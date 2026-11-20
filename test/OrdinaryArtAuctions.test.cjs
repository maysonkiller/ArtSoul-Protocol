const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const DAY = 86400n;
const DueAction = { None: 0n, Close: 1n, FinalizeDefault: 2n };
const eth = ethers.parseEther;
const mine = async tx => (await tx).wait();
const at = timestamp => network.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);

describe('Native primary auctions in an immutable ordinary artwork pair', function () {
    this.timeout(90000);
    let provider, admin, artist, alice, bob, carol, treasury, engine, nft;

    async function deploy(name, ...args) {
        const artifact = await artifacts.readArtifact(name);
        return (await new ethers.ContractFactory(artifact.abi, artifact.bytecode, admin).deploy(...args)).waitForDeployment();
    }
    async function open(price = eth('0.1'), uri = 'ipfs://ordinary-work') {
        await mine(engine.connect(artist).registerArtwork(uri));
        const work = await engine.workCount();
        await mine(engine.connect(artist).createAuction(work, price, DAY));
        return engine.auctionCount();
    }
    function bid(signer, id, price) {
        return engine.requiredDepositForBid(price).then(value => mine(engine.connect(signer).placeBid(id, price, { value })));
    }
    async function close(id, delay = 0n) {
        await at((await engine.auctions(id)).end + delay);
        return mine(engine.connect(carol).closeAuction(id));
    }
    async function rejects(call, name) {
        await assert.rejects(call, error => {
            const data = error.data ?? error.error?.data;
            assert.equal(data?.slice(0, 10), engine.interface.getError(name).selector, String(error));
            return true;
        });
    }
    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [admin, artist, alice, bob, carol, treasury] = await provider.listAccounts();
        engine = await deploy('OrdinaryAuctionFixture', treasury.address);
        nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, provider);
    });

    it('preserves the entire payment window through an entry pause and delayed permissionless closing', async () => {
        const id = await open(eth('0.001'));
        await bid(alice, id, eth('0.001'));
        await mine(engine.setEntryPaused(true));
        await rejects(engine.connect(artist).registerArtwork.staticCall('ipfs://second'), 'EnforcedPause');
        await rejects(engine.connect(artist).createAuction.staticCall(id, 1, DAY), 'EnforcedPause');
        await rejects(engine.connect(bob).placeBid.staticCall(id, eth('0.02'), { value: eth('0.01') }), 'EnforcedPause');
        const receipt = await close(id, 3n * DAY);
        const closed = await engine.auctions(id);
        assert.equal(closed.deadline, BigInt((await provider.getBlock(receipt.blockNumber)).timestamp) + DAY);
        await rejects(engine.closeAuction.staticCall(id), 'WrongAuctionState');
        await rejects(engine.connect(bob).settleAuction.staticCall(id), 'NotWinner');
        await rejects(engine.connect(alice).settleAuction.staticCall(id, { value: 1 }), 'IncorrectFunding');
        await at(closed.deadline);
        const payment = await mine(engine.connect(alice).settleAuction(id));
        const surplus = payment.logs.find(log => log.fragment?.name === 'WinnerSurplusCredited');
        assert.deepEqual(Array.from(surplus.args), [id, alice.address, eth('0.009')]);
        assert.equal(await nft.ownerOf(1), alice.address);
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
        assert.equal(await nft.firstCollector(1), alice.address);
        assert.equal((await engine.works(1)).floor, eth('0.001'));
        assert.equal(await engine.credits(alice.address), eth('0.009'));
        assert.equal(await engine.credits(artist.address), eth('0.000975'));
        assert.equal(await engine.credits(treasury.address), eth('0.000025'));
        for (const signer of [alice, artist, treasury]) await mine(engine.connect(signer).withdraw());
        assert.equal(await provider.getBalance(engine.target), 0n);
        await rejects(engine.connect(alice).withdraw.staticCall(), 'NoCredit');
        await rejects(engine.finalizeDefault.staticCall(id), 'WrongAuctionState');
    });

    it('closes a bidless round in the creator’s relist and keeps a paused no-bid close permissionless', async () => {
        const id = await open();
        const end = (await engine.auctions(id)).end;
        assert.equal(await engine.currentAuctionForWork(1), id);
        await rejects(engine.connect(artist).createAuction.staticCall(1, eth('0.1'), DAY), 'WrongAuctionState');
        await at(end - 1n);
        await network.provider.send('evm_mine');
        assert.equal(await engine.currentAuctionForWork(1), id);
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
        await at(end);
        await network.provider.send('evm_mine');
        assert.equal((await provider.getBlock('latest')).transactions.length, 0);
        assert.equal(await engine.currentAuctionForWork(1), 0n);
        assert.equal(await engine.dueAuctionAction(id), DueAction.Close);
        assert.equal(await nft.totalSupply(), 0n);
        await rejects(engine.minimumBid.staticCall(id), 'WrongAuctionState');
        const relist = await mine(engine.connect(artist).createAuction(1, eth('0.2'), 2n * DAY));
        assert.deepEqual(relist.logs.map(log => log.fragment?.name), ['AuctionClosed', 'AuctionOpened']);
        assert.equal((await engine.auctions(id)).state, 3n);
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
        assert.equal((await engine.works(1)).activeAuction, 2n);
        await rejects(engine.closeAuction.staticCall(id), 'WrongAuctionState');
        await mine(engine.setEntryPaused(true));
        await close(2);
        assert.equal((await engine.works(1)).activeAuction, 0n);
        assert.equal((await engine.works(1)).floor, 0n);
        assert.equal(await nft.totalSupply(), 0n);
    });

    it('reports a funded round ready to close at its extended end even during an entry pause', async () => {
        assert.equal(await engine.dueAuctionAction(1), DueAction.None);
        const id = await open();
        const originalEnd = (await engine.auctions(id)).end;
        await at(originalEnd - 60n);
        await bid(alice, id, eth('0.10'));
        const end = (await engine.auctions(id)).end;
        assert.ok(end > originalEnd);
        await mine(engine.setEntryPaused(true));
        await at(originalEnd);
        await network.provider.send('evm_mine');
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
        await rejects(engine.closeAuction.staticCall(id), 'WrongAuctionState');
        await at(end);
        await network.provider.send('evm_mine');
        assert.equal(await engine.dueAuctionAction(id), DueAction.Close);
        await mine(engine.connect(carol).closeAuction(id));
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
    });

    it('anchors each supported bidding duration to its opening block', async () => {
        for (const hours of [24n, 36n, 48n]) {
            await mine(engine.connect(artist).registerArtwork('ipfs://duration'));
            const work = await engine.workCount();
            const duration = hours * 3600n;
            const receipt = await mine(engine.connect(artist).createAuction(work, eth('0.1'), duration));
            const openedAt = BigInt((await provider.getBlock(receipt.blockNumber)).timestamp);
            const auction = await engine.auctions(await engine.auctionCount());
            assert.equal(auction.originalEnd, openedAt + duration);
            assert.equal(auction.end, auction.originalEnd);
            assert.equal(auction.deadline, 0n);
        }
    });

    it('extends only accepted bids inside the inclusive final ten minutes', async () => {
        const id = await open();
        const end = (await engine.auctions(id)).end;
        await at(end - 601n);
        const early = await bid(alice, id, eth('0.1'));
        assert.deepEqual(early.logs.map(log => log.fragment?.name), ['BidAccepted']);
        assert.equal((await engine.auctions(id)).end, end);

        await at(end - 600n);
        const late = await bid(bob, id, eth('0.12'));
        const extensions = late.logs.filter(log => log.fragment?.name === 'AuctionExtended');
        assert.deepEqual(extensions.map(log => Array.from(log.args)), [[id, end, end + 600n]]);
        assert.equal((await engine.auctions(id)).end, end + 600n);

        await at(end);
        await network.provider.send('evm_mine');
        await rejects(engine.connect(alice).placeBid.staticCall(id, 1, { value: eth('0.01') }), 'BidBelowMinimum');
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
        assert.equal((await engine.auctions(id)).deadline, 0n);
        assert.equal((await engine.auctions(id)).end, end + 600n);
    });

    it('caps extensions one hour after the original end and opens a full day to pay on closing', async () => {
        const id = await open();
        const originalEnd = (await engine.auctions(id)).originalEnd;
        const cap = originalEnd + 3600n;
        let end = originalEnd;
        for (let step = 0; step < 6; step++) {
            const signer = step % 2 === 0 ? alice : bob;
            const price = eth('0.1') + BigInt(step) * eth('0.02');
            await at(end - 1n);
            const accepted = await bid(signer, id, price);
            const extensions = accepted.logs.filter(log => log.fragment?.name === 'AuctionExtended');
            assert.deepEqual(extensions.map(log => Array.from(log.args)), [[id, end, end + 600n]]);
            end += 600n;
            const auction = await engine.auctions(id);
            assert.equal(auction.originalEnd, originalEnd);
            assert.equal(auction.end, end);
            assert.equal(auction.deadline, 0n);
        }
        assert.equal(end, cap);
        await at(cap - 1n);
        const finalBid = await bid(alice, id, eth('0.3'));
        assert.equal(finalBid.logs.filter(log => log.fragment?.name === 'AuctionExtended').length, 0);
        assert.equal((await engine.auctions(id)).end, cap);
        await at(cap);
        await network.provider.send('evm_mine');
        await rejects(engine.connect(bob).placeBid.staticCall(id, eth('0.4'), { value: eth('0.04') }), 'WrongAuctionState');
        assert.equal(await engine.dueAuctionAction(id), DueAction.Close);
        assert.equal((await engine.auctions(id)).deadline, 0n);
        const closingTime = cap + 1200n;
        await at(closingTime);
        await mine(engine.connect(carol).closeAuction(id));
        assert.equal((await engine.auctions(id)).deadline, closingTime + DAY);
        assert.equal((await engine.auctions(id)).highestBidder, alice.address);
    });

    it('lets the recorded winner close and pay in one transaction once bidding expires', async () => {
        const id = await open();
        const price = eth('0.1');
        await bid(alice, id, price);
        await mine(engine.setEntryPaused(true));
        const value = price - await engine.requiredDepositForBid(price);
        await rejects(engine.connect(alice).settleAuction.staticCall(id, { value }), 'WrongAuctionState');
        await at((await engine.auctions(id)).end);
        await network.provider.send('evm_mine');
        assert.equal(await engine.currentAuctionForWork(1), id);
        await rejects(engine.connect(bob).settleAuction.staticCall(id, { value }), 'WrongAuctionState');
        await assert.rejects(mine(engine.connect(alice).settleAuction(id, { value: value - 1n, gasLimit: 3000000 })));
        assert.equal((await engine.auctions(id)).deadline, 0n);
        assert.equal(await nft.totalSupply(), 0n);
        const receipt = await mine(engine.connect(alice).settleAuction(id, { value }));
        const { parseOrdinarySettlement } = await import('../src/indexer/ordinary-settlement.js');
        const raw = await network.provider.send('eth_getTransactionReceipt', [receipt.hash]);
        const projected = parseOrdinarySettlement(raw, { chainId: 31337, coreAddress: engine.target.toLowerCase(),
            nftAddress: nft.target.toLowerCase(), blockNumber: receipt.blockNumber, blockHash: receipt.blockHash }, receipt.hash, id.toString());
        assert.equal(projected.firstCollector, alice.address.toLowerCase());
        assert.equal(projected.priceWei, price.toString());
        assert.equal(projected.runnerUpAccepted, false);
        const lifecycle = receipt.logs.filter(log => ['AuctionClosed', 'AuctionSettled'].includes(log.fragment?.name));
        assert.deepEqual(lifecycle.map(log => log.fragment.name), ['AuctionClosed', 'AuctionSettled']);
        assert.equal(lifecycle[0].args.deadline, BigInt((await provider.getBlock(receipt.blockNumber)).timestamp) + DAY);
        assert.equal(await nft.ownerOf(1), alice.address);
        assert.equal(await engine.currentAuctionForWork(1), 0n);
        await rejects(engine.connect(alice).settleAuction.staticCall(id, { value }), 'WrongAuctionState');
    });

    it('reconciles every displaced deposit, a rejected refund, and only the final winner’s default', async () => {
        const receiver = await deploy('OrdinaryBidderFixture');
        const id = await open();
        const place = (price, deposit) => mine(receiver.bid(engine.target, id, eth(price), { value: eth(deposit) }));
        await place('0.10', '0.01');
        await bid(bob, id, eth('0.20'));
        await bid(carol, id, eth('0.30'));
        await place('0.40', '0.04');
        await rejects(engine.processRefunds.staticCall(id, 1), 'RefundsUnavailable');
        await close(id);
        await mine(engine.setEntryPaused(true));
        await rejects(engine.processRefunds.staticCall(id, 3), 'InvalidRefundBatch');
        const bobBefore = await provider.getBalance(bob.address);
        await mine(engine.processRefunds(id, 2));
        assert.deepEqual(Array.from(await engine.refundProgress(id)), [2n, 3n]);
        assert.equal(await provider.getBalance(bob.address) - bobBefore, eth('0.02'));
        assert.equal(await engine.credits(receiver.target), eth('0.01'));
        await rejects(receiver.withdraw.staticCall(engine.target), 'CreditTransferFailed');
        const deadline = (await engine.auctions(id)).deadline;
        await at(deadline);
        await network.provider.send('evm_mine');
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
        await rejects(engine.finalizeDefault.staticCall(id), 'WrongAuctionState');
        await at(deadline + 1n);
        await network.provider.send('evm_mine');
        assert.equal(await engine.dueAuctionAction(id), DueAction.FinalizeDefault);
        await mine(engine.finalizeDefault(id));
        assert.equal(await engine.dueAuctionAction(id), DueAction.None);
        await rejects(engine.finalizeDefault.staticCall(id), 'WrongAuctionState');
        assert.equal(await engine.credits(artist.address), eth('0.032'));
        assert.equal(await engine.credits(treasury.address), eth('0.008'));
        assert.equal(await nft.totalSupply(), 0n);
        assert.equal((await engine.works(1)).floor, 0n);
        const carolBefore = await provider.getBalance(carol.address);
        await mine(engine.processRefunds(id, 2));
        await mine(engine.processRefunds(id, 2));
        assert.equal(await provider.getBalance(carol.address) - carolBefore, eth('0.03'));
        assert.deepEqual(Array.from(await engine.refundProgress(id)), [3n, 3n]);
        await mine(receiver.acceptDelivery(true, false));
        await mine(receiver.withdraw(engine.target));
        assert.equal(await provider.getBalance(receiver.target), eth('0.01'));
        assert.equal(await provider.getBalance(engine.target), eth('0.04'));
    });

    it('rolls back payment, floor, issuance, and proceeds together when the winner declines the NFT', async () => {
        const wallet = await deploy('OrdinaryBidderFixture');
        const auction = await open();
        await mine(wallet.bid(engine.target, auction, eth('0.10'), { value: eth('0.01') }));
        await close(auction);
        await rejects(wallet.settle.staticCall(engine.target, auction, { value: eth('0.089') }), 'IncorrectFunding');
        const due = { value: eth('0.09'), gasLimit: 3000000 };
        await assert.rejects(mine(wallet.settle(engine.target, auction, due)));
        assert.equal((await engine.auctions(auction)).deposit, eth('0.01'));
        assert.equal((await engine.works(1)).floor, 0n);
        assert.equal(await engine.credits(artist.address), 0n);
        assert.equal(await provider.getBalance(engine.target), eth('0.01'));
        assert.equal(await nft.totalSupply(), 0n);
        await mine(wallet.acceptDelivery(true, true));
        await mine(wallet.settle(engine.target, auction, due));
        assert.equal(await nft.ownerOf(1), wallet.target);
        await rejects(wallet.settle.staticCall(engine.target, auction, due), 'WrongAuctionState');
    });

    it('keeps an old funded auction and refund payable when a second pair uses the same local IDs', async () => {
        const id = await open();
        await bid(alice, id, eth('0.10'));
        await bid(bob, id, eth('0.20'));
        const second = await deploy('OrdinaryAuctionFixture', treasury.address);
        await mine(second.connect(artist).registerArtwork('ipfs://other'));
        await mine(second.connect(artist).createAuction(1, eth('0.1'), DAY));
        await close(id);
        await mine(engine.connect(bob).settleAuction(id, { value: eth('0.18') }));
        await mine(engine.processRefunds(id, 1));
        assert.equal(await nft.ownerOf(1), bob.address);
        assert.notEqual(await second.nft(), nft.target);
        assert.equal((await second.works(1)).floor, 0n);
        assert.equal(await provider.getBalance(second.target), 0n);
        assert.equal(await engine.credits(treasury.address), eth('0.005'));
        assert.equal(await second.credits(treasury.address), 0n);
    });

    it('closing charges the same gas for one bid and sixteen bids, with refunds processed separately', async () => {
        const small = await open();
        const large = await open();
        await bid(alice, small, eth('0.10'));
        for (let sequence = 0; sequence < 16; sequence++) {
            await bid(sequence % 2 ? bob : alice, large, eth('0.10') + BigInt(sequence) * eth('0.01'));
        }
        await at((await engine.auctions(large)).end);
        const smallClose = await mine(engine.closeAuction(small));
        const largeClose = await mine(engine.closeAuction(large));
        assert.equal(smallClose.gasUsed, largeClose.gasUsed);
        assert.deepEqual(Array.from(await engine.refundProgress(large)), [0n, 15n]);
        const winner = await engine.auctions(large);
        await mine(engine.connect(bob).settleAuction(large, { value: winner.price - winner.deposit }));
        for (let i = 0; i < 8; i++) await mine(engine.processRefunds(large, 2));
        assert.deepEqual(Array.from(await engine.refundProgress(large)), [15n, 15n]);
        assert.equal(await provider.getBalance(engine.target), winner.price + eth('0.01'));
    });

    it('uses ceiling increments and deposits and credits the indivisible wei to the larger payout remainder', async () => {
        const price = eth('1') + 1n;
        const id = await open(price);
        assert.equal(await engine.requiredDepositForBid(price), eth('0.1') + 1n);
        await bid(alice, id, price);
        assert.equal(await engine.minimumBid(id), price + eth('0.025') + 1n);
        await close(id);
        await mine(engine.connect(alice).settleAuction(id, { value: price - await engine.requiredDepositForBid(price) }));
        const protocol = eth('0.025');
        assert.equal(await engine.credits(treasury.address), protocol);
        assert.equal(await engine.credits(artist.address), price - protocol);
    });

    it('enforces the URI byte limit at entry and settles the longest accepted URI', async () => {
        const uri = 'ipfs://' + 'a'.repeat(2041);
        await rejects(engine.registerArtwork.staticCall(uri + 'a'), 'InvalidWork');
        await rejects(engine.registerArtwork.staticCall('é'.repeat(1025)), 'InvalidWork');
        const id = await open(1n, uri);
        await bid(alice, id, 1n);
        await close(id);
        await mine(engine.connect(alice).settleAuction(id));
        assert.equal(await nft.tokenURI(1), uri);
    });
});
