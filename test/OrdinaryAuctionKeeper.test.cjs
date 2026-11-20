const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const DAY = 86400n;
const eth = ethers.parseEther;
const mined = async tx => (await tx).wait();

describe('Operator-owned lifecycle keeper for ordinary auctions', function () {
    this.timeout(90000);
    let runKeeperCycle, openKeeperStore, provider, engine, nft, config, store;
    let deployer, creator, winner, runner, operator, treasury;

    async function mineAt(timestamp) {
        await network.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);
        await network.provider.send('evm_mine');
    }

    async function openWork() {
        await mined(engine.connect(creator).registerArtwork('ipfs://keeper-art'));
        const work = await engine.workCount();
        await mined(engine.connect(creator).createAuction(work, eth('0.1'), DAY));
        return engine.auctionCount();
    }

    async function bid(id, buyer, amount) {
        const price = eth(amount);
        const value = await engine.requiredDepositForBid(price);
        await mined(engine.connect(buyer).placeBid(id, price, { value }));
    }

    function cycle(executeLocal = true) {
        return runKeeperCycle({ provider, store, config, executeLocal });
    }

    function hasAction(result, id, action, status) {
        return result.actions.some(row => row.id === String(id) && row.action === action && row.status === status);
    }

    function sends() {
        return provider.getTransactionCount(operator.address);
    }

    before(async () => {
        ({ runKeeperCycle } = await import('../scripts/auction-keeper.mjs'));
        ({ openKeeperStore } = await import('../scripts/auction-keeper-discovery.mjs'));
    });

    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [deployer, creator, winner, runner, operator, treasury] = await provider.listAccounts();
        const artifact = await artifacts.readArtifact('OrdinaryAuctionFixture');
        const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
        engine = await factory.deploy(treasury.address);
        const deployment = await engine.deploymentTransaction().wait();
        nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, provider);
        config = {
            chainId: 31337,
            engine: engine.target,
            codeHash: ethers.keccak256(await provider.getCode(engine.target)),
            startBlock: deployment.blockNumber,
            operator: operator.address,
        };
        store = openKeeperStore(':memory:', config);
    });

    afterEach(() => store?.close());

    it('uses the extended bidding deadline, preserves both payment windows and spends no gas on a bidless work', async () => {
        const empty = await openWork();
        const funded = await openWork();
        const originalEnd = (await engine.auctions(funded)).end;
        await bid(funded, runner, '0.1');
        await mineAt(originalEnd - 60n);
        await bid(funded, winner, '0.2');
        const extendedEnd = (await engine.auctions(funded)).end;
        assert.ok(extendedEnd > originalEnd);

        await mineAt(originalEnd);
        await cycle();
        assert.equal(await sends(), 0);
        assert.equal(await engine.currentAuctionForWork(empty), 0n);
        assert.equal((await engine.auctions(empty)).state, 1n);
        await mined(engine.setEntryPaused(true));

        await mineAt(extendedEnd);
        assert.ok(hasAction(await cycle(false), funded, 'closeAuction', 'preview'));
        assert.equal(await sends(), 0);
        assert.ok(hasAction(await cycle(), funded, 'closeAuction', 'confirmed'));
        const payment = await engine.auctions(funded);
        assert.equal(payment.state, 2n);
        assert.equal(await sends(), 1);

        await mineAt(payment.deadline);
        await cycle();
        assert.equal(await sends(), 1);
        await mineAt(payment.deadline + 1n);
        assert.ok(hasAction(await cycle(), funded, 'finalizeDefault', 'confirmed'));
        const offer = await engine.runnerUpOffers(funded);
        assert.equal(offer.bidder, runner.address);
        assert.equal(offer.price, eth('0.1'));
        assert.equal(await nft.totalSupply(), 0n);
        assert.equal(await sends(), 2);

        await mineAt(offer.deadline);
        await cycle();
        assert.equal(await sends(), 2);
        await mineAt(offer.deadline + 1n);
        assert.ok(hasAction(await cycle(), funded, 'expireRunnerUpOffer', 'confirmed'));
        await cycle();
        assert.equal(await sends(), 3);
        assert.equal(await engine.currentAuctionForWork(funded), 0n);
        assert.equal((await engine.works(funded)).floor, 0n);
        assert.equal(await nft.totalSupply(), 0n);
    });

    it('observes a winner paying after preview and never sends the obsolete close', async () => {
        const id = await openWork();
        await bid(id, winner, '0.1');
        await mineAt((await engine.auctions(id)).end);
        assert.ok(hasAction(await cycle(false), id, 'closeAuction', 'preview'));
        await mined(engine.connect(winner).settleAuction(id, { value: eth('0.09') }));
        await cycle();
        assert.equal(await sends(), 0);
        assert.equal(await nft.firstCollector(1), winner.address);
        assert.equal(await nft.totalSupply(), 1n);
    });

    it('processes two funded expirations in separate cycles and keeps both deposits locked for payment', async () => {
        const first = await openWork();
        const second = await openWork();
        await bid(first, winner, '0.1');
        await bid(second, runner, '0.1');
        await mineAt((await engine.auctions(second)).end);

        const closed = [];
        for (const expectedCount of [1, 2]) {
            const result = await cycle();
            const confirmed = result.actions.filter(row => row.status === 'confirmed');
            assert.equal(confirmed.length, 1);
            assert.equal(confirmed[0].action, 'closeAuction');
            closed.push(confirmed[0].id);
            assert.equal(await sends(), expectedCount);
        }
        assert.deepEqual(closed.sort(), [String(first), String(second)]);
        assert.equal((await engine.auctions(first)).deposit, eth('0.01'));
        assert.equal((await engine.auctions(second)).deposit, eth('0.01'));
        await cycle();
        assert.equal(await sends(), 2);
        assert.equal(await nft.totalSupply(), 0n);
    });
});
