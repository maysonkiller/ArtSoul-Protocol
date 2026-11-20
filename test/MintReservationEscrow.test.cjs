const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const eth = ethers.parseEther;
const day = 24 * 60 * 60;
const premium = eth('0.1');
const resalePrice = eth('0.15');
const mintPrice = eth('0.8');

describe('Mint reservation escrow on the disposable EVM', function () {
    this.timeout(90000);
    let provider, creator, original, buyer, other, recipient, protocol, fixture, auctionStart, auctionEnd;

    async function mine(transaction) {
        return (await transaction).wait();
    }

    function events(receipt) {
        return receipt.logs.filter(log => log.address.toLowerCase() === fixture.target.toLowerCase())
            .map(log => fixture.interface.parseLog(log));
    }

    function artEvents(receipt) {
        return events(receipt).filter(event => event.name === 'Transfer' || event.name === 'CollectionMinted');
    }

    async function at(timestamp) {
        await network.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);
    }

    async function advance(timestamp) {
        await at(timestamp);
        await network.provider.send('evm_mine');
    }

    async function rejects(operation) {
        await assert.rejects(operation, error =>
            error.code === 'CALL_EXCEPTION' || /reverted/.test(String(error)));
    }

    async function deployFixture(supply, claimHours = 36, additionalPayment = mintPrice, treasury = protocol.address) {
        const artifact = await artifacts.readArtifact('MintReservationFixture');
        const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, creator)
            .deploy(supply, creator.address, treasury, claimHours, additionalPayment);
        return contract.waitForDeployment();
    }

    async function configure(places = 1, publicUnits = 1, {
        placePrice = premium, additionalPayment = mintPrice, treasury = protocol.address
    } = {}) {
        fixture = await deployFixture(places + publicUnits, 36, additionalPayment, treasury);
        auctionStart = (await provider.getBlock('latest')).timestamp + 60;
        auctionEnd = auctionStart + 3600;
        const terms = { kind: 2, allocation: places, walletLimit: 1, price: placePrice, start: auctionStart,
            end: auctionEnd, merkleRoot: ethers.ZeroHash, enabled: true, rollover: false,
            priceSource: 0, fallbackEnabled: false, fallbackPrice: 0 };
        await mine(fixture.addPhase(terms));
        await mine(fixture.addPhase({ ...terms, kind: 0, allocation: publicUnits, walletLimit: publicUnits,
            start: auctionEnd, end: auctionEnd + 7 * day, price: eth('1') }));
        await mine(fixture.lockConfiguration());
        await advance(auctionStart);
    }

    async function settle(delay = 0) {
        await at(auctionEnd + delay);
        const receipt = await mine(fixture.connect(recipient).finalizeAuction(0, { gasLimit: 1500000 }));
        const timestamp = (await receipt.getBlock()).timestamp;
        assert.equal(await fixture.resaleEndsAt(), BigInt(timestamp + day));
        assert.equal(await fixture.redemptionEndsAt(), BigInt(timestamp + day + 36 * 3600));
        return receipt;
    }

    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [creator, original, buyer, other, recipient, protocol] = await provider.listAccounts();
    });

    it('locks exactly a funded auction and a separately priced public phase, including a zero additional holder payment', async () => {
        await rejects(deployFixture(2, 0));
        fixture = await deployFixture(2, 12, 0n);
        auctionStart = (await provider.getBlock('latest')).timestamp + 60;
        auctionEnd = auctionStart + 3600;
        const opening = { kind: 2, allocation: 1, walletLimit: 1, price: premium, start: auctionStart,
            end: auctionEnd, merkleRoot: ethers.ZeroHash, enabled: true, rollover: false,
            priceSource: 0, fallbackEnabled: false, fallbackPrice: 0 };
        const publicMint = { ...opening, kind: 0, start: auctionEnd, end: auctionEnd + day, price: eth('1') };
        await rejects(fixture.addPhase.staticCall({ ...opening, kind: 0 }));
        await rejects(fixture.addPhase.staticCall({ ...opening, rollover: true }));
        await mine(fixture.addPhase(opening));
        await rejects(fixture.lockConfiguration.staticCall());
        await rejects(fixture.addPhase.staticCall({ ...publicMint, price: 0 }));
        await rejects(fixture.addPhase.staticCall({ ...publicMint, price: 0, priceSource: 1 }));
        await rejects(fixture.addPhase.staticCall({ ...publicMint, enabled: false }));
        await mine(fixture.addPhase(publicMint));
        await rejects(fixture.addPhase.staticCall({ ...publicMint, end: publicMint.end + day, start: publicMint.end }));
        await mine(fixture.lockConfiguration());
        await advance(auctionStart);
        await mine(fixture.connect(original).bid(0, { value: premium }));
        await advance(auctionEnd);
        await mine(fixture.closePhase(0));
        await advance(await fixture.resaleEndsAt());
        const redeemed = await mine(fixture.connect(original).redeemReservation(original.address, original.address));
        assert.equal(events(redeemed).find(event => event.name === 'CollectionMinted').args.unitPrice, 0n);
        assert.equal(await fixture.ownerOf(1), original.address);
        assert.equal(await fixture.credits(creator.address), eth('0.0975'));
        assert.equal(await fixture.credits(protocol.address), eth('0.0025'));
    });

    it('resells only the current listing, preserves stock and settles a single ERC-721 mint for the final holder', async () => {
        await configure();
        await mine(fixture.connect(original).bid(0, { value: premium }));
        await settle(3600);
        assert.equal(await fixture.credits(creator.address), 0n);
        assert.equal((await fixture.bids(0, original.address)).claimed, false);
        await rejects(fixture.connect(original).claimAuction.staticCall(0, original.address));
        await rejects(fixture.connect(other).listReservation.staticCall(resalePrice));
        await mine(fixture.connect(original).listReservation(eth('0.2')));
        await mine(fixture.connect(original).cancelReservationListing());
        await mine(fixture.connect(original).listReservation(resalePrice));
        await rejects(fixture.connect(buyer).buyReservation.staticCall(original.address, 1, { value: resalePrice }));
        await rejects(fixture.connect(buyer).buyReservation.staticCall(original.address, 3, { value: resalePrice - 1n }));
        await rejects(fixture.connect(buyer).redeemReservation.staticCall(original.address, buyer.address, { value: mintPrice }));

        const resaleEnd = await fixture.resaleEndsAt();
        await at(resaleEnd - 1n);
        const purchase = await mine(fixture.connect(buyer).buyReservation(original.address, 3,
            { value: resalePrice, gasLimit: 1500000 }));
        assert.equal(BigInt((await purchase.getBlock()).timestamp), resaleEnd - 1n);
        assert.equal(await fixture.credits(original.address), 0n);
        await rejects(fixture.connect(buyer).listReservation.staticCall(resalePrice));
        await rejects(fixture.connect(other).buyReservation.staticCall(original.address, 3, { value: resalePrice }));

        await advance(resaleEnd);
        await rejects(fixture.connect(original).redeemReservation.staticCall(original.address, original.address, { value: mintPrice }));
        await rejects(fixture.connect(buyer).redeemReservation.staticCall(original.address, recipient.address, { value: mintPrice + 1n }));
        await mine(fixture.connect(other).mintPhase(1, 1, 0, [], other.address, { value: eth('1') }));
        await rejects(fixture.connect(recipient).mintPhase.staticCall(1, 1, 0, [], recipient.address, { value: eth('1') }));
        const creatorBefore = await fixture.credits(creator.address);
        const protocolBefore = await fixture.credits(protocol.address);
        await rejects(fixture.connect(buyer).redeemReservation(original.address, fixture.target,
            { value: mintPrice, gasLimit: 1500000 }).then(t => t.wait()));
        assert.equal(await fixture.totalMinted(), 1n);
        assert.equal((await fixture.bids(0, original.address)).claimed, false);
        assert.equal(await fixture.credits(original.address), 0n);
        assert.equal(await fixture.credits(creator.address), creatorBefore);
        await mine(fixture.connect(buyer).redeemReservation(original.address, recipient.address, { value: mintPrice }));
        assert.equal(await fixture.totalMinted(), 2n);
        assert.equal(await fixture.ownerOf(2), recipient.address);
        assert.equal((await fixture.bids(0, original.address)).claimed, true);
        assert.equal((await fixture.bids(0, buyer.address)).claimed, false);
        assert.equal(await fixture.credits(original.address), resalePrice);
        assert.equal(await fixture.credits(creator.address) - creatorBefore, eth('0.8775'));
        assert.equal(await fixture.credits(protocol.address) - protocolBefore, eth('0.0225'));
        await rejects(fixture.connect(buyer).redeemReservation.staticCall(original.address, buyer.address, { value: mintPrice }));
        await rejects(fixture.refundFailedReservation.staticCall(original.address));
    });

    it('records the art mint price and First Collector separately from a reservation award, resale and expiry', async () => {
        await configure(2);
        const bid = await mine(fixture.connect(original).bid(0, { value: premium }));
        await mine(fixture.connect(other).bid(0, { value: premium }));
        const award = await settle();
        const listing = await mine(fixture.connect(original).listReservation(resalePrice));
        const resale = await mine(fixture.connect(buyer).buyReservation(original.address, 1, { value: resalePrice }));
        for (const receipt of [bid, award, listing, resale]) assert.deepEqual(artEvents(receipt), []);
        assert.equal(events(award).find(event => event.name === 'AuctionFinalized').args.clearingPrice, premium);
        const resold = events(resale).find(event => event.name === 'ReservationResold');
        assert.deepEqual(Array.from(resold.args), [original.address, buyer.address, resalePrice, 1n]);
        assert.equal(await fixture.firstCollector(1), ethers.ZeroAddress);

        await advance(await fixture.resaleEndsAt());
        const redeemed = await mine(fixture.connect(buyer).redeemReservation(original.address, recipient.address, { value: mintPrice }));
        assert.deepEqual(Array.from(events(redeemed).find(event => event.name === 'ReservationProceedsCredited').args),
            [original.address, eth('0.8775'), eth('0.0225'), resalePrice]);
        const [transfer, mint] = artEvents(redeemed);
        assert.deepEqual(artEvents(redeemed).map(event => event.name), ['Transfer', 'CollectionMinted']);
        assert.deepEqual(Array.from(transfer.args), [ethers.ZeroAddress, recipient.address, 1n]);
        assert.deepEqual(Array.from(mint.args), [0n, buyer.address, recipient.address, 1n, 1n, mintPrice]);
        assert.deepEqual(Array.from(events(redeemed).find(event => event.name === 'ReservationResolved').args),
            [original.address, buyer.address, 1n]);
        assert.equal(await fixture.firstCollector(1), recipient.address);
        await rejects(fixture.connect(buyer).redeemReservation(original.address, recipient.address,
            { value: mintPrice, gasLimit: 1500000 }).then(t => t.wait()));

        const gift = await mine(fixture.connect(recipient).transferFrom(recipient.address, protocol.address, 1));
        assert.deepEqual(artEvents(gift).map(event => event.name), ['Transfer']);
        assert.deepEqual(Array.from(artEvents(gift)[0].args), [recipient.address, protocol.address, 1n]);
        await advance(await fixture.redemptionEndsAt());
        const expired = await mine(fixture.expireReservation(other.address));
        assert.deepEqual(artEvents(expired), []);
        assert.deepEqual(Array.from(events(expired).find(event => event.name === 'ReservationResolved').args),
            [other.address, other.address, 2n]);
        assert.equal(await fixture.totalMinted(), 1n);
        assert.equal(await fixture.ownerOf(1), protocol.address);
        assert.equal(await fixture.firstCollector(1), recipient.address);
    });

    it('returns gross payments to their separate payers without duplicating auction excess or losing bids', async () => {
        await configure(2, 1);
        await mine(fixture.connect(original).bid(0, { value: eth('0.45') }));
        await mine(fixture.connect(buyer).bid(0, { value: eth('0.20') }));
        await mine(fixture.connect(other).bid(0, { value: eth('0.15') }));
        await settle();
        assert.equal(await fixture.credits(other.address), eth('0.15'));
        await mine(fixture.connect(original).claimAuctionRefund(0));
        assert.equal(await fixture.credits(original.address), eth('0.25'));
        await mine(fixture.connect(original).listReservation(resalePrice));
        await mine(fixture.connect(recipient).buyReservation(original.address, 1, { value: resalePrice }));
        await mine(fixture.simulateLaunchFailure());
        await rejects(fixture.connect(other).mintPhase.staticCall(1, 1, 0, [], other.address, { value: eth('1') }));
        const refunded = await mine(fixture.connect(other).refundFailedReservation(original.address));
        assert.deepEqual(artEvents(refunded), []);
        assert.equal(events(refunded).some(event => event.name === 'ReservationProceedsCredited'), false);
        assert.deepEqual(Array.from(events(refunded).find(event => event.name === 'ReservationResolved').args),
            [original.address, recipient.address, 3n]);
        await mine(fixture.connect(other).refundFailedReservation(buyer.address));
        await rejects(fixture.refundFailedReservation.staticCall(original.address));
        await rejects(fixture.connect(recipient).redeemReservation.staticCall(original.address, recipient.address, { value: mintPrice }));
        assert.equal(await fixture.totalMinted(), 0n);
        assert.equal(await fixture.credits(creator.address), 0n);
        assert.equal(await fixture.credits(protocol.address), 0n);
        assert.equal(await provider.getBalance(fixture.target), eth('0.95'));
        for (const [payer, credit] of [[original, eth('0.45')], [buyer, eth('0.20')],
            [other, eth('0.15')], [recipient, resalePrice]]) {
            assert.equal(await fixture.credits(payer.address), credit);
            await rejects(fixture.connect(payer).withdrawTo(fixture.target, { gasLimit: 1500000 }).then(t => t.wait()));
            assert.equal(await fixture.credits(payer.address), credit);
            const before = await provider.getBalance(protocol.address);
            await mine(fixture.connect(payer).withdrawTo(protocol.address));
            assert.equal(await provider.getBalance(protocol.address) - before, credit);
            await rejects(fixture.connect(payer).withdrawTo.staticCall(protocol.address));
        }
        assert.equal(await provider.getBalance(fixture.target), 0n);
    });

    it('expires unused rights only after a full redemption window, releasing inventory and no mint payment', async () => {
        await configure();
        await mine(fixture.connect(original).bid(0, { value: premium }));
        await settle();
        await mine(fixture.connect(original).listReservation(resalePrice));
        await mine(fixture.connect(buyer).buyReservation(original.address, 1, { value: resalePrice }));
        const deadline = await fixture.redemptionEndsAt();
        await advance(deadline - 1n);
        await rejects(fixture.expireReservation.staticCall(original.address));
        await fixture.connect(buyer).redeemReservation.staticCall(original.address, recipient.address, { value: mintPrice });
        await at(deadline);
        const expiry = await mine(fixture.connect(other).expireReservation(original.address, { gasLimit: 1500000 }));
        assert.equal(BigInt((await expiry.getBlock()).timestamp), deadline);
        assert.equal(await fixture.totalMinted(), 0n);
        assert.equal((await fixture.bids(0, original.address)).claimed, false);
        assert.equal(await fixture.credits(creator.address), eth('0.0975'));
        assert.equal(await fixture.credits(original.address), resalePrice);
        assert.equal(await fixture.credits(protocol.address), eth('0.0025'));
        assert.deepEqual(Array.from(events(expiry).find(event => event.name === 'ReservationProceedsCredited').args),
            [original.address, eth('0.0975'), eth('0.0025'), resalePrice]);
        await rejects(fixture.connect(buyer).redeemReservation.staticCall(original.address, buyer.address, { value: mintPrice }));
        await rejects(fixture.expireReservation.staticCall(original.address));
        await rejects(fixture.connect(buyer).withdrawTo.staticCall(buyer.address));
        const before = await provider.getBalance(recipient.address);
        await mine(fixture.connect(creator).withdrawTo(recipient.address));
        assert.equal(await provider.getBalance(recipient.address) - before, eth('0.0975'));
        await mine(fixture.connect(original).withdrawTo(recipient.address));
        assert.equal(await provider.getBalance(recipient.address) - before, eth('0.0975') + resalePrice);
        await mine(fixture.connect(protocol).withdrawTo(recipient.address));
        assert.equal(await provider.getBalance(recipient.address) - before, premium + resalePrice);
        assert.equal(await provider.getBalance(fixture.target), 0n);
        await mine(fixture.connect(other).mintPhase(1, 1, 0, [], other.address, { value: eth('1') }));
        await mine(fixture.connect(recipient).mintPhase(1, 1, 0, [], recipient.address, { value: eth('1') }));
        assert.equal(await fixture.totalMinted(), 2n);
    });

    it('preserves funded bids when the launch fails before the auction is finalized', async () => {
        await configure(2);
        await mine(fixture.connect(original).bid(0, { value: eth('0.35') }));
        await mine(fixture.simulateLaunchFailure());
        await rejects(fixture.connect(buyer).bid.staticCall(0, { value: premium }));
        await advance(auctionEnd + 60);
        await mine(fixture.connect(other).finalizeAuction(0));
        await rejects(fixture.connect(original).claimAuction.staticCall(0, original.address));
        await mine(fixture.connect(other).refundFailedReservation(original.address));
        await mine(fixture.connect(original).claimAuctionRefund(0));
        assert.equal(await fixture.credits(original.address), eth('0.35'));
        assert.equal(await fixture.credits(creator.address), 0n);
        assert.equal(await fixture.credits(protocol.address), 0n);
        assert.equal(await fixture.totalMinted(), 0n);
        await mine(fixture.connect(original).withdrawTo(original.address));
        assert.equal(await provider.getBalance(fixture.target), 0n);
    });

    it('preserves a completed mint and refunds another holder whose delivery window was interrupted', async () => {
        await configure(2);
        await mine(fixture.connect(original).bid(0, { value: premium }));
        await mine(fixture.connect(buyer).bid(0, { value: premium }));
        await settle();
        await advance(await fixture.resaleEndsAt());
        await mine(fixture.connect(original).redeemReservation(original.address, original.address, { value: mintPrice }));
        await mine(fixture.simulateLaunchFailure());
        await rejects(fixture.refundFailedReservation.staticCall(original.address));
        await advance(await fixture.redemptionEndsAt());
        await rejects(fixture.expireReservation.staticCall(buyer.address));
        await mine(fixture.connect(other).refundFailedReservation(buyer.address));
        assert.equal(await fixture.totalMinted(), 1n);
        assert.equal((await fixture.bids(0, original.address)).claimed, true);
        assert.equal((await fixture.bids(0, buyer.address)).claimed, false);
        assert.equal(await fixture.ownerOf(1), original.address);
        assert.equal(await fixture.credits(buyer.address), premium);
        assert.equal(await fixture.credits(creator.address) + await fixture.credits(protocol.address), premium + mintPrice);
    });

    it('keeps a fully elapsed usable window distinct from a launch failure reported later', async () => {
        await configure();
        await mine(fixture.connect(original).bid(0, { value: premium }));
        await settle();
        await advance(await fixture.redemptionEndsAt());
        await mine(fixture.simulateLaunchFailure());
        await rejects(fixture.refundFailedReservation.staticCall(original.address));
        await mine(fixture.connect(buyer).expireReservation(original.address));
        assert.equal(await fixture.credits(creator.address), eth('0.0975'));
        assert.equal(await fixture.credits(original.address), 0n);
    });

    for (const [placePrice, additionalPayment, expectedFee] of [
        [11n, 9n, 0n], [19n, 2n, 1n], [21n, 39n, 1n]
    ]) {
        it(`rounds the combined primary payment of ${placePrice} + ${additionalPayment} wei once`, async () => {
            await configure(1, 1, { placePrice, additionalPayment });
            await mine(fixture.connect(original).bid(0, { value: placePrice }));
            await settle();
            await advance(await fixture.resaleEndsAt());
            await mine(fixture.connect(original).redeemReservation(original.address, recipient.address, { value: additionalPayment }));
            assert.equal(await fixture.credits(protocol.address), expectedFee);
            assert.equal(await fixture.credits(creator.address), placePrice + additionalPayment - expectedFee);
        });
    }

    it('adds independent allocations when the treasury and creator share an address and the NFT is gifted there', async () => {
        await configure(1, 1, { treasury: creator.address });
        const clearingPrice = eth('0.12');
        await mine(fixture.connect(original).bid(0, { value: clearingPrice }));
        const award = await settle();
        assert.equal(events(award).find(event => event.name === 'AuctionFinalized').args.clearingPrice, clearingPrice);
        await mine(fixture.connect(original).listReservation(resalePrice));
        await mine(fixture.connect(buyer).buyReservation(original.address, 1, { value: resalePrice }));
        await advance(await fixture.resaleEndsAt());
        const receipt = await mine(fixture.connect(buyer).redeemReservation(original.address, creator.address, { value: mintPrice }));
        assert.deepEqual(Array.from(events(receipt).find(event => event.name === 'ReservationProceedsCredited').args),
            [original.address, eth('0.897'), eth('0.023'), resalePrice]);
        assert.equal(await fixture.firstCollector(1), creator.address);
        assert.equal(await fixture.credits(creator.address), clearingPrice + mintPrice);
        assert.equal(await fixture.credits(original.address), resalePrice);
        const before = await provider.getBalance(recipient.address);
        await mine(fixture.connect(creator).withdrawTo(recipient.address));
        assert.equal(await provider.getBalance(recipient.address) - before, clearingPrice + mintPrice);
        await mine(fixture.connect(original).withdrawTo(recipient.address));
        assert.equal(await provider.getBalance(recipient.address) - before, clearingPrice + mintPrice + resalePrice);
        assert.equal(await provider.getBalance(fixture.target), 0n);
    });

    it('creates no paid entitlement on an empty round', async () => {
        await configure();
        await advance(auctionEnd);
        await mine(fixture.connect(buyer).finalizeAuction(0));
        await rejects(fixture.connect(original).listReservation.staticCall(premium));
        await rejects(fixture.connect(original).claimAuction.staticCall(0, original.address));
        await rejects(fixture.refundFailedReservation.staticCall(original.address));
        assert.equal(await fixture.credits(creator.address), 0n);
        assert.equal(await provider.getBalance(fixture.target), 0n);
        assert.equal(await fixture.totalMinted(), 0n);
    });

    it('keeps redemption and withdrawals available during an entry pause and respects the independent expiry clock', async () => {
        await configure(2);
        await mine(fixture.connect(original).bid(0, { value: eth('0.35') }));
        await mine(fixture.connect(buyer).bid(0, { value: premium }));
        await settle();
        await mine(fixture.connect(original).listReservation(resalePrice));
        await mine(fixture.pause());
        await rejects(fixture.connect(other).buyReservation.staticCall(original.address, 1, { value: resalePrice }));
        await mine(fixture.connect(original).cancelReservationListing());
        await mine(fixture.connect(original).claimAuctionRefund(0));
        assert.equal(await fixture.credits(original.address), eth('0.25'));
        await mine(fixture.connect(original).withdrawTo(recipient.address));
        const deadline = await fixture.redemptionEndsAt();
        await advance(await fixture.resaleEndsAt());
        await mine(fixture.connect(buyer).redeemReservation(buyer.address, buyer.address, { value: mintPrice }));
        assert.equal(await fixture.ownerOf(1), buyer.address);
        await advance(deadline);
        await mine(fixture.connect(other).expireReservation(original.address));
        assert.equal(await fixture.credits(creator.address) + await fixture.credits(protocol.address), 2n * premium + mintPrice);
    });
});
