import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, ZeroAddress, keccak256 } from 'ethers';
import { createFirstArtworkDraft } from '../src/features/collections/launch-config.js';
import { expectedPhaseCommitment, preparePhaseCallReview } from '../src/features/collections/phase-call-review.js';
import { checkCollectionPhaseLock } from '../scripts/check-collection-phase-lock.mjs';

function ready() {
    const draft = createFirstArtworkDraft();
    Object.assign(draft, { name: 'Studio', description: 'A test series.', maxSupply: 3, holderRights: 'Personal display.' });
    draft.media.metadataBaseURI = 'ipfs://fixture/';
    Object.assign(draft.phases[0], { allocation: 1, startAt: '2027-01-01T03:00:00+03:00', endAt: '2027-01-02T00:00:00Z' });
    draft.phases[0].pricing.priceEth = '0.010000000000000001';
    Object.assign(draft.phases[1], { allocation: 2, startAt: '2027-01-02T00:00:00Z', endAt: '2027-01-03T00:00:00Z' });
    return draft;
}

test('phase call downloads preserve exact reserve, UTC times and reviewed format', () => {
    const draft = ready();
    const review = preparePhaseCallReview(JSON.stringify(draft));
    assert.equal(review.phases[0].config.price, '10000000000000001');
    assert.equal(review.phases[0].config.start, 1798761600);
    assert.equal(review.phases[1].config.priceSource, 1);
    assert.equal(review.phases[1].config.fallbackEnabled, false);
    for (const change of [d => { d.chainId = 8453; }, d => { d.crafting.enabled = true; },
        d => { d.phases[1].pricing.sourcePhaseId = ''; }, d => { d.phases[1].eligibility.kind = 'genesis'; },
        d => { d.phases[1].pricing.fallback = 'fixed'; }, d => { d.phases[1].allocation = 9; },
        d => { d.phases[0].startAt = '2027-01-01T00:00:00.001Z'; }]) {
        const invalid = ready();
        change(invalid);
        assert.throws(() => preparePhaseCallReview(JSON.stringify(invalid)));
    }
});

test('two finalized nodes must identify the same original phase commitment on the reviewed collection', async () => {
    const draft = JSON.stringify(ready()), review = preparePhaseCallReview(draft);
    const address = '0x' + '1'.repeat(40), code = '0x6020', runtime = keccak256(code);
    const lock = '0x' + '2'.repeat(64), blockHash = '0x' + '3'.repeat(64);
    const block = { number: '0x10', hash: blockHash, transactions: [lock] };
    const at = { blockNumber: block.number, transactionHash: lock, blockHash, transactionIndex: '0x0' };
    const commitment = expectedPhaseCommitment(84532, address, review.phases);
    const event = new Interface(['event ConfigurationLocked(bytes32 indexed commitment,uint256 chainId)']);
    const log = { ...at, address, ...event.encodeEventLog('ConfigurationLocked', [commitment, 84532]), logIndex: '0x0' };
    const receipt = { ...at, status: '0x1', logs: [log] };
    const node = () => async (method, params) => {
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getBlockByNumber') return block;
        if (method === 'eth_getCode') {
            assert.deepEqual(params, [address, { blockHash, requireCanonical: true }]);
            return code;
        }
        assert.equal(method, 'eth_getTransactionReceipt');
        assert.deepEqual(params, [lock]);
        return receipt;
    };
    const check = providers => checkCollectionPhaseLock(draft, address, runtime, lock, providers);
    const result = await check([node(), node()]);
    assert.equal(result.receipt.transactionHash, lock);
    const rpc = node();
    await assert.rejects(check([rpc, rpc]), /independent RPC/);
    await assert.rejects(check([rpc, async (method, params) => method === 'eth_getCode' ? '0x60' : rpc(method, params)]), /runtime differs/);
    await assert.rejects(check([rpc, async (method, params) => method === 'eth_chainId' ? '0x1' : rpc(method, params)]), /Wrong RPC chain/);
    await assert.rejects(check([rpc, async (method, params) => method === 'eth_getTransactionReceipt'
        ? { ...receipt, logs: [{ ...log, logIndex: '0x1' }] } : rpc(method, params)]), /disagree/);
    await assert.rejects(checkCollectionPhaseLock(draft, ZeroAddress, runtime, lock, [node(), node()]), /collection address/);
    log.removed = true;
    await assert.rejects(check([node(), node()]), /log position/);
});
