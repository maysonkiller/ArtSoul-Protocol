const assert = require('node:assert/strict');
const hre = require('hardhat');
const { artifacts } = hre;
const { createProvider } = require('hardhat/internal/core/providers/construction');
const { ethers } = require('ethers');

const DAY = 86400n;
const eth = ethers.parseEther;
const id = 1n;
const mine = async tx => (await tx).wait();
const event = (receipt, name) => receipt.logs.find(log => log.fragment?.name === name)?.args;

describe('Runner-up offers for ordinary artworks', function () {
    this.timeout(90000);
    let evm, provider, operator, creator, winner, runner, third, treasury, engine, nft, reviewedPair;
    const at = timestamp => evm.send('evm_setNextBlockTimestamp', [Number(timestamp)]);

    before(async () => {
        const chain = { ...hre.config.networks.hardhat, chainId: 84532, forking: undefined };
        evm = await createProvider({ ...hre.config, networks: { hardhat: chain } }, 'hardhat', artifacts);
    });
    afterEach(() => provider?.destroy());

    async function deploy(name, ...args) {
        const artifact = await artifacts.readArtifact(name);
        return (await new ethers.ContractFactory(artifact.abi, artifact.bytecode, operator).deploy(...args)).waitForDeployment();
    }

    beforeEach(async () => {
        await evm.send('hardhat_reset');
        provider = new ethers.BrowserProvider(evm, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [operator, creator, winner, runner, third, treasury] = await provider.listAccounts();
        engine = await deploy('OrdinaryAuctionFixture', treasury.address);
        nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, provider);
        reviewedPair = { chainId: 84532, coreAddress: engine.target, nftAddress: nft.target,
            expectedCoreCodeHash: ethers.keccak256(await provider.getCode(engine.target)),
            expectedNftCodeHash: ethers.keccak256(await provider.getCode(nft.target)) };
        await mine(engine.connect(creator).registerArtwork('ipfs://ordinary'));
        await mine(engine.connect(creator).createAuction(id, eth('0.1'), DAY));
    });

    async function readOffer(blockNumber = 'latest') {
        const { default: EventListener } = await import('../src/indexer/event-listener.js');
        const block = await provider.getBlock(blockNumber);
        const listener = Object.assign(Object.create(EventListener.prototype), {
            chainId: 84532, contractAddress: engine.target, nftAddress: nft.target,
            readProviders: [evm], readRpcs: ['in-process'], readRpcUnavailableUntil: [0], baseTimeout: 5000
        });
        return listener.readOrdinaryRunnerUpOffer({ ...reviewedPair, blockNumber: block.number,
            blockHash: block.hash, auctionId: id.toString(), isCurrent: () => true });
    }

    async function bid(bidder, amount) {
        const price = eth(amount);
        const value = await engine.requiredDepositForBid(price);
        await mine(engine.connect(bidder).placeBid(id, price, { value }));
    }

    async function close() {
        await at((await engine.auctions(id)).end);
        await mine(engine.connect(third).closeAuction(id));
    }

    async function recordDefault(delay = 1n) {
        await at((await engine.auctions(id)).deadline + delay);
        return mine(engine.connect(third).finalizeDefault(id));
    }

    async function openOffer() {
        await bid(runner, '0.1');
        await bid(winner, '0.2');
        await close();
        await recordDefault();
        return (await engine.runnerUpOffers(id)).deadline;
    }

    async function rejects(call, errorName) {
        await assert.rejects(call, error => {
            const data = error.data ?? error.error?.data;
            assert.equal(data?.slice(0, 10), engine.interface.getError(errorName).selector, String(error));
            return true;
        });
    }

    it('reads the reviewed runner-up offer from a finalized local block through the operator CLI', async () => {
        const { execFile } = require('node:child_process');
        const { mkdtemp, writeFile, unlink, rmdir } = require('node:fs/promises');
        const { join } = require('node:path');
        const { tmpdir } = require('node:os');
        const { promisify } = require('node:util');
        const deadline = await openOffer();
        const block = await provider.getBlock('latest');
        const rpc = await hre.run('node:create-server', { provider: evm, hostname: '127.0.0.1', port: 0 });
        const dir = await mkdtemp(join(tmpdir(), 'artsoul-runner-up-'));
        const file = join(dir, 'pair.json');
        try {
            await writeFile(file, JSON.stringify(reviewedPair));
            const { port } = await rpc.listen();
            const { stdout } = await promisify(execFile)(process.execPath,
                [require.resolve('../scripts/read-ordinary-runner-up.mjs'), file, '1', String(block.number), block.hash], {
                    timeout: 15000, windowsHide: true,
                    env: { SystemRoot: process.env.SystemRoot || '', ARTSOUL_ORDINARY_RPC_URL: `http://127.0.0.1:${port}` }
                });
            const offer = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
            assert.deepEqual(offer, await readOffer(block.number));
            assert.equal(offer.deadline, deadline.toString());
        } finally {
            await rpc.close();
            await unlink(file);
            await rmdir(dir);
        }
    });

    it('refunds returning bidders before default and honors only the runner-up’s last bid at the exact offer deadline', async () => {
        await bid(runner, '0.1');
        await bid(winner, '0.2');
        await bid(third, '0.3');
        await bid(runner, '0.4');
        await bid(winner, '0.5');
        await close();
        const pending = await readOffer();
        assert.deepEqual([pending.status, pending.eligibleBuyer, pending.bidder, pending.priceWei, pending.deadline],
            ['not_offered', null, null, null, null]);
        const value = eth('0.4');
        await rejects(engine.connect(runner).acceptRunnerUpOffer.staticCall(id, { value }), 'WrongAuctionState');
        const earlierBalance = await provider.getBalance(runner.address);
        await mine(engine.processRefunds(id, 2));
        await mine(engine.processRefunds(id, 2));
        assert.equal(await provider.getBalance(runner.address) - earlierBalance, eth('0.05'));

        const receipt = await recordDefault(3n * DAY);
        assert.deepEqual(Array.from(event(receipt, 'AuctionDefaulted')), [id, winner.address, eth('0.05')]);
        const deadline = BigInt((await provider.getBlock(receipt.blockNumber)).timestamp) + DAY;
        assert.deepEqual(Array.from(event(receipt, 'RunnerUpOfferOpened')), [id, runner.address, value, deadline]);
        const opened = await readOffer(receipt.blockNumber);
        assert.deepEqual([opened.status, opened.eligibleBuyer, opened.priceWei, opened.deadline],
            ['open', runner.address.toLowerCase(), value.toString(), deadline.toString()]);
        assert.deepEqual(Array.from(await engine.runnerUpOffers(id)), [runner.address, value, deadline]);
        assert.equal(await engine.credits(creator.address), eth('0.04'));
        assert.equal(await engine.credits(treasury.address), eth('0.01'));
        assert.equal(await nft.totalSupply(), 0n);
        assert.equal((await engine.works(id)).floor, 0n);
        await rejects(engine.connect(creator).createAuction.staticCall(id, value, DAY), 'WrongAuctionState');
        for (const outsider of [winner, third, creator, operator]) {
            await rejects(engine.connect(outsider).acceptRunnerUpOffer.staticCall(id, { value }), 'NotRunnerUp');
            await rejects(engine.connect(outsider).declineRunnerUpOffer.staticCall(id), 'NotRunnerUp');
        }
        await rejects(engine.connect(winner).settleAuction.staticCall(id, { value: eth('0.45') }), 'WrongAuctionState');
        await rejects(engine.finalizeDefault.staticCall(id), 'WrongAuctionState');
        await rejects(engine.connect(runner).acceptRunnerUpOffer.staticCall(id, { value: eth('0.36') }), 'IncorrectFunding');
        await rejects(engine.connect(runner).acceptRunnerUpOffer.staticCall(id, { value: value + 1n }), 'IncorrectFunding');
        await mine(engine.setEntryPaused(true));
        await at(deadline);
        const sale = await mine(engine.connect(runner).acceptRunnerUpOffer(id, { value }));
        const rawReceipt = await evm.send('eth_getTransactionReceipt', [sale.hash]);
        const { parseOrdinarySettlement } = await import('../src/indexer/ordinary-settlement.js');
        const pair = { coreAddress: engine.target.toLowerCase(), nftAddress: nft.target.toLowerCase(),
            chainId: 84532, blockNumber: sale.blockNumber, blockHash: sale.blockHash };
        const projected = parseOrdinarySettlement(rawReceipt, pair, sale.hash, id.toString());
        assert.equal(projected.firstCollector, runner.address.toLowerCase());
        assert.equal(projected.creator, creator.address.toLowerCase());
        assert.equal(projected.priceWei, value.toString());
        assert.equal(projected.runnerUpAccepted, true);
        assert.deepEqual(Array.from(event(sale, 'RunnerUpOfferAccepted')), [id, runner.address, value]);
        const accepted = await readOffer(sale.blockNumber);
        assert.deepEqual([accepted.status, accepted.eligibleBuyer, accepted.bidder, accepted.priceWei],
            ['accepted', null, runner.address.toLowerCase(), value.toString()]);
        assert.deepEqual(await readOffer(receipt.blockNumber), opened);
        assert.deepEqual(Array.from(event(sale, 'AuctionSettled')), [id, id, 1n, value]);
        const auction = await engine.auctions(id);
        assert.equal(auction.highestBidder, winner.address);
        assert.equal(auction.price, eth('0.5'));
        assert.equal(auction.firstCollector, runner.address);
        assert.equal((await engine.nftSettlement(id)).firstCollector, runner.address);
        assert.equal(await nft.ownerOf(1), runner.address);
        assert.equal(await nft.firstCollector(1), runner.address);
        assert.equal((await engine.works(id)).floor, value);
        assert.equal(await engine.currentAuctionForWork(id), 0n);
        assert.equal(await engine.credits(creator.address), eth('0.43'));
        assert.equal(await engine.credits(treasury.address), eth('0.02'));
        assert.equal(await engine.credits(runner.address), 0n);
        await rejects(engine.connect(runner).acceptRunnerUpOffer.staticCall(id, { value }), 'WrongAuctionState');
        await rejects(engine.connect(runner).declineRunnerUpOffer.staticCall(id), 'WrongAuctionState');
        await rejects(engine.expireRunnerUpOffer.staticCall(id), 'WrongAuctionState');
        for (const payee of [creator, treasury]) await mine(engine.connect(payee).withdraw());
        assert.equal(await provider.getBalance(engine.target), 0n);
    });

    it('lets the runner-up decline during a pause and releases the work without offering it to a third bidder', async () => {
        await bid(third, '0.1');
        await bid(runner, '0.2');
        await bid(winner, '0.3');
        await close();
        await mine(engine.setEntryPaused(true));
        await recordDefault();
        const before = await provider.getBalance(runner.address);
        await mine(engine.processRefunds(id, 2));
        assert.equal(await provider.getBalance(runner.address) - before, eth('0.02'));
        const receipt = await mine(engine.connect(runner).declineRunnerUpOffer(id));
        assert.deepEqual(Array.from(event(receipt, 'RunnerUpOfferDeclined')), [id, runner.address]);
        assert.equal((await readOffer(receipt.blockNumber)).status, 'closed');
        assert.equal(await engine.currentAuctionForWork(id), 0n);
        assert.equal((await engine.works(id)).floor, 0n);
        assert.equal(await nft.totalSupply(), 0n);
        await rejects(engine.connect(third).acceptRunnerUpOffer.staticCall(id, { value: eth('0.1') }), 'WrongAuctionState');
        await rejects(engine.connect(runner).declineRunnerUpOffer.staticCall(id), 'WrongAuctionState');
        assert.equal(await engine.credits(creator.address), eth('0.024'));
        assert.equal(await engine.credits(treasury.address), eth('0.006'));
        await mine(engine.setEntryPaused(false));
        await mine(engine.connect(creator).createAuction(id, eth('0.3'), DAY));
        assert.equal(await engine.currentAuctionForWork(id), 2n);
    });

    for (const lazyRelist of [false, true]) {
        const outcome = lazyRelist ? 'inside the creator’s relist' : 'by a third party during a pause';
        it('expires the offer strictly after its deadline ' + outcome, async () => {
            const deadline = await openOffer();
            if (!lazyRelist) await mine(engine.setEntryPaused(true));
            await at(deadline);
            await evm.send('evm_mine');
            const atDeadline = await readOffer();
            assert.equal(atDeadline.eligibleBuyer, runner.address.toLowerCase());
            assert.equal(await engine.currentAuctionForWork(id), id);
            assert.equal(await engine.dueAuctionAction(id), 0n);
            await rejects(engine.connect(third).expireRunnerUpOffer.staticCall(id), 'WrongAuctionState');
            await at(deadline + 1n);
            await evm.send('evm_mine');
            const expired = await readOffer();
            assert.deepEqual([expired.status, expired.eligibleBuyer, expired.deadline],
                ['expired', null, deadline.toString()]);
            assert.equal(await engine.dueAuctionAction(id), 3n);
            assert.equal(await engine.currentAuctionForWork(id), 0n);
            await rejects(engine.connect(runner).acceptRunnerUpOffer.staticCall(id, { value: eth('0.1') }), 'WrongAuctionState');
            await rejects(engine.connect(runner).declineRunnerUpOffer.staticCall(id), 'WrongAuctionState');
            const receipt = lazyRelist
                ? await mine(engine.connect(creator).createAuction(id, eth('0.1'), DAY))
                : await mine(engine.connect(third).expireRunnerUpOffer(id));
            assert.deepEqual(Array.from(event(receipt, 'RunnerUpOfferExpired')), [id, runner.address]);
            assert.equal((await readOffer(receipt.blockNumber)).status, 'closed');
            assert.equal(await engine.currentAuctionForWork(id), lazyRelist ? 2n : 0n);
            assert.equal(await engine.dueAuctionAction(id), 0n);
            await rejects(engine.expireRunnerUpOffer.staticCall(id), 'WrongAuctionState');
            assert.equal(await nft.totalSupply(), 0n);
            assert.equal((await engine.works(id)).floor, 0n);
            const before = await provider.getBalance(runner.address);
            await mine(engine.processRefunds(id, 1));
            assert.equal(await provider.getBalance(runner.address) - before, eth('0.01'));
        });
    }

    it('releases a single-bid work immediately when its winner defaults', async () => {
        await bid(winner, '0.2');
        await close();
        const receipt = await recordDefault();
        assert.equal(event(receipt, 'RunnerUpOfferOpened'), undefined);
        assert.equal((await readOffer(receipt.blockNumber)).status, 'not_offered');
        assert.equal(await engine.currentAuctionForWork(id), 0n);
        assert.equal(await engine.dueAuctionAction(id), 0n);
        await rejects(engine.connect(winner).acceptRunnerUpOffer.staticCall(id, { value: eth('0.2') }), 'WrongAuctionState');
        await mine(engine.connect(creator).createAuction(id, eth('0.2'), DAY));
        assert.equal(await nft.totalSupply(), 0n);
        assert.equal((await engine.works(id)).floor, 0n);
    });

    it('keeps a rejected refund withdrawable and rolls back the sale when the runner-up rejects NFT delivery', async () => {
        const wallet = await deploy('OrdinaryBidderFixture');
        const value = eth('0.1');
        await mine(wallet.bid(engine.target, id, value, { value: eth('0.01') }));
        await bid(winner, '0.2');
        await close();
        await recordDefault();
        await mine(engine.processRefunds(id, 1));
        assert.equal(await engine.credits(wallet.target), eth('0.01'));
        const payment = { value, gasLimit: 3000000 };
        await assert.rejects(mine(wallet.acceptOffer(engine.target, id, payment)));
        assert.equal(await engine.currentAuctionForWork(id), id);
        assert.equal(await nft.totalSupply(), 0n);
        assert.equal((await engine.works(id)).floor, 0n);
        assert.equal(await engine.credits(creator.address), eth('0.016'));
        assert.equal(await engine.credits(treasury.address), eth('0.004'));
        assert.equal(await provider.getBalance(engine.target), eth('0.03'));
        await mine(wallet.acceptDelivery(true, true));
        await mine(wallet.acceptOffer(engine.target, id, payment));
        assert.equal(await nft.firstCollector(1), wallet.target);
        assert.equal(await engine.credits(wallet.target), eth('0.01'));
        await mine(wallet.withdraw(engine.target));
        assert.equal(await provider.getBalance(wallet.target), eth('0.01'));
        assert.equal(await provider.getBalance(engine.target), eth('0.12'));
    });
});
