const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const mine = async tx => (await tx).wait();
const day = 86400n;

const candidates = [
    ['OrdinaryMarket', require('../docs/architecture/C1_ORDINARY_PAIR_STORAGE_2026-11-20.json'), 2n],
    ['OrdinaryPayoutMarket', require('../docs/architecture/C1_ORDINARY_PAYOUT_STORAGE.json'), 8n]
];

for (const [coreName, layout, batchLimit] of candidates) {
    describe(`Treasury and security bindings for ${coreName}`, function () {
        this.timeout(90000);
        verifyMarket(coreName, layout, batchLimit);
    });
}

function verifyMarket(coreName, layout, batchLimit) {
    let provider, deployer, artist, collector, buyer, protocol, ecosystem, security, engine;

    async function deploy(name, ...args) {
        const { abi, bytecode } = await artifacts.readArtifact(name);
        return (await new ethers.ContractFactory(abi, bytecode, deployer).deploy(...args)).waitForDeployment();
    }

    const deployMarket = (...roles) => deploy(coreName, ...roles, batchLimit, 30_000);

    async function rejects(operation, name) {
        await assert.rejects(operation, error => {
            const data = error.data ?? error.error?.data;
            assert.equal(data?.slice(0, 10), engine.interface.getError(name).selector, String(error));
            return true;
        });
    }

    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [deployer, artist, collector, buyer] = await provider.listAccounts();
        protocol = await deploy('TreasuryAccountStub', 2);
        ecosystem = await deploy('TreasuryAccountStub', 2);
        security = await deploy('TreasuryAccountStub', 2);
        engine = await deployMarket(protocol.target, ecosystem.target, security.target);
    });

    if (coreName === 'OrdinaryPayoutMarket') {
        it('matches the reviewed payout Core and NFT runtime hashes after actual local deployment', verifyPayoutRuntime);
        it('lets only the credited wallet route a rejected refund, including while entries are paused', verifyRoutedRefund);
    }

    async function verifyPayoutRuntime() {
        const { loadReviewedPair, buildRehearsalCoreReview, expectedRehearsalPairRegister, expectedOrdinaryPairRegister } = await import('../scripts/prepare-rehearsal-core.mjs');
        const { payoutCore } = await import('../scripts/prepare-ordinary-deployment.mjs');
        const { buildOrdinaryAuditManifest } = require('../scripts/ordinary-audit-manifest.cjs');
        const { core, nft, layout, manifest } = await loadReviewedPair(payoutCore);
        assert.deepEqual(buildOrdinaryAuditManifest(undefined, 'OrdinaryPayoutMarket'), manifest);
        const historical = new ethers.Interface((await artifacts.readArtifact('OrdinaryMarket')).abi).format();
        const current = new ethers.Interface(core.abi).format();
        assert.deepEqual(current.filter(entry => historical.includes(entry)), historical);
        assert.deepEqual(current.filter(entry => !historical.includes(entry)).sort(), [
            'error InvalidCreditRecipient()',
            'event CreditRouted(address indexed creditor, address indexed recipient)',
            'function withdrawTo(address recipient)'
        ]);
        const roles = { protocolTreasury: protocol, ecosystemTreasury: ecosystem, adminSecurity: security };
        const custody = { chainId: 84532 };
        for (const [role, safe] of Object.entries(roles)) {
            custody[role] = { address: safe.target, threshold: 2, owners: [...await safe.getOwners()] };
        }
        const nonce = await provider.getTransactionCount(deployer.address);
        const review = buildRehearsalCoreReview(core, manifest, custody, deployer.address, nonce);
        const register = expectedRehearsalPairRegister(custody, review, manifest, layout, core, nft);
        const deployed = await deploy(core.contractName, protocol.target, ecosystem.target, security.target, 8, 30_000);
        assert.equal(deployed.target, register.core.address);
        assert.equal(await deployed.nft(), register.nft.address);
        for (const entry of [register.core, register.nft]) {
            assert.equal(ethers.keccak256(await provider.getCode(entry.address)), entry.codeHash);
        }

        // The release takes its limits from its own review, including decimal-string inputs.
        // This second deployment still runs only on the disposable Hardhat network.
        const releaseNonce = await provider.getTransactionCount(deployer.address);
        const expectedCore = ethers.getCreateAddress({ from: deployer.address, nonce: releaseNonce });
        const args = [protocol.target, ecosystem.target, security.target, 3, 45000];
        const release = { ...review, chainId: 8453, nonce: releaseNonce, expectedCore,
            expectedNFT: ethers.getCreateAddress({ from: expectedCore, nonce: 1 }),
            initCodeHash: ethers.keccak256(ethers.concat([core.bytecode, new ethers.Interface(core.abi).encodeDeploy(args)])),
            constructorArgs: [...review.constructorArgs.slice(0, 3), '3', '45000'] };
        const linked = expectedOrdinaryPairRegister({ ...custody, chainId: 8453 }, release, manifest, layout, core, nft);
        const second = await deploy(core.contractName, ...args);
        assert.equal(second.target, linked.core.address);
        assert.equal(await second.nft(), linked.nft.address);
        for (const entry of [linked.core, linked.nft]) {
            assert.equal(ethers.keccak256(await provider.getCode(entry.address)), entry.codeHash);
        }
    }

    async function verifyRoutedRefund() {
        const wallet = await deploy('OrdinaryBidderFixture');
        const startPrice = ethers.parseEther('0.1');
        const credit = await engine.requiredDepositForBid(startPrice);
        await mine(engine.connect(artist).registerArtwork('ipfs://refund-work'));
        await mine(engine.connect(artist).createAuction(1, startPrice, day));
        await mine(wallet.bid(engine.target, 1, startPrice, { value: credit }));
        const next = await engine.minimumBid(1);
        const heldDeposit = await engine.requiredDepositForBid(next);
        await mine(engine.connect(collector).placeBid(1, next, { value: heldDeposit }));
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(1)).end)]);
        await mine(engine.closeAuction(1));
        await mine(engine.processRefunds(1, 2));
        await mine(security.setPause(engine.target, true));
        assert.equal(await engine.credits(wallet.target), credit);
        await rejects(engine.connect(buyer).withdrawTo.staticCall(buyer.address), 'NoCredit');
        await rejects(wallet.withdraw.staticCall(engine.target), 'CreditTransferFailed');
        for (const recipient of [ethers.ZeroAddress, engine.target]) {
            await rejects(wallet.withdrawTo.staticCall(engine.target, recipient), 'InvalidCreditRecipient');
        }
        await rejects(wallet.withdrawTo(engine.target, wallet.target, { gasLimit: 200_000 }).then(mine), 'CreditTransferFailed');
        assert.equal(await engine.credits(wallet.target), credit);
        const before = await provider.getBalance(buyer.address);
        const receipt = await mine(wallet.withdrawTo(engine.target, buyer.address));
        const logs = receipt.logs.map(log => engine.interface.parseLog(log));
        assert.deepEqual(logs.map(log => [log.name, ...log.args]), [
            ['CreditRouted', wallet.target, buyer.address], ['CreditWithdrawn', wallet.target, credit]
        ]);
        assert.equal(await provider.getBalance(buyer.address), before + credit);
        assert.equal(await provider.getBalance(engine.target), heldDeposit);
        assert.equal(await engine.credits(wallet.target), 0n);
        await rejects(wallet.withdrawTo.staticCall(engine.target, buyer.address), 'NoCredit');
    }

    it('requires three distinct two-of-three accounts and explicit refund limits at creation', async () => {
        assert.deepEqual([await engine.protocolTreasury(), await engine.ecosystemTreasury(), await engine.adminSecurity()],
            [protocol.target, ecosystem.target, security.target]);
        const single = await deploy('TreasuryAccountStub', 1);
        const three = await deploy('TreasuryAccountStub', 3);
        const fourOwners = await deploy('TreasuryAccountStub', 2);
        await mine(fourOwners.addOwner(buyer.address));
        for (const index of [0, 1, 2]) {
            const roles = [protocol.target, ecosystem.target, security.target];
            for (const invalid of [ethers.ZeroAddress, deployer.address, single.target, three.target, fourOwners.target]) {
                roles[index] = invalid;
                await rejects(deployMarket(...roles), 'InvalidMultisig');
            }
            roles[index] = roles[(index + 1) % 3];
            await rejects(deployMarket(...roles), 'OverlappingSafeRoles');
        }
        const safes = [protocol.target, ecosystem.target, security.target];
        for (const limits of [[0, 30_000], [2, 0]]) {
            await rejects(deploy(coreName, ...safes, ...limits), 'InvalidRefundLimits');
        }
        assert.equal(await engine.refundBatchLimit(), batchLimit);
        assert.equal(await engine.refundTransferGas(), 30_000n);
    });

    it('reserves both entry-pause directions for the bound governance account with a current quorum', async () => {
        for (const value of [true, false]) {
            await rejects(engine.setEntryPaused.staticCall(value), 'UnauthorizedPauseCaller');
            for (const account of [protocol, ecosystem]) {
                await rejects(account.setPause.staticCall(engine.target, value), 'UnauthorizedPauseCaller');
            }
            await mine(security.setThreshold(1));
            await rejects(security.setPause.staticCall(engine.target, value), 'InvalidMultisig');
            await mine(security.setThreshold(2));
            await mine(security.setPause(engine.target, value));
            assert.equal(await engine.paused(), value);
        }
    });

    it('reserves scheduling, cancellation and disablement for the security Safe and makes the notice public', async () => {
        const market = await deploy('SettledArtworkSourceFixture');
        for (const [method, forward] of [
            ['scheduleMarketplaceAdmission', 'scheduleMarket'],
            ['cancelMarketplaceAdmission', 'cancelMarket'],
            ['disableMarketplace', 'disableMarket']
        ]) {
            await rejects(engine[method].staticCall(market.target), 'UnauthorizedMarketplaceGovernor');
            for (const treasury of [protocol, ecosystem]) {
                await rejects(treasury[forward].staticCall(engine.target, market.target), 'UnauthorizedMarketplaceGovernor');
            }
        }
        for (const invalid of [ethers.ZeroAddress, buyer.address, engine.target]) {
            await rejects(security.scheduleMarket.staticCall(engine.target, invalid), 'InvalidMarketplaceChange');
        }
        await rejects(engine.executeMarketplaceAdmission.staticCall(market.target), 'InvalidMarketplaceChange');
        const scheduled = await mine(security.scheduleMarket(engine.target, market.target));
        const readyAt = BigInt((await scheduled.getBlock()).timestamp) + 2n * day;
        const event = scheduled.logs.map(log => engine.interface.parseLog(log)).find(log => log?.name === 'MarketplaceAdmissionScheduled');
        assert.deepEqual([...event.args], [market.target, readyAt]);
        assert.equal(await engine.marketplaceAdmissionReadyAt(market.target), readyAt);
        assert.equal(await engine.isMarketplaceAllowed(market.target), false);
        await rejects(security.scheduleMarket.staticCall(engine.target, market.target), 'InvalidMarketplaceChange');
        await mine(security.setThreshold(1));
        await rejects(security.cancelMarket.staticCall(engine.target, market.target), 'InvalidMultisig');
        await mine(security.setThreshold(2));
        await network.provider.send('evm_setNextBlockTimestamp', [Number(readyAt)]);
        const cancelled = await mine(security.cancelMarket(engine.target, market.target));
        const cancelEvent = cancelled.logs.map(log => engine.interface.parseLog(log)).find(log => log?.name === 'MarketplaceAdmissionCancelled');
        assert.deepEqual([...cancelEvent.args], [market.target]);
        assert.equal(await engine.marketplaceAdmissionReadyAt(market.target), 0n);
        await rejects(engine.executeMarketplaceAdmission.staticCall(market.target), 'InvalidMarketplaceChange');
        await rejects(security.cancelMarket.staticCall(engine.target, market.target), 'InvalidMarketplaceChange');
        await rejects(security.disableMarket.staticCall(engine.target, engine.target), 'InvalidMarketplaceChange');
        assert.equal(await engine.isMarketplaceAllowed(engine.target), true);
    });

    it('requires the full notice on each admission and preserves owner control across immediate disablement', async () => {
        const market = await deploy('SettledArtworkSourceFixture');
        const nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, collector);
        await mine(engine.connect(artist).registerArtwork('ipfs://admission-work'));
        await mine(engine.connect(artist).createAuction(1, 1000n, day));
        await mine(engine.connect(collector).placeBid(1, 1000n, { value: await engine.requiredDepositForBid(1000n) }));
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(1)).end)]);
        await mine(engine.connect(collector).settleAuction(1));
        for (const generation of [1n, 2n]) {
            const schedule = await mine(security.scheduleMarket(engine.target, market.target));
            const readyAt = (await schedule.getBlock()).timestamp + Number(2n * day);
            await network.provider.send('evm_setNextBlockTimestamp', [readyAt - 1]);
            await network.provider.send('evm_mine');
            await rejects(engine.executeMarketplaceAdmission.staticCall(market.target), 'InvalidMarketplaceChange');
            await network.provider.send('evm_setNextBlockTimestamp', [readyAt]);
            const activation = await mine(engine.connect(buyer).executeMarketplaceAdmission(market.target, { gasLimit: 500000 }));
            assert.equal((await activation.getBlock()).timestamp, readyAt);
            assert.equal(await engine.marketplaceApprovalGeneration(market.target), generation);
            assert.equal(await engine.marketplaceAdmissionReadyAt(market.target), 0n);
            await rejects(engine.executeMarketplaceAdmission.staticCall(market.target), 'InvalidMarketplaceChange');
            await rejects(security.scheduleMarket.staticCall(engine.target, market.target), 'InvalidMarketplaceChange');
            assert.equal(await nft.getApproved(1), ethers.ZeroAddress);
            assert.equal(await nft.isApprovedForAll(collector.address, market.target), false);
            await mine(nft.approve(market.target, 1));
            await mine(nft.setApprovalForAll(market.target, true));
            assert.equal(await nft.getApproved(1), market.target);
            assert.equal(await nft.isApprovedForAll(collector.address, market.target), true);
            await mine(security.setThreshold(1));
            await rejects(security.disableMarket.staticCall(engine.target, market.target), 'InvalidMultisig');
            await mine(security.setThreshold(3));
            await mine(security.disableMarket(engine.target, market.target));
            assert.equal(await engine.isMarketplaceAllowed(market.target), false);
            assert.equal(await nft.getApproved(1), ethers.ZeroAddress);
            assert.equal(await nft.isApprovedForAll(collector.address, market.target), false);
            await rejects(security.disableMarket.staticCall(engine.target, market.target), 'InvalidMarketplaceChange');
            await mine(security.setThreshold(2));
        }
        await mine(nft.transferFrom(collector.address, buyer.address, 1));
        assert.equal(await nft.ownerOf(1), buyer.address);
    });

    it('rechecks the 2-of-3 quorum at execution and permits cancellation under a stronger quorum', async () => {
        const market = await deploy('SettledArtworkSourceFixture');
        for (const change of ['threshold', 'owners']) {
            await mine(security.scheduleMarket(engine.target, market.target));
            const readyAt = await engine.marketplaceAdmissionReadyAt(market.target);
            if (change === 'threshold') await mine(security.setThreshold(3));
            else await mine(security.addOwner(buyer.address));
            await network.provider.send('evm_setNextBlockTimestamp', [Number(readyAt)]);
            await network.provider.send('evm_mine');
            await rejects(engine.executeMarketplaceAdmission.staticCall(market.target), 'InvalidMultisig');
            await mine(security.cancelMarket(engine.target, market.target));
            await rejects(security.scheduleMarket.staticCall(engine.target, market.target), 'InvalidMultisig');
            assert.equal(await engine.isMarketplaceAllowed(market.target), false);
            if (change === 'threshold') await mine(security.setThreshold(2));
        }
    });

    it('keeps a funded auction and its proceeds independent of a second pair deployed by the same wallet', async () => {
        const firstPrice = ethers.parseEther('0.01');
        const secondPrice = 2n * firstPrice;
        async function openAndBid(core, winner, price, uri) {
            await mine(core.connect(artist).registerArtwork(uri));
            await mine(core.connect(artist).createAuction(1, price, day));
            const deposit = await core.requiredDepositForBid(price);
            await mine(core.connect(winner).placeBid(1, price, { value: deposit }));
            return price - deposit;
        }

        const firstPayment = await openAndBid(engine, collector, firstPrice, 'ipfs://first-pair-work');
        const nextSecurity = await deploy('TreasuryAccountStub', 2);
        const next = await deploy('OrdinaryPayoutMarket', protocol.target, ecosystem.target, nextSecurity.target, 8, 30_000);
        const secondPayment = await openAndBid(next, buyer, secondPrice, 'ipfs://second-pair-work');
        await mine(nextSecurity.setPause(next.target, true));
        assert.equal(await next.paused(), true);
        assert.equal(await engine.paused(), false);
        await rejects(nextSecurity.setPause.staticCall(engine.target, true), 'UnauthorizedPauseCaller');

        const { abi } = await artifacts.readArtifact('SettledArtworkNFT');
        const firstNFT = new ethers.Contract(await engine.nft(), abi, provider);
        const secondNFT = new ethers.Contract(await next.nft(), abi, provider);
        assert.notEqual(firstNFT.target, secondNFT.target);
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await next.auctions(1)).end)]);
        await mine(next.connect(buyer).settleAuction(1, { value: secondPayment }));
        assert.equal(await secondNFT.ownerOf(1), buyer.address);
        assert.equal(await firstNFT.totalSupply(), 0n);
        assert.equal(await provider.getBalance(engine.target), firstPrice);
        assert.equal(await engine.credits(protocol.target), 0n);

        await mine(engine.connect(collector).settleAuction(1, { value: firstPayment }));
        assert.equal(await firstNFT.ownerOf(1), collector.address);
        assert.equal(await engine.credits(protocol.target), firstPrice / 40n);
        assert.equal(await next.credits(protocol.target), secondPrice / 40n);
        for (const core of [engine, next]) {
            await rejects(core.connect(deployer).withdraw.staticCall(), 'NoCredit');
        }
        await mine(protocol.claim(next.target));
        assert.equal(await provider.getBalance(protocol.target), secondPrice / 40n);
        assert.equal(await next.credits(protocol.target), 0n);
        assert.equal(await engine.credits(protocol.target), firstPrice / 40n);
        await mine(protocol.claim(engine.target));
        assert.equal(await provider.getBalance(protocol.target), (firstPrice + secondPrice) / 40n);
    });

    it('separates the same bidder’s refundable and defaulted deposits across two live auctions', async () => {
        const eth = ethers.parseEther;
        const bidder = await deploy('OrdinaryBidderFixture');
        const nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, provider);
        for (const [id, creator, start] of [[1, artist, '0.2'], [2, collector, '0.5']]) {
            await mine(engine.connect(creator).registerArtwork('ipfs://work-' + id));
            await mine(engine.connect(creator).createAuction(id, eth(start), day));
            await mine(bidder.bid(engine.target, id, eth(start), { value: eth(start) / 10n }));
        }
        await mine(engine.connect(buyer).placeBid(1, eth('0.3'), { value: eth('0.03') }));
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(2)).end)]);
        await mine(engine.connect(buyer).settleAuction(1, { value: eth('0.27') }));
        await mine(engine.closeAuction(2));
        assert.equal(await nft.ownerOf(1), buyer.address);
        assert.equal((await engine.works(1)).floor, eth('0.3'));
        assert.equal(await engine.credits(artist.address), eth('0.2925'));
        assert.equal(await engine.credits(protocol.target), eth('0.0075'));

        // The bidder initially refuses ETH. A retry must preserve exactly one fallback credit.
        await mine(engine.processRefunds(1, 1));
        await mine(engine.processRefunds(1, 1));
        assert.equal(await engine.credits(bidder.target), eth('0.02'));
        await mine(bidder.acceptDelivery(true, false));
        await mine(bidder.withdraw(engine.target));
        assert.equal(await provider.getBalance(bidder.target), eth('0.02'));
        await rejects(bidder.withdraw.staticCall(engine.target), 'NoCredit');
        await mine(engine.connect(artist).withdraw());
        await mine(protocol.claim(engine.target));
        assert.equal((await engine.auctions(2)).deposit, eth('0.05'));
        assert.equal(await provider.getBalance(engine.target), eth('0.05'));

        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(2)).deadline + 1n)]);
        await mine(engine.finalizeDefault(2));
        assert.equal(await engine.credits(collector.address), eth('0.04'));
        assert.equal(await engine.credits(protocol.target), eth('0.01'));
        assert.equal(await engine.currentAuctionForWork(2), 0n);
        assert.equal((await engine.works(2)).floor, 0n);
        assert.equal(await nft.totalSupply(), 1n);
        await mine(engine.connect(collector).withdraw());
        await mine(protocol.claim(engine.target));
        assert.equal(await provider.getBalance(engine.target), 0n);
    });

    it('matches largest remainders in role order for all price residues and full-width prices', async () => {
        const quotes = await deploy('TreasuryBindingFixture', protocol.target, ecosystem.target, security.target);
        function expectedShares(amount, weights) {
            const denominator = weights.reduce((sum, weight) => sum + weight, 0n);
            const shares = weights.map(weight => amount * weight / denominator);
            const remaining = amount - shares.reduce((sum, share) => sum + share, 0n);
            const ranking = weights.map((weight, role) => ({ role, remainder: amount * weight % denominator }));
            ranking.sort((a, b) => Number(b.remainder - a.remainder) || a.role - b.role);
            for (const { role } of ranking.slice(0, Number(remaining))) shares[role]++;
            return shares;
        }
        const amounts = Array.from({ length: 200 }, (_, i) => BigInt(i));
        amounts.push(1n << 255n, ethers.MaxUint256 - 199n, ethers.MaxUint256 - 1n, ethers.MaxUint256);
        for (const amount of amounts) {
            const [primary, penalty, resale] = await quotes.payoutQuotes(amount);
            assert.deepEqual([amount - primary, primary], expectedShares(amount, [39n, 1n]), String(amount));
            assert.deepEqual([amount - penalty, penalty], expectedShares(amount, [4n, 1n]), String(amount));
            assert.deepEqual([...resale], expectedShares(amount, [185n, 11n, 2n, 2n]), String(amount));
            assert.equal(resale.reduce((sum, share) => sum + share, 0n), amount);
        }
    });

    it('conserves a pending refund and both creator roles through reacquisition, resale and final withdrawals', async () => {
        const price = ethers.parseEther('0.02');
        const deposit = ethers.parseEther('0.01');
        const nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, provider);
        const marketLayout = layout.contracts[`contracts/replacement/${coreName}.sol:${coreName}`];
        const guardSlot = BigInt(marketLayout.storage.find(field => field.label === '_status').slot);

        // Observe ordinary successful transfers on the local EVM. Every outgoing call
        // made by the market must run inside its lock, and the lock must be released.
        async function checkGuard(receipt) {
            const { structLogs } = await network.provider.send('debug_traceTransaction',
                [receipt.hash, { disableStorage: true, disableMemory: true }]);
            let lock = 1n;
            let calls = 0;
            for (const { depth, op, stack } of structLogs) {
                if (depth !== 1) continue;
                if (op === 'SSTORE' && BigInt('0x' + stack.at(-1)) === guardSlot) lock = BigInt('0x' + stack.at(-2));
                if (op === 'CALL') {
                    assert.equal(lock, 2n);
                    calls++;
                }
            }
            assert.ok(calls > 0);
            assert.equal(lock, 1n);
        }
        async function checkLiabilities(pendingRefund) {
            const credits = await Promise.all([artist.address, buyer.address, collector.address, protocol.target, ecosystem.target]
                .map(address => engine.credits(address)));
            assert.equal(await provider.getBalance(engine.target), credits.reduce((sum, amount) => sum + amount, pendingRefund));
        }

        await mine(engine.connect(artist).registerArtwork('ipfs://reacquired-work'));
        await mine(engine.connect(artist).createAuction(1, deposit, day));
        await mine(engine.connect(collector).placeBid(1, deposit, { value: deposit }));
        await mine(engine.connect(buyer).placeBid(1, price, { value: deposit }));
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(1)).end)]);
        await checkGuard(await mine(engine.connect(buyer).settleAuction(1, { value: price - deposit })));
        await checkLiabilities(deposit);

        const secondPrice = price + 399n;
        await mine(nft.connect(buyer).approve(engine.target, 1));
        await mine(engine.connect(buyer).listResale(1, 0, price));
        await checkGuard(await mine(engine.connect(artist).buyResale(1, 1, { value: price })));
        const priorCreatorCredit = await engine.credits(artist.address);
        await mine(nft.connect(artist).approve(engine.target, 1));
        await mine(engine.connect(artist).listResale(1, 2, secondPrice));
        await checkGuard(await mine(engine.connect(collector).buyResale(1, 3, { value: secondPrice })));
        // The extra 399 wei allocate 369 to the seller, 22 to the creator and 4 to each treasury.
        assert.equal(await engine.credits(artist.address) - priorCreatorCredit, price * 98n / 100n + 391n);
        assert.equal(await nft.ownerOf(1), collector.address);
        assert.equal(await nft.firstCollector(1), buyer.address);
        assert.equal(await nft.tokenCreator(1), artist.address);
        await checkLiabilities(deposit);

        await mine(security.setPause(engine.target, true));
        await checkGuard(await mine(engine.processRefunds(1, 1)));
        await mine(engine.processRefunds(1, 1));
        assert.deepEqual(Array.from(await engine.refundProgress(1)), [1n, 1n]);
        await checkLiabilities(0n);
        for (const account of [artist, buyer]) {
            if (coreName === 'OrdinaryPayoutMarket' && account === artist) {
                const before = await provider.getBalance(deployer.address);
                const credit = await engine.credits(artist.address);
                await checkGuard(await mine(engine.connect(artist).withdrawTo(deployer.address)));
                assert.equal(await provider.getBalance(deployer.address), before + credit);
            } else {
                await checkGuard(await mine(engine.connect(account).withdraw()));
            }
            await rejects(engine.connect(account).withdraw.staticCall(), 'NoCredit');
            await checkLiabilities(0n);
        }
        for (const treasury of [protocol, ecosystem]) await mine(treasury.claim(engine.target));
        assert.equal(await provider.getBalance(engine.target), 0n);
    });

    it('routes indivisible primary, default and resale proceeds to their exact recipients with withdrawals during pause', async () => {
        const primaryPrice = 10020n; // The protocol and creator both have a half-wei remainder.
        const defaultDeposit = ethers.parseEther('0.01') + 3n;
        const resalePrice = 10050n; // One extra wei remains for two equal treasury fractions.
        for (const [id, price] of [[1, primaryPrice], [2, defaultDeposit * 10n]]) {
            const deposit = await engine.requiredDepositForBid(price);
            await mine(engine.connect(artist).registerArtwork('ipfs://work-' + id));
            await mine(engine.connect(artist).createAuction(id, price, day));
            await mine(engine.connect(collector).placeBid(id, price, { value: deposit }));
        }
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(2)).end)]);
        await mine(engine.closeAuction(1));
        await mine(engine.closeAuction(2));
        await mine(engine.connect(collector).settleAuction(1));
        assert.equal(await engine.credits(artist.address), 9770n);
        assert.equal(await engine.credits(protocol.target), 250n);
        assert.equal(await engine.credits(ecosystem.target), 0n);

        const { abi } = await artifacts.readArtifact('SettledArtworkNFT');
        const nft = new ethers.Contract(await engine.nft(), abi, collector);
        await mine(nft.approve(engine.target, 1));
        const returnedSurplus = await engine.credits(collector.address);
        await mine(engine.connect(collector).listResale(1, 0, resalePrice));
        await mine(engine.connect(buyer).buyResale(1, 1, { value: resalePrice }));
        assert.equal(await engine.credits(collector.address) - returnedSurplus, 9296n);
        assert.equal(await engine.credits(artist.address), 9770n + 553n);
        await mine(security.setPause(engine.target, true));
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(2)).deadline + 1n)]);
        await mine(engine.finalizeDefault(2));

        const defaultProtocol = defaultDeposit / 5n + 1n;
        assert.equal(await engine.credits(artist.address), 9770n + 553n + defaultDeposit - defaultProtocol);
        const protocolShare = 250n + 101n + defaultProtocol;
        const ecosystemShare = 100n;
        assert.equal(await engine.credits(protocol.target), protocolShare);
        assert.equal(await engine.credits(ecosystem.target), ecosystemShare);
        assert.equal(await engine.credits(security.target), 0n);
        await rejects(security.claim.staticCall(engine.target), 'NoCredit');
        for (const [account, amount] of [[protocol, protocolShare], [ecosystem, ecosystemShare]]) {
            await mine(account.claim(engine.target));
            assert.equal(await provider.getBalance(account.target), amount);
            assert.equal(await engine.credits(account.target), 0n);
        }
    });
}
