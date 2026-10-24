// Disposable PostgreSQL only. Never reads DATABASE_URL or a project credential.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';

const container = `artsoul-saved-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const A=`0x${'1'.repeat(40)}`, B=`0x${'2'.repeat(40)}`, CORE=`0x${'3'.repeat(40)}`, OLD=`0x${'4'.repeat(40)}`;
const migration=fs.readFileSync('sql/migrations/saved_artworks.sql','utf8');
function docker(...args) {return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();}
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}

test('Saved migration explicitly protects the private table and is included in the no-default-grant rehearsal',()=>{
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(migration,/PRIMARY KEY \(wallet_address, chain_id, core_address, artwork_id\)/);
  assert.match(migration,/REVOKE ALL ON public.saved_artworks FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration,/REVOKE ALL ON SEQUENCE public.saved_artworks_id_seq/);
  assert.match(migration,/GRANT USAGE, SELECT ON SEQUENCE public.saved_artworks_id_seq TO service_role/);
  assert.match(fs.readFileSync('test/data-api-grants-integration.test.cjs','utf8'),/'saved_artworks'/);
});

test('Saved persistence is private, deployment-scoped and idempotent in PostgreSQL',{
  skip:available?false:'Disposable PostgreSQL requires Docker'
},async t=>{
  let created=false,pool;
  t.after(async()=>{if(pool)await pool.end();if(created)docker('rm','-f',container);});
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-saved-fixture','-e','POSTGRES_DB=artsoul',
    '-p','127.0.0.1::5432','postgres:17');created=true;
  const endpoint=docker('port',container,'5432/tcp');assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool=new pg.Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',
    password:'local-saved-fixture',connectionTimeoutMillis:1000});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){try{await pool.query('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
  assert.ok(ready,'disposable PostgreSQL starts');
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;`);
  await pool.query(migration);
  const client=await pool.connect();
  try{
    await t.test('client roles cannot enumerate or mutate saves or use the sequence',async()=>{
      for(const role of ['anon','authenticated']){
        await client.query(`SET ROLE ${role}`);
        await assert.rejects(client.query('SELECT * FROM saved_artworks'),{code:'42501'});
        await assert.rejects(client.query('DELETE FROM saved_artworks'),{code:'42501'});
        await assert.rejects(client.query("SELECT nextval('saved_artworks_id_seq')"),{code:'42501'});
        await client.query('RESET ROLE');
      }
      const flags=(await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.saved_artworks'::regclass")).rows[0];
      assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true});
    });
    const add=`INSERT INTO saved_artworks(wallet_address,chain_id,core_address,artwork_id) VALUES($1,$2,$3,$4)
      ON CONFLICT(wallet_address,chain_id,core_address,artwork_id) DO NOTHING RETURNING id::text,created_at`;
    await client.query('SET ROLE service_role');
    await t.test('duplicate adds preserve the original ordering and timestamp, with exact protocol IDs',async()=>{
      const first=(await client.query(add,[A,84532,CORE,'7'])).rows[0];
      const second=await client.query(add,[A,84532,CORE,'7']);assert.equal(second.rowCount,0);
      const existing=(await client.query('SELECT id::text,created_at FROM saved_artworks WHERE wallet_address=$1',[A])).rows[0];
      assert.deepEqual(existing,first);
      const maxId=String(2n**256n-1n);await client.query(add,[A,84532,CORE,maxId]);
      assert.equal((await client.query('SELECT artwork_id::text FROM saved_artworks WHERE artwork_id=$1',[maxId])).rows[0].artwork_id,maxId);
    });
    await t.test('wallet, chain and registry disambiguate the same artwork number',async()=>{
      await client.query(add,[B,84532,CORE,'7']);await client.query(add,[A,84532,OLD,'7']);await client.query(add,[A,11155111,CORE,'7']);
      const rows=(await client.query("SELECT wallet_address,chain_id::text,core_address FROM saved_artworks WHERE artwork_id=7")).rows;
      assert.equal(rows.length,4);
      assert.equal(rows.filter(row=>row.wallet_address===B).length,1);
    });
    await t.test('deletion is scoped, repeatable and does not destroy another wallet or deployment',async()=>{
      const remove='DELETE FROM saved_artworks WHERE wallet_address=$1 AND chain_id=$2 AND core_address=$3 AND artwork_id=$4';
      assert.equal((await client.query(remove,[A,84532,OLD,'7'])).rowCount,1);
      assert.equal((await client.query(remove,[A,84532,OLD,'7'])).rowCount,0);
      assert.equal((await client.query("SELECT count(*)::int AS total FROM saved_artworks WHERE artwork_id=7")).rows[0].total,3);
    });
    await t.test('database constraints reject invalid identities independently of JavaScript',async()=>{
      for(const params of [[A,0,CORE,'7'],[A,84532,'0x'+'0'.repeat(40),'7'],[A,84532,CORE,'0'],
        [A,84532,CORE,String(2n**256n)],['not-a-wallet',84532,CORE,'7']]){
        await assert.rejects(client.query(add,params),{code:'23514'});
      }
    });
    await client.query('RESET ROLE');
    await t.test('concurrent duplicate requests create one row and migration reapplication preserves data',async()=>{
      const attempts=await Promise.all([pool.query(add,[B,84532,CORE,'18']),pool.query(add,[B,84532,CORE,'18'])]);
      assert.equal(attempts.reduce((total,result)=>total+result.rowCount,0),1);
      const before=(await pool.query('SELECT count(*)::int AS total FROM saved_artworks')).rows[0].total;
      await pool.query(migration);
      assert.equal((await pool.query('SELECT count(*)::int AS total FROM saved_artworks')).rows[0].total,before);
    });
  }finally{await client.query('RESET ROLE');client.release();}
});
