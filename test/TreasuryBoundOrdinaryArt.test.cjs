const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const mine = async tx => (await tx).wait();
const day = 86400n;

describe('Permanent ordinary-artwork treasury and security bindings', function () {
    this.timeout(90000);
    let provider, deployer, artist, collector, buyer, protocol, ecosystem, security, engine;

    async function deploy(name, ...args) {
        const { abi, bytecode } = await artifacts.readArtifact(name);
        return (await new ethers.ContractFactory(abi, bytecode, deployer).deploy(...args)).waitForDeployment();
    }

    const deployMarket = (...roles) => deploy('OrdinaryMarket', ...roles, 2, 30_000);

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
            await rejects(deploy('OrdinaryMarket', ...safes, ...limits), 'InvalidRefundLimits');
        }
        assert.equal(await engine.refundBatchLimit(), 2n);
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
        const next = await deployMarket(protocol.target, ecosystem.target, nextSecurity.target);
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
});
