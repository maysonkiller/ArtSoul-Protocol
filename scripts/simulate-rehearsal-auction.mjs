// Read-only rehearsal against the state immediately after a fresh Base Sepolia deployment.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Interface, ZeroHash, getAddress, isHexString, keccak256, parseEther, toQuantity, zeroPadValue } from 'ethers';
import { confirmFinalizedBlock, finalizedBlock, readRpc } from './verify-treasury-safes.mjs';

const [registerFile, blockHash, option, ...extra] = process.argv.slice(2);
const safeRefunds = option === '--safe-refunds';
const payout = option === '--payout' || safeRefunds;
assert(registerFile && isHexString(blockHash, 32) && (!option || payout) && !extra.length,
    'Usage: node scripts/simulate-rehearsal-auction.mjs <pair-register.json> <creation-block-hash> [--payout | --safe-refunds]');
const register = JSON.parse(await readFile(registerFile, 'utf8'));
assert.equal(register.chainId, 84532);
const [market, nft] = await Promise.all([payout ? 'OrdinaryPayoutMarket' : 'OrdinaryMarket', 'SettledArtworkNFT'].map(async name => {
    const artifact = new URL('../artifacts/contracts/replacement/' + name + '.sol/' + name + '.json', import.meta.url);
    return new Interface(JSON.parse(await readFile(artifact, 'utf8')).abi);
}));
// These are virtual participants in read-only RPC simulations.
const [artist, collector, buyer] = [1001, 1002, 1003].map(id => getAddress('0x' + id.toString(16).padStart(40, '0')));
const price = parseEther('0.10'), deposit = parseEther('0.01'), resale = parseEther('0.20');
const uri = 'ipfs://artwork-rehearsal';

async function simulateSafeRefunds(rpc, block, start) {
    const core = register.core.address;
    const treasury = register.protocolTreasury;
    const at = { blockHash: block.hash, requireCanonical: true };
    const [proxy, singleton, slot] = await Promise.all([
        rpc('eth_getCode', [treasury.address, at]), rpc('eth_getCode', [treasury.singleton, at]),
        rpc('eth_getStorageAt', [treasury.address, '0x0', at])
    ]);
    assert.equal(keccak256(proxy), treasury.proxyCodeHash);
    assert.equal(keccak256(singleton), treasury.singletonCodeHash);
    assert.equal(slot.toLowerCase(), zeroPadValue(treasury.singleton, 32).toLowerCase());
    const recipients = Array.from({ length: 8 }, (_, i) => getAddress('0x' + (2000 + i).toString(16).padStart(40, '0')));
    const safe = new Interface(['event SafeReceived(address indexed sender,uint256 value)']);
    const call = (method, args, from = artist, value = 0n) => ({
        from, to: core, data: market.encodeFunctionData(method, args), value: toQuantity(value), gas: '0x100000'
    });
    const sizes = [1, 4, 8];
    const open = [], close = [];
    for (const [index, size] of sizes.entries()) {
        const id = index + 1;
        open.push(call('registerArtwork', [uri]), call('createAuction', [id, price, 86400]));
        for (let i = 0; i <= size; i++) {
            const bid = price + BigInt(i) * parseEther('0.01');
            open.push(call('placeBid', [id, bid], i === size ? buyer : recipients[i], bid / 10n));
        }
        close.push(call('closeAuction', [id]), call('processRefunds', [id, size]),
            call('processRefunds', [id, size]), call('refundProgress', [id]));
    }
    // Only virtual bidder addresses and balances change. At payout each recipient
    // executes the reviewed proxy's receive path through the deployed singleton.
    const blocks = [
        { blockOverrides: { time: toQuantity(start) }, calls: open, stateOverrides: Object.fromEntries(
            [artist, buyer, ...recipients].map(address => [address, { balance: toQuantity(parseEther('1')) }])) },
        { blockOverrides: { time: toQuantity(start + 86400) }, calls: close, stateOverrides: Object.fromEntries(
            recipients.map(address => [address, { code: proxy, state: { [ZeroHash]: slot } }])) }
    ];
    const result = await rpc('eth_simulateV1', [{ blockStateCalls: blocks, validation: false }, block.number]);
    assert.deepEqual(result.map(b => b.calls.map(c => c.status)), blocks.map(b => b.calls.map(() => '0x1')));
    const measurements = sizes.map((size, index) => {
        const id = BigInt(index + 1);
        const [, paid, replay, progress] = result[1].calls.slice(4 * index, 4 * index + 4);
        assert.deepEqual([...market.decodeFunctionResult('refundProgress', progress.returnData)], [BigInt(size), BigInt(size)]);
        assert.equal(replay.logs.length, 0);
        const logs = paid.logs.filter(log => log.address.toLowerCase() === core.toLowerCase());
        assert.equal(logs.length, size);
        for (const [i, log] of logs.entries()) {
            const amount = (price + BigInt(i) * parseEther('0.01')) / 10n;
            const processed = market.parseLog(log);
            assert.equal(processed.name, 'OutbidRefundProcessed');
            assert.deepEqual([...processed.args], [id, BigInt(i), recipients[i], amount, true]);
            const received = paid.logs.filter(entry => entry.address.toLowerCase() === recipients[i].toLowerCase());
            assert.equal(received.length, 1);
            const event = safe.parseLog(received[0]);
            assert.equal(event.name, 'SafeReceived');
            assert.deepEqual([...event.args], [getAddress(core), amount]);
        }
        return { recipients: size, executionGas: BigInt(paid.gasUsed).toString() };
    });
    await confirmFinalizedBlock(rpc, await finalizedBlock(84532, rpc), block);
    return { block: Number(BigInt(block.number)), blockHash: block.hash, safeRefunds: measurements };
}

async function simulateCreditRoute(rpc, block, start) {
    const fixture = JSON.parse(await readFile(new URL('../artifacts/contracts/test/OrdinaryAuctionFixture.sol/OrdinaryBidderFixture.json', import.meta.url), 'utf8'));
    const wallet = new Interface(fixture.abi);
    const walletAddress = getAddress('0x0000000000000000000000000000000000001004');
    assert.equal(await rpc('eth_getCode', [walletAddress, { blockHash, requireCanonical: true }]), '0x');
    const core = register.core.address;
    const call = (from, to, abi, method, args, amount = 0n) => ({
        from, to, data: abi.encodeFunctionData(method, args), value: toQuantity(amount), gas: '0x100000'
    });
    const higher = parseEther('0.11'), higherDeposit = parseEther('0.011');
    const blocks = [
        { blockOverrides: { time: toQuantity(start) }, stateOverrides: {
            [artist]: { balance: toQuantity(parseEther('1')) }, [buyer]: { balance: toQuantity(parseEther('1')) },
            [walletAddress]: { code: fixture.deployedBytecode, state: {} }
        }, calls: [
            call(artist, core, market, 'registerArtwork', [uri]), call(artist, core, market, 'createAuction', [1, price, 86400]),
            call(artist, walletAddress, wallet, 'bid', [core, 1, price], deposit),
            call(buyer, core, market, 'placeBid', [1, higher], higherDeposit)
        ] },
        { blockOverrides: { time: toQuantity(start + 86400) }, calls: [
            call(artist, core, market, 'closeAuction', [1]), call(artist, core, market, 'processRefunds', [1, 1]),
            call(artist, core, market, 'credits', [walletAddress]), call(artist, walletAddress, wallet, 'balanceAt', [collector]),
            call(artist, walletAddress, wallet, 'withdrawTo', [core, collector]), call(artist, walletAddress, wallet, 'balanceAt', [collector]),
            call(artist, core, market, 'credits', [walletAddress]), call(artist, walletAddress, wallet, 'balanceAt', [core])
        ] }
    ];
    const simulated = await rpc('eth_simulateV1', [{ blockStateCalls: blocks, validation: false }, block.number]);
    assert.deepEqual(simulated.map(b => b.calls.map(c => c.status)), blocks.map(b => b.calls.map(() => '0x1')));
    const [, refund, before, oldBalance, withdrawal, newBalance, after, held] = simulated[1].calls;
    const eventArgs = (result, name) => {
        const logs = result.logs.filter(log => log.address.toLowerCase() === core.toLowerCase() && log.topics[0] === market.getEvent(name).topicHash);
        assert.equal(logs.length, 1, name);
        return [...market.parseLog(logs[0]).args];
    };
    assert.deepEqual(eventArgs(refund, 'OutbidRefundProcessed'), [1n, 0n, walletAddress, deposit, false]);
    assert.deepEqual(eventArgs(withdrawal, 'CreditRouted'), [walletAddress, collector]);
    assert.deepEqual(eventArgs(withdrawal, 'CreditWithdrawn'), [walletAddress, deposit]);
    assert.deepEqual([BigInt(before.returnData), BigInt(after.returnData), BigInt(held.returnData)], [deposit, 0n, higherDeposit]);
    const delivered = BigInt(newBalance.returnData) - BigInt(oldBalance.returnData);
    assert.equal(delivered, deposit);
    return delivered.toString();
}

async function simulate(url) {
    const rpc = readRpc(url);
    assert.equal(BigInt(await rpc('eth_chainId', [])), 84532n);
    const block = await rpc('eth_getBlockByHash', [blockHash, false]);
    assert.equal(block.hash, blockHash);
    const at = { blockHash, requireCanonical: true };
    for (const item of [register.core, register.nft]) {
        assert.equal(keccak256(await rpc('eth_getCode', [item.address, at])), item.codeHash);
    }
    const start = Number(BigInt(block.timestamp)) + 1;
    if (safeRefunds) return simulateSafeRefunds(rpc, block, start);
    const end = start + 86400;
    const secondStart = end + 1;
    const secondEnd = secondStart + 86400;
    const extendedEnd = secondEnd + 600;
    const defaultTime = extendedEnd + 86401;
    const higherBid = parseEther('0.11'), higherDeposit = parseEther('0.011');
    function call(abi, method, args = [], from = artist, value = 0n) {
        return { from, to: abi === market ? register.core.address : register.nft.address,
            data: abi.encodeFunctionData(method, args), value: toQuantity(value), gas: '0x100000' };
    }
    const readNft = async (method, args = []) => nft.decodeFunctionResult(method,
        await rpc('eth_call', [call(nft, method, args), at]))[0];
    assert.equal(await readNft('name'), 'ArtSoul NFT');
    assert.equal(await readNft('symbol'), 'ARTSOUL');
    // ERC-165, ERC-721, metadata and ERC-2981, followed by the ERC-165 negative control.
    for (const interfaceId of ['0x01ffc9a7', '0x80ac58cd', '0x5b5e139f', '0x2a55205a', '0xffffffff']) {
        assert.equal(await readNft('supportsInterface', [interfaceId]), interfaceId !== '0xffffffff');
    }
    const roles = [artist, collector, register.protocolTreasury.address, register.ecosystemTreasury.address];
    const virtualBlocks = [
        { blockOverrides: { time: toQuantity(start) },
            stateOverrides: Object.fromEntries([artist, collector, buyer].map(account => [account, { balance: toQuantity(parseEther('1')) }])),
            calls: [call(market, 'registerArtwork', [uri]), call(market, 'createAuction', [1, price, 86400]),
                call(market, 'placeBid', [1, price], collector, deposit), call(nft, 'totalSupply')] },
        { blockOverrides: { time: toQuantity(end) },
            calls: [call(market, 'settleAuction', [1], collector, price - deposit), call(nft, 'ownerOf', [1]),
                call(nft, 'approve', [register.core.address, 1], collector), call(market, 'listResale', [1, 0, resale], collector),
                call(market, 'buyResale', [1, 1], buyer, resale), call(nft, 'ownerOf', [1]), call(nft, 'firstCollector', [1]),
                call(nft, 'tokenCreator', [1]), ...roles.map(address => call(market, 'credits', [address]))] },
        { blockOverrides: { time: toQuantity(secondStart) }, calls: [
            call(market, 'registerArtwork', [uri + '-second']), call(market, 'createAuction', [2, price, 86400]),
            call(market, 'placeBid', [2, price], collector, deposit),
            call(market, 'registerArtwork', [uri + '-bidless']), call(market, 'createAuction', [3, price, 86400])] },
        { blockOverrides: { time: toQuantity(secondEnd - 60) }, calls: [
            call(market, 'placeBid', [2, higherBid], buyer, higherDeposit), call(market, 'auctions', [2])] },
        { blockOverrides: { time: toQuantity(extendedEnd) }, calls: [
            call(market, 'currentAuctionForWork', [3]), call(market, 'closeAuction', [3]),
            call(market, 'closeAuction', [2]), call(market, 'auctions', [2]), call(nft, 'totalSupply')] },
        { blockOverrides: { time: toQuantity(defaultTime) }, calls: [
            call(market, 'finalizeDefault', [2]), call(market, 'runnerUpOffers', [2]),
            call(market, 'processRefunds', [2, 1]), call(market, 'acceptRunnerUpOffer', [2], collector, price),
            call(nft, 'firstCollector', [2]), call(nft, 'artworkToToken', [3]), ...roles.map(address => call(market, 'credits', [address]))] }
    ];
    const result = await rpc('eth_simulateV1', [{ blockStateCalls: virtualBlocks, validation: false }, block.number]);
    assert.equal(result.length, virtualBlocks.length);
    for (const [i, { calls }] of result.entries()) {
        assert.equal(calls.length, virtualBlocks[i].calls.length);
        for (const [j, response] of calls.entries()) {
            assert.equal(response.status, '0x1', 'Simulated call failed at block ' + i + ', position ' + j);
        }
    }
    const [before, after, , lastBid, close, fallback] = result.map(entry => entry.calls);
    const value = (abi, method, result) => abi.decodeFunctionResult(method, result.returnData)[0];
    assert.equal(value(market, 'registerArtwork', before[0]), 1n);
    assert.equal(value(market, 'createAuction', before[1]), 1n);
    assert.equal(value(nft, 'totalSupply', before[3]), 0n);
    assert.equal(value(market, 'settleAuction', after[0]), 1n);
    assert.equal(value(nft, 'ownerOf', after[1]), collector);
    assert.equal(value(nft, 'ownerOf', after[5]), buyer);
    assert.equal(value(nft, 'firstCollector', after[6]), collector);
    assert.equal(value(nft, 'tokenCreator', after[7]), artist);
    // Primary 97.5/2.5 and resale 92.5/5.5/1/1, summed across the two sales.
    const credit = after.slice(8).map(response => value(market, 'credits', response));
    assert.deepEqual(credit, ['0.1085', '0.185', '0.0045', '0.002'].map(parseEther));
    const late = market.decodeFunctionResult('auctions', lastBid[1].returnData);
    assert.equal(late.originalEnd, BigInt(secondEnd));
    assert.equal(late.end, BigInt(extendedEnd));
    assert.equal(value(market, 'currentAuctionForWork', close[0]), 0n);
    assert.equal(market.decodeFunctionResult('auctions', close[3].returnData).deadline, BigInt(extendedEnd + 86400));
    assert.equal(value(nft, 'totalSupply', close[4]), 1n);
    const offer = market.decodeFunctionResult('runnerUpOffers', fallback[1].returnData);
    assert.deepEqual([offer.bidder, offer.price, offer.deadline], [collector, price, BigInt(defaultTime + 86400)]);
    const refundLog = fallback[2].logs.find(log => log.address.toLowerCase() === register.core.address.toLowerCase() &&
        log.topics[0] === market.getEvent('OutbidRefundProcessed').topicHash);
    assert(refundLog, 'Expected the runner-up deposit refund');
    const refund = market.parseLog(refundLog).args;
    assert.deepEqual([refund.creditor, refund.amount, refund.paid], [collector, deposit, true]);
    assert.equal(value(nft, 'firstCollector', fallback[4]), collector);
    assert.equal(value(nft, 'artworkToToken', fallback[5]), 0n);
    const finalCredit = fallback.slice(6).map(response => value(market, 'credits', response));
    // Add a second primary sale and the defaulted winner's 80/20 deposit split.
    assert.deepEqual(finalCredit, ['0.2148', '0.185', '0.0092', '0.002'].map(parseEther));
    assert.equal((await rpc('eth_getBlockByNumber', [block.number, false])).hash, blockHash);
    assert.equal(BigInt(await rpc('eth_call', [call(market, 'workCount'), at])), 0n);
    assert.equal(BigInt(await rpc('eth_call', [call(nft, 'totalSupply'), at])), 0n);
    const routed = payout ? { routedCreditWei: await simulateCreditRoute(rpc, block, start) } : {};
    return { ...routed, block: Number(BigInt(block.number)), blockHash, saleAndResaleCreditsWei: credit.map(String),
        creditsAfterRunnerUpWei: finalCredit.map(String), runnerUpRefundWei: String(refund.amount) };
}

const [first, second] = await Promise.all(['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(simulate));
assert.deepEqual(first, second);
console.log(JSON.stringify({ simulation: 'eth_simulateV1', chainId: 84532, providers: 2, ...first }, null, 2));
