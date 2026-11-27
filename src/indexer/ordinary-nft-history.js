import { ZeroAddress } from 'ethers';
import { appendExact } from './finalized-evidence.js';
import { appendOrdinaryResalePurchase, appendOrdinarySettlement, withOrdinaryIssuer } from './ordinary-settlement-intake.js';

export async function ordinaryHistoryProgress(db, pair, origin) {
    const { rows } = await db.query(`SELECT origin_block,origin_previous_hash,through_block,through_hash,supply_after,
        nft_address,core_code_hash,nft_code_hash FROM artsoul_private.ordinary_nft_ranges
        JOIN artsoul_private.ordinary_issuers USING(chain_id,core_address) WHERE chain_id=$1 AND core_address=$2
        ORDER BY through_block DESC LIMIT 1`, [pair.chainId, pair.coreAddress.toLowerCase()]);
    const last = rows[0];
    if (!last) return { fromBlock: origin.fromBlock, previousBlockHash: origin.previousBlockHash, bootstrap: true, supply: '0' };
    if (Number(last.origin_block) !== origin.fromBlock || last.origin_previous_hash !== origin.previousBlockHash) {
        throw new Error('Ordinary NFT history origin differs from the retained origin');
    }
    if (last.nft_address !== pair.nftAddress.toLowerCase() || last.core_code_hash !== pair.expectedCoreCodeHash.toLowerCase() ||
        last.nft_code_hash !== pair.expectedNftCodeHash.toLowerCase()) throw new Error('Ordinary NFT history issuer differs from the reviewed pair');
    return { fromBlock: Number(last.through_block) + 1, previousBlockHash: last.through_hash, bootstrap: false, supply: last.supply_after };
}

// The issuer lock serializes only commits; both RPC readings finish before anyone takes this lock.
export function commitOrdinaryHistory(pool, pair, origin, batch, sales, resales) {
    const scope = [pair.chainId, pair.coreAddress.toLowerCase()];
    const source = { chainId: pair.chainId, contractAddress: pair.coreAddress, nftAddress: pair.nftAddress };
    return withOrdinaryIssuer(pool, source, { isCurrent: () => true }, batch, async client => {
        await client.query('SELECT 1 FROM artsoul_private.ordinary_issuers WHERE chain_id=$1 AND core_address=$2 FOR UPDATE', scope);
        const next = await ordinaryHistoryProgress(client, pair, origin);
        if (next.fromBlock !== batch.fromBlock || next.previousBlockHash !== batch.previousBlockHash ||
            next.bootstrap !== batch.bootstrap || next.supply !== batch.mintCoverage.before) {
            throw new Error('Ordinary NFT history checkpoint changed');
        }
        const tokenIds = [...new Set(batch.events.map(event => event.eventData.tokenId))];
        const { rows } = tokenIds.length ? await client.query(`SELECT DISTINCT ON (token_id) token_id,to_wallet
            FROM artsoul_private.ordinary_nft_transfers WHERE chain_id=$1 AND core_address=$2 AND token_id=ANY($3::numeric[])
            ORDER BY token_id,block_number DESC,log_index DESC`, [...scope, tokenIds]) : { rows: [] };
        const owners = new Map(rows.map(row => [row.token_id, row.to_wallet]));
        const key = { chain_id: pair.chainId, core_address: batch.coreAddress, through_block: batch.blockNumber };
        await appendExact(client, 'ordinary_nft_ranges', { ...key, origin_block: origin.fromBlock,
            origin_previous_hash: origin.previousBlockHash, from_block: batch.fromBlock,
            previous_hash: batch.previousBlockHash, through_hash: batch.blockHash,
            supply_before: batch.mintCoverage.before, supply_after: batch.mintCoverage.after, event_count: batch.events.length,
            resale_count: resales.length });
        const purchased = new Map(resales.map(sale => [sale.transactionHash + ':' + (sale.logIndex + 1), sale]));
        if (purchased.size !== batch.purchases.length || purchased.size !== resales.length) throw new Error('Ordinary purchase count changed');
        let minted = 0;
        for (const event of batch.events) {
            const { from, to, tokenId } = event.eventData;
            if ((owners.get(tokenId) ?? ZeroAddress) !== from) throw new Error('Ordinary transfer disagrees with the preceding owner');
            owners.set(tokenId, to);
            const locator = event.transactionHash + ':' + event.logIndex;
            const resale = purchased.get(locator);
            if (resale) {
                if (resale.tokenId !== tokenId || resale.buyer !== to || resale.seller !== from || resale.blockHash !== event.blockHash ||
                    resale.blockNumber !== event.blockNumber || resale.coreAddress !== batch.coreAddress || resale.nftAddress !== batch.nftAddress ||
                    resale.chainId !== batch.chainId) throw new Error('Ordinary resale differs from its retained transfer');
                await appendOrdinaryResalePurchase(client,resale);
                purchased.delete(locator);
            }
            if (from === ZeroAddress) {
                const sale = sales[minted++];
                if (!sale || sale.tokenId !== tokenId || sale.firstCollector !== to || sale.chainId !== pair.chainId ||
                    sale.coreAddress !== batch.coreAddress || sale.nftAddress !== batch.nftAddress ||
                    sale.blockNumber !== event.blockNumber || sale.blockHash !== event.blockHash ||
                    sale.transactionHash !== event.transactionHash || sale.logIndex <= event.logIndex) {
                    throw new Error('Ordinary mint has no matching finalized sale');
                }
                await appendOrdinarySettlement(client, sale);
            }
            await appendExact(client, 'ordinary_nft_transfers', { ...key, block_number: event.blockNumber,
                block_hash: event.blockHash, transaction_hash: event.transactionHash, transaction_index: event.transactionIndex,
                log_index: event.logIndex, block_time: new Date(event.timestamp), token_id: tokenId, from_wallet: from, to_wallet: to });
        }
        if (minted !== sales.length) throw new Error('Unexpected ordinary sale in transfer range');
        if (purchased.size) throw new Error('Undelivered ordinary purchase in transfer range');
    });
}
