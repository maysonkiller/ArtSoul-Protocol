import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, toBeHex, toQuantity } from 'ethers';
import { verifyOutbidRefund, verifyRefundBatch } from '../scripts/read-ordinary-outbid-refund.mjs';
import { resaleFixture } from './helpers/ordinary-resale-postgres.mjs';

const abi = new Interface([
    'event OutbidRefundQueued(uint256 indexed auctionId,uint256 indexed index,address indexed creditor,uint256 amount)',
    'event OutbidRefundProcessed(uint256 indexed auctionId,uint256 indexed index,address indexed creditor,uint256 amount,bool paid)',
    'function refundProgress(uint256) returns (uint256,uint256)',
    'function refundBatchLimit() returns (uint256)', 'function refundTransferGas() returns (uint256)',
    'function processRefunds(uint256,uint256)'
]);

function verify(options = {}) {
    const queued = resaleFixture(93);
    const processed = resaleFixture(93, {blockNumber:194, blockHash:toBeHex(194,32), transactionHash:toBeHex(1094,32)});
    const creditor = toBeHex(12,20), amount = 10000000000000000n;
    const providers = queued.providers.map(({origin}, i) => Object.assign(async (method, params) => {
        if (method === 'eth_chainId') return '0x14a34';
        const key = params[1]?.blockHash ?? params[0];
        const f = ['finalized', processed.location.blockHash, processed.location.transactionHash, toQuantity(194)].includes(key) ? processed : queued;
        const paid = f === processed;
        if (method === 'eth_getTransactionReceipt') {
            const {blockNumber, blockHash, transactionHash} = f.location;
            const position = {blockNumber:toQuantity(blockNumber), blockHash, transactionHash, transactionIndex:'0x0'};
            const name = paid ? 'OutbidRefundProcessed' : 'OutbidRefundQueued';
            const args = [1, 0, creditor, paid ? options.amount ?? amount : amount];
            if (paid) args.push(options.paid ?? true);
            const log = {...position, logIndex:'0x3', address:f.pair.coreAddress, ...abi.encodeEventLog(name,args)};
            return {...position, status:'0x1', logs:[log]};
        }
        if (method === 'eth_call' && params[0].data === abi.encodeFunctionData('refundProgress',[1])) {
            assert.deepEqual(params[1], {blockHash:f.location.blockHash, requireCanonical:true});
            assert.equal(params[0].to, f.pair.coreAddress);
            return abi.encodeFunctionResult('refundProgress',[paid ? options.cursor ?? 1 : 0, 2]);
        }
        return f.providers[i](method,params);
    }, {origin}));
    return verifyOutbidRefund(queued.pair, '1', options.entry ?? '0', queued.location.transactionHash,
        processed.location.transactionHash, providers);
}

test('matches each finalized outbid entry to actual delivery or withdrawable credit', async () => {
    for (const paid of [true,false]) {
        const {queued, processed, disposition} = await verify({paid});
        assert.equal(disposition, paid ? 'delivered' : 'credited-for-withdrawal');
        assert.equal(queued.amountWei, '10000000000000000');
        assert.equal(processed.amountWei, queued.amountWei);
        assert.equal(queued.rpcReadings, 2);
        assert.equal(processed.rpcReadings, 2);
    }
});

test('requires the same indexed obligation, full amount and processed cursor', async () => {
    await assert.rejects(verify({amount:1n}), /disposition do not match/);
    await assert.rejects(verify({cursor:0}), /disagrees with finalized queue/);
    await assert.rejects(verify({entry:'1'}), /one matching ordinary refund event/);
});

async function verifyBatch(options = {}) {
    const f = resaleFixture(98);
    const { transactionHash, blockHash } = f.location;
    const sender = toBeHex(15,20), creditor = toBeHex(12,20);
    const position = { blockHash, transactionHash, blockNumber: toQuantity(f.location.blockNumber), transactionIndex: '0x0' };
    const providers = f.providers.map((base, i) => Object.assign(async (method, args) => {
        const senderAndCore = { from: sender, to: f.pair.coreAddress };
        if (method === 'eth_getTransactionByHash') return { ...position, ...senderAndCore, hash: transactionHash, value: '0x0',
            input: abi.encodeFunctionData('processRefunds',[1,options.requested ?? 8]) };
        if (method === 'eth_getTransactionReceipt') return { ...position, ...senderAndCore, type:'0x2', status:'0x1',
            gasUsed: '0x64', effectiveGasPrice:'0x2', l1Fee: i === 1 && options.feeDisagreement ? '0x2' : '0x1',
            logs: (options.ids ?? [5,6]).map((entry,index) => ({ ...position, address: f.pair.coreAddress, logIndex: toQuantity(index + 1),
                ...abi.encodeEventLog('OutbidRefundProcessed',[1,entry,creditor,100,index===0]) })) };
        if (method === 'eth_call') {
            const call = abi.parseTransaction(args[0]);
            if (call?.name === 'refundProgress') return abi.encodeFunctionResult(call.name,[options.cursor ?? 10,12]);
            if (call?.name === 'refundBatchLimit') return abi.encodeFunctionResult(call.name,[options.limit ?? 8]);
            if (call?.name === 'refundTransferGas') return abi.encodeFunctionResult(call.name,[30000]);
        }
        return base(method,args);
    }, { origin: base.origin }));
    return verifyRefundBatch(f.pair,transactionHash,providers);
}

test('reports signed batch calldata, distinct recipients, per-entry dispositions and whole-transaction fee separately', async () => {
    const { batch, fees, matchesReviewedLimits, perRecipientGasMeasurement } = await verifyBatch();
    assert.equal(matchesReviewedLimits,true);
    assert.equal(perRecipientGasMeasurement,'not_in_receipt');
    assert.deepEqual([batch.requestedEntries,batch.processedEntries,batch.distinctCreditors,batch.deliveredEntries,batch.creditedEntries],
        ['8',2,1,1,1]);
    assert.deepEqual([fees.gasUsed,fees.executionFeeWei,fees.l1DataFeeWei,fees.networkFeeWei],['100','200','1','201']);
    assert.equal((await verifyBatch({ ids: [] })).batch.processedEntries,0);
    assert.equal((await verifyBatch({ limit: 9 })).matchesReviewedLimits,false);
    await assert.rejects(verifyBatch({ feeDisagreement: true }), /FIELDS/);
    await assert.rejects(verifyBatch({ ids: [5,7] }), /finalized queue/);
    await assert.rejects(verifyBatch({ cursor: 6 }), /finalized queue/);
    await assert.rejects(verifyBatch({ requested: 1 }), /exceeds/);
});
