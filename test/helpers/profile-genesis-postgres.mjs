import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { review, founder, mainnetCollector } from './genesis-grant-rpc.mjs';

// The surrounding isolated rehearsal has already recorded the reviewed founder and serial 201.
export async function checkProfileGenesis(pool) {
    await pool.query(await readFile(new URL('../../sql/migrations/20261125220000_profile_genesis_serial.sql', import.meta.url), 'utf8'));
    const client = await pool.connect();
    const signature = 'public.read_profile_genesis_serial(text,text,text,text,text)';
    const lookup = async (wallet, issuer = review) => (await client.query(
        'SELECT public.read_profile_genesis_serial($1,$2,$3,$4,$5) AS serial',
        [issuer.genesis, issuer.genesisCodeHash, issuer.safe, issuer.founder, wallet])).rows[0].serial;
    const cursor = (chain, confirmed) => client.query(`INSERT INTO public.indexer_state
        (chain_id,contract_address,last_indexed_block,last_confirmed_block,started_at,last_indexed_at,status)
        VALUES ($1,$2,100,$3,now(),now(),'running')`, [chain, review.genesis, confirmed]);
    try {
        await client.query('BEGIN');
        for (const [role, allowed] of [['anon',false],['authenticated',false],['service_role',true]]) {
            assert.equal((await client.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS yes',
                [role, signature])).rows[0].yes, allowed);
            assert.equal((await client.query("SELECT has_table_privilege($1,'artsoul_private.genesis_grants','SELECT') AS yes", [role])).rows[0].yes, false);
        }
        assert.equal(await lookup(founder), null);
        await cursor(84532, 100); assert.equal(await lookup(founder), null);
        await cursor(8453, 100); assert.equal(await lookup(founder), null);
        await client.query('DELETE FROM public.indexer_state WHERE chain_id=84532');
        await client.query('UPDATE public.indexer_state SET last_confirmed_block=31 WHERE chain_id=8453');
        assert.equal(await lookup(founder), null);
        await client.query('UPDATE public.indexer_state SET last_confirmed_block=32 WHERE chain_id=8453');
        await client.query('SET LOCAL ROLE service_role');
        assert.equal(await lookup(founder), 0);
        assert.equal(await lookup(mainnetCollector), 201);
        assert.equal(await lookup(review.safe), null);
        for (const other of [{ genesis: founder }, { safe: founder }, { founder: review.safe }, { genesisCodeHash: '0x' + 'a'.repeat(64) }]) {
            assert.equal(await lookup(founder, { ...review, ...other }), null);
        }
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
}
