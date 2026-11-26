import { appendExact, withEvidenceTransaction } from './finalized-evidence.js';

export async function withOrdinaryIssuer(pool, listener, options, proof, write) {
    const assertCurrent = () => {
        if (options.isCurrent() !== true || listener.chainId !== proof.chainId ||
            listener.contractAddress?.toLowerCase() !== proof.coreAddress || listener.nftAddress?.toLowerCase() !== proof.nftAddress) {
            throw new Error('Ordinary intake superseded');
        }
    };
    assertCurrent();
    return withEvidenceTransaction(pool, async client => {
        assertCurrent();
        await appendExact(client, 'ordinary_issuers', {
            chain_id: proof.chainId, core_address: proof.coreAddress, nft_address: proof.nftAddress,
            core_code_hash: proof.coreCodeHash, nft_code_hash: proof.nftCodeHash
        });
        return write(client);
    }, assertCurrent);
}

export async function ingestOrdinarySettlement(pool, listener, options) {
    const sale = await listener.readOrdinarySettlement(options);
    return persistOrdinarySettlement(pool, listener, options, sale);
}

export async function persistOrdinarySettlement(pool, listener, options, sale) {
    const inserted = await withOrdinaryIssuer(pool, listener, options, sale, async client => {
        const key = { chain_id: sale.chainId, core_address: sale.coreAddress, auction_id: sale.auctionId };
        const created = await appendExact(client, 'ordinary_settlements', {
            ...key, artwork_id: sale.artworkId, token_id: sale.tokenId, price_wei: sale.priceWei, creator: sale.creator,
            first_collector: sale.firstCollector, runner_up_accepted: sale.runnerUpAccepted,
            transaction_hash: sale.transactionHash, block_number: sale.blockNumber, block_hash: sale.blockHash, log_index: sale.logIndex
        });
        await appendExact(client, 'ordinary_primary_credits', { ...key, protocol_treasury: sale.protocol,
            protocol_wei: sale.protocolWei, creator_wei: sale.creatorWei, log_index: sale.creditLogIndex });
        return created;
    });
    return { inserted, sale };
}

// The ordinary receipt reader supplies decimal strings for every uint256 field.
export function appendOrdinaryRegistration(client, work) {
    return appendExact(client, 'ordinary_registrations', {
        chain_id: work.chainId, core_address: work.coreAddress, artwork_id: work.artworkId, creator: work.creator,
        metadata_uri: Buffer.from(work.metadataUriHex.slice(2), 'hex'), transaction_hash: work.transactionHash,
        block_number: work.blockNumber, block_hash: work.blockHash, log_index: work.logIndex
    });
}

export function appendOrdinaryResalePurchase(client, sale) {
    return appendExact(client, 'ordinary_resale_purchases', {
        chain_id: sale.chainId, core_address: sale.coreAddress, token_id: sale.tokenId, listing_version: sale.version,
        artwork_id: sale.artworkId, price_wei: sale.priceWei, seller: sale.seller, buyer: sale.buyer,
        creator: sale.creator, first_collector: sale.firstCollector, protocol_treasury: sale.protocol, ecosystem_treasury: sale.ecosystem,
        seller_wei: sale.sellerWei, creator_wei: sale.creatorWei, protocol_wei: sale.protocolWei, ecosystem_wei: sale.ecosystemWei,
        transaction_hash: sale.transactionHash, block_number: sale.blockNumber, block_hash: sale.blockHash, log_index: sale.logIndex
    });
}
