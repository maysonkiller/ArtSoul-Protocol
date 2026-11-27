import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { reportOrdinaryDemand } from '../../scripts/report-ordinary-demand.mjs';
import { syncOrdinaryHistory } from '../../scripts/sync-ordinary-history.mjs';
import { readReviewedOrdinaryPair } from '../../scripts/read-reviewed-ordinary-pair.mjs';
import { sequencedRead } from '../../scripts/serve-rehearsal-review.mjs';

// Invoked only inside the integration test's own newly created loopback cluster.
export async function checkPublicMintRestore(admin, bin, directory) {
    assert.equal(admin.options.host, '127.0.0.1');
    const databases = ['ordinary_primary_source','ordinary_primary_restore'];
    const pools = [];
    const archive = join(directory, 'ordinary-primary.dump');
    const header = await readFile('docs/testnet/ordinary-auction-1-settlement.json', 'utf8');
    const record = JSON.parse(header), pair = await readReviewedOrdinaryPair('docs/testnet/ordinary-auction-1-settlement.json');
    const origin = { fromBlock: record.blockNumber, previousBlockHash: record.mintBlockEvidence.previousBlockHash };
    const providers = ['https://sepolia.base.org','https://base-sepolia-rpc.publicnode.com'].map(sequencedRead);
    const sync = pool => syncOrdinaryHistory({ pool, pair, origin, providers, maxBlocks: 1 });
    const params = ['-h','127.0.0.1','-p',String(admin.options.port),'-U',admin.options.user,'--no-password'];
    const pgCmd = (cmd, args) => promisify(execFile)(join(bin, cmd + (process.platform === 'win32' ? '.exe' : '')),
        [...params, ...args], { windowsHide: true, timeout: 30000 });
    const tables = ['ordinary_issuers','ordinary_settlements','ordinary_primary_credits','ordinary_nft_ranges','ordinary_nft_transfers','ordinary_resale_purchases'];
    try {
        for (const database of databases) {
            await admin.query('CREATE DATABASE ' + database);
            const pool = new pg.Pool({ host: admin.options.host, port: admin.options.port, user: admin.options.user,
                database, max: 1, connectionTimeoutMillis: 5000 });
            pools.push(pool);
            for (const name of ['018_ordinary_settlement_evidence','020_ordinary_resale_purchases','023_ordinary_primary_credits','024_ordinary_nft_history']) {
                await pool.query(await readFile('src/indexer/migrations/' + name + '.sql','utf8'));
            }
        }
        const [source, restored] = pools;
        const first = await sync(source);
        assert.equal(first.transfers, 1);
        assert.equal(first.primarySales, 1);
        assert.equal(first.blockHash, record.blockHash);
        const [sale] = (await source.query('SELECT transaction_hash FROM artsoul_private.ordinary_settlements')).rows;
        assert.equal(sale.transaction_hash, record.transactionHash);
        const tablesArg = tables.flatMap(table => ['--table','artsoul_private.' + table]);
        await pgCmd('pg_dump', ['--format=custom','--data-only','--file',archive,...tablesArg,databases[0]]);
        await pgCmd('pg_restore', ['--exit-on-error','--single-transaction','--dbname',databases[1],archive]);
        for (const table of tables) {
            const query = 'SELECT * FROM artsoul_private.' + table;
            const original = (await source.query(query)).rows;
            assert.equal(original.length, table === 'ordinary_resale_purchases' ? 0 : 1);
            assert.deepEqual((await restored.query(query)).rows, original);
        }
        const resumed = await sync(restored);
        assert.equal(resumed.fromBlock, record.blockNumber + 1);
        assert.equal(resumed.primarySales, 0);
        const report = await reportOrdinaryDemand(restored,'84532',pair.coreAddress,String(record.blockNumber),
            String(resumed.throughBlock), { marketCoverage: true });
        assert.equal(report.primaryCoverage,'finalized_mints_and_credits');
        assert.equal(report.coreResaleCoverage,'finalized_core_purchases_and_credits');
        assert.equal(report.totals.resales,'0');
        assert.equal(report.totals.primary_sales,'1');
        assert.equal(report.totals.primary_volume_wei,'1000000000000000');
        assert.equal(report.totals.primary_protocol_credit_wei,'25000000000000');
        return { first, resumed, archivedTables: tables.length, revenueWei: report.totals.primary_protocol_credit_wei };
    } finally {
        await Promise.all(pools.map(pool => pool.end()));
        await unlink(archive).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
}
