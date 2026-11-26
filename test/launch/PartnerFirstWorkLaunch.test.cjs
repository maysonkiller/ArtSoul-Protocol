const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const mine = async operation => (await operation).wait();
const day = 86400n;
const maxTime = (1n << 64n) - 1n;

describe('Partner collection first-work lifecycle', function () {
    this.timeout(60000);
    let provider, creator, protocol, bidder, collector, publicBuyer, launch, first, sale;

    async function at(timestamp) {
        await network.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);
        await network.provider.send('evm_mine');
    }

    async function lock(publicPhase = sale) {
        await mine(launch.addPhase(first));
        await mine(launch.addPhase(publicPhase));
        return mine(launch.lockConfiguration());
    }

    function event(receipt, name) {
        return receipt.logs.map(log => launch.interface.parseLog(log)).find(log => log?.name === name)?.args;
    }

    const reject = (operation, name) => assert.rejects(operation, error => {
        assert.equal((error.data ?? error.error?.data)?.slice(0, 10), launch.interface.getError(name).selector, String(error));
        return true;
    });

    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [creator, protocol, bidder, collector, publicBuyer] = await provider.listAccounts();
        const source = await artifacts.readArtifact('SettledArtworkSourceFixture');
        const registry = await (await new ethers.ContractFactory(source.abi, source.bytecode, creator).deploy()).waitForDeployment();
        const { abi, bytecode } = await artifacts.readArtifact('PartnerFirstWorkLaunch');
        launch = await (await new ethers.ContractFactory(abi, bytecode, creator)
            .deploy('Fixture series', 'SER', 'ipfs://fixture/', 4, creator.address, protocol.address, registry.target)).waitForDeployment();
        const start = BigInt((await provider.getBlock('latest')).timestamp) + 120n;
        first = {kind: 3, start, end: start + day, allocation: 1, walletLimit: 1, price: 100n, merkleRoot: ethers.ZeroHash,
            enabled: true, rollover: false, priceSource: 0, fallbackEnabled: false, fallbackPrice: 0};
        sale = {...first, kind: 0, start: first.end + 10n, end: first.end + day, allocation: 3, walletLimit: 3, price: 0, priceSource: 1};
    });

    it('locks one first NFT and the entire public remainder to its paid price', async () => {
        await reject(launch.addPhase.staticCall({...first, kind: 2}), 'InvalidConfiguration');
        await mine(launch.addPhase(first));
        await reject(launch.lockConfiguration.staticCall(), 'InvalidConfiguration');
        for (const overrides of [{allocation: 2}, {enabled: false}, {kind: 1}, {price: 1, priceSource: 0},
            {fallbackEnabled: true, fallbackPrice: 1}]) {
            await reject(launch.addPhase.staticCall({...sale, ...overrides}), 'InvalidConfiguration');
        }
        await mine(launch.addPhase(sale));
        const receipt = await mine(launch.lockConfiguration());
        assert.deepEqual([...event(receipt, 'OpeningAttemptStarted')], [1n, first.start, first.end, sale.start, sale.end]);
        assert.equal(await launch.collectionFirstCollector(), ethers.ZeroAddress);
        await reject(launch.mintPrice(1), 'PriceUnavailable');
        await reject(launch.retryFirstAuction.staticCall(), 'PhaseUnavailable');
    });

    it('retries only an empty opening, with the reserve, durations, gap and reserved stock preserved', async () => {
        await lock();
        await at(sale.end + day);
        await reject(launch.connect(bidder).retryFirstAuction.staticCall(), 'OwnableUnauthorizedAccount');
        await reject(launch.closePhase.staticCall(1), 'PriceUnavailable');
        const emptyClose = await mine(launch.connect(bidder).closePhase(0));
        await mine(launch.pause());
        await reject(launch.retryFirstAuction.staticCall(), 'EnforcedPause');
        await mine(launch.unpause());
        const restarted = await mine(launch.retryFirstAuction());
        const next = BigInt((await restarted.getBlock()).timestamp);
        const shift = next - first.start;
        assert.deepEqual([...event(restarted, 'OpeningAttemptStarted')], [2n, next, first.end + shift, sale.start + shift, sale.end + shift]);
        const [opening, state] = await launch.phase(0);
        assert.equal(opening.price, first.price);
        assert.equal(state.closed, false);
        assert.equal(state.capacity, 1n);
        assert.equal((await launch.phase(1))[1].capacity, 3n);
        assert.equal(await launch.reapplicationAvailableAt(), 0n);
        await reject(launch.retryFirstAuction.staticCall(), 'PhaseUnavailable');
        await mine(launch.connect(bidder).bid(0, {value: 400n}));
        await at(opening.end);
        await reject(launch.retryFirstAuction.staticCall(), 'PhaseUnavailable');
        await reject(launch.mintPrice(1), 'PriceUnavailable');
        const closed = await mine(launch.connect(publicBuyer).finalizeAuction(0));
        assert.equal(await launch.mintPrice(1), 400n);
        assert.equal(await launch.collectionFirstCollector(), bidder.address);
        assert.equal(await launch.totalSupply(), 0n);
        assert.equal(await launch.credits(protocol.address), 10n);
        assert.equal(await launch.credits(creator.address), 390n);
        await at(sale.start + shift);
        await reject(launch.connect(publicBuyer).mintPhase.staticCall(1, 1, 0, [], publicBuyer.address, {value: 100n}), 'IncorrectPayment');
        const publicMint = await mine(launch.connect(publicBuyer).mintPhase(1, 3, 0, [], publicBuyer.address, {value: 1200n}));
        const claimed = await mine(launch.connect(bidder).claimAuction(0, collector.address));
        assert.equal(await launch.ownerOf(1), collector.address);
        assert.equal(await launch.firstCollector(1), bidder.address);
        assert.equal(await launch.collectionFirstCollector(), bidder.address);
        assert.equal(await launch.ownerOf(4), publicBuyer.address);
        assert.equal(await launch.totalSupply(), 4n);
        assert.equal(await launch.credits(protocol.address), 40n);
        assert.equal(await launch.credits(creator.address), 1560n);

        const transfer = await mine(launch.connect(collector).transferFrom(collector.address, publicBuyer.address, 1));
        const rpc = (method, params) => network.provider.send(method, params);
        const head = await rpc('eth_getBlockByNumber', ['latest', false]);
        const address = await launch.getAddress();
        const runtimeHash = ethers.keccak256(await rpc('eth_getCode', [address, 'latest']));
        const work = { price: await launch.mintPrice(1), firstCollector: await launch.firstCollector(1) };
        const { readCollectionOpeningReceipts } = await import('../../scripts/read-collection-opening-receipts.mjs');
        const verify = (settlement, issuance, read = rpc) =>
            readCollectionOpeningReceipts(read, head, address, runtimeHash, work, { settlement, issuance });
        const proof = await verify(closed.hash, claimed.hash);
        assert.equal(proof.settlement.transactionHash, closed.hash);
        assert.equal(proof.issuance.transactionHash, claimed.hash);
        assert.ok(proof.mintLogIndex < proof.issuance.logIndex);
        assert.equal(proof.mintRecipient, collector.address);
        assert.equal(await launch.ownerOf(1), publicBuyer.address);
        for (const other of [publicMint, transfer]) await assert.rejects(verify(closed.hash, other.hash), /CollectionMinted/);
        await assert.rejects(verify(emptyClose.hash, claimed.hash), /funded opening/);
        await assert.rejects(verify(closed.hash, claimed.hash, async (method, params) => {
            const result = await rpc(method, params);
            return method === 'eth_getBlockByNumber' ? { ...result, transactions: [] } : result;
        }), /finalized block position/);
    });

    it('cancels at the third bidless deadline and measures 30 days independently of the closing caller', async () => {
        await lock();
        for (const attempt of [2n, 3n]) {
            await at((await launch.phase(0))[0].end);
            const receipt = await mine(launch.retryFirstAuction());
            assert.equal(event(receipt, 'OpeningAttemptStarted').attempt, attempt);
        }
        const deadline = (await launch.phase(0))[0].end;
        await at(deadline - 1n);
        assert.equal(await launch.reapplicationAvailableAt(), 0n);
        await at(deadline);
        const eligible = deadline + 30n * day;
        assert.equal(await launch.reapplicationAvailableAt(), eligible);
        await reject(launch.retryFirstAuction.staticCall(), 'PhaseUnavailable');
        await at(deadline + 2n * day);
        const receipt = await mine(launch.connect(publicBuyer).finalizeAuction(0));
        assert.deepEqual([...event(receipt, 'OpeningLaunchCancelled')], [deadline, eligible]);
        await reject(launch.finalizeAuction.staticCall(0), 'PhaseUnavailable');
        await at(eligible - 1n);
        await reject(launch.requestReapplication.staticCall(), 'PhaseUnavailable');
        await network.provider.send('evm_setNextBlockTimestamp', [Number(eligible)]);
        const requested = await mine(launch.requestReapplication({gasLimit: 200_000}));
        assert.equal(BigInt((await requested.getBlock()).timestamp), eligible);
        assert.deepEqual([...event(requested, 'PartnerReapplicationRequested')], [creator.address]);
        assert.equal(await launch.reapplicationRequested(), true);
        await reject(launch.requestReapplication.staticCall(), 'PhaseUnavailable');
        await reject(launch.retryFirstAuction.staticCall(), 'PhaseUnavailable');
        await reject(launch.mintPrice(1), 'PriceUnavailable');
        assert.equal(await launch.collectionFirstCollector(), ethers.ZeroAddress);
        assert.equal(await launch.totalSupply(), 0n);
        assert.equal(await launch.credits(creator.address), 0n);
    });

    it('starts a usable public window after late funded settlement, including an open-ended sale', async () => {
        await lock({...sale, end: maxTime});
        await at(first.start);
        await mine(launch.connect(bidder).bid(0, {value: first.price}));
        await at(sale.end + day);
        const receipt = await mine(launch.connect(publicBuyer).closePhase(0));
        const now = BigInt((await receipt.getBlock()).timestamp);
        assert.deepEqual([...event(receipt, 'PublicMintWindowShifted')], [now, maxTime]);
        await mine(launch.connect(publicBuyer).mintPhase(1, 1, 0, [], publicBuyer.address, {value: first.price}));
        assert.equal(await launch.ownerOf(2), publicBuyer.address);
        assert.equal(await launch.mintPrice(1), first.price);
    });
});
