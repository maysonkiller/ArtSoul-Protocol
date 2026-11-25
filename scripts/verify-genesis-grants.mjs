// Match a finalized grant receipt to the exact batch previously reviewed by the Safe.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface, ZeroAddress, ZeroHash, isHexString, keccak256 } from 'ethers';
import { prepareGenesisGrants } from './prepare-genesis-grants.mjs';
import { confirmFinalizedBlock, finalizedBlock, readRpc, requireIndependentProviders } from './verify-treasury-safes.mjs';

const abi = new Interface([
    'function grantAuthority() view returns (address)', 'function founderRecipient() view returns (address)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
    'event Locked(uint256 tokenId)',
    'event GenesisGranted(uint256 indexed tokenId,address indexed recipient,uint8 indexed category,bytes32 decisionHash)'
]);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const nonzeroHash = value => isHexString(value, 32) && value.toLowerCase() !== ZeroHash;

async function inspectBatch(rpc, prepared, founder, codeHash, hash) {
    const genesis = prepared.transaction.to;
    const [head, receipt] = await Promise.all([finalizedBlock(8453, rpc), rpc('eth_getTransactionReceipt', [hash])]);
    assert(receipt?.transactionHash?.toLowerCase() === hash && receipt.status === '0x1' && nonzeroHash(receipt.blockHash) &&
        quantity(receipt.blockNumber) && quantity(receipt.transactionIndex) && Array.isArray(receipt.logs), 'Invalid Genesis receipt');
    const block = { hash: receipt.blockHash.toLowerCase(), number: receipt.blockNumber.toLowerCase() };
    await confirmFinalizedBlock(rpc, head, block);
    const at = { blockHash: block.hash, requireCanonical: true };
    const [header, code, safeResult, founderResult] = await Promise.all([
        rpc('eth_getBlockByHash', [block.hash, false]), rpc('eth_getCode', [genesis, at]),
        ...['grantAuthority', 'founderRecipient'].map(name => rpc('eth_call', [{ to: genesis, data: abi.encodeFunctionData(name) }, at]))
    ]);
    assert(header?.hash?.toLowerCase() === block.hash && header.number?.toLowerCase() === block.number &&
        Array.isArray(header.transactions) && header.transactions[BigInt(receipt.transactionIndex)]?.toLowerCase() === hash,
    'Transaction absent at its canonical position');
    assert(code !== '0x' && keccak256(code) === codeHash, 'Different Genesis runtime');
    assert.equal(safeResult?.toLowerCase(), abi.encodeFunctionResult('grantAuthority', [prepared.safe]), 'Different grant authority');
    assert.equal(founderResult?.toLowerCase(), abi.encodeFunctionResult('founderRecipient', [founder]), 'Different founder recipient');

    // Receiver hooks and the outer Safe execution may emit their own logs between issuer events.
    const logs = receipt.logs.filter(log => log?.address?.toLowerCase() === genesis.toLowerCase());
    assert.equal(logs.length, prepared.grants.length * 3, 'Incomplete or additional Genesis events');
    let previous = -1n;
    let offset = 0;
    function match(name, args) {
        const log = logs[offset++];
        assert(log.removed === false && log.blockHash?.toLowerCase() === block.hash && log.blockNumber?.toLowerCase() === block.number &&
            log.transactionHash?.toLowerCase() === hash && log.transactionIndex?.toLowerCase() === receipt.transactionIndex.toLowerCase() &&
            quantity(log.logIndex) && BigInt(log.logIndex) > previous, 'Invalid Genesis log position');
        const expected = abi.encodeEventLog(abi.getEvent(name), args);
        assert.deepEqual(log.topics.map(topic => topic.toLowerCase()), expected.topics, `Different ${name} topics`);
        assert.equal(log.data?.toLowerCase(), expected.data, `Different ${name} data`);
        previous = BigInt(log.logIndex);
        return previous.toString();
    }
    const grants = prepared.grants.map(({ tokenId, category, recipient, decisionHash }) => {
        const mintIndex = match('Transfer', [ZeroAddress, recipient, tokenId]);
        const lockIndex = match('Locked', [tokenId]);
        const grantIndex = match('GenesisGranted', [tokenId, recipient, category, decisionHash]);
        return { tokenId, category, recipient, decisionHash, mintIndex, lockIndex, grantIndex };
    });
    await confirmFinalizedBlock(rpc, await finalizedBlock(8453, rpc), block);
    return { chainId: 8453, genesis, safe: prepared.safe, transactionHash: hash, block,
        transactionIndex: BigInt(receipt.transactionIndex).toString(), grants };
}

export async function verifyGenesisGrants(review, transactionHash, providers) {
    const prepared = prepareGenesisGrants(review);
    assert(nonzeroHash(review.genesisCodeHash) && nonzeroHash(transactionHash), 'Supply the reviewed initialized runtime hash and mined transaction hash');
    const binding = { genesisCodeHash: review.genesisCodeHash.toLowerCase(), founder: review.founder.toLowerCase(),
        policyHash: review.policyHash.toLowerCase(), calldataHash: keccak256(prepared.transaction.data) };
    requireIndependentProviders(providers);
    const [first, second] = await Promise.all(providers.map(rpc => inspectBatch(rpc, prepared, binding.founder,
        binding.genesisCodeHash, transactionHash.toLowerCase())));
    assert.deepEqual(first, second, 'Providers disagree on finalized Genesis grants');
    return { ...first, ...binding };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [, , file, hash, ...extra] = process.argv;
    if (!file || !hash || extra.length) {
        console.error('Usage: node scripts/verify-genesis-grants.mjs reviewed-grants.json TX_HASH');
        process.exitCode = 1;
    } else try {
        const review = JSON.parse(await readFile(file, 'utf8'));
        const providers = [process.env.ARTSOUL_CUSTODY_RPC_URL, process.env.ARTSOUL_CUSTODY_RPC_CHECK_URL].map(readRpc);
        console.log(JSON.stringify(await verifyGenesisGrants(review, hash, providers), null, 2));
    } catch {
        console.error('Genesis grants could not be confirmed. Check the reviewed batch, runtime hash, transaction and two independent Base mainnet endpoints.');
        process.exitCode = 1;
    }
}
