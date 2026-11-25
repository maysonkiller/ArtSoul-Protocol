import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { reportOrdinaryDemand } from '../../scripts/report-ordinary-demand.mjs';

const address = n => '0x' + n.toString(16).padStart(40, '0');
const hash = n => '0x' + n.toString(16).padStart(64, '0');

export async function checkOrdinaryDemand(pool) {
    const client = await pool.connect();
    const core = address(401), other = address(402), alice = address(410), bob = address(411), cara = address(412);
    const report = (first, last, issuer = core, chain = '8453') => reportOrdinaryDemand(client, chain, issuer, first, last);
    let log = 0;
    async function primary(chain, issuer, token, buyer, height, price) {
        await client.query(`INSERT INTO artsoul_private.ordinary_settlements
            (chain_id,core_address,auction_id,artwork_id,token_id,price_wei,creator,first_collector,runner_up_accepted,
            transaction_hash,block_number,block_hash,log_index) VALUES ($1,$2,$3,$3,$3,$4,$5,$6,false,$7,$8,$9,$10)`,
        [chain, issuer, token, price.toString(), address(415), buyer, hash(++log), height, hash(height), log]);
    }
    async function resale(chain, issuer, version, seller, buyer, height, [sellerWei, creatorWei, protocolWei, ecosystemWei]) {
        await client.query(`INSERT INTO artsoul_private.ordinary_resale_purchases
            (chain_id,core_address,token_id,listing_version,artwork_id,price_wei,seller,buyer,creator,first_collector,
            protocol_treasury,ecosystem_treasury,seller_wei,creator_wei,protocol_wei,ecosystem_wei,transaction_hash,block_number,block_hash,log_index)
            VALUES ($1,$2,1,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [chain, issuer, version, sellerWei + creatorWei + protocolWei + ecosystemWei, seller, buyer, address(415), alice,
            address(416), address(417), sellerWei, creatorWei, protocolWei, ecosystemWei, hash(++log), height, hash(height), log]);
    }
    try {
        await client.query('BEGIN');
        for (const [chain, issuer, nft] of [[8453, core, 403], [8453, other, 404], [84532, core, 403]]) {
            await client.query(`INSERT INTO artsoul_private.ordinary_issuers
                (chain_id,core_address,nft_address,core_code_hash,nft_code_hash) VALUES ($1,$2,$3,$4,$5)`,
            [chain, issuer, address(nft), hash(551), hash(552)]);
        }
        const large = 900719925474099312345n;
        await primary(8453, core, 1, alice, 100, large);
        await primary(8453, core, 2, cara, 101, 7n);
        await resale(8453, core, 1, alice, bob, 102, [93, 6, 1, 1]);
        await resale(8453, core, 2, bob, alice, 103, [139, 8, 2, 1]);
        await resale(8453, core, 3, alice, bob, 105, [45, 3, 1, 0]);
        await primary(8453, core, 3, cara, 99, large);
        await resale(8453, core, 4, bob, cara, 106, [93, 6, 1, 1]);
        for (const [chain, issuer] of [[8453, other], [84532, core]]) {
            await primary(chain, issuer, 1, alice, 100, large);
            await resale(chain, issuer, 1, alice, bob, 102, [93, 6, 1, 1]);
        }
        assert.deepEqual(await report('100', '105'), {
            chainId: 8453, coreAddress: core, fromBlock: '100', toBlock: '105', issuerRegistered: true,
            coverage: 'indexed_receipts_only', totals: { paying_wallets: '3', repeat_paying_wallets: '2', primary_sales: '2', resales: '3',
                primary_volume_wei: (large + 7n).toString(), resale_volume_wei: '300', total_volume_wei: (large + 307n).toString(),
                resale_protocol_credit_wei: '4', resale_ecosystem_credit_wei: '2' }
        });
        const single = (await report('105', '105')).totals;
        assert.equal(single.resales, '1');
        assert.equal(single.paying_wallets, '1');
        assert.equal(single.repeat_paying_wallets, '0');
        assert.equal(single.resale_protocol_credit_wei, '1');
        assert.equal(single.resale_ecosystem_credit_wei, '0');
        const empty = await report('107', '108');
        assert.equal(empty.issuerRegistered, true);
        assert.ok(Object.values(empty.totals).every(value => value === '0'));
        const unknown = await report('107', '108', address(418));
        assert.equal(unknown.issuerRegistered, false);
        assert.equal(unknown.totals, null);
        const command = await promisify(execFile)(process.execPath,
            ['scripts/report-ordinary-demand.mjs', '8453', address(418), '107', '108'], {
                env: { ...process.env, ARTSOUL_ORDINARY_DATABASE_URL: `postgresql://postgres@127.0.0.1:${pool.options.port}/postgres` },
                timeout: 15000
            });
        assert.deepEqual(JSON.parse(command.stdout), unknown);
        for (const [low, high] of [['-1','3'], ['6','5'], ['1.2','3'], ['0','9223372036854775808']]) {
            await assert.rejects(report(low, high), /block interval/);
        }
        await assert.rejects(report('0', '1', core, '1'), /Choose Base/);
        await assert.rejects(report('0', '1', address(0)), /Core address/);
        await client.query('CREATE ROLE demand_report_fixture_reader; GRANT USAGE ON SCHEMA artsoul_private TO demand_report_fixture_reader; GRANT SELECT ON ALL TABLES IN SCHEMA artsoul_private TO demand_report_fixture_reader');
        await client.query('SET LOCAL ROLE demand_report_fixture_reader');
        await assert.rejects(report('100','105'), /Row security/);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
}
