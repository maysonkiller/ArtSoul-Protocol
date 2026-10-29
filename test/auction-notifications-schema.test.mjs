// Disposable PostgreSQL and synthetic logs only; no live credentials or RPCs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import {listIndexerMigrations} from '../scripts/apply-migrations.js';

const A=`0x${'1'.repeat(40)}`,B=`0x${'2'.repeat(40)}`,C=`0x${'3'.repeat(40)}`,CORE=`0x${'4'.repeat(40)}`,OLD=`0x${'5'.repeat(40)}`;
const sql=fs.readFileSync('sql/migrations/auction_notifications.sql','utf8');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('auction inbox proves source, recipient, confirmation and durable private state in PostgreSQL',{
  skip:available?false:'Disposable PostgreSQL requires Docker',timeout:90000
},async t=>{
  const container=`artsoul-inbox-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let created=false,pool;const priorRedis=process.env.REDIS_URL;process.env.REDIS_URL='';
  t.after(async()=>{await pool?.end();if(created)docker('rm','-f',container);
    if(priorRedis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=priorRedis;});
  t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});t.mock.method(console,'error',()=>{});
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-inbox-fixture','-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');created=true;
  const endpoint=docker('port',container,'5432/tcp');assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool=new pg.Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',password:'local-inbox-fixture',connectionTimeoutMillis:1000});
  for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');await delay(100);await pool.query('SELECT 1');break;}catch(error){if(attempt>=80)throw error;await delay(250);}}
  await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  for(const migration of listIndexerMigrations())await pool.query(migration.sql);
  await pool.query(fs.readFileSync(new URL('./fixtures/indexer-legacy-notification-writer.sql',import.meta.url),'utf8'));
  await pool.query(`INSERT INTO distributed_locks(lock_name,instance_id,fencing_token,expires_at)
    VALUES('notification-fixture','worker-fixture',1,clock_timestamp()+interval '1 hour')`);
  await pool.query(`CREATE TABLE artwork_moderation_visibility(chain_id NUMERIC,artwork_id NUMERIC,hidden BOOLEAN);
    CREATE TABLE artwork_media_chain_revisions(chain_id NUMERIC PRIMARY KEY,revision NUMERIC(78,0) NOT NULL);
    INSERT INTO artwork_media_chain_revisions VALUES(84532,0);
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;`);
  await pool.query(sql);
  await pool.query('INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,last_indexed_at,started_at) VALUES(84532,$1,1000,1000,now(),now())',[CORE]);
  const {default:Engine}=await import('../src/indexer/sync-engine.js');
  const engine=new Engine({pool,query:async(q,p)=>(await pool.query(q,p)).rows},{chainId:84532,contractAddress:CORE,donationAddress:OLD});
  engine.getRecoveryAuthority=()=>({lockName:'notification-fixture',instanceId:'worker-fixture',fencingToken:'1',isCurrent:()=>true});
  let block=100;
  const hash=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
  async function event(name,data,source=CORE){
    const context=await engine._captureWriteContext();
    const n=++block,tx=hash(n);
    await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES(84532,$1,$2,$3,$4)',[n,hash(n+1000),hash(n+999),1700000000+n]);
    const value={eventName:name,eventData:data,blockNumber:n,logIndex:0,transactionHash:tx,timestamp:(1700000000+n)*1000};
    if(source!==null)value.contractAddress=source;
    await engine._processEvent(value,context);return {block:n,tx};
  }
  const register=(id,source=CORE)=>event('ArtworkRegistered',{artworkId:String(id),creator:A,metadataURI:'ipfs://fixture'},source);
  const auction=(id,artwork=id,source=CORE)=>event('AuctionCreated',{auctionId:String(id),artworkId:String(artwork),creator:A,startPrice:'1000',duration:'86400',endTime:'2000000000',chainId:'84532'},source);
  const bid=(id,bidder,source=CORE)=>event('BidPlaced',{auctionId:String(id),bidder,bidAmount:'2000',depositAmount:'1000'},source);
  const read=async(wallet=A,before=null,core=CORE)=>(await pool.query('SELECT read_auction_notifications($1,$2,$3) result',[wallet,core,before])).rows[0].result;
  const mark=async(wallet,ids,value)=>(await pool.query('SELECT mark_auction_notifications($1,$2,$3,$4) result',[wallet,CORE,ids,value])).rows[0].result;
  const prefs=async(wallet,revision,created=true,outbid=true)=>(await pool.query('SELECT save_auction_notification_preferences($1,$2,$3,$4,$5) result',[wallet,CORE,revision,created,outbid])).rows[0].result;
  const ids=async()=> (await pool.query("SELECT id::TEXT,payload->>'type' type FROM outbox_events WHERE event_type='notification' ORDER BY id")).rows;

  await t.test('the same-snapshot chain revision is exact and missing rollback bookkeeping fails closed',async()=>{
    assert.equal((await read()).chainRevision,'0');
    await pool.query('UPDATE artwork_media_chain_revisions SET revision=9007199254740993');
    assert.equal((await read()).chainRevision,'9007199254740993');
    await pool.query('DELETE FROM artwork_media_chain_revisions');
    await assert.rejects(read(),{code:'55000'});
    await pool.query('INSERT INTO artwork_media_chain_revisions VALUES(84532,0)');
  });

  await t.test('actual handler stamps only supplied matching log addresses; legacy rows remain unknown and wrong sources fail before projection',async()=>{
    await register(1);await auction(1);await bid(1,B);await bid(1,C);
    const rows=(await pool.query('SELECT contract_address FROM contract_events ORDER BY id')).rows;
    assert.ok(rows.every(row=>row.contract_address===CORE));
    await register(2,null);await auction(2,2,null);
    assert.equal((await pool.query("SELECT contract_address FROM contract_events WHERE event_name='AuctionCreated' AND event_data->>'auctionId'='2'")).rows[0].contract_address,null);
    await assert.rejects(register(3,OLD),/source does not match/);
    assert.equal((await pool.query('SELECT count(*)::INT n FROM v41_artworks WHERE artwork_id=3')).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::INT n FROM contract_events WHERE event_data->>'artworkId'='3'")).rows[0].n,0);
    assert.deepEqual((await read()).items.map(row=>[row.type,row.artwork_id]),[['auction_created','1']]);
    assert.deepEqual((await read(B)).items.map(row=>row.type),['outbid']);
    assert.equal((await read(C)).items.length,0);
  });
  await t.test('foreign recipients, unsupported payloads, another Core and unconfirmed or failed-registry events never enter the feed',async()=>{
    const outbid=(await ids()).find(row=>row.type==='outbid').id;
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)) WHERE id=$2",[A,outbid]);
    assert.equal((await read(A)).items.some(row=>row.type==='outbid'),false);
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)) WHERE id=$2",[B,outbid]);
    await pool.query("UPDATE contract_events SET contract_address=$1 WHERE event_name='AuctionCreated' AND event_data->>'auctionId'='1'",[OLD]);
    assert.equal((await read(A)).items.length,0);assert.equal((await read(B)).items.length,0);
    await pool.query("UPDATE contract_events SET contract_address=$1 WHERE event_name='AuctionCreated' AND event_data->>'auctionId'='1'",[CORE]);
    await pool.query('UPDATE indexer_state SET last_confirmed_block=101 WHERE chain_id=84532');assert.equal((await read(A)).items.length,0);
    await pool.query('UPDATE indexer_state SET last_confirmed_block=1000 WHERE chain_id=84532');
    await pool.query("UPDATE event_processing_registry SET processing_status='failed' WHERE event_name='BidPlaced'");assert.equal((await read(B)).items.length,0);
    await pool.query("UPDATE event_processing_registry SET processing_status='completed' WHERE event_name='BidPlaced'");
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{type}','\"test_notification\"') WHERE id=$1",[outbid]);assert.equal((await read(B)).items.length,0);
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{type}','\"outbid\"') WHERE id=$1",[outbid]);
    await assert.rejects(read(A,null,OLD),{code:'55000'});
  });
  await t.test('an unknown or foreign immediate prior bid cannot be skipped to invent a recipient from an older proven bid',async()=>{
    await register(4);await auction(4);await bid(4,B);await bid(4,C,null);await bid(4,A);
    const latest=(await pool.query("SELECT id::TEXT FROM outbox_events WHERE payload->>'auctionId'='4' ORDER BY id DESC LIMIT 1")).rows[0].id;
    assert.equal((await read(C)).items.some(row=>row.id===latest),false);
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)) WHERE id=$2",[B,latest]);
    assert.equal((await read(B)).items.some(row=>row.id===latest),false);
  });
  await t.test('read state is recipient-bound, atomic for mixed IDs, reversible and removed with a reorg',async()=>{
    const own=(await read(A)).items[0].id,other=(await read(B)).items[0].id;
    assert.deepEqual(await mark(A,[own,other],true),{updated:false});
    assert.equal((await read(A)).items.find(row=>row.id===own).read,false);
    assert.deepEqual(await mark(A,[own],true),{updated:true,ids:[own],read:true});
    assert.equal((await read(A)).items.find(row=>row.id===own).read,true);
    await mark(A,[own],false);assert.equal((await read(A)).items.find(row=>row.id===own).read,false);
    await assert.rejects(mark(A,[own,own],true),{code:'22023'});
    const source=(await pool.query('SELECT correlation_id FROM outbox_events WHERE id=$1',[own])).rows[0].correlation_id;
    const n=(await pool.query("SELECT block_number FROM contract_events WHERE '84532-'||transaction_hash||'-'||log_index::TEXT=$1",[source])).rows[0].block_number;
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[n]);
    assert.equal((await read(A)).items.some(row=>row.id===own),false);
    assert.equal((await pool.query('SELECT count(*)::INT n FROM auction_notification_reads WHERE outbox_id=$1',[own])).rows[0].n,0);
    assert.deepEqual(await mark(A,[own],true),{updated:false});
  });
  await t.test('category visibility preferences use CAS, preserve history/read state and never set email preferences',async()=>{
    await register(5);await auction(5);
    const own=(await read(A)).items[0].id;await mark(A,[own],true);
    const outcomes=await Promise.all([prefs(A,0,false,true),prefs(A,0,false,true)]);
    assert.equal(outcomes.filter(row=>row.saved).length,1);assert.equal((await read(A)).items.length,0);
    assert.equal((await read(B)).preferencesRevision,0);
    assert.deepEqual(await prefs(A,0),{saved:false});await prefs(A,1,true,true);
    assert.equal((await read(A)).items.find(row=>row.id===own).read,true);
    assert.equal((await read(A)).preferencesRevision,2);
  });
  await t.test('BIGINT pagination is numeric beyond JavaScript precision and hidden artworks lose their action link',async()=>{
    await bid(5,B);await bid(5,A);await bid(5,C);
    await pool.query("SELECT setval('outbox_events_id_seq',9007199254740993,false)");
    for(let id=20;id<44;id++){await register(id);await auction(id);}
    const first=await read(A);assert.equal(first.items.length,21);
    assert.ok(BigInt(first.items[0].id)>9007199254740991n);
    const second=await read(A,first.items.at(-1).id);assert.ok(second.items.every(row=>BigInt(row.id)<BigInt(first.items.at(-1).id)));
    await pool.query('INSERT INTO artwork_moderation_visibility VALUES(84532,$1,true)',[first.items[0].artwork_id]);
    assert.equal((await read(A)).items[0].artworkAvailable,false);
  });
  await t.test('category filtering precedes the internal page bound so older enabled updates remain reachable',async()=>{
    const revision=(await read(A)).preferencesRevision;
    await prefs(A,revision,false,true);
    const page=await read(A);
    assert.ok(page.items.some(item=>item.type==='outbid'&&item.artwork_id==='5'));
    assert.ok(page.items.every(item=>item.type==='outbid'));
    await prefs(A,revision+1,true,true);
    const plan=await pool.query('EXPLAIN (ANALYZE,FORMAT JSON) SELECT read_auction_notifications($1,$2)',[A,CORE]);
    assert.ok(Number.isFinite(plan.rows[0]['QUERY PLAN'][0]['Execution Time']));
    assert.equal((await pool.query('SELECT count(*)::INT n FROM canonical_auction_notifications($1,$2)',[A,CORE])).rows[0].n,21);
  });
  await t.test('client roles and direct service writes are denied; idempotent migration preserves preferences and reads',async()=>{
    for(const role of ['anon','authenticated','service_role']){
      const client=await pool.connect();try{await client.query(`SET ROLE ${role}`);
        for(const table of ['auction_notification_reads','auction_notification_preferences']){
          await assert.rejects(client.query(`DELETE FROM ${table}`),{code:'42501'});
          if(role!=='service_role')await assert.rejects(client.query(`SELECT * FROM ${table}`),{code:'42501'});
        }
        await assert.rejects(client.query('SELECT * FROM canonical_auction_notifications($1,$2)',[A,CORE]),{code:'42501'});
        if(role!=='service_role')await assert.rejects(client.query('SELECT read_auction_notifications($1,$2)',[A,CORE]),{code:'42501'});
        else assert.ok((await client.query('SELECT read_auction_notifications($1,$2) result',[A,CORE])).rows[0].result.items.length);
      }finally{await client.query('RESET ROLE');client.release();}
    }
    const before=(await pool.query('SELECT * FROM auction_notification_preferences ORDER BY wallet_address')).rows;
    await pool.query(sql);assert.deepEqual((await pool.query('SELECT * FROM auction_notification_preferences ORDER BY wallet_address')).rows,before);
    const flags=(await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('auction_notification_reads','auction_notification_preferences')")).rows;
    assert.ok(flags.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
  });
});
