import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { review, founder, mainnetCollector } from './genesis-grant-rpc.mjs';

// The surrounding isolated rehearsal has already recorded the reviewed founder and serial 201.
export async function checkProfileGenesis(pool) {
    await pool.query(await readFile(new URL('../../sql/migrations/20261125220000_profile_genesis_serial.sql', import.meta.url), 'utf8'));
    for (const file of ['20261125170000_aura_border_setting.sql', '20261125223000_wallet_genesis_frames.sql']) {
        await pool.query(await readFile(new URL('../../sql/migrations/' + file, import.meta.url), 'utf8'));
    }
    const client = await pool.connect();
    const signature = 'public.read_profile_genesis_serial(text,text,text,text,text)';
    const lookup = async (wallet, issuer = review) => (await client.query(
        'SELECT public.read_profile_genesis_serial($1,$2,$3,$4,$5) AS serial',
        [issuer.genesis, issuer.genesisCodeHash, issuer.safe, issuer.founder, wallet])).rows[0].serial;
    const frames = async (wallet, ids, genesis = review.genesis) => (await client.query(
        'SELECT * FROM public.read_wallet_genesis_frames($1,$2,$3,$4,$5,$6)',
        [genesis, review.genesisCodeHash, review.safe, review.founder, wallet, ids])).rows;
    const cursor = (chain, confirmed) => client.query(`INSERT INTO public.indexer_state
        (chain_id,contract_address,last_indexed_block,last_confirmed_block,started_at,last_indexed_at,status)
        VALUES ($1,$2,100,$3,now(),now(),'running')`, [chain, review.genesis, confirmed]);
    try {
        await client.query('BEGIN');
        for (const [role, allowed] of [['anon',false],['authenticated',false],['service_role',true]]) {
            assert.equal((await client.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS yes',
                [role, signature])).rows[0].yes, allowed);
            assert.equal((await client.query("SELECT has_table_privilege($1,'artsoul_private.genesis_grants','SELECT') AS yes", [role])).rows[0].yes, false);
            assert.equal((await client.query("SELECT has_function_privilege($1,'public.read_wallet_genesis_frames(text,text,text,text,text,smallint[])','EXECUTE') AS yes",
                [role])).rows[0].yes, allowed);
            assert.equal((await client.query("SELECT has_table_privilege($1,'artsoul_private.finalized_genesis_serials','SELECT') AS yes",
                [role])).rows[0].yes, false);
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
        assert.deepEqual(await frames(founder, [201, 0]), [{token_id:0, border_text:false}]);
        assert.deepEqual(await frames(review.safe, [0, 201]), []);
        assert.deepEqual(await frames(founder, Array(13).fill(0)), []);
        assert.equal(await lookup(mainnetCollector), 201);
        assert.equal(await lookup(review.safe), null);
        for (const other of [{ genesis: founder }, { safe: founder }, { founder: review.safe }, { genesisCodeHash: '0x' + 'a'.repeat(64) }]) {
            assert.equal(await lookup(founder, { ...review, ...other }), null);
        }
        const secondIssuer = '0x' + '77'.repeat(20), secondHolder = '0x' + '88'.repeat(20);
        assert.deepEqual(await frames(secondHolder, [201,202], secondIssuer), []);
        await client.query('RESET ROLE');
        await client.query('UPDATE public.indexer_state SET last_confirmed_block=33 WHERE chain_id=8453');
        await client.query('INSERT INTO artsoul_private.aura_border_history(revision, enabled, actor_wallet, authorization_version) VALUES(1,true,$1,1)', [founder]);
        await client.query('SET LOCAL ROLE service_role');
        assert.deepEqual(await frames(secondHolder, [201,202], secondIssuer),
            [{token_id:201, border_text:true}, {token_id:202, border_text:true}]);
        assert.deepEqual(await frames(secondHolder, [201,202]), []);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
}
