import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Interface, ZeroAddress, toQuantity } from 'ethers';
import { lateBidWindow, rehearsalArtwork, rehearsalLateBid as bid, sameReview, walletRequest } from '../scripts/rehearsal-review/client.mjs';
import { checkWinnerSettlement, finalizedAuctionStatus, firstLateBidReview, inspectFirstBid, prepareFirstBid, readBidExtension, verifyFirstBidReceipt } from '../scripts/review-rehearsal-late-bid.mjs';

const start = bid.deadline - bid.window;
const block = { blockHash: '0x' + '2'.repeat(64), requireCanonical: true };
const market = new Interface(['function minimumBid(uint256) view returns(uint256)',
    'function requiredDepositForBid(uint256) view returns(uint256)', 'function placeBid(uint256,uint256) payable']);
const reserve = 1000000000000000n;
const valid = { artworkId:1n, startPrice:reserve, originalEnd:BigInt(bid.deadline), end:BigInt(bid.deadline),
    deadline:0n, state:1n, highestBidder:ZeroAddress, price:0n, deposit:0n };
const observedCode = '0x1234';
test('winner review binds the exact late bid, deposit and both eligible settlement windows', () => {
    const end = valid.end + BigInt(bid.window);
    const won = {...valid,end,highestBidder:bid.bidder,price:reserve,deposit:BigInt(bid.deposit)};
    checkWinnerSettlement(won,end);
    checkWinnerSettlement({...won,state:2n,deadline:end+100n},end+99n);
    assert.throws(()=>checkWinnerSettlement(won,end-1n));
    for (const overrides of [{state:4n},{highestBidder:ZeroAddress},{price:reserve+1n},{deposit:0n},{end:end+600n},
        {state:2n,deadline:end-1n}]) assert.throws(()=>checkWinnerSettlement({...won,...overrides},end));
});
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

test('finalized auction status checks the chain and shared canonical block before reading a review', async () => {
    const node = (chain, headerHash) => async (method, params) => {
        if (method === 'eth_chainId') return chain;
        if (method === 'eth_getBlockByNumber') return {number: '0x42', hash: headerHash, timestamp: toQuantity(start)};
        if (method === 'eth_getCode') { assert.deepEqual(params[1], block); return observedCode; }
        assert.equal(method, 'eth_call');
        assert.deepEqual(params[1], block);
        return new Interface(['function auctions(uint256) view returns(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)'])
            .encodeFunctionResult('auctions', [1n,reserve,bid.deadline,bid.deadline,0n,ZeroAddress,0n,0n,1n,ZeroAddress]);
    };
    const first = node('0x14a34', block.blockHash);
    await assert.rejects(finalizedAuctionStatus([first, first]), /independent/);
    await assert.rejects(finalizedAuctionStatus([first, node('0x2105', block.blockHash)]), /Wrong RPC chain/);
    await assert.rejects(finalizedAuctionStatus([first, node('0x14a34', '0x' + 'f'.repeat(64))]), /finalized block/);
    await assert.rejects(finalizedAuctionStatus([first, node('0x14a34', block.blockHash)]), /runtime/);
});

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

test('the receipt establishes the exact new deadline from the included bid and its immediately following canonical event', async () => {
    const hash = '0x' + '3'.repeat(64);
    const terms = {core:rehearsalArtwork.core,bidder:bid.bidder,deadline:bid.deadline};
    const events = new Interface(['event BidAccepted(uint256 indexed auctionId,address indexed bidder,uint256 price,uint256 deposit)',
        'event AuctionExtended(uint256 indexed auctionId,uint256 oldEnd,uint256 newEnd)']);
    const details = { transactionHash:hash,blockHash:block.blockHash,blockNumber:'0x42',transactionIndex:'0x0' };
    const header = { number:details.blockNumber,hash:details.blockHash,timestamp:toQuantity(start),transactions:[hash] };
    const logs = [['BidAccepted',[1n,bid.bidder,reserve,BigInt(bid.deposit)]],
        ['AuctionExtended',[1n,BigInt(bid.deadline),BigInt(bid.deadline+600)]]].map(([name,args],index) => ({
        ...details,address:terms.core,logIndex:toQuantity(index+5),...events.encodeEventLog(name,args)
    }));
    const tx = { ...details,hash,chainId:'0x14a34',from:bid.bidder,to:terms.core,value:bid.deposit,
        input:market.encodeFunctionData('placeBid',[1n,reserve]) };
    const receipt = { ...details,status:'0x1',from:tx.from,to:tx.to,logs,gasUsed:'0x20000' };
    assert.equal(readBidExtension(tx,receipt,header,hash,terms).deadlineAfterThisBid,'2026-11-26T21:38:44.000Z');
    for (const changed of [[logs[1],logs[0]],[logs[0]], [logs[0],{...logs[1],removed:true}],
        [logs[0],{...logs[1],address:bid.bidder}], [logs[0],{...logs[1],logIndex:'0x9'}],
        [logs[0],{...logs[1],...events.encodeEventLog('AuctionExtended',[1,bid.deadline,bid.deadline+1200])}]]) {
        assert.throws(() => readBidExtension(tx,{...receipt,logs:changed},header,hash,terms));
    }
    assert.throws(() => readBidExtension(tx,receipt,{...header,transactions:[]},hash,terms));
    assert.throws(() => readBidExtension(tx,receipt,{...header,timestamp:toQuantity(start-1)},hash,terms));
    assert.throws(() => readBidExtension({...tx,chainId:'0x2105'},receipt,header,hash,terms));
    await assert.rejects(verifyFirstBidReceipt('0x1234',[]),/public transaction hash/);
    const read = nodeRead();
    await assert.rejects(verifyFirstBidReceipt(hash,[read,read]),/independent/);
});
