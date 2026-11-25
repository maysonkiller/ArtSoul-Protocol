// Verify a prepared Safe 1.4.1 grant locally. Its calldata and signatures never reach either RPC.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Interface, TypedDataEncoder, ZeroAddress, getAddress, getBytes, hashMessage, isHexString, keccak256, recoverAddress } from 'ethers';
import { prepareGenesisGrants } from './prepare-genesis-grants.mjs';
import { readLocalGrantJson } from './check-genesis-grant-documents.mjs';
import { confirmFinalizedBlock, finalizedBlock, readRpc, requireIndependentProviders, verifySafeAtBlock } from './verify-treasury-safes.mjs';

const abi = new Interface(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)',
    'function nonce() view returns (uint256)', 'function VERSION() view returns (string)',
    'function grantAuthority() view returns (address)', 'function founderRecipient() view returns (address)']);
const fields = abi.getFunction('execTransaction').inputs.slice(0, 9).map(({ name, type }) => ({ name, type }));
const safeTypes = { SafeTx: [...fields, { name: 'nonce', type: 'uint256' }] };

export function checkGrantConfirmations(prepared, custody, proposal, nonce) {
    assert(proposal.chainId === 8453 && getAddress(proposal.to) === prepared.safe &&
        getAddress(custody.address) === prepared.safe && proposal.value === '0', 'Wrong Safe, chain or outer value');
    const decoded = abi.decodeFunctionData('execTransaction', proposal.data);
    assert.equal(abi.encodeFunctionData('execTransaction', decoded), proposal.data.toLowerCase(), 'Noncanonical Safe calldata');
    assert(decoded.to === prepared.transaction.to && decoded.value === 0n && decoded.operation === 0n &&
        decoded.data === prepared.transaction.data, 'Different Genesis grant CALL');
    assert(decoded.safeTxGas === 0n && decoded.baseGas === 0n && decoded.gasPrice === 0n &&
        decoded.gasToken === ZeroAddress && decoded.refundReceiver === ZeroAddress, 'Unreviewed gas or refund terms');
    const digest = TypedDataEncoder.hash({ chainId: 8453, verifyingContract: prepared.safe }, safeTypes,
        { ...Object.fromEntries(fields.map(({ name }) => [name, decoded[name]])), nonce });
    const owners = new Set(custody.owners.map(getAddress));
    assert(owners.size === custody.owners.length && !owners.has(ZeroAddress) &&
        Number.isSafeInteger(custody.threshold) && custody.threshold >= 2 && custody.threshold <= owners.size, 'Invalid grant owner quorum');
    const signatures = decoded.signatures.slice(2);
    const count = signatures.length / 130;
    assert(Number.isInteger(count) && count >= custody.threshold && count <= owners.size, 'Incomplete or unsupported confirmations');
    let previous = 0n;
    for (let offset = 0; offset < signatures.length; offset += 130) {
        const raw = signatures.slice(offset, offset + 130);
        const tag = parseInt(raw.slice(128), 16);
        assert([27, 28, 31, 32].includes(tag), 'Unsupported Safe signature type');
        const personal = tag > 30;
        const signer = recoverAddress(personal ? hashMessage(getBytes(digest)) : digest,
            { r: '0x' + raw.slice(0, 64), s: '0x' + raw.slice(64, 128), v: personal ? tag - 4 : tag });
        assert(owners.has(signer) && BigInt(signer) > previous, 'Invalid, duplicate or unsorted owner confirmation');
        previous = BigInt(signer);
    }
    return { checkedGrants: prepared.grants.length, confirmations: count, safeTxHash: digest };
}

export async function verifyGenesisSafeProposal(review, custody, proposal, providers) {
    const prepared = prepareGenesisGrants(review);
    const { genesisCodeHash, founder: founderAddress } = review;
    custody = structuredClone(custody);
    proposal = { ...proposal };
    assert(isHexString(genesisCodeHash, 32) && getAddress(custody.address) === prepared.safe, 'Different reviewed deployment');
    requireIndependentProviders(providers);
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(8453, rpc)));
    const block = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    const at = { blockHash: block.hash, requireCanonical: true };
    const nonces = await Promise.all(providers.map(async (rpc, i) => {
        await confirmFinalizedBlock(rpc, heads[i], block);
        await verifySafeAtBlock(custody, 'Genesis grant Safe', rpc, block);
        const genesis = prepared.transaction.to;
        const view = (to, name) => rpc('eth_call', [{ to, data: abi.encodeFunctionData(name) }, at]);
        const [code, authority, founder, version, nonce] = await Promise.all([rpc('eth_getCode', [genesis, at]),
            view(genesis, 'grantAuthority'), view(genesis, 'founderRecipient'), view(prepared.safe, 'VERSION'), view(prepared.safe, 'nonce')]);
        assert(code !== '0x' && keccak256(code) === genesisCodeHash.toLowerCase() &&
            authority.toLowerCase() === abi.encodeFunctionResult('grantAuthority', [prepared.safe]) &&
            founder.toLowerCase() === abi.encodeFunctionResult('founderRecipient', [founderAddress]), 'Different Genesis deployment binding');
        assert.equal(version.toLowerCase(), abi.encodeFunctionResult('VERSION', ['1.4.1']), 'Unsupported Safe version');
        assert(isHexString(nonce, 32), 'Invalid Safe nonce');
        await confirmFinalizedBlock(rpc, await finalizedBlock(8453, rpc), block);
        return BigInt(nonce);
    }));
    assert.equal(nonces[0], nonces[1], 'Different Safe nonce at the reviewed block');
    return { ...checkGrantConfirmations(prepared, custody, proposal, nonces[0]), nonce: String(nonces[0]), block };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 5) throw new Error();
        const [review, custody, proposal] = await Promise.all(process.argv.slice(2).map(readLocalGrantJson));
        const providers = [process.env.ARTSOUL_CUSTODY_RPC_URL, process.env.ARTSOUL_CUSTODY_RPC_CHECK_URL].map(readRpc);
        console.log(JSON.stringify(await verifyGenesisSafeProposal(review, custody, proposal, providers)));
    } catch {
        console.error('Genesis proposal could not be verified. Check the three local review files, confirmations and two private RPC endpoints.');
        process.exitCode = 1;
    }
}
