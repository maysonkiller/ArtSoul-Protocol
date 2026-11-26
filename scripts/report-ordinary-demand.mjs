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

export async function reportOrdinaryDemand(client, chain, core, fromBlock, toBlock) {
    if (!['8453', '84532'].includes(chain) || !isAddress(core) || core.toLowerCase() === ZeroAddress) {
        throw new ReportError('Choose Base or Base Sepolia and a nonzero Core address.');
    }
    const block = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
    if (!block(fromBlock) || !block(toBlock) || BigInt(toBlock) < BigInt(fromBlock)) {
        throw new ReportError('Supply an inclusive ascending block interval using nonnegative PostgreSQL bigint values.');
    }
    const coreAddress = core.toLowerCase();
    const { rows } = await client.query(sql, [Number(chain), coreAddress, fromBlock, toBlock]);
    const { registered, filtered, ...totals } = rows[0];
    if (filtered) throw new ReportError('Row security filters this reporting session. Use the authorized private indexer reader.');
    return { chainId: Number(chain), coreAddress, fromBlock, toBlock, issuerRegistered: registered,
        coverage: 'indexed_receipts_only', totals: registered ? totals : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let pool;
    try {
        const args = process.argv.slice(2);
        if (args.length !== 4) throw new ReportError('Usage: node scripts/report-ordinary-demand.mjs CHAIN_ID CORE_ADDRESS FIRST_BLOCK LAST_BLOCK');
        const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
        if (!connectionString) throw new ReportError('Set ARTSOUL_ORDINARY_DATABASE_URL for the private indexer reader.');
        pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
        console.log(JSON.stringify(await reportOrdinaryDemand(pool, ...args), null, 2));
    } catch (error) {
        console.error(error instanceof ReportError ? error.message : 'Could not read the ordinary sales evidence. Check database access and migrations 018, 020 and 023.');
        process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}
