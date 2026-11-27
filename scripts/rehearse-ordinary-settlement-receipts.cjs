// Compile the local contract artifacts first. All calls below go to an in-process EVM.
const assert = require('node:assert/strict');
const path = require('node:path');
const { ethers } = require('ethers');

process.env.HARDHAT_CONFIG = path.join(__dirname, '../hardhat.local.config.cjs');
process.env.HARDHAT_NETWORK = 'hardhat';
const { artifacts, config } = require('hardhat');
const { createProvider } = require('hardhat/internal/core/providers/construction');

async function main() {
    const { readOrdinarySettlement, readOrdinaryToken, readOrdinaryResaleQuote, readOrdinaryResalePurchase, readOrdinaryTransferRange,
        readOrdinaryRefundEntry, readOrdinaryRefundBatch } =
        await import('../src/indexer/nft-deployment-proof.js');
    const { readBidExtension } = await import('./review-rehearsal-late-bid.mjs');
    const { verifyOutbidRefund } = await import('./read-ordinary-outbid-refund.mjs');
    const chainId = 84532;
    const hardhat = { ...config.networks.hardhat, chainId, forking: undefined };
    const rpc = await createProvider({ ...config, networks: { hardhat } }, 'hardhat', artifacts);
    const provider = new ethers.BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 10;
    try {
        const [payer, creator, first, second] = await provider.listAccounts();
        async function deploy(name, ...args) {
            const { abi, bytecode } = await artifacts.readArtifact(name);
            return (await new ethers.ContractFactory(abi, bytecode, payer).deploy(...args)).waitForDeployment();
        }
        const mine = async transaction => (await transaction).wait();
        const location = receipt => ({ blockHash: receipt.blockHash, blockNumber: receipt.blockNumber });
        // Advance the isolated node's finality tag past the requested receipt.
        const finalize = () => rpc.send('hardhat_mine', ['0x80']);
        const roles = [];
        for (let i = 0; i < 3; i++) roles.push((await deploy('TreasuryAccountStub', 2)).target);
        const pairs = [];
        for (const [index, winner] of [first, second].entries()) {
            const market = await deploy('OrdinaryMarket', ...roles, 8, 30_000);
            const nft = new ethers.Contract(await market.nft(), (await artifacts.readArtifact('SettledArtworkNFT')).abi, provider);
            const review = { chainId, coreAddress: market.target.toLowerCase(), nftAddress: nft.target.toLowerCase(),
                expectedCoreCodeHash: ethers.keccak256(await provider.getCode(market.target)),
                expectedNftCodeHash: ethers.keccak256(await provider.getCode(nft.target)), isCurrent: () => true };
            const listener = { chainId, contractAddress: market.target, nftAddress: nft.target, _readRpcCall: read => read(rpc) };
            const price = ethers.parseEther(index ? '0.002' : '0.001');
            await mine(market.connect(creator).registerArtwork('ipfs://local-pair-' + index));
            await mine(market.connect(creator).createAuction(1, price, 86400));
            const deadline = Number((await market.auctions(1)).end);
            if (index === 0) await rpc.send('evm_setNextBlockTimestamp', [deadline-600]);
            const bid = await mine(market.connect(winner).placeBid(1, price, { value: await market.requiredDepositForBid(price) }));
            if (index === 0) {
                const [tx, receipt, header] = await Promise.all([rpc.send('eth_getTransactionByHash',[bid.hash]),
                    rpc.send('eth_getTransactionReceipt',[bid.hash]), rpc.send('eth_getBlockByHash',[bid.blockHash,false])]);
                const terms = {core:market.target, bidder:winner.address, deadline};
                const extension = readBidExtension(tx,receipt,header,bid.hash,terms);
                assert.equal(extension.deadlineAfterThisBid, new Date((deadline+600)*1000).toISOString());
                assert.throws(() => readBidExtension(tx,{...receipt,logs:receipt.logs.slice(0,1)},header,bid.hash,terms));
                assert.throws(() => readBidExtension({...tx,value:'0x0'},receipt,header,bid.hash,terms));
                console.log('PASS: real local first-bid and ten-minute extension receipt.');
            }
            pairs.push({ market, nft, winner, buyer: index ? first : second, price, review, listener });
        }
        assert.notEqual(pairs[0].review.coreAddress, pairs[1].review.coreAddress);
        assert.notEqual(pairs[0].review.nftAddress, pairs[1].review.nftAddress);
        await rpc.send('evm_setNextBlockTimestamp', [Number((await pairs[1].market.auctions(1)).end)]);

        for (const pair of pairs) {
            const { market, nft, winner, buyer, price, review, listener } = pair;
            const primary = await mine(market.connect(winner).settleAuction(1));
            await finalize();
            const sale = await readOrdinarySettlement(listener, { ...review, ...location(primary),
                transactionHash: primary.hash, auctionId: '1' });
            assert.deepEqual([sale.auctionId, sale.artworkId, sale.tokenId, sale.creator, sale.firstCollector, sale.priceWei],
                ['1', '1', '1', creator.address.toLowerCase(), winner.address.toLowerCase(), String(price)]);
            assert.equal(sale.coreAddress, review.coreAddress);
            assert.deepEqual([sale.protocol, sale.protocolWei, sale.creatorWei], [
                roles[0].toLowerCase(), String(price / 40n), String(price - price / 40n)
            ]);
            pair.primary = primary;
            const resalePrice = price * 3n;
            await mine(nft.connect(winner).approve(market.target, 1));
            const listing = await mine(market.connect(winner).listResale(1, 0, resalePrice));
            const resale = await mine(market.connect(buyer).buyResale(1, 1, { value: resalePrice }));
            await finalize();
            const quote = await readOrdinaryResaleQuote(listener, { ...review, ...location(listing), tokenId: '1' });
            assert.deepEqual([quote.active, quote.seller, quote.priceWei, quote.version],
                [true, winner.address.toLowerCase(), String(resalePrice), '1']);
            const purchased = resale.logs.find(log => log.fragment?.name === 'ResalePurchased');
            const paid = await readOrdinaryResalePurchase(listener, { ...review, ...location(resale),
                transactionHash: resale.hash, logIndex: purchased.index });
            assert.deepEqual([paid.seller, paid.buyer, paid.creator, paid.priceWei, paid.protocol, paid.ecosystem],
                [winner.address, buyer.address, creator.address, String(resalePrice), roles[0], roles[1]].map(s => s.toLowerCase()));
            const token = await readOrdinaryToken(listener, { ...review, ...location(resale), tokenId: '1' });
            assert.deepEqual([token.nftAddress, token.owner, token.creator, token.firstCollector, token.artworkId],
                [review.nftAddress, buyer.address.toLowerCase(), creator.address.toLowerCase(), winner.address.toLowerCase(), '1']);
            await assert.rejects(readOrdinarySettlement(listener, { ...review, ...location(resale),
                transactionHash: resale.hash, auctionId: '1' }), /Expected one AuctionSettled/);
            const transfer = await mine(nft.connect(buyer).transferFrom(buyer.address,winner.address,1));
            await finalize();
            const previous = await provider.getBlock(primary.blockNumber-1);
            const history = await readOrdinaryTransferRange(listener, { ...review, ...location(transfer),fromBlock:primary.blockNumber,
                previousBlockHash:previous.hash,bootstrap:true,reviewResales:true });
            assert.equal(history.events.length,3);
            assert.deepEqual(history.purchases,[{ ...location(resale), transactionHash:resale.hash, logIndex:purchased.index }]);
            const indexedSale = await readOrdinaryResalePurchase(listener,{ ...review, ...history.purchases[0] });
            assert.equal(indexedSale.protocolWei, paid.protocolWei);
            assert.equal(indexedSale.ecosystemWei, paid.ecosystemWei);
        }
        // Both pairs are deployed before either receipt, and both use auction/artwork/token ID 1.
        for (const [i, pair] of pairs.entries()) {
            const other = pairs[1 - i].primary;
            await assert.rejects(readOrdinarySettlement(pair.listener, { ...pair.review,
                ...location(other), transactionHash: other.hash, auctionId: '1' }), /Expected one AuctionSettled/);
        }
        console.log('PASS: two issuer pairs, two paid primary sales, two resales and four rejected receipt substitutions on an isolated EVM.');
        const { market, listener, review } = pairs[0];
        const receiver = await deploy('OrdinaryBidderFixture');
        await mine(market.connect(creator).registerArtwork('ipfs://refund-rehearsal'));
        await mine(market.connect(creator).createAuction(2, ethers.parseEther('0.001'), 86400));
        const bidPrice = await market.minimumBid(2);
        await mine(receiver.bid(market.target, 2, bidPrice, {value:await market.requiredDepositForBid(bidPrice)}));
        const queuedReceipts = [];
        for (const bidder of [first, second]) {
            const price = await market.minimumBid(2);
            queuedReceipts.push(await mine(market.connect(bidder).placeBid(2, price, {value:await market.requiredDepositForBid(price)})));
        }
        await rpc.send('evm_setNextBlockTimestamp', [Number((await market.auctions(2)).end)]);
        await mine(market.closeAuction(2));
        const batch = await mine(market.processRefunds(2, 8));
        // The discovery reader queries intermediate state. Mine individual archive
        // blocks here because bulk filler blocks do not retain that state on Hardhat.
        for (let i = 0; i < 128; i++) await rpc.send('evm_mine', []);
        const measured = await readOrdinaryRefundBatch(listener, { ...review, ...location(batch), transactionHash: batch.hash });
        assert.deepEqual([measured.configuredBatchLimit,measured.configuredGasArgument,measured.requestedEntries,
            measured.processedEntries,measured.distinctCreditors,measured.deliveredEntries,measured.creditedEntries],
        ['8','30000','8',2,2,1,1]);
        console.log('Local batch: requested 8, processed 2, delivered 1, credited 1; whole-transaction execution gas', String(batch.gasUsed));
        // These local adapter fixtures exercise real EVM history on one disposable chain.
        const readers = [rpc.send.bind(rpc), rpc.send.bind(rpc)];
        for (const [i, queued] of queuedReceipts.entries()) {
            const options = {...review, auctionId:'2', entry:String(i)};
            const obligation = await readOrdinaryRefundEntry(listener, {...options, ...location(queued),
                transactionHash:queued.hash, event:'OutbidRefundQueued'});
            const payment = await readOrdinaryRefundEntry(listener, {...options, ...location(batch),
                transactionHash:batch.hash, event:'OutbidRefundProcessed'});
            assert.equal(payment.creditor, [receiver.target, first.address][i].toLowerCase());
            assert.equal(payment.creditor, obligation.creditor);
            assert.equal(payment.amountWei, obligation.amountWei);
            assert.equal(payment.paid, i === 1);
            const discovered = await verifyOutbidRefund(review, '2', String(i), queued.hash, '--discover', readers);
            assert.equal(discovered.processed.transactionHash, batch.hash);
            assert.equal(discovered.disposition, i === 1 ? 'delivered' : 'credited-for-withdrawal');
        }
        console.log('PASS: discovered the finalized local batch from each queued bid and verified wallet delivery and fallback credit.');
    } finally {
        provider.destroy();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
