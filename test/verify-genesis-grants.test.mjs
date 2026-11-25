import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, ZeroAddress, id, keccak256, toQuantity } from 'ethers';
import { prepareGenesisGrants } from '../scripts/prepare-genesis-grants.mjs';
import { verifyGenesisGrants } from '../scripts/verify-genesis-grants.mjs';

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
function receipt() {
    const result = { status: '0x1', transactionHash: tx, transactionIndex: '0x1', blockNumber: block.number, blockHash: block.hash, logs: [] };
    function log(address, name, args) {
        result.logs.push({ address, removed: false, blockNumber: block.number, blockHash: block.hash, transactionHash: tx,
            transactionIndex: '0x1', logIndex: toQuantity(8 + result.logs.length), ...abi.encodeEventLog(abi.getEvent(name), args) });
    }
    for (const grant of prepareGenesisGrants(review).grants) {
        log(genesis, 'Transfer', [ZeroAddress, grant.recipient, grant.tokenId]);
        log(mainnetCollector, 'Locked', [grant.tokenId]);
        log(genesis, 'Locked', [grant.tokenId]);
        log(genesis, 'GenesisGranted', [grant.tokenId, grant.recipient, grant.category, grant.decisionHash]);
    }
    return result;
}
function provider(overrides = {}) {
    let canonicalReads = 0;
    return async (method, params) => {
        switch (method) {
        case 'eth_chainId': return overrides.chain ?? '0x2105';
        case 'eth_getBlockByNumber':
            if (params[0] === 'finalized') return overrides.head ?? head;
            assert.deepEqual(params, [block.number, false]);
            return (++canonicalReads > 1 && overrides.reorg) ? { ...block, hash: id('changed') } : block;
        case 'eth_getBlockByHash':
            assert.deepEqual(params, [block.hash, false]);
            return overrides.header ?? block;
        case 'eth_getTransactionReceipt':
            assert.deepEqual(params, [tx]);
            return overrides.receipt ?? receipt();
        case 'eth_getCode':
            assert.deepEqual(params, [genesis, { blockHash: block.hash, requireCanonical: true }]);
            return overrides.code ?? code;
        case 'eth_call': {
            assert.deepEqual(params[1], { blockHash: block.hash, requireCanonical: true });
            assert.equal(params[0].to, genesis);
            const { name } = abi.parseTransaction(params[0]);
            return abi.encodeFunctionResult(name, [name === 'grantAuthority' ? (overrides.safe ?? safe) : founder]);
        }
        default: throw Error(`Unexpected RPC method ${method}`);
        }
    };
}

test('two providers confirm only the reviewed Genesis serials including founder zero, preserving all three log positions', async () => {
    const result = await verifyGenesisGrants(review, tx, [provider(), provider()]);
    assert.deepEqual(result.block, { number: block.number, hash: block.hash });
    assert.equal(result.transactionIndex, '1');
    assert.deepEqual(result.grants.map(g => [g.tokenId, g.recipient, g.mintIndex, g.lockIndex, g.grantIndex]),
        [[0, founder, '8', '10', '11'], [201, mainnetCollector, '12', '14', '15']]);
    assert.deepEqual(result.grants.map(g => g.decisionHash), prepareGenesisGrants(review).grants.map(g => g.decisionHash));
});

test('rejects a wrong chain, deployment, Safe, runtime or policy even for an internally consistent receipt', async () => {
    const two = [provider(), provider()];
    await assert.rejects(verifyGenesisGrants({ ...review, chainId: 84532 }, tx, two), /mainnet/);
    await assert.rejects(verifyGenesisGrants({ ...review, policyHash: id('other policy') }, tx, two), /GenesisGranted/);
    await assert.rejects(verifyGenesisGrants(review, tx, [two[0], two[0]]), /independent/);
    for (const overrides of [{ chain: '0x14a34' }, { code: '0x62' }, { safe: founder }]) {
        await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider(overrides)]));
    }
    const wrongIssuer = receipt();
    wrongIssuer.logs.forEach(log => { log.address = mainnetCollector; });
    await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider({receipt: wrongIssuer})]), /Genesis events/);
});

test('rejects missing, reordered, removed, duplicated or incorrect mint, lock and grant evidence', async () => {
    for (const edit of [
        logs => logs.splice(2, 1), logs => logs.push(logs[0]), logs => logs.reverse(),
        logs => { logs[2].removed = true; }, logs => { logs[2].logIndex = logs[0].logIndex; },
        logs => { logs[2].transactionHash = id('another tx'); }, logs => { logs[2].blockHash = head.hash; },
        logs => { logs[0].topics[3] = logs[4].topics[3]; }, logs => { logs[2].data = logs[6].data; },
        logs => { logs[3].topics[2] = logs[7].topics[2]; }, logs => { logs[3].topics[3] = logs[7].topics[3]; },
        logs => { logs[7].topics[1] = logs[3].topics[1]; }, logs => { logs[7].data = id('other decision'); }
    ]) {
        const record = receipt();
        edit(record.logs);
        await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider({ receipt: record })]));
    }
});

test('requires finalized inclusion, stable canonical hash on both reads, and agreement on the exact receipt positions', async () => {
    const changed = receipt();
    for (const log of changed.logs) log.logIndex = toQuantity(BigInt(log.logIndex) + 1n);
    for (const overrides of [{ head: { ...head, number: '0x1f' } }, { reorg: true },
        { header: { ...block, transactions: [...block.transactions].reverse() } }, { receipt: { ...receipt(), status: '0x0' } },
        { receipt: changed }]) {
        await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider(overrides)]));
    }
});
