// Measure the real candidate's batch path using only Hardhat's disposable accounts.
const path = require('node:path');
const assert = require('node:assert/strict');
process.env.HARDHAT_CONFIG = path.join(__dirname, '../hardhat.local.config.cjs');
process.env.HARDHAT_NETWORK = 'hardhat';
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.BrowserProvider(network.provider, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 10;
    assert.equal((await provider.getNetwork()).chainId, 31337n);
    const accounts = await provider.listAccounts();
    const payer = accounts[0];
    const mine = async tx => (await tx).wait();
    async function deploy(name, ...args) {
        const artifact = await artifacts.readArtifact(name);
        const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, payer);
        return (await factory.deploy(...args)).waitForDeployment();
    }
    const roles = [];
    for (let i = 0; i < 3; i++) roles.push((await deploy('TreasuryAccountStub', 2)).target);
    const engine = await deploy('OrdinaryMarket', ...roles, 16, 30_000);
    const rows = [];
    for (const [index, kind] of ['wallet', 'accepting-contract', 'credit-fallback'].entries()) {
        const auction = index + 1;
        await mine(engine.registerArtwork('ipfs://local-refund-measurement'));
        await mine(engine.createAuction(auction, ethers.parseEther('0.01'), 86400));
        const creditors = [];
        for (let i = 0; i < 17; i++) {
            const price = await engine.minimumBid(auction);
            const value = await engine.requiredDepositForBid(price);
            if (kind === 'wallet' || i === 16) {
                const wallet = accounts[i + 1];
                await mine(engine.connect(wallet).placeBid(auction, price, { value }));
                creditors.push(wallet.address);
            } else {
                const receiver = await deploy('OrdinaryBidderFixture');
                if (kind === 'accepting-contract') await mine(receiver.acceptDelivery(true, false));
                await mine(receiver.bid(engine.target, auction, price, { value }));
                creditors.push(receiver.target);
            }
        }
        await network.provider.send('evm_setNextBlockTimestamp', [Number((await engine.auctions(auction)).end)]);
        await mine(engine.closeAuction(auction));
        for (const count of [1, 4, 8, 16]) {
            const saved = await network.provider.send('evm_snapshot');
            const receipt = await mine(engine.processRefunds(auction, count));
            assert.deepEqual(Array.from(await engine.refundProgress(auction)), [BigInt(count), 16n]);
            const processed = receipt.logs.filter(log => log.fragment?.name === 'OutbidRefundProcessed');
            assert.equal(processed.length, count);
            for (let i = 0; i < count; i++) {
                assert.equal(processed[i].args.creditor, creditors[i]);
                assert.equal(processed[i].args.paid, kind !== 'credit-fallback');
            }
            rows.push({ kind, count, gasUsed: receipt.gasUsed.toString() });
            assert.equal(await network.provider.send('evm_revert', [saved]), true);
        }
    }
    console.log(JSON.stringify({ chain: 'isolated Hardhat', refundTransferGas: 30000, rows }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
