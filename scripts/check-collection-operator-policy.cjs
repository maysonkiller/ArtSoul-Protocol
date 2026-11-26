// Rehearse only the local collection candidates and their disposable holders.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ethers } = require('ethers');

const policyABI = new ethers.Interface(['error MarketplaceNotAllowed(address operator)']);

async function approvalOutcome(call, operator) {
    try {
        await call();
        return 'permitted';
    } catch (error) {
        const expected = policyABI.encodeErrorResult('MarketplaceNotAllowed', [operator]);
        if (ethers.isError(error, 'CALL_EXCEPTION') && error.data?.toLowerCase() === expected.toLowerCase()) {
            return 'denied-by-policy';
        }
        throw error;
    }
}

async function rehearseCollectionOperators({ network, artifacts }) {
    assert.equal(network.name, 'hardhat');
    assert.equal(network.config.forking?.enabled ?? false, false);
    const provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
    assert.equal((await provider.getNetwork()).chainId, 31337n);
    const mine = async operation => (await operation).wait();
    const [creator, treasury, holder, other] = await provider.listAccounts();
    async function deploy(name, ...args) {
        const { abi, bytecode } = await artifacts.readArtifact(name);
        return (await new ethers.ContractFactory(abi, bytecode, creator).deploy(...args)).waitForDeployment();
    }
    const protocolSafe = await deploy('TreasuryAccountStub', 2);
    const ecosystemSafe = await deploy('TreasuryAccountStub', 2);
    const securitySafe = await deploy('TreasuryAccountStub', 2);
    const registry = await deploy('OrdinaryPayoutMarket', protocolSafe.target, ecosystemSafe.target, securitySafe.target, 8, 30_000);
    const marketplace = await deploy('SettledArtworkSourceFixture');
    const editions = await deploy('CollectionLaunch', 'Editions', 'EDS', 'ipfs://fixture/', 3,
        creator.address, treasury.address, creator.address, 550, registry.target);
    const first = await deploy('PartnerFirstWorkLaunch', 'First work', 'FST', 'ipfs://fixture/', 2, creator.address, treasury.address, registry.target);
    const forge = await deploy('CollectionForge', 'Forged', 'FRG', 'ipfs://fixture/', editions.target,
        2, 1, ethers.id('local recipe'), creator.address, creator.address, 550);
    const start = (await provider.getBlock('latest')).timestamp + 100;
    const phase = { kind: 0, start, end: start + 100, allocation: 1, walletLimit: 1, price: 0,
        merkleRoot: ethers.ZeroHash, enabled: true, rollover: false, priceSource: 0, fallbackEnabled: false, fallbackPrice: 0 };
    await mine(editions.setForge(forge.target));
    await mine(editions.addPhase({ ...phase, allocation: 3, walletLimit: 3 }));
    await mine(editions.lockConfiguration());
    await mine(first.addPhase({ ...phase, kind: 3, price: 1 }));
    await mine(first.addPhase({ ...phase, start: phase.end, end: phase.end + 100, priceSource: 1 }));
    await mine(first.lockConfiguration());
    await network.provider.send('evm_setNextBlockTimestamp', [start]);
    await mine(editions.connect(holder).mintPhase(0, 3, 0, [], holder.address));
    await mine(first.connect(holder).bid(0, { value: 1 }));
    await network.provider.send('evm_setNextBlockTimestamp', [phase.end]);
    await mine(first.finalizeAuction(0));
    await mine(first.connect(holder).claimAuction(0, holder.address));

    const craft = forge.connect(holder);
    const missingConsent = error => ethers.isError(error, 'CALL_EXCEPTION') &&
        error.data === editions.interface.getError('UnauthorizedForge').selector;
    await assert.rejects(craft.craft.staticCall([1, 2], holder.address), missingConsent);
    await mine(editions.connect(holder).setForgeBurnApproval([1], true));
    await assert.rejects(craft.craft.staticCall([1, 2], holder.address), missingConsent);
    await mine(editions.connect(holder).setForgeBurnApproval([2], true));
    assert.equal(await editions.isApprovedForAll(holder.address, forge.target), false);
    await mine(craft.craft([1, 2], holder.address));
    assert.equal(await editions.totalBurned(), 2n);
    assert.equal(await forge.ownerOf(1), holder.address);

    const candidates = [];
    async function admit() {
        const scheduled = await mine(securitySafe.scheduleMarket(registry.target, marketplace.target));
        const readyAt = await registry.marketplaceAdmissionReadyAt(marketplace.target);
        assert.equal(readyAt - BigInt((await provider.getBlock(scheduled.blockNumber)).timestamp), 48n * 3600n);
        await network.provider.send('evm_setNextBlockTimestamp', [Number(readyAt)]);
        await mine(registry.executeMarketplaceAdmission(marketplace.target, { gasLimit: 500_000 }));
    }
    for (const [name, nft, token, unlistedContract] of [
        ['CollectionLaunch', editions, 3, first.target],
        ['PartnerFirstWorkLaunch', first, 1, editions.target],
        ['CollectionForge', forge, 1, first.target]
    ]) {
        const signed = nft.connect(holder);
        assert.equal(await nft.marketplaceRegistry(), registry.target);
        assert.equal(await nft.ownerOf(token), holder.address);
        assert.equal(await nft.getApproved(token), ethers.ZeroAddress);
        assert.equal(await approvalOutcome(() => signed.approve.staticCall(registry.target, token), registry.target), 'denied-by-policy');
        const probes = [];
        for (const [kind, operator] of [['wallet', other.address], ['contract', unlistedContract]]) {
            assert.equal(await nft.isApprovedForAll(holder.address, operator), false);
            const tokenGrant = await approvalOutcome(() => signed.approve.staticCall(operator, token), operator);
            const portfolioGrant = await approvalOutcome(() => signed.setApprovalForAll.staticCall(operator, true), operator);
            probes.push({ kind, tokenGrant, portfolioGrant });
        }
        await admit();
        assert.equal(await signed.getApproved(token), ethers.ZeroAddress);
        assert.equal(await signed.isApprovedForAll(holder.address, marketplace.target), false);
        await mine(signed.approve(marketplace.target, token));
        await mine(signed.setApprovalForAll(marketplace.target, true));
        assert.equal(await signed.getApproved(token), marketplace.target);
        assert.equal(await signed.isApprovedForAll(holder.address, marketplace.target), true);
        await mine(securitySafe.disableMarket(registry.target, marketplace.target));
        assert.equal(await signed.getApproved(token), ethers.ZeroAddress);
        assert.equal(await signed.isApprovedForAll(holder.address, marketplace.target), false);
        await admit();
        assert.equal(await signed.getApproved(token), ethers.ZeroAddress);
        assert.equal(await signed.isApprovedForAll(holder.address, marketplace.target), false);
        await mine(signed.approve(marketplace.target, token));
        await mine(marketplace.transferApproved(nft.target, holder.address, other.address, token));
        await mine(nft.connect(other).transferFrom(other.address, holder.address, token));
        await mine(securitySafe.disableMarket(registry.target, marketplace.target));
        await mine(signed.transferFrom(holder.address, other.address, token));
        assert.equal(await nft.ownerOf(token), other.address);
        candidates.push({ name, runtimeHash: ethers.keccak256(await provider.getCode(nft.target)), probes,
            directTransfer: true, freshApprovalAfterReadmission: true });
    }
    return { chainId: 31337, forgeWithIndividualConsent: true, candidates };
}

function requireRestrictedOperators(report) {
    assert.equal(report.chainId, 31337);
    assert.equal(report.forgeWithIndividualConsent, true);
    assert.deepEqual(report.candidates.map(row => row.name), ['CollectionLaunch', 'PartnerFirstWorkLaunch', 'CollectionForge']);
    for (const row of report.candidates) {
        assert.equal(row.directTransfer, true);
        assert.equal(row.freshApprovalAfterReadmission, true);
        assert.deepEqual(row.probes.map(probe => probe.kind), ['wallet', 'contract']);
    }
    const blocked = report.candidates.filter(candidate => candidate.probes.some(probe =>
        probe.tokenGrant !== 'denied-by-policy' || probe.portfolioGrant !== 'denied-by-policy'));
    if (blocked.length) throw new Error('Unlisted operator approval permitted by ' + blocked.map(item => item.name).join(', '));
}

if (require.main === module) {
    process.env.HARDHAT_CONFIG = path.resolve(__dirname, '../hardhat.local.config.cjs');
    process.env.HARDHAT_NETWORK = 'hardhat';
    const hre = require('hardhat');
    (async () => {
        await hre.run('compile', { quiet: true });
        const report = await rehearseCollectionOperators(hre);
        console.log(JSON.stringify(report, null, 2));
        requireRestrictedOperators(report);
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { rehearseCollectionOperators, requireRestrictedOperators };
