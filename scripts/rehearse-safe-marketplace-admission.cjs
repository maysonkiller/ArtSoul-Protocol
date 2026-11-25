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

    async function createRehearsalNetwork(chainId, safeCount) {
        const chain = { ...config.networks.hardhat, chainId, forking: undefined };
        const evm = await createProvider({ ...config, networks: { hardhat: chain } }, 'hardhat', artifacts);
        const provider = new ethers.BrowserProvider(evm, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        assert.equal((await provider.getNetwork()).chainId, BigInt(chainId));
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
        for (let salt = 1; salt <= safeCount; salt++) {
            const receipt = await mine(factory.createProxyWithNonce(singleton.target, init, salt));
            const creation = receipt.logs.find(log => log.fragment?.name === 'ProxyCreation');
            const safe = singleton.attach(creation.args.proxy);
            assert.equal(await safe.VERSION(), '1.4.1');
            assert.equal(await safe.getThreshold(), 2n);
            assert.deepEqual([...(await safe.getOwners())], addresses);
            safes.push(safe);
        }
        return { provider, evm, relayer, accounts, owners, addresses, deploy, safes };
    }

    const { provider, evm, relayer, accounts, owners, addresses, deploy, safes: allSafes } = await createRehearsalNetwork(84532, 9);
    const [security, ...bidderSafes] = allSafes;
    // Exercise the exact treasury handoff calldata on an isolated EVM at the published Safe addresses.
    const { buildRehearsalRequests, rehearsalSafeRelease } = await import('./prepare-rehearsal-safes.mjs');
    const components = [
        ['proxies/SafeProxyFactory', 'factory', 'factoryCodeHash'],
        ['SafeL2', 'singleton', 'singletonCodeHash'],
        ['handler/CompatibilityFallbackHandler', 'fallbackHandler', 'fallbackCodeHash']
    ];
    for (const [contractPath, address, digest] of components) {
        const { deployedBytecode } = safeArtifact(contractPath);
        assert.equal(ethers.keccak256(deployedBytecode), rehearsalSafeRelease[digest]);
        await evm.send('hardhat_setCode', [rehearsalSafeRelease[address], deployedBytecode]);
    }
    const treasuryPlan = buildRehearsalRequests({
        adminSafe: security.target, payer: relayer.address, owners: addresses,
        proxyCreationCode: safeArtifact('proxies/SafeProxy').bytecode
    });
    const rehearsalTreasuries = {};
    for (const request of treasuryPlan.roleRequests) {
        const receipt = await mine(relayer.sendTransaction(request.transaction));
        const factoryAbi = new ethers.Interface(safeArtifact('proxies/SafeProxyFactory').abi);
        const created = receipt.logs.filter(log => log.address === rehearsalSafeRelease.factory)
            .map(log => factoryAbi.parseLog(log)).find(log => log?.name === 'ProxyCreation');
        assert.equal(created.args.proxy, request.safe);
        const account = security.attach(request.safe);
        assert.equal(await account.getThreshold(), 2n);
        assert.deepEqual([...(await account.getOwners())], [...addresses].sort());
        assert.equal(ethers.keccak256(await provider.getCode(request.safe)), rehearsalSafeRelease.proxyCodeHash);
        rehearsalTreasuries[request.role] = account;
    }
    const safes = [rehearsalTreasuries.protocolTreasury, rehearsalTreasuries.ecosystemTreasury, security];
    console.log('PASS: both unsigned treasury requests created the predicted distinct Safe addresses with the selected three test owners.');
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
    const limits = [8, 30_000];
    const creation = await factoryCore.getDeployTransaction(...safes.map(safe => safe.target), ...limits);
    const { prepareOrdinaryDeployment } = await import('./prepare-ordinary-deployment.mjs');
    const review = {
        chainId: 84532, payer: relayer.address, nonce, expectedCore, expectedNFT,
        contract: coreArtifact.sourceName + ':' + coreArtifact.contractName,
        constructorArgs: [...roleNames.map(role => '$' + role), ...limits],
        initCodeHash: ethers.keccak256(creation.data)
    };
    const plan = prepareOrdinaryDeployment(coreArtifact, review, custody);
    const deployment = await mine(relayer.sendTransaction(plan.transaction));
    assert.equal(deployment.contractAddress, plan.core);
    const engine = new ethers.Contract(plan.core, coreArtifact.abi, relayer);
    assert.equal(await engine.nft(), plan.nft);
    assert.equal(await engine.refundBatchLimit(), BigInt(limits[0]));
    assert.equal(await engine.refundTransferGas(), BigInt(limits[1]));
    assert.deepEqual(await Promise.all(roleNames.map(role => engine[role]())), safes.map(safe => safe.target));
    const { expectedRehearsalPairRegister } = await import('./prepare-rehearsal-core.mjs');
    const nftArtifact = await artifacts.readArtifact('SettledArtworkNFT');
    const runtimeRegister = expectedRehearsalPairRegister(custody, review,
        require('../docs/security/C12_ORDINARY_AUDIT_MANIFEST.json'),
        require('../docs/architecture/C1_ORDINARY_PAIR_STORAGE_2026-11-20.json'), coreArtifact, nftArtifact);
    assert.equal(ethers.keccak256(await provider.getCode(plan.core)), runtimeRegister.core.codeHash);
    assert.equal(ethers.keccak256(await provider.getCode(plan.nft)), runtimeRegister.nft.codeHash);
    console.log('PASS: unsigned OrdinaryMarket creation produced the reviewed pair and three Safe bindings on an isolated EVM.');
    const market = await deploy(await artifacts.readArtifact('SettledArtworkSourceFixture'));
    const [artist, collector, buyer] = accounts.slice(3);
    const nft = new ethers.Contract(await engine.nft(), nftArtifact.abi, collector);
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

    await mine(engine.connect(artist).registerArtwork('ipfs://local-safe-bidder-refunds'));
    await mine(engine.connect(artist).createAuction(await engine.workCount(), ethers.parseEther('0.11'), 86400));
    const auctionId = await engine.auctionCount();
    const deposits = [];
    for (const safe of bidderSafes) {
        const price = await engine.minimumBid(auctionId);
        const deposit = await engine.requiredDepositForBid(price);
        await mine(relayer.sendTransaction({ to: safe.target, value: deposit }));
        const call = engine.interface.encodeFunctionData('placeBid', [auctionId, price]);
        await mine(safe.execTransaction(...await signedTransfer(safe, engine.target, deposit, call, firstPair)));
        assert.equal(await provider.getBalance(safe.target), 0n);
        deposits.push(deposit);
    }
    const finalBid = await engine.minimumBid(auctionId);
    await mine(engine.connect(buyer).placeBid(auctionId, finalBid, { value: await engine.requiredDepositForBid(finalBid) }));
    await evm.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(auctionId)).end)]);
    await mine(engine.closeAuction(auctionId));
    for (const count of [1, 4, 8]) {
        const snapshot = await evm.send('evm_snapshot');
        const receipt = await mine(engine.processRefunds(auctionId, count));
        const refunds = receipt.logs.filter(log => log.fragment?.name === 'OutbidRefundProcessed');
        assert.equal(refunds.length, count);
        assert.deepEqual(Array.from(await engine.refundProgress(auctionId)), [BigInt(count), BigInt(bidderSafes.length)]);
        for (const [i, safe] of bidderSafes.entries()) {
            const paid = i < count;
            if (paid) assert.deepEqual(Array.from(refunds[i].args), [auctionId, BigInt(i), safe.target, deposits[i], true]);
            assert.equal(await provider.getBalance(safe.target), paid ? deposits[i] : 0n);
            assert.equal(await engine.credits(safe.target), 0n);
        }
        if (count === bidderSafes.length) {
            const replay = await mine(engine.processRefunds(auctionId, count));
            assert.equal(replay.logs.some(log => log.fragment?.name === 'OutbidRefundProcessed'), false);
            assert.deepEqual(await Promise.all(bidderSafes.map(safe => provider.getBalance(safe.target))), deposits);
        }
        console.log('PASS: ' + count + ' Safe bidder refunds used ' + receipt.gasUsed + ' local execution gas.');
        assert.equal(await evm.send('evm_revert', [snapshot]), true);
    }

    const pilot = await createRehearsalNetwork(8453, 1);
    const grantSafe = pilot.safes[0];
    const founder = pilot.accounts[4].address;
    const genesis = await pilot.deploy(await artifacts.readArtifact('ArtSoulGenesis'), grantSafe.target, founder,
        'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3pteozf5b6tk3twtpjfeqmczy/');
    const { prepareGenesisGrants } = await import('./prepare-genesis-grants.mjs');
    const prepared = prepareGenesisGrants({
        chainId: 8453, safe: grantSafe.target, genesis: genesis.target, founder, policyHash: ethers.id('local-policy'),
        grants: [{ category: 'Founder', tokenId: 0, recipient: founder, activityChainId: 0, evidenceHash: ethers.id('local-decision') }]
    });
    const { data } = prepared.transaction;
    const oneApproval = await signedTransfer(grantSafe, genesis.target, 0n, data, [pilot.owners[0]]);
    await assert.rejects(grantSafe.execTransaction.staticCall(...oneApproval), /GS020/);
    assert.equal(await genesis.totalSupply(), 0n);
    const authorized = await signedTransfer(grantSafe, genesis.target, 0n, data, [pilot.owners[0], pilot.owners[2]]);
    await mine(grantSafe.execTransaction(...authorized));
    assert.equal(await genesis.ownerOf(0), founder);
    assert.equal(await genesis.locked(0), true);
    assert.equal((await genesis.grantRecord(0)).decisionHash, prepared.grants[0].decisionHash);
    assert.equal(await grantSafe.nonce(), 1n);
    console.log('PASS: a separate disposable Base simulation rejected one signature and recorded the exact Genesis decision with two.');

}

main().catch(error => { console.error(error); process.exitCode = 1; });
