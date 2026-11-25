// Table and column identifiers below are fixed by the writer. All evidence is bound as values.
async function appendExact(client, table, row) {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const params = columns.map((_, i) => '$' + (i + 1));
    const inserted = await client.query(
        `INSERT INTO artsoul_private.${table} (${columns.join(', ')}) VALUES (${params.join(', ')}) ON CONFLICT DO NOTHING`,
        values
    );
    if (inserted.rowCount === 1) return true;
    // READ COMMITTED takes a new snapshot after the competing insert commits.
    const matching = await client.query(
        `SELECT 1 FROM artsoul_private.${table} WHERE ${columns.map((name, i) => name + ' = ' + params[i]).join(' AND ')}`,
        values
    );
    if (!matching.rowCount) throw new Error('Conflicting finalized evidence in ' + table);
    return false;
}

export async function withOrdinaryIssuer(pool, listener, options, proof, write) {
    const assertCurrent = () => {
        if (options.isCurrent() !== true || listener.chainId !== proof.chainId ||
            listener.contractAddress?.toLowerCase() !== proof.coreAddress || listener.nftAddress?.toLowerCase() !== proof.nftAddress) {
            throw new Error('Ordinary intake superseded');
        }
    };
    assertCurrent();
    const client = await pool.connect();
    let discard;
    try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        assertCurrent();
        await appendExact(client, 'ordinary_issuers', {
            chain_id: proof.chainId, core_address: proof.coreAddress, nft_address: proof.nftAddress,
            core_code_hash: proof.coreCodeHash, nft_code_hash: proof.nftCodeHash
        });
        const result = await write(client);
        assertCurrent();
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
        throw error;
    } finally {
        client.release(discard);
    }
}

export async function ingestOrdinarySettlement(pool, listener, options) {
    const sale = await listener.readOrdinarySettlement(options);
    const inserted = await withOrdinaryIssuer(pool, listener, options, sale, client => appendExact(client, 'ordinary_settlements', {
        chain_id: sale.chainId, core_address: sale.coreAddress, auction_id: sale.auctionId, artwork_id: sale.artworkId,
        token_id: sale.tokenId, price_wei: sale.priceWei, creator: sale.creator, first_collector: sale.firstCollector,
        runner_up_accepted: sale.runnerUpAccepted, transaction_hash: sale.transactionHash, block_number: sale.blockNumber,
        block_hash: sale.blockHash, log_index: sale.logIndex
    }));
    return { inserted, sale };
}

// The ordinary receipt reader supplies decimal strings for every uint256 field.
export function appendOrdinaryResalePurchase(client, sale) {
    return appendExact(client, 'ordinary_resale_purchases', {
        chain_id: sale.chainId, core_address: sale.coreAddress, token_id: sale.tokenId, listing_version: sale.version,
        artwork_id: sale.artworkId, price_wei: sale.priceWei, seller: sale.seller, buyer: sale.buyer,
        creator: sale.creator, first_collector: sale.firstCollector, protocol_treasury: sale.protocol, ecosystem_treasury: sale.ecosystem,
        seller_wei: sale.sellerWei, creator_wei: sale.creatorWei, protocol_wei: sale.protocolWei, ecosystem_wei: sale.ecosystemWei,
        transaction_hash: sale.transactionHash, block_number: sale.blockNumber, block_hash: sale.blockHash, log_index: sale.logIndex
    });
}
