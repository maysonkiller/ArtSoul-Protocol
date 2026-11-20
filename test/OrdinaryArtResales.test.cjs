const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const mine = async tx => (await tx).wait();

describe('Versioned ordinary artwork resales after paid primary settlement', function () {
    this.timeout(90000);
    let admin, creator, seller, buyer, other, protocol, ecosystem, engine, nft, provider;
    const floor = 1000n;
    const price = 10000n;

    async function deploy(name, ...args) {
        const artifact = await artifacts.readArtifact(name);
        return (await new ethers.ContractFactory(artifact.abi, artifact.bytecode, admin).deploy(...args)).waitForDeployment();
    }
    async function rejectWith(call, name, iface = engine.interface) {
        await assert.rejects(call, error => {
            const data = error.data ?? error.error?.data;
            assert.equal(data?.slice(0, 10), iface.getError(name).selector, String(error));
            return true;
        });
    }
    const recipients = () => [seller, creator, protocol, ecosystem];
    const balances = () => Promise.all(recipients().map(account => engine.credits(account.address)));
    const list = (version, amount = price) => mine(engine.connect(seller).listResale(1, version, amount));
    const purchase = (version, amount = price) => mine(engine.connect(buyer).buyResale(1, version, { value: amount }));
    const attempt = (version, amount = price) => engine.connect(buyer).buyResale.staticCall(1, version, { value: amount });
    async function checkQuote(version, owner = ethers.ZeroAddress, amount = 0n, tokenId = 1) {
        const quote = await engine.getActiveResale(tokenId);
        assert.deepEqual([quote.active, quote.seller, quote.price, quote.version],
            [owner !== ethers.ZeroAddress, owner, amount, BigInt(version)]);
    }
    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [admin, creator, seller, buyer, other, protocol, ecosystem] = await provider.listAccounts();
        engine = await deploy('OrdinaryResaleFixture', protocol.address, ecosystem.address);
        nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, provider);
        await mine(engine.connect(creator).registerArtwork('ipfs://resale-work'));
        await mine(engine.connect(creator).createAuction(1, floor, 86400));
        const deposit = await engine.requiredDepositForBid(floor);
        await mine(engine.connect(seller).placeBid(1, floor, { value: deposit }));
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(1)).end)]);
        await mine(engine.closeAuction(1));
        await mine(engine.connect(seller).settleAuction(1));
    });

    it('accepts one exact-price buyer, credits four roles, preserves provenance and permits withdrawals while paused', async () => {
        await checkQuote(0);
        await checkQuote(0, ethers.ZeroAddress, 0n, 999);
        await rejectWith(engine.connect(buyer).listResale.staticCall(1, 0, price), 'InvalidListingOwner');
        await rejectWith(engine.connect(seller).listResale.staticCall(1, 0, floor - 1n), 'BelowCanonicalFloor');
        await rejectWith(engine.connect(seller).listResale.staticCall(1, 0, floor), 'MissingResaleApproval');
        await mine(nft.connect(seller).approve(engine.target, 1));
        const listed = await list(0);
        await checkQuote(1, seller.address, price);
        const listedEvent = listed.logs.map(log => engine.interface.parseLog(log)).find(log => log?.name === 'ResaleListed');
        assert.equal(listedEvent.args.version, 1n);
        assert.equal(listedEvent.args.authorization, await nft.resaleAuthorization(1, seller.address));
        await rejectWith(attempt(1, price - 1n), 'IncorrectFunding');
        await rejectWith(attempt(1, price + 1n), 'IncorrectFunding');
        await rejectWith(engine.connect(seller).buyResale.staticCall(1, 1, { value: price }), 'InvalidListingOwner');
        const before = await balances();
        const receipt = await purchase(1);
        const soldEvent = receipt.logs.map(log => engine.interface.parseLog(log)).find(log => log?.name === 'ResalePurchased');
        assert.equal(soldEvent.args.version, listedEvent.args.version);
        assert.equal(soldEvent.args.buyer, buyer.address);
        assert.equal(soldEvent.args.price, price);
        const after = await balances();
        assert.deepEqual(after.map((amount, i) => amount - before[i]), [9250n, 550n, 100n, 100n]);
        assert.equal(await nft.ownerOf(1), buyer.address);
        assert.equal(await nft.firstCollector(1), seller.address);
        assert.equal(await nft.tokenCreator(1), creator.address);
        assert.equal(await nft.totalSupply(), 1n);
        assert.equal((await engine.works(1)).floor, floor);
        await rejectWith(engine.connect(other).buyResale.staticCall(1, 1, { value: price }), 'StaleListing');
        assert.equal((await engine.resaleListings(1)).version, 2n);
        await checkQuote(2);
        await mine(engine.setTestConditions(true, true));
        for (const recipient of recipients()) await mine(engine.connect(recipient).withdraw());
        assert.equal(await provider.getBalance(engine.target), 0n);
    });

    it('invalidates same-price replacements, repricing and cancellations including during an entry pause', async () => {
        await mine(nft.connect(seller).setApprovalForAll(engine.target, true));
        await list(0);
        await list(1);
        await rejectWith(attempt(1), 'StaleListing');
        await list(2, price * 2n);
        await checkQuote(3, seller.address, price * 2n);
        await rejectWith(attempt(2), 'StaleListing');
        await rejectWith(engine.connect(seller).listResale.staticCall(1, 2, price), 'StaleListing');
        await rejectWith(engine.connect(seller).cancelResale.staticCall(1, 2), 'StaleListing');
        await rejectWith(engine.connect(other).cancelResale.staticCall(1, 3), 'InvalidListingOwner');
        await mine(engine.setTestConditions(true, true));
        await checkQuote(3);
        await rejectWith(attempt(3, price * 2n), 'EnforcedPause');
        await rejectWith(engine.connect(seller).listResale.staticCall(1, 3, price), 'EnforcedPause');
        const receipt = await mine(engine.connect(seller).cancelResale(1, 3));
        await checkQuote(4);
        assert.equal(engine.interface.parseLog(receipt.logs[0]).args.version, 3n);
        await mine(engine.setTestConditions(false, true));
        await list(4);
        await rejectWith(attempt(3), 'StaleListing');
        await purchase(5);
    });

    it('requires a fresh listing after explicit token or blanket revocation even after reapproval', async () => {
        await mine(nft.connect(seller).approve(engine.target, 1));
        await list(0);
        await mine(nft.connect(seller).approve(ethers.ZeroAddress, 1));
        await checkQuote(1);
        await rejectWith(attempt(1), 'MissingResaleApproval');
        await mine(nft.connect(seller).approve(engine.target, 1));
        await checkQuote(1);
        await rejectWith(attempt(1), 'MissingResaleApproval');
        await mine(nft.connect(seller).setApprovalForAll(engine.target, true));
        await list(1);
        // A second approval route stays live; explicit revocation still invalidates the advertised sale.
        await mine(nft.connect(seller).setApprovalForAll(engine.target, false));
        await checkQuote(2);
        await rejectWith(attempt(2), 'MissingResaleApproval');
        await mine(nft.connect(seller).setApprovalForAll(engine.target, true));
        await rejectWith(attempt(2), 'MissingResaleApproval');
        await list(2);
        await purchase(3);
    });

    it('blocks a former listing after a transfer round trip even with an uninterrupted operator approval', async () => {
        await mine(nft.connect(seller).setApprovalForAll(engine.target, true));
        await list(0);
        await mine(nft.connect(seller).transferFrom(seller.address, other.address, 1));
        await checkQuote(1);
        await rejectWith(engine.connect(seller).cancelResale.staticCall(1, 1), 'InvalidListingOwner');
        await rejectWith(attempt(1), 'MissingResaleApproval');
        await mine(nft.connect(other).transferFrom(other.address, seller.address, 1));
        await checkQuote(1);
        await rejectWith(attempt(1), 'MissingResaleApproval');
        await list(1);
        await checkQuote(2, seller.address, price);
        await purchase(2);
    });

    it('lets a new owner replace an inactive previous-owner listing without a separate cleanup transaction', async () => {
        await mine(nft.connect(seller).approve(engine.target, 1));
        await list(0);
        await mine(nft.connect(seller).transferFrom(seller.address, other.address, 1));
        const inactive = await engine.getActiveResale(1);
        assert.equal(inactive.active, false);
        await mine(nft.connect(other).approve(engine.target, 1));
        await mine(engine.connect(other).listResale(1, inactive.version, price * 2n));
        await checkQuote(2, other.address, price * 2n);
        await rejectWith(engine.connect(seller).cancelResale.staticCall(1, 2), 'InvalidListingOwner');
        await rejectWith(attempt(1), 'StaleListing');
        await purchase(2, price * 2n);
        await checkQuote(3);
    });

    it('rolls back the listing and all proceeds upon rejected delivery and honors temporary market suspension', async () => {
        const nonReceiver = await deploy('NonReceivingBuyerFixture');
        await mine(nft.connect(seller).approve(engine.target, 1));
        await list(0);
        const before = await balances();
        await assert.rejects(mine(nonReceiver.buy(engine.target, 1, 1, { value: price, gasLimit: 1000000 })));
        assert.deepEqual(await balances(), before);
        assert.equal((await engine.resaleListings(1)).version, 1n);
        assert.equal(await nft.ownerOf(1), seller.address);
        await mine(engine.setTestConditions(false, false));
        await checkQuote(1);
        await rejectWith(attempt(1), 'MissingResaleApproval');
        await mine(engine.setTestConditions(false, true));
        await checkQuote(1, seller.address, price);
        await purchase(1);
    });

    it('assigns each leftover wei to the highest remaining fractional quota on an actual resale', async () => {
        const oddPrice = 9999n;
        await mine(nft.connect(seller).approve(engine.target, 1));
        await list(0, oddPrice);
        const before = await balances();
        await purchase(1, oddPrice);
        const after = await balances();
        assert.deepEqual(after.map((amount, i) => amount - before[i]), [9249n, 550n, 100n, 100n]);
        assert.equal(await nft.ownerOf(1), buyer.address);
    });
});
