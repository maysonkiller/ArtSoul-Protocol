import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, toBeHex, toQuantity } from 'ethers';
import { verifyOutbidRefund } from '../scripts/read-ordinary-outbid-refund.mjs';
import { resaleFixture } from './helpers/ordinary-resale-postgres.mjs';

const abi = new Interface([
    'event OutbidRefundQueued(uint256 indexed auctionId,uint256 indexed index,address indexed creditor,uint256 amount)',
    'event OutbidRefundProcessed(uint256 indexed auctionId,uint256 indexed index,address indexed creditor,uint256 amount,bool paid)',
    'function refundProgress(uint256) returns (uint256,uint256)'
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
