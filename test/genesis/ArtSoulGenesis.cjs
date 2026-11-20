const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

describe('Dedicated Genesis grants on a disposable chain', function () {
    this.timeout(60000);
    let provider, sender, founder, artist, security, issuer, factory, genesis;
    const prefix = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3pteozf5b6tk3twtpjfeqmczy/';
    const mine = async tx => (await tx).wait();
    const grant = (id, category, recipient, chain = 0, reference = 'grant-' + id) =>
        [id, category, recipient, chain, ethers.id(reference)];

    function rejects(operation, errorName) {
        const selector = factory.interface.getError(errorName).selector;
        return assert.rejects(operation, error => error.data?.slice(0, 10) === selector);
    }

    beforeEach(async () => {
        assert.equal(network.name, 'hardhat');
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [sender, founder, artist] = await provider.listAccounts();
        const fixture = await artifacts.readArtifact('TreasuryAccountStub');
        security = await new ethers.ContractFactory(fixture.abi, fixture.bytecode, sender).deploy(2);
        await security.waitForDeployment();
        const artifact = await artifacts.readArtifact('ArtSoulGenesis');
        factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, sender);
        if ((await provider.getNetwork()).chainId === 8453n) {
            genesis = await (await factory.deploy(security.target, founder.address, prefix)).waitForDeployment();
            // Exercise contract-level caller checks independently of the Safe signature tests.
            await network.provider.send('hardhat_setBalance', [security.target, '0xde0b6b3a7640000']);
            await network.provider.send('hardhat_impersonateAccount', [security.target]);
            issuer = genesis.connect(new ethers.JsonRpcSigner(provider, security.target));
        }
    });

    it('rejects deployment outside Base and requires a multisig and immutable IPFS prefix on Base', async () => {
        if ((await provider.getNetwork()).chainId !== 8453n) {
            await rejects(factory.deploy(security.target, founder.address, prefix), 'BaseMainnetOnly');
            return;
        }
        assert.equal(await genesis.totalSupply(), 0n);
        await rejects(factory.deploy(sender.address, founder.address, prefix), 'InvalidAuthority');
        await rejects(factory.deploy(security.target, ethers.ZeroAddress, prefix), 'InvalidGrant');
        for (const invalid of ['https://example.com/', 'ipfs:///', 'ipfs://x/', prefix.slice(0, -1),
            prefix + 'nested/', prefix.replace('bafybei', 'bafkrei'), prefix.replace('bafybei', 'BAFYBEI'),
            prefix.slice(0, 14) + 'i' + prefix.slice(15), prefix.slice(0, 25) + '0' + prefix.slice(26),
            prefix.slice(0, 65) + 'z/', prefix + '?gateway=1']) {
            await rejects(factory.deploy(security.target, founder.address, invalid), 'InvalidMetadataPrefix');
        }
    });

    it('records published decisions and issues permanent ERC-5192 art only in its assigned category', async function () {
        if ((await provider.getNetwork()).chainId !== 8453n) this.skip();
        const team = grant(200, 1, artist.address);
        const receipt = await mine(issuer.grantBatch([grant(0, 0, founder.address), team,
            grant(201, 2, artist.address, 8453), grant(9999, 3, artist.address)]));
        assert.equal(await genesis.totalSupply(), 4n);
        assert.equal(await genesis.ownerOf(0), founder.address);
        assert.equal(await genesis.ownerOf(9999), artist.address);
        assert.equal(await genesis.tokenURI(200), prefix + '200');
        assert.deepEqual(Array.from(await genesis.grantRecord(200)), [1n, team[4]]);
        assert.equal(await genesis.supportsInterface('0xb45a3c0e'), true);
        assert.equal(await genesis.locked(200), true);
        await rejects(genesis.locked(8888), 'ERC721NonexistentToken');
        for (const event of ['Locked', 'GenesisGranted', 'Transfer']) {
            assert.equal(receipt.logs.filter(log => log.fragment?.name === event).length, 4);
        }
        const owner = genesis.connect(artist);
        await rejects(owner.approve(founder.address, 200), 'Soulbound');
        await rejects(owner.setApprovalForAll(founder.address, true), 'Soulbound');
        await rejects(owner.transferFrom(artist.address, founder.address, 200), 'Soulbound');
        await rejects(owner['safeTransferFrom(address,address,uint256)'](artist.address, founder.address, 200), 'Soulbound');
        assert.equal(await genesis.ownerOf(200), artist.address);
    });

    it('rejects invalid and repeated decisions atomically, preserves reserves and checks current quorum', async function () {
        if ((await provider.getNetwork()).chainId !== 8453n) this.skip();
        const first = grant(201, 3, artist.address);
        await rejects(genesis.grantBatch([first]), 'InvalidAuthority');
        await rejects(issuer.grantBatch([]), 'InvalidBatchSize');
        await rejects(issuer.grantBatch(Array(33).fill(first)), 'InvalidBatchSize');
        for (const invalid of [
            grant(0, 0, artist.address), grant(0, 3, founder.address), grant(1, 3, artist.address),
            grant(200, 2, artist.address, 8453), grant(202, 1, artist.address), grant(10000, 3, artist.address),
            grant(202, 2, artist.address, 84532), grant(202, 3, artist.address, 8453),
            grant(202, 3, ethers.ZeroAddress), [202, 3, artist.address, 0, ethers.ZeroHash],
            grant(202, 3, artist.address, 0, 'grant-201'), grant(201, 3, founder.address, 0, 'other-decision')
        ]) {
            await rejects(issuer.grantBatch([first, invalid]), 'InvalidGrant');
        }
        assert.equal(await genesis.usedDecision(first[4]), false);
        assert.equal(await genesis.totalSupply(), 0n);
        await mine(issuer.grantBatch([first]));
        await rejects(issuer.grantBatch([first]), 'InvalidGrant');
        await mine(security.setThreshold(1));
        await rejects(issuer.grantBatch([grant(202, 3, artist.address)]), 'InvalidAuthority');
        assert.equal(await genesis.totalSupply(), 1n);
    });

    it('executes exactly the reviewed grant calldata and preserves the policy and evidence binding', async function () {
        if ((await provider.getNetwork()).chainId !== 8453n) this.skip();
        const { prepareGenesisGrants } = await import('../../scripts/prepare-genesis-grants.mjs');
        const entry = { tokenId: 234, category: 'MainnetActivity', recipient: artist.address,
            activityChainId: 8453, evidenceHash: ethers.id('reviewed local evidence') };
        const review = { chainId: 8453, safe: security.target, genesis: genesis.target, founder: founder.address,
            policyHash: ethers.id('published local policy'), grants: [entry] };
        const result = prepareGenesisGrants(review);
        assert.equal(result.transaction.to, genesis.target);
        assert.equal(result.transaction.value, '0');
        assert.equal(result.transaction.operation, 0);
        const { decisionHash } = result.grants[0];
        for (const override of [{ safe: sender.address }, { genesis: sender.address }, { policyHash: ethers.id('other') },
            { grants: [{ ...entry, recipient: founder.address }] }]) {
            assert.notEqual(prepareGenesisGrants({ ...review, ...override }).grants[0].decisionHash, decisionHash);
        }
        assert.throws(() => prepareGenesisGrants({ ...review, grants: [entry, entry] }), /duplicate/);
        assert.throws(() => prepareGenesisGrants({ ...review, grants: [{ ...entry, activityChainId: 84532 }] }), /category/);
        await mine(issuer.runner.sendTransaction({ to: result.transaction.to, value: 0, data: result.transaction.data }));
        assert.equal((await genesis.grantRecord(entry.tokenId)).decisionHash, decisionHash);
        assert.equal(await genesis.ownerOf(entry.tokenId), artist.address);
    });
});
