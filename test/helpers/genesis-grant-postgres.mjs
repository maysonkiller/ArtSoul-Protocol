import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { id, keccak256 } from 'ethers';
import { ingestGenesisGrants } from '../../scripts/index-genesis-grants.mjs';
import { readGenesisHolder } from '../../scripts/read-genesis-holder.mjs';
import { block, founder, mainnetCollector, provider, review, tx } from './genesis-grant-rpc.mjs';

export async function checkMinedGenesisGrant(pool, safeArchive) {
    const script = fileURLToPath(new URL('../../scripts/rehearse-safe-marketplace-admission.cjs', import.meta.url));
    const output = execFileSync(process.execPath, [script, safeArchive, '--genesis-evidence'], {
        encoding: 'utf8', timeout: 120000, windowsHide: true
    });
    const evidence = JSON.parse(output);
    const issuer = evidence.review;
    const { hash, observations } = evidence;
    const save = reads => ingestGenesisGrants(pool, issuer, hash, reads.map(node => async (method, params) => {
        const key = JSON.stringify([method, params]);
        assert.ok(Object.hasOwn(node, key), 'The receipt check must use an observed RPC response: ' + method);
        return structuredClone(node[key]);
    }));
    const read = async () => (await readGenesisHolder(pool, issuer, issuer.founder)).evidence;

    const changed = structuredClone(observations);
    const receiptKey = JSON.stringify(['eth_getTransactionReceipt', [hash]]);
    const grantedTopic = id('GenesisGranted(uint256,address,uint8,bytes32)');
    const grant = changed[1][receiptKey].logs.find(log => log.topics[0] === grantedTopic);
    grant.data = id('different local grant decision');
    await assert.rejects(save(changed), /Different GenesisGranted data/);
    assert.equal(await read(), null);
    assert.equal((await save(observations)).inserted, true);
    assert.equal((await save(observations)).inserted, false);
    const persisted = await read();
    assert.equal(persisted.token_id, 0);
    assert.equal(persisted.transaction_hash, hash);
    assert.equal(persisted.block_hash, evidence.block.hash);
    assert.equal(BigInt(persisted.grant_index), BigInt(grant.logIndex));
    const counts = await pool.query(`SELECT
        (SELECT count(*)::int FROM artsoul_private.genesis_grant_batches WHERE genesis_address=$1) AS batches,
        (SELECT count(*)::int FROM artsoul_private.genesis_grants WHERE genesis_address=$1) AS grants`, [issuer.genesis.toLowerCase()]);
    assert.deepEqual(counts.rows[0], { batches: 1, grants: 1 });
}

// The caller supplies a newly created isolated PostgreSQL cluster with migration 021.
export async function checkGenesisGrantIntake(pool) {
    const save = (reviewed = review, hash = tx, header = block, overrides = {}) => ingestGenesisGrants(pool, reviewed, hash,
        [provider(overrides, reviewed, hash, header), provider(overrides, reviewed, hash, header)]);
    const lookup = (issuer, wallet) => readGenesisHolder(pool, issuer, wallet);
    await assert.rejects(ingestGenesisGrants({ connect: () => assert.fail('Unexpected database connection') }, review, tx,
        [provider(), provider({ reorg: true })]), /Providers disagree on the finalized block/);
    assert.deepEqual((await Promise.all([save(), save()])).map(row => row.inserted).sort(), [false, true]);
    assert.equal((await save()).inserted, false);

    const founderEvidence = (await lookup(review, founder)).evidence;
    assert.equal(founderEvidence.token_id, 0);
    assert.equal(founderEvidence.transaction_hash, tx);
    assert.equal(founderEvidence.block_hash, block.hash);
    assert.equal(founderEvidence.grant_index, '11');
    assert.equal((await lookup(review, mainnetCollector)).evidence.token_id, 201);
    assert.equal((await lookup(review, review.safe)).evidence, null);
    assert.equal((await readGenesisHolder(null, undefined, founder)).evidence, null);
    await assert.rejects(lookup({ ...review, chainId: 84532 }, founder), /Base mainnet/);
    for (const other of [{ genesis: founder }, { safe: founder }, { founder: review.safe }, { genesisCodeHash: id('other') }]) {
        assert.equal((await lookup({ ...review, ...other }, founder)).evidence, null);
    }

    const changed = { ...review, grants: review.grants.slice(1) };
    await assert.rejects(save(changed), /Conflicting finalized evidence in genesis_grant_batches/);
    await assert.rejects(save({ ...review, genesisCodeHash: keccak256('0x6278') }, tx, block, { code: '0x6278' }),
        /Conflicting finalized evidence in genesis_issuers/);

    const hash = id('second grant batch');
    const header = { number: '0x21', hash: id('second block'), transactions: [id('other transaction'), hash] };
    const otherCollector = '0x' + '88'.repeat(20);
    const collision = { ...review, grants: [
        { ...review.grants[1], tokenId: 202, recipient: otherCollector },
        { ...review.grants[1], recipient: otherCollector }
    ] };
    await assert.rejects(save(collision, hash, header, { head: header }), /Conflicting finalized evidence in genesis_grants/);
    assert.equal((await lookup(review, otherCollector)).evidence, null);
    const otherIssuer = { ...collision, genesis: '0x' + '77'.repeat(20) };
    assert.equal((await save(otherIssuer, hash, header, { head: header })).inserted, true);
    assert.equal((await lookup(otherIssuer, otherCollector)).evidence.token_id, 201);
    assert.equal((await lookup(review, otherCollector)).evidence, null);

    const counts = await pool.query(`SELECT (SELECT count(*) FROM artsoul_private.genesis_issuers) AS issuers,
        (SELECT count(*) FROM artsoul_private.genesis_grant_batches) AS batches,
        (SELECT count(*) FROM artsoul_private.genesis_grants) AS grants`);
    assert.deepEqual(counts.rows[0], { issuers: '2', batches: '2', grants: '4' });
    const tables = ['genesis_issuers', 'genesis_grant_batches', 'genesis_grants'];
    for (const table of tables) {
        await pool.query(`GRANT SELECT ON artsoul_private.${table} TO PUBLIC;
            GRANT UPDATE ON artsoul_private.${table} TO anon, authenticated, service_role`);
    }
    await pool.query(await readFile(new URL('../../src/indexer/migrations/021_genesis_grant_evidence.sql', import.meta.url), 'utf8'));
    await pool.query('CREATE ROLE genesis_fixture_reader; GRANT USAGE ON SCHEMA artsoul_private TO genesis_fixture_reader');
    for (const table of tables) {
        const name = 'artsoul_private.' + table;
        const access = await pool.query(`SELECT c.relrowsecurity, r.rolname,
            has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed
            FROM pg_class c CROSS JOIN pg_roles r WHERE c.oid = $1::regclass
            AND r.rolname IN ('anon', 'authenticated', 'service_role')`, [name]);
        assert.equal(access.rowCount, 3);
        assert.ok(access.rows.every(role => role.relrowsecurity && !role.allowed));
        await assert.rejects(pool.query(`UPDATE ${name} SET chain_id = chain_id`), /append-only/);
        await assert.rejects(pool.query(`DELETE FROM ${name}`), /append-only/);
        await pool.query(`GRANT SELECT ON ${name} TO genesis_fixture_reader;
            CREATE POLICY fixture_read ON ${name} FOR SELECT TO genesis_fixture_reader USING (true)`);
    }
    await assert.rejects(pool.query('TRUNCATE artsoul_private.genesis_grants'), /append-only/);
    const reader = await pool.connect();
    try {
        await reader.query('BEGIN READ ONLY; SET LOCAL ROLE genesis_fixture_reader');
        assert.deepEqual((await readGenesisHolder(reader, review, founder)).evidence, founderEvidence);
        assert.equal((await reader.query("SELECT has_table_privilege(current_user, 'artsoul_private.genesis_grants', 'INSERT') AS allowed")).rows[0].allowed, false);
    } finally {
        await reader.query('ROLLBACK');
        reader.release();
    }
}
