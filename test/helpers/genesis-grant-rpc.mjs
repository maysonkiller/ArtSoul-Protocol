import assert from 'node:assert/strict';
import { Interface, ZeroAddress, id, keccak256, toQuantity } from 'ethers';
import { prepareGenesisGrants } from '../../scripts/prepare-genesis-grants.mjs';

const abi = new Interface([
    'function grantAuthority() view returns (address)', 'function founderRecipient() view returns (address)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)', 'event Locked(uint256 tokenId)',
    'event GenesisGranted(uint256 indexed tokenId,address indexed recipient,uint8 indexed category,bytes32 decisionHash)'
]);
const genesis = '0x' + '11'.repeat(20), safe = '0x' + '22'.repeat(20), founder = '0x' + '33'.repeat(20);
const mainnetCollector = '0x' + '44'.repeat(20), code = '0x610100';
const review = { chainId: 8453, safe, genesis, founder, genesisCodeHash: keccak256(code), policyHash: id('fixture policy'),
    grants: [{ tokenId: 0, category: 'Founder', recipient: founder, activityChainId: 0, evidenceHash: id('founder') },
        { tokenId: 201, category: 'MainnetActivity', recipient: mainnetCollector, activityChainId: 8453, evidenceHash: id('fixture eligibility') }] };
const tx = id('fixture grant tx'), block = { hash: id('fixture block'), number: '0x20', transactions: [id('other tx'), tx] };
const head = { hash: id('finalized'), number: '0x21' };
export function receipt(reviewed = review, hash = tx, header = block) {
    const genesis = reviewed.genesis;
    const result = { status: '0x1', transactionHash: hash, transactionIndex: '0x1', blockNumber: header.number, blockHash: header.hash, logs: [] };
    function log(address, name, args) {
        result.logs.push({ address, removed: false, blockNumber: header.number, blockHash: header.hash, transactionHash: hash,
            transactionIndex: '0x1', logIndex: toQuantity(8 + result.logs.length), ...abi.encodeEventLog(abi.getEvent(name), args) });
    }
    for (const grant of prepareGenesisGrants(reviewed).grants) {
        log(genesis, 'Transfer', [ZeroAddress, grant.recipient, grant.tokenId]);
        log(mainnetCollector, 'Locked', [grant.tokenId]);
        log(genesis, 'Locked', [grant.tokenId]);
        log(genesis, 'GenesisGranted', [grant.tokenId, grant.recipient, grant.category, grant.decisionHash]);
    }
    return result;
}
export function provider(overrides = {}, reviewed = review, hash = tx, header = block) {
    const { genesis, safe, founder } = reviewed;
    let canonicalReads = 0;
    return async (method, params) => {
        switch (method) {
        case 'eth_chainId': return overrides.chain ?? '0x2105';
        case 'eth_getBlockByNumber':
            if (params[0] === 'finalized') return overrides.head ?? head;
            assert.deepEqual(params, [header.number, false]);
            return (++canonicalReads > 1 && overrides.reorg) ? { ...header, hash: id('changed') } : header;
        case 'eth_getBlockByHash':
            assert.deepEqual(params, [header.hash, false]);
            return overrides.header ?? header;
        case 'eth_getTransactionReceipt':
            assert.deepEqual(params, [hash]);
            return overrides.receipt ?? receipt(reviewed, hash, header);
        case 'eth_getCode':
            assert.deepEqual(params, [genesis, { blockHash: header.hash, requireCanonical: true }]);
            return overrides.code ?? code;
        case 'eth_call': {
            assert.deepEqual(params[1], { blockHash: header.hash, requireCanonical: true });
            assert.equal(params[0].to, genesis);
            const { name } = abi.parseTransaction(params[0]);
            return abi.encodeFunctionResult(name, [name === 'grantAuthority' ? (overrides.safe ?? safe) : founder]);
        }
        default: throw Error(`Unexpected RPC method ${method}`);
        }
    };
}

export { review, tx, block, head, founder, mainnetCollector };
