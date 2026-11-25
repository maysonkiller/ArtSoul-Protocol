import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Interface, ZeroAddress, toQuantity } from 'ethers';
import { lateBidWindow, rehearsalArtwork, rehearsalLateBid as bid, sameReview, walletRequest } from '../scripts/rehearsal-review/client.mjs';
import { firstLateBidReview, inspectFirstBid, prepareFirstBid } from '../scripts/review-rehearsal-late-bid.mjs';

const start = bid.deadline - bid.window;
const block = { blockHash: '0x' + '2'.repeat(64), requireCanonical: true };
const market = new Interface(['function minimumBid(uint256) view returns(uint256)',
    'function requiredDepositForBid(uint256) view returns(uint256)', 'function placeBid(uint256,uint256) payable']);
const reserve = 1000000000000000n;
const valid = { artworkId:1n, startPrice:reserve, originalEnd:BigInt(bid.deadline), end:BigInt(bid.deadline),
    deadline:0n, state:1n, highestBidder:ZeroAddress, price:0n, deposit:0n };
const observedCode = '0x1234';
const codeChecks = [rehearsalArtwork.core, rehearsalArtwork.nft].map(address => ({
    address, sha256:createHash('sha256').update(Buffer.from(observedCode.slice(2), 'hex')).digest('hex')
}));

function nodeRead(overrides = {}) {
    const methods = {
        eth_getCode: () => '0x',
        eth_getTransactionCount: () => '0x1',
        eth_getBalance: () => toQuantity(2n * BigInt(bid.deposit)),
        eth_call: ([tx, at]) => {
            const decoded = market.parseTransaction(tx);
            if (decoded.name === 'placeBid') {
                assert.deepEqual([...decoded.args], [1n, reserve]);
                assert.equal(tx.from, bid.bidder);
                assert.equal(tx.to, rehearsalArtwork.core);
                assert.equal(tx.value, bid.deposit);
                assert.equal(at, 'pending');
                return '0x';
            }
            assert.deepEqual(at, block);
            return market.encodeFunctionResult(decoded.name, [decoded.name === 'minimumBid' ? reserve : BigInt(bid.deposit)]);
        }, ...overrides
    };
    return (method, params) => {
        assert(Object.hasOwn(methods, method), 'Unexpected RPC ' + method);
        return methods[method](params);
    };
}

function plan(read = nodeRead(), auction = valid, time = start) {
    return prepareFirstBid(read, block, time, auction, codeChecks, time);
}

test('a first bid can be reviewed only from the inclusive opening second to the exclusive deadline', async () => {
    assert.equal(lateBidWindow(start-1, start), 'early');
    assert.equal(lateBidWindow(start, start-1), 'early');
    assert.equal(lateBidWindow(start, start), 'open');
    assert.equal(lateBidWindow(bid.deadline-1, bid.deadline-1), 'open');
    assert.equal(lateBidWindow(bid.deadline-1, bid.deadline), 'expired');
    assert.throws(() => lateBidWindow(start, start+61), /disagree/);
    const noRead = () => assert.fail('A closed review should not simulate a bid');
    for (const [time, status] of [[start-1,'early'],[bid.deadline,'expired']]) {
        assert.deepEqual(await plan(noRead, valid, time), {lateBidStatus:status});
    }
    for (const change of [{state:2n}, {end:valid.end+600n}, {highestBidder:bid.bidder}, {price:reserve}, {deposit:1n}]) {
        assert.deepEqual(await plan(noRead, {...valid,...change}), {complete:true, lateBidStatus:'changed'});
    }
});

test('the planner requires reviewed auction terms, independently reported providers, funding and a successful pending simulation', async () => {
    const read = nodeRead();
    await assert.rejects(firstLateBidReview([read, read]), /independent/);
    const wrongCode = async (method) => {
        if (method === 'eth_getBlockByNumber') return {hash:block.blockHash, timestamp:toQuantity(start)};
        if (method === 'eth_getCode') return observedCode;
        const auction = new Interface(['function auctions(uint256) view returns(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)']);
        return auction.encodeFunctionResult('auctions', [1n,reserve,bid.deadline,bid.deadline,0n,ZeroAddress,0n,0n,1n,ZeroAddress]);
    };
    await assert.rejects(inspectFirstBid(wrongCode,start), /runtime/);
    await assert.rejects(plan(read, {...valid, artworkId:2n}), /recorded opening/);
    await assert.rejects(plan(nodeRead({eth_getCode: () => observedCode})), /externally owned/);
    await assert.rejects(plan(nodeRead({eth_getTransactionCount: ([, at]) => at === 'pending' ? '0x2' : '0x1'})), /pending transaction/);
    await assert.rejects(plan(nodeRead({eth_getBalance: () => bid.deposit})), /plus test gas/);
    await assert.rejects(plan(nodeRead({eth_call: ([tx, at]) => {
        const method = market.parseTransaction(tx).name;
        return method === 'requiredDepositForBid' ? market.encodeFunctionResult(method,[1n]) : read('eth_call',[tx,at]);
    }})), /deposit has changed/);
    await assert.rejects(plan(nodeRead({eth_call: ([call, at]) => at === 'pending' ? '0x01' : read('eth_call', [call,at])})), /simulation failed/);
    const ready = await plan();
    assert.equal(ready.operation, 'placeBid');
    assert.equal(ready.value, bid.deposit);
    assert.equal(ready.dataSha256, bid.dataSha256);
});

test('the wallet constructs one exact payable call after checking chain, sender, nonce, runtimes, timing and pending execution', async t => {
    t.mock.timers.enable({ apis:['Date'], now:start*1000 });
    const prepared = { chainId:'0x14a34', payer:bid.bidder, ...await plan() };
    const wallet = (overrides = {}) => ({ request: ({method,params}) => nodeRead({
        eth_chainId: () => '0x14a34', eth_accounts: () => [bid.bidder],
        eth_getCode: ([address]) => address === bid.bidder ? '0x' : observedCode,
        eth_getBlockByNumber: () => ({timestamp:toQuantity(start)}), ...overrides
    })(method,params) });
    assert.deepEqual(await walletRequest(wallet(),prepared), { from:bid.bidder, to:rehearsalArtwork.core, chainId:'0x14a34',
        nonce:'0x1', value:bid.deposit, data:market.encodeFunctionData('placeBid',[1n,reserve]) });
    await assert.rejects(walletRequest(wallet({eth_chainId: () => '0x2105'}),prepared), /Base Sepolia/);
    await assert.rejects(walletRequest(wallet({eth_accounts: () => [rehearsalArtwork.core]}),prepared), /Select the displayed/);
    await assert.rejects(walletRequest(wallet(),{ ...prepared,value:'0x1' }), /Unexpected bidder or deposit/);
    await assert.rejects(walletRequest(wallet(),{ ...prepared,data:market.encodeFunctionData('placeBid',[2n,reserve]) }), /data changed/);
    assert.equal(sameReview(prepared,{...prepared,value:'0x1'}),false);
    t.mock.timers.setTime(bid.deadline*1000);
    await assert.rejects(walletRequest(wallet({eth_getBlockByNumber: () => ({timestamp:toQuantity(bid.deadline)})}),prepared), /first late bid is unavailable/);
});
