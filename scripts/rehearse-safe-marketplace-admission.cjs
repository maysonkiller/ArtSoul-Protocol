// Run with a local copy of the published @safe-global/safe-contracts 1.4.1 tarball.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');

process.env.HARDHAT_CONFIG = path.join(__dirname, '../hardhat.local.config.cjs');
process.env.HARDHAT_NETWORK = 'hardhat';
const { artifacts, config } = require('hardhat');
const { createProvider } = require('hardhat/internal/core/providers/construction');

const archiveHash = 'fP1jewywSwsIniM04NsqPyVRFKPMAuirC3ftA/TA4X3Zc5EnwQp/UCJUU2PL/37/z/jMo8UUaJ+pnFNWmMU7dQ==';
const zero = ethers.ZeroAddress;
const mine = async tx => (await tx).wait();

async function main() {
    assert.ok(process.argv[2], 'Supply the path to safe-contracts-1.4.1.tgz');
    const archive = readFileSync(process.argv[2]);
    assert.equal(createHash('sha512').update(archive).digest('base64'), archiveHash, 'Safe package integrity');
    function safeArtifact(contractPath) {
        const name = path.posix.basename(contractPath);
        const member = `package/build/artifacts/contracts/${contractPath}.sol/${name}.json`;
        return JSON.parse(execFileSync('tar', ['-xzOf', '-', member], { input: archive }));
    }

    const chain = { ...config.networks.hardhat, chainId: 84532, forking: undefined };
    const evm = await createProvider({ ...config, networks: { hardhat: chain } }, 'hardhat', artifacts);
    const provider = new ethers.BrowserProvider(evm, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 10;
    assert.equal((await provider.getNetwork()).chainId, 84532n);
    const [relayer, ...accounts] = await provider.listAccounts();
    const owners = accounts.slice(0, 3);
    const addresses = owners.map(owner => owner.address);
    async function deploy({ abi, bytecode }, ...args) {
        return (await new ethers.ContractFactory(abi, bytecode, relayer).deploy(...args)).waitForDeployment();
    }
    const singleton = await deploy(safeArtifact('SafeL2'));
    const factory = await deploy(safeArtifact('proxies/SafeProxyFactory'));
    const handler = await deploy(safeArtifact('handler/CompatibilityFallbackHandler'));
    const init = singleton.interface.encodeFunctionData('setup', [addresses, 2, zero, '0x', handler.target, zero, 0, zero]);
    const safes = [];
    for (const salt of [1, 2, 3]) {
        const receipt = await mine(factory.createProxyWithNonce(singleton.target, init, salt));
        const creation = receipt.logs.find(log => log.fragment?.name === 'ProxyCreation');
        const safe = singleton.attach(creation.args.proxy);
        assert.equal(await safe.VERSION(), '1.4.1');
        assert.equal(await safe.getThreshold(), 2n);
        assert.deepEqual([...(await safe.getOwners())], addresses);
        safes.push(safe);
    }
    const security = safes[2];
    const coreArtifact = await artifacts.readArtifact('OrdinaryMarket');
    const factoryCore = new ethers.ContractFactory(coreArtifact.abi, coreArtifact.bytecode);
    const nonce = await provider.getTransactionCount(relayer.address);
    const expectedCore = ethers.getCreateAddress({ from: relayer.address, nonce });
    const expectedNFT = ethers.getCreateAddress({ from: expectedCore, nonce: 1 });
    const roleNames = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
    const custody = { chainId: 84532 };
    for (const [i, role] of roleNames.entries()) {
        custody[role] = { address: safes[i].target, owners: addresses, threshold: 2 };
    }
    // The independent encoder and the local signer use rehearsal-only refund limits.
    const limits = [2, 30_000];
    const creation = await factoryCore.getDeployTransaction(...safes.map(safe => safe.target), ...limits);
    const { prepareOrdinaryDeployment } = await import('./prepare-ordinary-deployment.mjs');
    const plan = prepareOrdinaryDeployment(coreArtifact, {
        chainId: 84532, payer: relayer.address, nonce, expectedCore, expectedNFT,
        contract: coreArtifact.sourceName + ':' + coreArtifact.contractName,
        constructorArgs: [...roleNames.map(role => '$' + role), ...limits],
        initCodeHash: ethers.keccak256(creation.data)
    }, custody);
    const deployment = await mine(relayer.sendTransaction(plan.transaction));
    assert.equal(deployment.contractAddress, plan.core);
    const engine = new ethers.Contract(plan.core, coreArtifact.abi, relayer);
    assert.equal(await engine.nft(), plan.nft);
    assert.equal(await engine.refundBatchLimit(), BigInt(limits[0]));
    assert.equal(await engine.refundTransferGas(), BigInt(limits[1]));
    assert.deepEqual(await Promise.all(roleNames.map(role => engine[role]())), safes.map(safe => safe.target));
    console.log('PASS: unsigned OrdinaryMarket creation produced the reviewed pair and three Safe bindings on an isolated EVM.');
    const market = await deploy(await artifacts.readArtifact('SettledArtworkSourceFixture'));
    const [artist, collector, buyer] = accounts.slice(3);
    const nft = new ethers.Contract(await engine.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, collector);
    assert.equal(await nft.core(), engine.target);
    const bid = ethers.parseEther('0.01');
    await mine(engine.connect(artist).registerArtwork('ipfs://local-safe-rehearsal'));
    await mine(engine.connect(artist).createAuction(1, bid, 86400));
    await mine(engine.connect(collector).placeBid(1, bid, { value: await engine.requiredDepositForBid(bid) }));
    assert.equal(await nft.totalSupply(), 0n);
    await evm.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(1)).end)]);
    await mine(engine.connect(collector).settleAuction(1));
    const tokenId = await nft.auctionToToken(1);
    assert.equal(await nft.ownerOf(tokenId), collector.address);

    const transfer = [nft.target, collector.address, buyer.address, tokenId];
    async function requireFreshConsent() {
        assert.equal(await nft.getApproved(tokenId), zero);
        assert.equal(await nft.isApprovedForAll(collector.address, market.target), false);
        await assert.rejects(market.transferApproved.staticCall(...transfer), error =>
            error.data === nft.interface.encodeErrorResult('ERC721InsufficientApproval', [market.target, tokenId]));
    }

    async function signedTransfer(safe, target, amount, calldata, signers) {
        const args = [target, amount, calldata, 0, 0n, 0n, 0n, zero, zero];
        const digest = await safe.getTransactionHash(...args, await safe.nonce());
        const signatures = [];
        for (const owner of [...signers].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))) {
            const sig = ethers.Signature.from(await owner.signMessage(ethers.getBytes(digest)));
            // Safe tags personal_sign signatures by adding four to the recovery byte.
            signatures.push(ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v + 4, 1)]));
        }
        return [...args, ethers.concat(signatures)];
    }

    function signedCall(method, signers) {
        return signedTransfer(security, engine.target, 0n, engine.interface.encodeFunctionData(method, [market.target]), signers);
    }

    async function execute(method, signers) {
        const args = await signedCall(method, signers);
        return mine(security.execTransaction(...args));
    }

    const schedule = 'scheduleMarketplaceAdmission';
    const soleSignature = await signedCall(schedule, [owners[0]]);
    await assert.rejects(security.execTransaction.staticCall(...soleSignature), /GS020/);
    assert.equal(await security.nonce(), 0n);
    assert.equal(await engine.marketplaceAdmissionReadyAt(market.target), 0n);

    const firstPair = owners.slice(0, 2);
    await execute(schedule, firstPair);
    assert.ok(await engine.marketplaceAdmissionReadyAt(market.target) > 0n);
    await execute('cancelMarketplaceAdmission', [owners[0], owners[2]]);
    assert.equal(await engine.marketplaceAdmissionReadyAt(market.target), 0n);
    const scheduled = await execute(schedule, firstPair);
    const readyAt = (await scheduled.getBlock()).timestamp + 48 * 3600;
    assert.equal(await engine.marketplaceAdmissionReadyAt(market.target), BigInt(readyAt));
    await evm.send('evm_setNextBlockTimestamp', [readyAt - 1]);
    await evm.send('evm_mine');
    await assert.rejects(engine.executeMarketplaceAdmission.staticCall(market.target), error =>
        error.data === engine.interface.getError('InvalidMarketplaceChange').selector);
    assert.equal(await engine.isMarketplaceAllowed(market.target), false);
    await assert.rejects(nft.approve.staticCall(market.target, tokenId), error =>
        error.data === nft.interface.encodeErrorResult('MarketplaceNotAllowed', [market.target]));
    await assert.rejects(nft.setApprovalForAll.staticCall(market.target, true), error =>
        error.data === nft.interface.encodeErrorResult('MarketplaceNotAllowed', [market.target]));

    await evm.send('evm_setNextBlockTimestamp', [readyAt]);
    const activated = await mine(engine.executeMarketplaceAdmission(market.target, { gasLimit: 500000 }));
    assert.equal((await activated.getBlock()).timestamp, readyAt);
    assert.equal(await engine.marketplaceApprovalGeneration(market.target), 1n);
    await requireFreshConsent();
    await mine(nft.approve(market.target, tokenId));
    assert.equal(await nft.getApproved(tokenId), market.target);
    await mine(nft.setApprovalForAll(market.target, true));
    assert.equal(await nft.isApprovedForAll(collector.address, market.target), true);
    await market.transferApproved.staticCall(...transfer);
    await execute('disableMarketplace', owners.slice(1));
    assert.equal(await engine.isMarketplaceAllowed(market.target), false);
    await requireFreshConsent();

    await execute(schedule, firstPair);
    const readmission = await engine.marketplaceAdmissionReadyAt(market.target);
    await evm.send('evm_setNextBlockTimestamp', [Number(readmission)]);
    await mine(engine.executeMarketplaceAdmission(market.target, { gasLimit: 500000 }));
    assert.equal(await engine.marketplaceApprovalGeneration(market.target), 2n);
    await requireFreshConsent();
    await mine(nft.approve(market.target, tokenId));
    await mine(market.transferApproved(...transfer));
    assert.equal(await nft.ownerOf(tokenId), buyer.address);
    assert.equal(await security.nonce(), 5n);
    assert.equal(await provider.getBalance(security.target), 0n);
    console.log('PASS: Safe 1.4.1, three owner pairs, 48-hour admission, immediate disablement and fresh NFT owner consent.');

    const [protocol, ecosystem] = safes;
    const resalePrice = ethers.parseEther('1');
    await mine(nft.connect(buyer).approve(engine.target, tokenId));
    await mine(engine.connect(buyer).listResale(tokenId, 0, resalePrice));
    await mine(engine.connect(collector).buyResale(tokenId, 1, { value: resalePrice }));
    const poolShare = resalePrice / 100n;
    const protocolShare = bid * 25n / 1000n + resalePrice / 100n;
    assert.equal(await engine.credits(protocol.target), protocolShare);
    assert.equal(await engine.credits(ecosystem.target), poolShare);
    const withdraw = engine.interface.encodeFunctionData('withdraw');
    const oneSigner = await signedTransfer(ecosystem, engine.target, 0n, withdraw, [owners[0]]);
    await assert.rejects(ecosystem.execTransaction.staticCall(...oneSigner), /GS020/);
    const claim = await signedTransfer(ecosystem, engine.target, 0n, withdraw, firstPair);
    await mine(ecosystem.execTransaction(...claim));
    assert.equal(await engine.credits(ecosystem.target), 0n);
    assert.equal(await provider.getBalance(ecosystem.target), poolShare);
    const recipient = accounts[6].address;
    const beforeGrant = await provider.getBalance(recipient);
    const grant = await signedTransfer(ecosystem, recipient, poolShare, '0x', owners.slice(1));
    await mine(ecosystem.execTransaction(...grant));
    assert.equal(await provider.getBalance(recipient), beforeGrant + poolShare);
    assert.equal(await provider.getBalance(ecosystem.target), 0n);
    assert.equal(await ecosystem.nonce(), 2n);
    assert.equal(await engine.credits(protocol.target), protocolShare);
    assert.equal(await provider.getBalance(protocol.target), 0n);
    console.log('PASS: two Safe owners claimed the exact 1% resale share and a second pair authorized a local grant.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
