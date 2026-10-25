// Synthetic ledger events and disposable PostgreSQL only; no live credentials/RPCs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import {listIndexerMigrations} from '../scripts/apply-migrations.js';

const A=`0x${'1'.repeat(40)}`,B=`0x${'2'.repeat(40)}`,C=`0x${'3'.repeat(40)}`,CORE=`0x${'4'.repeat(40)}`,OLD=`0x${'5'.repeat(40)}`,ZERO=`0x${'0'.repeat(40)}`;
const sql=fs.readFileSync('sql/migrations/auction_notification_reminders.sql','utf8');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('private current reminders preserve legacy history and prove deadlines in PostgreSQL',{
  skip:available?false:'Disposable PostgreSQL requires Docker',timeout:120000
},async t=>{
  const container=`artsoul-reminders-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let created=false,pool;const priorRedis=process.env.REDIS_URL;process.env.REDIS_URL='';
  t.after(async()=>{await pool?.end();if(created)docker('rm','-f',container);
    if(priorRedis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=priorRedis;});
  t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});t.mock.method(console,'error',()=>{});
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-reminder-fixture','-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');created=true;
  const endpoint=docker('port',container,'5432/tcp');assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool=new pg.Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',password:'local-reminder-fixture',connectionTimeoutMillis:1000});
  for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');await delay(100);await pool.query('SELECT 1');break;}catch(error){if(attempt>=80)throw error;await delay(250);}}
  await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  for(const migration of listIndexerMigrations())await pool.query(migration.sql);
  await pool.query(`CREATE TABLE artwork_moderation_visibility(chain_id NUMERIC,artwork_id NUMERIC,hidden BOOLEAN);
    CREATE TABLE artwork_media_chain_revisions(chain_id NUMERIC PRIMARY KEY,revision NUMERIC(78,0) NOT NULL);
    INSERT INTO artwork_media_chain_revisions VALUES(84532,0);
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;`);
  for(const name of ['auction_notifications','auction_notification_lifecycle'])await pool.query(fs.readFileSync(`sql/migrations/${name}.sql`,'utf8'));
  const legacyHash=async()=>crypto.createHash('sha256').update(JSON.stringify((await pool.query(`SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN ('canonical_auction_notifications','canonical_auction_notifications_v2',
      'read_auction_notifications','read_auction_notifications_v2','mark_auction_notifications','mark_auction_notifications_v2',
      'save_auction_notification_preferences','save_auction_notification_preferences_v2') ORDER BY proname`)).rows)).digest('hex');
  const originalHash=await legacyHash();
  await pool.query(sql);assert.equal(await legacyHash(),originalHash);
  const hash=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
  const now=Number((await pool.query('SELECT floor(extract(epoch FROM statement_timestamp()))::TEXT value')).rows[0].value);
  await pool.query("INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,last_indexed_at,started_at,status) VALUES(84532,$1,10000,10000,now(),now(),'running')",[CORE]);
  await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES(84532,10000,$1,$2,$3)',[hash(10000),hash(9999),now]);
  const {default:Engine}=await import('../src/indexer/sync-engine.js');
  const engine=new Engine({pool,query:async(q,p)=>(await pool.query(q,p)).rows},{chainId:84532,contractAddress:CORE,donationAddress:OLD});
  let block=100;
  async function event(name,data,source=CORE){
    const n=++block,value={eventName:name,eventData:data,blockNumber:n,logIndex:0,transactionHash:hash(n),timestamp:now*1000};
    await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES(84532,$1,$2,$3,$4)',[n,hash(n+20000),hash(n+19999),now]);
    if(source!==null)value.contractAddress=source;await engine._processEvent(value);return value;
  }
  const register=id=>event('ArtworkRegistered',{artworkId:String(id),creator:A,metadataURI:'ipfs://fixture'});
  const auction=(id,artwork=id,deadline=now+1800,source=CORE)=>event('AuctionCreated',{auctionId:String(id),artworkId:String(artwork),creator:A,startPrice:'1000',duration:'86400',endTime:String(deadline),chainId:'84532'},source);
  const bid=(id,bidder=B,source=CORE)=>event('BidPlaced',{auctionId:String(id),bidder,bidAmount:'2000',depositAmount:'1000'},source);
  const end=(id,winner=B,deadline=now+1800,source=CORE)=>event('AuctionEnded',{auctionId:String(id),winner,winningBid:winner===ZERO?'0':'2000',settlementDeadline:winner===ZERO?'0':String(deadline)},source);
  const extend=(id,oldEndTime,newEndTime,source=CORE)=>event('AuctionExtended',{auctionId:String(id),oldEndTime:String(oldEndTime),newEndTime:String(newEndTime)},source);
  const read=async(wallet=A,before=null,v=3,core=CORE)=>(await pool.query(`SELECT read_auction_notifications${v===1?'':`_v${v}`}($1,$2,$3) result`,[wallet,core,before])).rows[0].result;
  const mark=async(wallet,ids,value)=>(await pool.query('SELECT mark_auction_notifications_v3($1,$2,$3,$4) result',[wallet,CORE,ids,value])).rows[0].result;
  const save=async(wallet,revision,minutes=[60],enabled=true)=>(await pool.query('SELECT save_auction_notification_preferences_v3($1,$2,$3,true,true,true,$4,$5) result',[wallet,CORE,revision,enabled,minutes])).rows[0].result;
  const settings=async(wallet,minutes,enabled=true)=>save(wallet,(await read(wallet,null,2)).preferencesRevision,minutes,enabled);
  const reminder=async(wallet,id)=>(await read(wallet)).reminders.find(row=>row.auction_id===String(id));
  const reminderRows=async(id)=>(await pool.query("SELECT id::TEXT,idempotency_key,correlation_id,payload FROM outbox_events WHERE payload->>'auctionId'=$1 AND idempotency_key LIKE 'reminder-v3-%' ORDER BY id",[String(id)])).rows;

  await t.test('first-page reads materialize only creator and proven current-round bidders, with no history pollution',async()=>{
    await register(1);await auction(1);await bid(1);
    assert.deepEqual((await read(C)).reminders,[]);
    const legacy=await read(A,null,2),first=await read(A),owned=first.reminders[0];
    assert.deepEqual(first.items,legacy.items);assert.equal(first.remindersAvailable,true);assert.equal(first.remindersCapped,false);
    assert.deepEqual(first.reminderMinutes,[60]);assert.equal(first.preferences.reminders,true);
    assert.equal(owned.type,'auction_ending');assert.equal(owned.deadline,String(now+1800));assert.equal(owned.offset_minutes,60);
    assert.equal(typeof owned.id,'string');assert.equal(owned.artwork_id,'1');assert.equal(owned.auction_id,'1');
    assert.ok(Date.parse(owned.created_at)>=now*1000);assert.ok(Date.parse(first.serverTime)>=Date.parse(owned.created_at)-1000);
    assert.equal((await read(B)).reminders.length,1);assert.equal((await reminderRows(1)).length,2);
    assert.equal((await read(A)).reminders[0].id,owned.id);assert.equal((await reminderRows(1)).length,2);
    assert.ok((await read(A,null,1)).items.every(row=>!['auction_ending','payment_due'].includes(row.type)));
  });

  await t.test('read state is durable and mixed history/reminder updates are atomic and recipient-bound',async()=>{
    const a=await read(A),own=a.reminders[0].id,history=a.items[0].id,foreign=(await read(B)).reminders[0].id;
    assert.deepEqual(await mark(A,[history,own,foreign],true),{updated:false});
    assert.equal((await reminder(A,1)).read,false);
    assert.deepEqual(await mark(A,[history,own],true),{updated:true,ids:[history,own].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),read:true});
    assert.equal((await reminder(A,1)).read,true);assert.equal((await read(A,null,2)).items.find(row=>row.id===history).read,true);
    await assert.rejects(mark(A,[own,own],false),{code:'22023'});
    assert.deepEqual(await mark(C,[own],true),{updated:false});
  });

  await t.test('extensions change the displayed deadline without new IDs or unread resets; rewinds ignore stale projection fields',async()=>{
    const original=await reminder(A,1),extension=await extend(1,now+1800,now+2100);
    const updated=await reminder(A,1);assert.equal(updated.id,original.id);assert.equal(updated.read,true);assert.equal(updated.deadline,String(now+2100));assert.equal(updated.transaction_hash,extension.transactionHash);
    assert.equal((await reminderRows(1)).length,2);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[extension.blockNumber]);
    assert.equal((await pool.query('SELECT extract(epoch FROM end_time)::BIGINT::TEXT deadline FROM v41_auctions WHERE chain_id=84532 AND auction_id=1')).rows[0].deadline,String(now+2100));
    const reverted=await reminder(A,1);assert.equal(reverted.id,original.id);assert.equal(reverted.read,true);assert.equal(reverted.deadline,String(now+1800));
    const unknown=await extend(1,now+1800,now+2100,null);assert.equal(await reminder(A,1),undefined);
    assert.deepEqual(await mark(A,[original.id],false),{updated:false});
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[unknown.blockNumber]);assert.equal((await reminder(A,1)).id,original.id);
  });

  await t.test('extension outside a selected window hides the reminder and preserves its read identity',async()=>{
    const localNow=Number((await pool.query('SELECT floor(extract(epoch FROM statement_timestamp()))::TEXT value')).rows[0].value);
    await settings(A,[1]);await register(2);await auction(2,2,localNow+45);const original=await reminder(A,2);assert.ok(original);
    await mark(A,[original.id],true);const extension=await extend(2,localNow+45,localNow+345);
    assert.equal(await reminder(A,2),undefined);assert.deepEqual(await mark(A,[original.id],false),{updated:false});
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[extension.blockNumber]);
    assert.equal((await reminder(A,2)).id,original.id);assert.equal((await reminder(A,2)).read,true);
    await settings(A,[60]);
  });

  await t.test('only a proven nonzero winner receives a payment reminder; completion/default/no-bids suppress current reminders',async()=>{
    await register(3);await auction(3);await bid(3);const ended=await end(3);
    assert.equal(await reminder(A,3),undefined);assert.equal(await reminder(C,3),undefined);
    const payment=await reminder(B,3);assert.equal(payment.type,'payment_due');assert.equal(payment.transaction_hash,ended.transactionHash);
    await event('SettlementCompleted',{auctionId:'3',artworkId:'3',winner:B,finalPrice:'2000',tokenId:'3'});
    assert.equal(await reminder(B,3),undefined);assert.deepEqual(await mark(B,[payment.id],true),{updated:false});
    await register(4);await auction(4);await end(4);const unpaid=await reminder(B,4);assert.ok(unpaid);
    await event('SettlementDefaulted',{auctionId:'4',winner:B,artistAmount:'800',platformAmount:'200'},null);
    assert.equal(await reminder(B,4),undefined);
    await register(5);await auction(5);await end(5,ZERO);assert.equal(await reminder(A,5),undefined);assert.equal(await reminder(B,5),undefined);
  });

  await t.test('newer unknown/foreign/unconfirmed sources cannot revive older rounds or deadlines',async()=>{
    await register(6);await auction(6);const original=await reminder(A,6);assert.ok(original);
    const newer=await auction(7,6,now+1800,null);assert.equal(await reminder(A,6),undefined);assert.equal(await reminder(A,7),undefined);
    assert.deepEqual(await mark(A,[original.id],true),{updated:false});
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[newer.blockNumber]);assert.equal((await reminder(A,6)).id,original.id);
    const extension=await extend(6,now+1800,now+2100);
    for(const address of [OLD,null]){await pool.query('UPDATE contract_events SET contract_address=$1 WHERE transaction_hash=$2',[address,extension.transactionHash]);assert.equal(await reminder(A,6),undefined);}
    await pool.query('UPDATE contract_events SET contract_address=$1,block_number=10001 WHERE transaction_hash=$2',[CORE,extension.transactionHash]);assert.equal(await reminder(A,6),undefined);
    await pool.query('UPDATE contract_events SET block_number=$1 WHERE transaction_hash=$2',[extension.blockNumber,extension.transactionHash]);
    await pool.query("UPDATE event_processing_registry SET processing_status='failed' WHERE transaction_hash=$1",[extension.transactionHash]);assert.equal(await reminder(A,6),undefined);
    await pool.query("UPDATE event_processing_registry SET processing_status='completed' WHERE transaction_hash=$1",[extension.transactionHash]);assert.ok(await reminder(A,6));
  });

  await t.test('a bidder loses reminder eligibility if their source disappears while creation and outbox remain',async()=>{
    await register(8);await auction(8);const placed=await bid(8);const original=await reminder(B,8);assert.ok(original);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[placed.blockNumber]);
    assert.ok((await reminderRows(8)).some(row=>row.id===original.id));assert.equal(await reminder(B,8),undefined);
    assert.deepEqual(await mark(B,[original.id],true),{updated:false});assert.ok(await reminder(A,8));
  });

  await t.test('custom settings normalize, enforce three unique bounded offsets and share CAS with legacy clients',async()=>{
    const current=(await read(A)).preferencesRevision;
    const outcomes=await Promise.all([save(A,current,[60,1,30]),save(A,current,[60,1,30])]);assert.equal(outcomes.filter(row=>row.saved).length,1);
    assert.deepEqual((await read(A)).reminderMinutes,[1,30,60]);
    for(const value of [[],[0],[1441],[1,1],[1,2,3,4],[null],null])await assert.rejects(save(A,current+1,value),{code:'22023'});
    await assert.rejects(pool.query('SELECT save_auction_notification_preferences_v3($1,$2,$3,true,true,true,true,ARRAY[[1,2],[3,4]])',[A,CORE,current+1]),{code:'22023'});
    await pool.query('SELECT save_auction_notification_preferences_v2($1,$2,$3,true,true,false)',[A,CORE,current+1]);
    const after=await read(A);assert.deepEqual(after.reminderMinutes,[1,30,60]);assert.equal(after.preferences.reminders,true);assert.equal(after.preferences.lifecycle,false);
    assert.deepEqual(await save(A,current+1),{saved:false});
    await settings(A,[60],false);assert.deepEqual((await read(A)).reminders,[]);await settings(A,[60],true);
  });

  await t.test('only the latest due offset is caught up and its three possible keys cannot collide',async()=>{
    const localNow=Number((await pool.query('SELECT floor(extract(epoch FROM statement_timestamp()))::TEXT value')).rows[0].value);
    await pool.query('UPDATE block_hashes SET timestamp=$1 WHERE chain_id=84532 AND block_number=10000',[localNow]);
    await pool.query('UPDATE indexer_state SET last_indexed_at=now()');
    await settings(A,[1,2,3]);await register(9);await auction(9,9,localNow+150);
    const first=await reminder(A,9);assert.equal(first.offset_minutes,3);
    const keys=[];
    for(const seconds of [0,40,100]){
      const row=(await pool.query("SELECT offset_minutes,idempotency_key FROM auction_reminder_candidates($1,$2,ARRAY[1,2,3],to_timestamp($3)) WHERE auction_id='9'",[A,CORE,localNow+seconds])).rows[0];
      keys.push(row.idempotency_key);assert.equal(row.offset_minutes,seconds===0?3:seconds===40?2:1);
    }
    assert.equal(new Set(keys).size,3);assert.ok(keys.every(key=>key.length<=100));
    await register(10);await auction(10,10,localNow+40);const catchup=await reminder(A,10);assert.equal(catchup.offset_minutes,1);
    assert.equal((await reminderRows(10)).filter(row=>row.payload.recipient===A).length,1);
    await settings(A,[60]);
  });

  await t.test('stale canonical blocks, stale heartbeat, stopped state and missing block evidence hide only reminders',async()=>{
    const original=await read(A),id=original.reminders.find(row=>row.auction_id==='1').id;
    await pool.query('UPDATE block_hashes SET timestamp=$1 WHERE chain_id=84532 AND block_number=10000',[now-121]);
    let stale=await read(A);assert.equal(stale.remindersAvailable,false);assert.deepEqual(stale.reminders,[]);assert.deepEqual(stale.items,original.items);
    assert.deepEqual(await mark(A,[id],true),{updated:false});
    await pool.query('UPDATE block_hashes SET timestamp=$1 WHERE chain_id=84532 AND block_number=10000',[now]);
    await pool.query("UPDATE indexer_state SET last_indexed_at=now()-interval '121 seconds'");assert.equal((await read(A)).remindersAvailable,false);
    await pool.query("UPDATE indexer_state SET last_indexed_at=now(),status='stopped'");assert.equal((await read(A)).remindersAvailable,false);
    await pool.query("UPDATE indexer_state SET status='running'");
    const blockRow=(await pool.query('DELETE FROM block_hashes WHERE block_number=10000 RETURNING *')).rows[0];assert.equal((await read(A)).remindersAvailable,false);
    await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES($1,$2,$3,$4,$5)',[blockRow.chain_id,blockRow.block_number,blockRow.block_hash,blockRow.parent_hash,blockRow.timestamp]);
    assert.equal((await read(A)).remindersAvailable,true);
  });

  await t.test('past deadlines and malformed source values fail closed without SQL interpolation',async()=>{
    await register(11);const expired=await auction(11,11,now-1);assert.equal(await reminder(A,11),undefined);
    await pool.query("UPDATE contract_events SET event_data=jsonb_set(event_data,'{endTime}',to_jsonb($1::TEXT)) WHERE transaction_hash=$2",["1); DROP TABLE outbox_events;--",expired.transactionHash]);
    assert.equal(await reminder(A,11),undefined);assert.ok((await pool.query("SELECT to_regclass('outbox_events') name")).rows[0].name);
    await assert.rejects(read("x' OR true --"),{code:'22023'});await assert.rejects(read(A,null,3,OLD),{code:'55000'});
  });

  await t.test('payload recipient substitution cannot redirect a reminder, even with a recomputed logical key',async()=>{
    const original=await reminder(A,1),row=(await reminderRows(1)).find(row=>row.id===original.id);
    const forged=`reminder-v3-${crypto.createHash('sha256').update(`84532|${CORE}|1|auction_ending|${C}|60`).digest('hex')}`;
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)),idempotency_key=$2 WHERE id=$3",[C,forged,original.id]);
    assert.deepEqual(await mark(C,[original.id],true),{updated:false});assert.equal((await read(C)).reminders.some(item=>item.id===original.id),false);
    await pool.query('UPDATE outbox_events SET payload=$1,idempotency_key=$2 WHERE id=$3',[row.payload,row.idempotency_key,original.id]);
  });

  await t.test('reminders are separately capped, ordered, idempotent and never materialized by history-page reads',async()=>{
    for(let id=20;id<43;id++){await register(id);await auction(id,id,now+600+id);}
    const before=(await pool.query("SELECT count(*)::INT n FROM outbox_events WHERE idempotency_key LIKE 'reminder-v3-%'")).rows[0].n;
    const history=await read(A,null,2);await read(A,history.items[0].id);
    assert.equal((await pool.query("SELECT count(*)::INT n FROM outbox_events WHERE idempotency_key LIKE 'reminder-v3-%'")).rows[0].n,before);
    const first=await read(A);assert.deepEqual(first.items,history.items);assert.equal(first.reminders.length,20);assert.equal(first.remindersCapped,true);
    assert.equal(new Set(first.reminders.map(row=>`${row.type}:${row.auction_id}`)).size,20);
    assert.ok(first.reminders.every((row,index,rows)=>index===0||BigInt(row.deadline)>=BigInt(rows[index-1].deadline)));
    const after=(await pool.query("SELECT count(*)::INT n FROM outbox_events WHERE idempotency_key LIKE 'reminder-v3-%'")).rows[0].n;assert.ok(after-before<=21);
    await read(A);assert.equal((await pool.query("SELECT count(*)::INT n FROM outbox_events WHERE idempotency_key LIKE 'reminder-v3-%'")).rows[0].n,after);
    await pool.query('INSERT INTO artwork_moderation_visibility VALUES(84532,$1,true)',[first.reminders[0].artwork_id]);
    assert.equal((await read(A)).reminders[0].artworkAvailable,false);
  });

  await t.test('creation rewind deletes its reminder/read rows and concurrent duplicate reads insert once',async()=>{
    await register(50);const createdEvent=await auction(50,50,now+180);await bid(50,C);
    const responses=await Promise.all([read(C),read(C)]);const own=responses[0].reminders.find(row=>row.auction_id==='50');assert.ok(own);
    assert.equal(responses[1].reminders.find(row=>row.auction_id==='50').id,own.id);
    assert.equal((await reminderRows(50)).filter(row=>row.payload.recipient===C).length,1);await mark(C,[own.id],true);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[createdEvent.blockNumber]);
    assert.equal((await reminderRows(50)).length,0);assert.deepEqual(await mark(C,[own.id],true),{updated:false});
    assert.equal((await pool.query('SELECT count(*)::INT n FROM auction_notification_reads WHERE outbox_id=$1',[own.id])).rows[0].n,0);
  });

  await t.test('shared revision fencing permits parallel wallets and blocks a rewind revision change until commit',async()=>{
    const reader=await pool.connect(),writer=await pool.connect();
    try{
      await reader.query('BEGIN');await reader.query('SELECT read_auction_notifications_v3($1,$2)',[A,CORE]);
      await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(writer.query('UPDATE artwork_media_chain_revisions SET revision=revision+1 WHERE chain_id=84532'),{code:'55P03'});
      await writer.query('ROLLBACK');
      await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
      const concurrent=(await writer.query('SELECT read_auction_notifications_v3($1,$2) result',[B,CORE])).rows[0].result;
      assert.equal(concurrent.chainRevision,'0');await writer.query('COMMIT');await reader.query('COMMIT');
      await pool.query('UPDATE artwork_media_chain_revisions SET revision=revision+1 WHERE chain_id=84532');assert.equal((await read(A)).chainRevision,'1');
    }finally{await reader.query('ROLLBACK');await writer.query('ROLLBACK');reader.release();writer.release();}
  });

  await t.test('repeated migration preserves legacy RPC definitions and explicit private grants',async()=>{
    await pool.query(sql);assert.equal(await legacyHash(),originalHash);
    for(const name of ['read_auction_notifications_v3(text,text,bigint)','mark_auction_notifications_v3(text,text,bigint[],boolean)',
      'save_auction_notification_preferences_v3(text,text,integer,boolean,boolean,boolean,boolean,integer[])']){
      const row=(await pool.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') service,has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated",[name])).rows[0];
      assert.deepEqual(row,{service:true,anon:false,authenticated:false});
    }
    const helpers=['auction_reminder_candidates(text,text,integer[],timestamp with time zone)','canonical_auction_reminders(text,text,integer[],timestamp with time zone,bigint[])',
      'auction_reminders_available(text,timestamp with time zone)','proven_auction_reminder_event(bigint,text,bigint)','valid_auction_reminder_minutes(integer[])'];
    for(const helper of helpers)assert.equal((await pool.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[helper])).rows[0].allowed,false);
    const client=await pool.connect();try{await client.query('SET ROLE service_role');assert.equal((await client.query('SELECT read_auction_notifications_v3($1,$2) result',[C,CORE])).rows[0].result.remindersAvailable,true);}finally{await client.query('RESET ROLE');client.release();}
    await pool.query('UPDATE artwork_media_chain_revisions SET revision=9007199254740993');assert.equal((await read(A)).chainRevision,'9007199254740993');
    await pool.query('DELETE FROM artwork_media_chain_revisions');await assert.rejects(read(A),{code:'55000'});
  });
});
