import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Interface, ZeroAddress, toQuantity } from 'ethers';
import { refundCollectors, refundOpeningHash, refundRequestAt } from '../scripts/rehearsal-review/refund-auction.mjs';
import { rehearsalArtwork, sameReview, walletRequest } from '../scripts/rehearsal-review/client.mjs';
import { refundAuctionPlan } from '../scripts/review-rehearsal-refund-auction.mjs';

const market = new Interface([
    'function auctions(uint256) view returns(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)',
    'function dueAuctionAction(uint256) view returns(uint8)', 'function refundProgress(uint256) view returns(uint256,uint256)',
    'function minimumBid(uint256) view returns(uint256)', 'function requiredDepositForBid(uint256) view returns(uint256)',
    'function placeBid(uint256,uint256) payable', 'function closeAuction(uint256)', 'function processRefunds(uint256,uint256)'
]);
const reserve = 1000000000000000n, deposit = 10000000000000000n;
const core = rehearsalArtwork.core, [first, second] = refundCollectors;
const hash = '0x' + 'ab'.repeat(32), code = '0x6010';
const digest = hex => createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex');

function scenario(stage) {
    const bid = stage === 'first' || stage === 'outbid';
    const view = {
        auctions: [2n, reserve, 1900000000n, 1900000000n, 0n, stage === 'first' ? ZeroAddress : stage === 'outbid' ? first : second,
            stage === 'first' ? 0n : stage === 'outbid' ? reserve : reserve + deposit, stage === 'first' ? 0n : deposit,
            stage === 'refund' ? 2 : 1, ZeroAddress],
        refundProgress: [0n, bid ? 0n : 1n], dueAuctionAction: [stage === 'close' ? 1 : 0],
        minimumBid: [stage === 'first' ? reserve : reserve + deposit], requiredDepositForBid: [deposit]
    };
    const payer = stage === 'outbid' ? second : first;
    const rpc = async (method, params) => {
        if (method === 'eth_accounts') return [payer];
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getTransactionCount') return '0x3';
        if (method === 'eth_getCode') return params[0] === payer ? '0x' : code;
        assert.equal(method, 'eth_call');
        const [tx, at] = params;
        assert.equal(tx.to, core);
        assert.equal(at, 'pending');
        const parsed = market.parseTransaction(tx);
        if (view[parsed.name]) {
            assert.equal(parsed.args[0], parsed.name === 'requiredDepositForBid' ? view.minimumBid[0] : 2n);
            return market.encodeFunctionResult(parsed.name, view[parsed.name]);
        }
        assert.equal(tx.from, payer);
        return '0x';
    };
    return { view, rpc, payer, wallet: { request: ({method, params}) => rpc(method, params) } };
}

for (const [stage, operation, args] of [
    ['first', 'placeBid', [2n, reserve]], ['outbid', 'placeBid', [2n, reserve + deposit]],
    ['close', 'closeAuction', [2n]], ['refund', 'processRefunds', [2n, 1n]]
]) {
    test('auction 2 ' + stage + ' reviews only its exact state, sender, call and value', async () => {
        const { view, rpc, payer, wallet } = scenario(stage);
        const requested = await refundRequestAt(rpc, core, stage, 'pending');
        const data = market.encodeFunctionData(operation, args);
        const value = operation === 'placeBid' ? toQuantity(deposit) : '0x0';
        assert.equal(requested.operation, operation);
        assert.equal(requested.data, data);
        const plan = { ...requested, chainId: '0x14a34', rehearsalWorkId: '2', refundStage: stage,
            openingHash: refundOpeningHash, queuedHash: operation === 'placeBid' ? undefined : hash, dataSha256: digest(data),
            codeChecks: [core, rehearsalArtwork.nft].map(address => ({ address, sha256: digest(code) })),
            deployments: [], nonce: '0x3', target: core };
        const tx = await walletRequest(wallet, plan);
        assert.deepEqual(tx, { from: payer, chainId: '0x14a34', nonce: '0x3', to: core, value, data });
        await assert.rejects(walletRequest(wallet, { ...plan, value: '0x1' }), /request changed/);
        assert.equal(sameReview(plan, { ...plan, refundStage: 'other' }), false);
        if (stage === 'outbid') {
            view.minimumBid = [reserve + deposit + 1n];
            await assert.rejects(walletRequest(wallet, plan));
            view.minimumBid = [reserve + deposit];
        }
        if (stage === 'first') view.auctions[5] = first;
        if (stage === 'outbid') view.auctions[5] = second;
        if (stage === 'close') view.auctions[8] = 2;
        if (stage === 'refund') view.refundProgress[0] = 1n;
        assert.ok((await refundRequestAt(rpc, core, stage, 'pending')).unavailable);
        await assert.rejects(walletRequest(wallet, plan), /request changed/);
    });
}

test('auction 2 requires its final close before a deposit can be processed', async () => {
    const { view, rpc } = scenario('refund');
    view.auctions[8] = 1;
    assert.match((await refundRequestAt(rpc, core, 'refund', 'pending')).unavailable, /closed on-chain/);
});

test('two nodes observing the opening before finality expose its height and no transaction', async () => {
    const node = (origin, number) => Object.assign(async (method, params) => {
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getBlockByNumber') return { number: toQuantity(number), hash };
        assert.equal(method, 'eth_getTransactionReceipt');
        assert.deepEqual(params, [refundOpeningHash]);
        return { transactionHash: refundOpeningHash, status: '0x1', from: '0xE6d6658DD5013B30Ab8cA9CBD667D0b5a5A1b215',
            to: core, blockNumber: '0x40', blockHash: hash };
    }, { origin });
    const nodes = [node('https://one.example', 60), node('https://two.example', 63)];
    const result = await refundAuctionPlan('first', undefined, nodes);
    assert.deepEqual(Object.keys(result), ['refundStatus']);
    assert.match(result.refundStatus, /block 64.*height is 60/);
    assert.equal(sameReview({}, result), false);
    await assert.rejects(refundAuctionPlan('refund', undefined, nodes), /signed outbid/);
});
