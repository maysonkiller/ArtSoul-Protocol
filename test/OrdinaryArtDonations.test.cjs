const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const { artifacts, network } = require('hardhat');

const mine = async transaction => (await transaction).wait();

describe('Creator support on the replacement ordinary artwork pair', function () {
    this.timeout(90000);
    let provider, deployer, artist, collector, donor, treasury, core, donations, nft;

    async function deploy(name, ...args) {
        const { abi, bytecode } = await artifacts.readArtifact(name);
        return (await new ethers.ContractFactory(abi, bytecode, deployer).deploy(...args)).waitForDeployment();
    }

    beforeEach(async () => {
        await network.provider.send('hardhat_reset');
        provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
        provider.pollingInterval = 10;
        [deployer, artist, collector, donor, treasury] = await provider.listAccounts();
        const admin = await deploy('DonationTestAdmin', deployer.address);
        core = await deploy('OrdinaryAuctionFixture', treasury.address);
        donations = await deploy('OrdinaryArtDonations', core.target, admin.target);
        const { abi } = await artifacts.readArtifact('SettledArtworkNFT');
        nft = new ethers.Contract(await core.nft(), abi, collector);
    });

    it('forwards the full pre-mint donation and produces the event consumed by the indexer', async () => {
        const { DONATION_ABI, parseDonationEvent, projectDonation } = await import('../src/indexer/donation-events.js');
        await mine(core.connect(artist).registerArtwork('ipfs://first'));
        const before = await provider.getBalance(artist.address);
        const receipt = await mine(donations.connect(donor).donate(artist.address, 1, 'Thank you', true, { value: 17n }));
        assert.equal(await donations.core(), core.target);
        assert.equal(await provider.getBalance(artist.address) - before, 17n);
        assert.equal(await provider.getBalance(donations.target), 0n);
        assert.equal(await core.credits(treasury.address), 0n);
        assert.equal(await nft.totalSupply(), 0n);
        assert.equal((await core.works(1)).floor, 0n);
        assert.equal(receipt.logs.length, 1);
        assert.equal(receipt.logs[0].address, donations.target);
        const log = receipt.logs[0];
        const eventData = parseDonationEvent(new ethers.Interface(DONATION_ABI).parseLog(log).args);
        assert.deepEqual(eventData, {
            donor: donor.address, creator: artist.address, artworkId: 1n, amount: 17n,
            message: 'Thank you', anonymous: true, message_utf8_hex: '5468616e6b20796f75'
        });
        // Replay the local receipt through the Sepolia projection boundary with a recording SQL client.
        const inserts = [];
        const timestamp = new Date((await provider.getBlock(receipt.blockNumber)).timestamp * 1000).toISOString();
        await projectDonation({ query: async (_sql, values) => inserts.push(values) }, {
            eventData, transactionHash: receipt.hash, contractAddress: log.address,
            logIndex: log.index, blockNumber: log.blockNumber
        }, 84532, donations.target, timestamp);
        assert.deepEqual(inserts, [['84532', donations.target.toLowerCase(), receipt.hash, log.index, log.blockNumber,
            '1', artist.address.toLowerCase(), donor.address.toLowerCase(), '17', true, 'Thank you', timestamp]]);
    });

    it('rejects unknown artwork and mismatched recipients', async () => {
        await mine(core.connect(artist).registerArtwork('ipfs://first'));
        for (const [creator, id, errorName] of [
            [artist.address, 0, 'ArtworkNotFound'], [artist.address, 2, 'ArtworkNotFound'],
            [donor.address, 1, 'CreatorMismatch']
        ]) {
            await assert.rejects(donations.connect(donor).donate.staticCall(creator, id, '', false, { value: 1n }),
                error => error.revert?.name === errorName);
        }
    });

    it('still pays the work creator when the NFT has a different ID and owner', async () => {
        await mine(core.connect(deployer).registerArtwork('ipfs://unminted'));
        await mine(core.connect(artist).registerArtwork('ipfs://second'));
        const price = ethers.parseEther('0.01');
        await mine(core.connect(artist).createAuction(2, price, 86400));
        await mine(core.connect(collector).placeBid(1, price, { value: await core.requiredDepositForBid(price) }));
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await core.auctions(1)).end)]);
        await mine(core.closeAuction(1));
        await mine(core.connect(collector).settleAuction(1));
        assert.equal(await nft.artworkToToken(2), 1n);
        assert.equal(await nft.ownerOf(1), collector.address);
        const balances = await Promise.all([artist.address, collector.address].map(address => provider.getBalance(address)));
        const floor = (await core.works(2)).floor;
        await mine(donations.connect(donor).donate(artist.address, 2, '', false, { value: 19n }));
        assert.equal(await provider.getBalance(artist.address) - balances[0], 19n);
        assert.equal(await provider.getBalance(collector.address), balances[1]);
        assert.equal((await core.works(2)).floor, floor);
        assert.equal(await nft.ownerOf(1), collector.address);
    });
});
