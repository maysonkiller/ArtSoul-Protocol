import { pathToFileURL } from 'node:url';
import { isAddress, ZeroAddress } from 'ethers';
import pg from 'pg';

class ReportError extends Error {}

const sql = `
WITH sales AS (
    SELECT first_collector AS buyer, true AS is_primary, price_wei, credit.protocol_wei, 0::numeric AS ecosystem_wei
    FROM artsoul_private.ordinary_settlements
    LEFT JOIN artsoul_private.ordinary_primary_credits AS credit USING (chain_id, core_address, auction_id)
    WHERE chain_id = $1 AND core_address = $2 AND block_number BETWEEN $3 AND $4
    UNION ALL
    SELECT buyer, false, price_wei, protocol_wei, ecosystem_wei
    FROM artsoul_private.ordinary_resale_purchases
    WHERE chain_id = $1 AND core_address = $2 AND block_number BETWEEN $3 AND $4
), wallets AS (
    SELECT buyer, count(*) AS purchases,
        count(*) FILTER (WHERE is_primary) AS primary_sales, count(*) FILTER (WHERE NOT is_primary) AS resales,
        sum(price_wei) FILTER (WHERE is_primary) AS primary_volume, sum(price_wei) FILTER (WHERE NOT is_primary) AS resale_volume,
        count(*) FILTER (WHERE is_primary AND protocol_wei IS NULL) AS missing_primary_credits,
        sum(protocol_wei) FILTER (WHERE is_primary) AS primary_protocol_credit,
        sum(protocol_wei) FILTER (WHERE NOT is_primary) AS resale_protocol_credit, sum(ecosystem_wei) AS resale_ecosystem_credit
    FROM sales GROUP BY buyer
), prior_buyers AS (
    SELECT first_collector AS buyer FROM artsoul_private.ordinary_settlements
    WHERE chain_id = $1 AND core_address = $2 AND block_number < $3
    UNION
    SELECT buyer FROM artsoul_private.ordinary_resale_purchases
    WHERE chain_id = $1 AND core_address = $2 AND block_number < $3
)
SELECT EXISTS (SELECT 1 FROM artsoul_private.ordinary_issuers WHERE chain_id = $1 AND core_address = $2) AS registered,
    row_security_active('artsoul_private.ordinary_issuers') OR row_security_active('artsoul_private.ordinary_settlements')
        OR row_security_active('artsoul_private.ordinary_resale_purchases') OR row_security_active('artsoul_private.ordinary_primary_credits') AS filtered,
    count(*)::text AS paying_wallets, (count(*) FILTER (WHERE purchases > 1))::text AS repeat_paying_wallets,
    count(prior_buyers.buyer)::text AS returning_paying_wallets,
    coalesce(sum(primary_sales), 0)::text AS primary_sales, coalesce(sum(resales), 0)::text AS resales,
    coalesce(sum(primary_volume), 0)::text AS primary_volume_wei, coalesce(sum(resale_volume), 0)::text AS resale_volume_wei,
    (coalesce(sum(primary_volume), 0) + coalesce(sum(resale_volume), 0))::text AS total_volume_wei,
    coalesce(sum(missing_primary_credits), 0)::text AS primary_sales_missing_credit,
    CASE WHEN coalesce(sum(missing_primary_credits), 0) = 0 THEN coalesce(sum(primary_protocol_credit), 0)::text END AS primary_protocol_credit_wei,
    coalesce(sum(resale_protocol_credit), 0)::text AS resale_protocol_credit_wei,
    coalesce(sum(resale_ecosystem_credit), 0)::text AS resale_ecosystem_credit_wei
FROM wallets LEFT JOIN prior_buyers USING (buyer)`;

// All subqueries share the sales report's statement snapshot. A partial restore
// must not certify a period simply because its last checkpoint survived.
const sqlWithCoverage = `
WITH totals AS (${sql}), spans AS (
    SELECT r.*, lag(through_block) OVER w AS prior_end, lag(through_hash) OVER w AS prior_hash,
        lag(supply_after) OVER w AS prior_supply, lag(origin_block) OVER w AS prior_origin,
        lag(origin_previous_hash) OVER w AS prior_origin_hash
    FROM artsoul_private.ordinary_nft_ranges r
    WHERE chain_id=$1 AND core_address=$2 AND from_block <= $4 AND through_block >= $3
    WINDOW w AS (ORDER BY through_block)
), retained AS (
    SELECT s.*, count(t.token_id) AS event_rows, count(t.token_id) FILTER (WHERE t.from_wallet=$5) AS mint_rows,
        count(resale.token_id) AS purchased_rows
    FROM spans s LEFT JOIN artsoul_private.ordinary_nft_transfers t USING (chain_id,core_address,through_block)
    LEFT JOIN artsoul_private.ordinary_resale_purchases resale ON resale.chain_id=t.chain_id AND resale.core_address=t.core_address
        AND resale.transaction_hash=t.transaction_hash AND resale.log_index=t.log_index-1 AND resale.token_id=t.token_id
        AND resale.seller=t.from_wallet AND resale.buyer=t.to_wallet AND resale.block_hash=t.block_hash AND resale.block_number=t.block_number
    GROUP BY s.chain_id,s.core_address,s.origin_block,s.origin_previous_hash,s.through_block,s.through_hash,
        s.from_block,s.previous_hash,s.supply_before,s.supply_after,s.event_count,s.resale_count,s.prior_end,s.prior_hash,
        s.prior_supply,s.prior_origin,s.prior_origin_hash
), mints AS (
    SELECT token_id,to_wallet,transaction_hash,block_hash,block_number,log_index
    FROM artsoul_private.ordinary_nft_transfers
    WHERE chain_id=$1 AND core_address=$2 AND block_number BETWEEN $3 AND $4 AND from_wallet=$5
), paid AS (
    SELECT token_id,first_collector,transaction_hash,block_hash,block_number,log_index
    FROM artsoul_private.ordinary_settlements
    WHERE chain_id=$1 AND core_address=$2 AND block_number BETWEEN $3 AND $4
)
SELECT totals.*, row_security_active('artsoul_private.ordinary_nft_ranges')
    OR row_security_active('artsoul_private.ordinary_nft_transfers') AS coverage_filtered,
    coalesce((SELECT min(from_block) <= $3 AND max(through_block) >= $4
        AND bool_and(event_rows=event_count AND mint_rows=supply_after-supply_before
            AND (prior_end IS NULL OR (from_block=prior_end+1 AND previous_hash=prior_hash
                AND supply_before=prior_supply AND prior_origin=origin_block AND prior_origin_hash=origin_previous_hash)))
        FROM retained),false)
    AND NOT EXISTS (SELECT 1 FROM mints m FULL JOIN paid p USING(token_id)
        WHERE m.token_id IS NULL OR p.token_id IS NULL OR m.to_wallet<>p.first_collector
            OR m.transaction_hash<>p.transaction_hash OR m.block_hash<>p.block_hash
            OR m.block_number<>p.block_number OR m.log_index>=p.log_index)
    AND totals.primary_sales_missing_credit='0' AS primary_complete,
    coalesce((SELECT bool_and(resale_count IS NOT NULL AND purchased_rows=resale_count) FROM retained),false)
    AND NOT EXISTS (SELECT 1 FROM artsoul_private.ordinary_resale_purchases r
        WHERE r.chain_id=$1 AND r.core_address=$2 AND r.block_number BETWEEN $3 AND $4 AND NOT EXISTS (
            SELECT 1 FROM artsoul_private.ordinary_nft_transfers t WHERE t.chain_id=r.chain_id AND t.core_address=r.core_address
                AND t.token_id=r.token_id AND t.block_hash=r.block_hash AND t.block_number=r.block_number
                AND t.transaction_hash=r.transaction_hash AND t.log_index=r.log_index+1 AND t.from_wallet=r.seller AND t.to_wallet=r.buyer))
    AS resales_matched
FROM totals`;

export async function reportOrdinaryDemand(client, chain, core, fromBlock, toBlock, { primaryCoverage = false, marketCoverage = false } = {}) {
    if (!['8453', '84532'].includes(chain) || !isAddress(core) || core.toLowerCase() === ZeroAddress) {
        throw new ReportError('Choose Base or Base Sepolia and a nonzero Core address.');
    }
    const block = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
    if (!block(fromBlock) || !block(toBlock) || BigInt(toBlock) < BigInt(fromBlock)) {
        throw new ReportError('Supply an inclusive ascending block interval using nonnegative PostgreSQL bigint values.');
    }
    const coreAddress = core.toLowerCase();
    const params = [Number(chain), coreAddress, fromBlock, toBlock];
    const verify = primaryCoverage || marketCoverage;
    if (verify) params.push(ZeroAddress);
    const { rows } = await client.query(verify ? sqlWithCoverage : sql, params);
    const { registered, filtered, coverage_filtered, primary_complete, resales_matched, ...totals } = rows[0];
    if (filtered || coverage_filtered) throw new ReportError('Row security filters this reporting session. Use the authorized private indexer reader.');
    return { chainId: Number(chain), coreAddress, fromBlock, toBlock, issuerRegistered: registered,
        coverage: 'indexed_receipts_only', ...(verify && { primaryCoverage: registered && primary_complete ? 'finalized_mints_and_credits' : 'incomplete' }),
        ...(marketCoverage && { coreResaleCoverage: registered && primary_complete && resales_matched ? 'finalized_core_purchases_and_credits' : 'incomplete' }),
        totals: registered ? totals : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let pool;
    try {
        const args = process.argv.slice(2);
        const primaryCoverage = args.length === 5 && args[4] === '--primary-coverage';
        const marketCoverage = args.length === 5 && args[4] === '--market-coverage';
        if (args.length !== 4 && !primaryCoverage && !marketCoverage) throw new ReportError('Usage: node scripts/report-ordinary-demand.mjs CHAIN_ID CORE_ADDRESS FIRST_BLOCK LAST_BLOCK [--primary-coverage|--market-coverage]');
        const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
        if (!connectionString) throw new ReportError('Set ARTSOUL_ORDINARY_DATABASE_URL for the private indexer reader.');
        pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
        console.log(JSON.stringify(await reportOrdinaryDemand(pool, ...args.slice(0, 4), { primaryCoverage, marketCoverage }), null, 2));
    } catch (error) {
        console.error(error instanceof ReportError ? error.message : 'Could not read the ordinary sales evidence. Check access and migrations 018, 020, 023 and, for primary coverage, 024.');
        process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}
