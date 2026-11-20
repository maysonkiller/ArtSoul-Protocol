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

export async function ingestOrdinarySettlement(pool, listener, options) {
    const sale = await listener.readOrdinarySettlement(options);
    const assertCurrent = () => {
        if (options.isCurrent() !== true || listener.chainId !== sale.chainId ||
            listener.contractAddress?.toLowerCase() !== sale.coreAddress || listener.nftAddress?.toLowerCase() !== sale.nftAddress) {
            throw new Error('Ordinary settlement intake superseded');
        }
    };
    assertCurrent();
    const client = await pool.connect();
    let discard;
    try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        assertCurrent();
        await appendExact(client, 'ordinary_issuers', {
            chain_id: sale.chainId, core_address: sale.coreAddress, nft_address: sale.nftAddress,
            core_code_hash: sale.coreCodeHash, nft_code_hash: sale.nftCodeHash
        });
        const inserted = await appendExact(client, 'ordinary_settlements', {
            chain_id: sale.chainId, core_address: sale.coreAddress, auction_id: sale.auctionId, artwork_id: sale.artworkId,
            token_id: sale.tokenId, price_wei: sale.priceWei, creator: sale.creator, first_collector: sale.firstCollector,
            runner_up_accepted: sale.runnerUpAccepted, transaction_hash: sale.transactionHash, block_number: sale.blockNumber,
            block_hash: sale.blockHash, log_index: sale.logIndex
        });
        assertCurrent();
        await client.query('COMMIT');
        return { inserted, sale };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
        throw error;
    } finally {
        client.release(discard);
    }
}
