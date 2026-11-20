const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

describe('Ordinary artwork NFT paired with its issuing engine', function () {
    let provider, publisher, creator, collector, buyer, source, nft;
    const uri = 'ipfs://artwork-fixture';

    async function deploy(name) {
        const { abi, bytecode } = await artifacts.readArtifact(name);
        const contract = await new ethers.ContractFactory(abi, bytecode, publisher).deploy();
        return contract.waitForDeployment();
    }

    const mine = async transaction => (await transaction).wait();
    const record = (overrides = {}) => ({
        settled: true, artworkId: 73n, creator: creator.address,
        firstCollector: collector.address, metadataURI: uri, ...overrides
    });

    async function expectRevert(read, errorName, iface = nft.interface) {
        const selector = iface.getError(errorName).selector;
        await assert.rejects(read, error => {
            const data = error.data ?? error.error?.data;
            assert.equal(data?.slice(0, 10), selector, String(error));
            return true;
        });
    }

    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [publisher, creator, collector, buyer] = await provider.listAccounts();
        source = await deploy('SettledArtworkSourceFixture');
        const { abi } = await artifacts.readArtifact('SettledArtworkNFT');
        nft = new ethers.Contract(await source.nft(), abi, publisher);
    });

    it('binds both addresses at construction and consumes each settled auction and artwork once', async () => {
        assert.equal(await nft.core(), source.target);
        await mine(source.setRecord(8, record()));
        await expectRevert(nft.mintSettled.staticCall(8), 'UnauthorizedCore');
        await mine(source.issue(nft.target, 8));
        assert.equal(await nft.totalSupply(), 1n);
        assert.equal(await nft.artworkToToken(73), 1n);
        assert.equal(await nft.auctionToToken(8), 1n);
        assert.equal(await nft.tokenToArtwork(1), 73n);
        const publicNFT = nft.connect(provider);
        assert.equal(await publicNFT.ownerOf(1), collector.address);
        assert.equal(await nft.tokenCreator(1), creator.address);
        assert.equal(await nft.firstCollector(1), collector.address);
        assert.equal(await publicNFT.tokenURI(1), uri);
        await expectRevert(source.issue.staticCall(nft.target, 8), 'AlreadyIssued');
        await mine(source.setRecord(9, record()));
        await expectRevert(source.issue.staticCall(nft.target, 9), 'AlreadyIssued');
        assert.equal(await nft.auctionToToken(9), 0n);
        await mine(source.setRecord(8, record({ metadataURI: 'ipfs://other-fixture' })));
        assert.equal(await nft.tokenURI(1), uri);
        for (const name of ['setCore', 'mint', 'burn', 'setTokenURI', 'setRoyaltyReceiver']) {
            assert.equal(nft.interface.getFunction(name), null);
        }
    });

    it('requires a complete settled record and a positive auction ID', async () => {
        await expectRevert(source.issue.staticCall(nft.target, 0), 'InvalidSettlement');
        await expectRevert(source.issue.staticCall(nft.target, 8), 'InvalidSettlement');
        for (const fields of [{ settled: false }, { artworkId: 0 }, { creator: ethers.ZeroAddress },
            { firstCollector: ethers.ZeroAddress }, { metadataURI: '' }]) {
            await mine(source.setRecord(8, record(fields)));
            await expectRevert(source.issue.staticCall(nft.target, 8), 'InvalidSettlement');
        }
        assert.equal(await nft.totalSupply(), 0n);
    });

    it('quotes the canonical creator royalty across the full price range and keeps the original provenance', async () => {
        assert.equal(await nft.supportsInterface('0x80ac58cd'), true);
        assert.equal(await nft.supportsInterface('0x5b5e139f'), true);
        assert.equal(await nft.supportsInterface('0x2a55205a'), true);
        assert.deepEqual(Array.from(await nft.royaltyInfo(1, 10000)), [ethers.ZeroAddress, 0n]);
        await mine(source.setRecord(8, record()));
        await mine(source.issue(nft.target, 8));
        assert.equal(await nft.transferEpoch(1), 0n);
        await mine(nft.connect(collector).transferFrom(collector.address, buyer.address, 1));
        assert.equal(await nft.transferEpoch(1), 1n);
        await mine(nft.connect(buyer).transferFrom(buyer.address, collector.address, 1));
        assert.equal(await nft.transferEpoch(1), 2n);
        assert.equal(await nft.firstCollector(1), collector.address);
        assert.equal(await nft.tokenCreator(1), creator.address);
        for (const price of [0n, 1n, 10000n, ethers.MaxUint256]) {
            assert.deepEqual(Array.from(await nft.royaltyInfo(1, price)), [creator.address, price * 550n / 10000n]);
        }
    });

    it('preserves the issuing market and changes an external operator generation only on an actual admission', async () => {
        const market = await deploy('SettledArtworkSourceFixture');
        assert.equal(await source.marketplaceApprovalGeneration(source.target), 1n);
        for (const operator of [ethers.ZeroAddress, source.target, buyer.address]) {
            await expectRevert(source.allowMarketplace.staticCall(operator, true), 'InvalidMarketplaceChange', source.interface);
        }
        await expectRevert(source.allowMarketplace.staticCall(source.target, false), 'InvalidMarketplaceChange', source.interface);
        await expectRevert(source.allowMarketplace.staticCall(market.target, false), 'InvalidMarketplaceChange', source.interface);
        for (const [active, generation] of [[true, 1n], [false, 1n], [true, 2n]]) {
            const receipt = await mine(source.allowMarketplace(market.target, active));
            const event = receipt.logs.map(log => source.interface.parseLog(log)).find(log => log?.name === 'MarketplaceAdmissionChanged');
            assert.deepEqual([...event.args], [market.target, generation, active]);
            assert.equal(await source.marketplaceApprovalGeneration(market.target), active ? generation : 0n);
            assert.equal(await source.isMarketplaceAllowed(market.target), active);
            await expectRevert(source.allowMarketplace.staticCall(market.target, active), 'InvalidMarketplaceChange', source.interface);
        }
    });

    it('requires fresh token and blanket consent independently after readmission while the owner can still transfer or revoke', async () => {
        const market = await deploy('SettledArtworkSourceFixture');
        await mine(source.setRecord(8, record()));
        await mine(source.issue(nft.target, 8));
        await mine(source.setRecord(9, record({ artworkId: 74n })));
        await mine(source.issue(nft.target, 9));
        const walletNFT = nft.connect(collector);
        const marketTransfer = id => market.transferApproved.staticCall(nft.target, collector.address, buyer.address, id);
        await expectRevert(walletNFT.approve.staticCall(market.target, 1), 'MarketplaceNotAllowed');
        await expectRevert(walletNFT.setApprovalForAll.staticCall(market.target, true), 'MarketplaceNotAllowed');

        await mine(source.allowMarketplace(market.target, true));
        await mine(walletNFT.approve(market.target, 1));
        await mine(walletNFT.setApprovalForAll(market.target, true));
        await marketTransfer(1);
        await marketTransfer(2);
        await mine(walletNFT.approve(source.target, 2));
        const coreAuthorization = await nft.resaleAuthorization(2, collector.address);
        assert.notEqual(coreAuthorization, ethers.ZeroHash);
        for (const active of [false, true]) {
            await mine(source.allowMarketplace(market.target, active));
            assert.equal(await nft.isApprovedForAll(collector.address, market.target), false);
            assert.equal(await nft.getApproved(1), ethers.ZeroAddress);
            await expectRevert(marketTransfer(1), 'ERC721InsufficientApproval');
            await expectRevert(marketTransfer(2), 'ERC721InsufficientApproval');
            assert.equal(await nft.resaleAuthorization(2, collector.address), coreAuthorization);
        }
        await expectRevert(market.approveToken.staticCall(nft.target, market.target, 1), 'ERC721InvalidApprover');
        await mine(walletNFT.approve(market.target, 1));
        assert.equal(await nft.getApproved(1), market.target);
        await marketTransfer(1);
        await expectRevert(marketTransfer(2), 'ERC721InsufficientApproval');
        await mine(walletNFT.approve(ethers.ZeroAddress, 1));
        await mine(walletNFT.setApprovalForAll(market.target, true));
        assert.equal(await nft.getApproved(1), ethers.ZeroAddress);
        await market.approveToken.staticCall(nft.target, market.target, 1);
        await mine(market.transferApproved(nft.target, collector.address, buyer.address, 2));
        assert.equal(await nft.ownerOf(2), buyer.address);
        assert.equal(await nft.isApprovedForAll(buyer.address, market.target), false);
        await mine(source.allowMarketplace(market.target, false));
        await mine(walletNFT.setApprovalForAll(market.target, false));
        await mine(walletNFT.transferFrom(collector.address, buyer.address, 1));
        assert.equal(await nft.ownerOf(1), buyer.address);
    });

    it('keeps the first pair usable after a new engine starts with the same local IDs', async () => {
        await mine(source.setRecord(8, record()));
        const second = await deploy('SettledArtworkSourceFixture');
        const next = new ethers.Contract(await second.nft(), nft.interface, publisher);
        assert.notEqual(next.target, nft.target);
        assert.equal(await next.core(), second.target);
        await mine(second.setRecord(8, record({ creator: buyer.address, firstCollector: creator.address })));
        await expectRevert(second.issue.staticCall(nft.target, 8), 'UnauthorizedCore');
        await mine(second.issue(next.target, 8));
        await mine(source.issue(nft.target, 8));
        assert.equal(await nft.ownerOf(1), collector.address);
        assert.equal(await next.ownerOf(1), creator.address);
        assert.equal(await nft.tokenCreator(1), creator.address);
        assert.equal(await next.tokenCreator(1), buyer.address);
    });

    it('provides complete provenance in a receiver callback and rolls back a rejected delivery', async () => {
        await mine(source.setRecord(8, record({ firstCollector: source.target })));
        await expectRevert(source.issue(nft.target, 8, { gasLimit: 1_000_000 }), 'ERC721InvalidReceiver');
        assert.equal(await nft.totalSupply(), 0n);
        assert.equal(await nft.auctionToToken(8), 0n);
        assert.equal(await nft.artworkToToken(73), 0n);
        assert.equal(await nft.firstCollector(1), ethers.ZeroAddress);
        const receiver = await deploy('SettledArtworkReceiverFixture');
        await mine(source.setRecord(8, record({ firstCollector: receiver.target })));
        await mine(source.issue(nft.target, 8));
        assert.equal(await nft.ownerOf(1), receiver.target);
    });
});
