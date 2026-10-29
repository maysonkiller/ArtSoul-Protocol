// Disposable PostgreSQL and synthetic Engine events only; no live data or credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import {listIndexerMigrations} from '../scripts/apply-migrations.js';

const A=`0x${'1'.repeat(40)}`,B=`0x${'2'.repeat(40)}`,C=`0x${'3'.repeat(40)}`,CORE=`0x${'4'.repeat(40)}`,OLD=`0x${'5'.repeat(40)}`;
const hash=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
const sql=fs.readFileSync('sql/migrations/notification_summary.sql','utf8');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const summarySignature='read_notification_summary(text,text,boolean,boolean,boolean)';
const markSignature='mark_personal_moderation_notifications(text,bigint[],boolean)';

test('private notification summaries prove all unread categories before pagination in PostgreSQL',{
  skip:available?false:'Disposable PostgreSQL requires Docker',timeout:120000
},async t=>{
  const container=`artsoul-summary-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let created=false,pool;const priorRedis=process.env.REDIS_URL;process.env.REDIS_URL='';
  t.after(async()=>{await pool?.end();if(created)docker('rm','-f',container);
    if(priorRedis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=priorRedis;});
  t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});t.mock.method(console,'error',()=>{});
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-summary-fixture','-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');created=true;
  const endpoint=docker('port',container,'5432/tcp');assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool=new pg.Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',password:'local-summary-fixture',connectionTimeoutMillis:1000});
  for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');await delay(100);await pool.query('SELECT 1');break;}catch(error){if(attempt>=80)throw error;await delay(250);}}
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;`);
  for(const migration of listIndexerMigrations())await pool.query(migration.sql);
  await pool.query(fs.readFileSync(new URL('./fixtures/indexer-legacy-notification-writer.sql',import.meta.url),'utf8'));
  await pool.query(`INSERT INTO distributed_locks(lock_name,instance_id,fencing_token,expires_at)
    VALUES('notification-fixture','worker-fixture',1,clock_timestamp()+interval '1 hour')`);
  await pool.query('CREATE TABLE artwork_media_chain_revisions(chain_id NUMERIC PRIMARY KEY,revision NUMERIC(78,0) NOT NULL);');
  for(const name of ['phase18_artwork_moderation_visibility','a8b_artwork_report_intake','a8c_protocol_admin_review',
    'artist_support','artist_support_moderation','auction_notifications','auction_notification_lifecycle','auction_notification_reminders']){
    await pool.query(fs.readFileSync(`sql/migrations/${name}.sql`,'utf8'));
  }
  const legacyHash=async()=>crypto.createHash('sha256').update(JSON.stringify((await pool.query(`SELECT oid::regprocedure::TEXT name,pg_get_functiondef(oid) definition,proacl
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname NOT IN ('read_notification_summary','mark_personal_moderation_notifications') ORDER BY oid`)).rows)).digest('hex');
  const originalHash=await legacyHash();await pool.query(sql);assert.equal(await legacyHash(),originalHash);
  const {default:Engine}=await import('../src/indexer/sync-engine.js');
  let now,block,engine,report;
  t.beforeEach(async()=>{
    await pool.query(`TRUNCATE contract_events,event_processing_registry,outbox_events,auction_notification_reads,auction_notification_preferences,
      block_hashes,v41_artworks,v41_auctions,artwork_report_notifications,artwork_report_events,artwork_reports,
      artwork_moderation_visibility,artwork_moderation_log,indexer_state,artwork_media_chain_revisions RESTART IDENTITY CASCADE;
      INSERT INTO artwork_media_chain_revisions VALUES(84532,0);`);
    now=Number((await pool.query('SELECT floor(extract(epoch FROM statement_timestamp()))::TEXT value')).rows[0].value);block=100;
    await pool.query("INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,last_indexed_at,started_at,status) VALUES(84532,$1,10000,10000,now(),now(),'running')",[CORE]);
    await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES(84532,10000,$1,$2,$3)',[hash(10000),hash(9999),now]);
    report=(await pool.query("INSERT INTO artwork_reports(chain_id,artwork_id,reporter_wallet,category,details,good_faith_confirmed) VALUES(84532,1,$1,'other','Synthetic review fixture',true) RETURNING id",[A])).rows[0].id;
    engine=new Engine({pool,query:async(q,p)=>(await pool.query(q,p)).rows},{chainId:84532,contractAddress:CORE,donationAddress:OLD});
    engine.getRecoveryAuthority=()=>({lockName:'notification-fixture',instanceId:'worker-fixture',fencingToken:'1',isCurrent:()=>true});
  });
  async function event(name,data,source=CORE){
    const context=await engine._captureWriteContext();
    const n=++block,value={eventName:name,eventData:data,blockNumber:n,logIndex:0,transactionHash:hash(n),timestamp:now*1000};
    await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES(84532,$1,$2,$3,$4)',[n,hash(n+20000),hash(n+19999),now]);
    if(source!==null)value.contractAddress=source;await engine._processEvent(value,context);return value;
  }
  const register=id=>event('ArtworkRegistered',{artworkId:String(id),creator:A,metadataURI:'ipfs://fixture'});
  const auction=(id,artwork=id,deadline=now+1800,source=CORE)=>event('AuctionCreated',{auctionId:String(id),artworkId:String(artwork),creator:A,startPrice:'1000',duration:'86400',endTime:String(deadline),chainId:'84532'},source);
  const bid=(id,bidder=B)=>event('BidPlaced',{auctionId:String(id),bidder,bidAmount:'2000',depositAmount:'1000'});
  const extend=(deadline,source=CORE)=>event('AuctionExtended',{auctionId:'1',oldEndTime:String(now+1800),newEndTime:String(deadline)},source);
  const summary=async(wallet=A,core=CORE,flags=[true,true,true],client=pool)=>(await client.query('SELECT read_notification_summary($1,$2,$3,$4,$5) result',[wallet,core,...flags])).rows[0].result;
  const mark=async(wallet,ids,read,client=pool)=>(await client.query('SELECT mark_personal_moderation_notifications($1,$2,$3) result',[wallet,ids,read])).rows[0].result;
  const notice=async(wallet=A,type='REPORT_RESOLVED')=>(await pool.query('INSERT INTO artwork_report_notifications(report_id,recipient_wallet,notification_type) VALUES($1,$2,$3) RETURNING id::TEXT',[report,wallet,type])).rows[0].id;
  const inbox=async(wallet=A)=>(await pool.query('SELECT read_auction_notifications_v3($1,$2) result',[wallet,CORE])).rows[0].result;
  const markAuction=async(wallet,ids,read)=>(await pool.query('SELECT mark_auction_notifications_v3($1,$2,$3,$4) result',[wallet,CORE,ids,read])).rows[0].result;
  const save=async(created=true,outbid=true,lifecycle=true,reminders=true,minutes=[60])=>{
    const revision=(await summary()).preferencesRevision;
    return (await pool.query('SELECT save_auction_notification_preferences_v3($1,$2,$3,$4,$5,$6,$7,$8) result',[A,CORE,revision,created,outbid,lifecycle,reminders,minutes])).rows[0].result;
  };
  const stateHash=async()=>crypto.createHash('sha256').update(JSON.stringify((await pool.query(`SELECT
    (SELECT coalesce(jsonb_agg(t ORDER BY id),'[]') FROM outbox_events t) outbox,
    (SELECT coalesce(jsonb_agg(t ORDER BY wallet_address,core_address,outbox_id),'[]') FROM auction_notification_reads t) reads,
    (SELECT coalesce(jsonb_agg(t ORDER BY wallet_address,core_address),'[]') FROM auction_notification_preferences t) preferences,
    (SELECT coalesce(jsonb_agg(t ORDER BY id),'[]') FROM artwork_report_notifications t) moderation`)).rows)).digest('hex');

  await t.test('older unread history survives twenty-one newer read rows and the summary performs no writes',async()=>{
    for(let id=1;id<=26;id++){await register(id);await auction(id);}
    await pool.query(`INSERT INTO auction_notification_reads(wallet_address,core_address,outbox_id,read)
      SELECT $1,$2,id,true FROM outbox_events WHERE payload->>'type'='auction_created' AND payload->>'auctionId'<>'1'`,[A,CORE]);
    const page=(await pool.query('SELECT read_auction_notifications_v2($1,$2) result',[A,CORE])).rows[0].result;
    assert.equal(page.items.length,21);assert.ok(page.items.every(item=>item.read));
    const before=await stateHash(),result=await summary();assert.equal(result.auctionCount,1);assert.equal(result.reminderCount,26);
    assert.equal(result.nextReminderDeadline,String(now+1800));assert.equal(result.chainRevision,'0');assert.equal(result.preferencesRevision,0);
    assert.equal(await stateHash(),before);assert.equal((await summary(B)).auctionCount,0);
    assert.deepEqual(Object.keys(result).sort(),['auctionCount','chainRevision','moderationCount','nextReminderDeadline','preferencesRevision','reminderCount','remindersAvailable','serverTime'].sort());
    assert.ok(Number.isFinite(Date.parse(result.serverTime)));
  });

  await t.test('all category counts saturate at 100 after validation and reminders need no outbox rows',async()=>{
    for(let id=1;id<=103;id++){await register(id);await auction(id,id,now+300+id);}
    await pool.query("INSERT INTO artwork_report_notifications(report_id,recipient_wallet,notification_type) SELECT $1,$2,'REPORT_RESOLVED' FROM generate_series(1,103)",[report,A]);
    const before=await stateHash(),result=await summary();
    assert.equal(result.auctionCount,100);assert.equal(result.moderationCount,100);assert.equal(result.reminderCount,100);
    assert.equal(result.nextReminderDeadline,String(now+301));assert.equal(await stateHash(),before);
    assert.equal((await pool.query("SELECT count(*)::INT n FROM outbox_events WHERE idempotency_key LIKE 'reminder-v3-%'")).rows[0].n,0);
  });

  await t.test('history counts reuse source, recipient, registry and confirmation proof instead of trusting payloads',async()=>{
    await register(1);const created=await auction(1);await bid(1,B);await bid(1,C);
    assert.equal((await summary()).auctionCount,3);assert.equal((await summary(B)).auctionCount,1);
    const outbid=(await pool.query("SELECT id FROM outbox_events WHERE payload->>'type'='outbid'")).rows[0].id;
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)) WHERE id=$2",[C,outbid]);
    assert.equal((await summary(B)).auctionCount,0);assert.equal((await summary(C)).auctionCount,0);
    for(const source of [OLD,null]){
      await pool.query('UPDATE contract_events SET contract_address=$1 WHERE transaction_hash=$2',[source,created.transactionHash]);
      assert.equal((await summary()).auctionCount,0);assert.equal((await summary()).reminderCount,0);
    }
    await pool.query('UPDATE contract_events SET contract_address=$1 WHERE transaction_hash=$2',[CORE,created.transactionHash]);
    await pool.query("UPDATE event_processing_registry SET processing_status='failed'");assert.equal((await summary()).auctionCount,0);
    await pool.query("UPDATE event_processing_registry SET processing_status='completed'");
    await pool.query('UPDATE indexer_state SET last_confirmed_block=100');assert.equal((await summary()).auctionCount,0);
    await pool.query('UPDATE indexer_state SET last_confirmed_block=10000');
    await pool.query('DELETE FROM block_hashes WHERE block_number=$1',[created.blockNumber]);assert.equal((await summary()).auctionCount,0);
  });

  await t.test('feature and preference filters retain exact shared revisions and independent moderation',async()=>{
    await register(1);await auction(1);await bid(1);await notice();
    assert.equal((await summary()).auctionCount,2);assert.equal((await summary(A,CORE,[true,false,false])).auctionCount,1);
    await save(false,true,true,true,[30]);let result=await summary();assert.equal(result.auctionCount,1);assert.equal(result.preferencesRevision,1);
    await save(true,true,false,false);result=await summary();assert.equal(result.auctionCount,1);assert.equal(result.reminderCount,0);assert.equal(result.remindersAvailable,true);
    await pool.query('DELETE FROM artwork_media_chain_revisions');
    result=await summary(A,null,[false,false,false]);assert.equal(result.moderationCount,1);assert.equal(result.auctionCount,0);
    assert.equal(result.chainRevision,null);assert.equal(result.preferencesRevision,0);assert.equal(result.remindersAvailable,true);
    await assert.rejects(summary(),{code:'55000'});await assert.rejects(summary(A,OLD),{code:'55000'});
  });

  await t.test('recognized moderation notices have reversible exact-ID read state and mixed recipients change nothing',async()=>{
    const types=['REPORT_ACTIONED','REPORT_DISMISSED','REPORT_RESOLVED','REPORT_REOPENED','ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED'];
    assert.equal((await summary()).moderationCount,0); // A pending staff report alone is not a personal notice.
    await pool.query("SELECT setval(pg_get_serial_sequence('artwork_report_notifications','id'),9007199254740993,false)");
    const ids=[];for(const type of types)ids.push(await notice(A,type));const foreign=await notice(B);
    assert.equal((await summary()).moderationCount,8);assert.ok(BigInt(ids[0])>9007199254740991n);
    assert.deepEqual(await mark(A,[ids[0],foreign],true),{updated:false});assert.equal((await summary()).moderationCount,8);
    assert.deepEqual(await mark(A,[ids[0],'9223372036854775807'],true),{updated:false});
    assert.deepEqual(await mark(A,ids,true),{updated:true,ids,read:true});assert.equal((await summary()).moderationCount,0);
    const timestamp=(await pool.query('SELECT read_at::TEXT FROM artwork_report_notifications WHERE id=$1',[ids[0]])).rows[0].read_at;
    await mark(A,[ids[0]],true);assert.equal((await pool.query('SELECT read_at::TEXT FROM artwork_report_notifications WHERE id=$1',[ids[0]])).rows[0].read_at,timestamp);
    assert.deepEqual(await mark(A,[ids[0]],false),{updated:true,ids:[ids[0]],read:false});assert.equal((await summary()).moderationCount,1);
    assert.equal((await summary(B)).moderationCount,1);
    for(const invalid of [[],[ids[0],ids[0]],[null],['0'],Array.from({length:21},(_,i)=>String(i+1)),null])await assert.rejects(mark(A,invalid,true),{code:'22023'});
    await assert.rejects(mark(A,[ids[0]],null),{code:'22023'});
    await assert.rejects(pool.query('SELECT mark_personal_moderation_notifications($1,ARRAY[[1,2],[3,4]],true)',[A]),{code:'22023'});
    const client=await pool.connect();try{
      await client.query('BEGIN');await client.query('ALTER TABLE artwork_report_notifications DROP CONSTRAINT artwork_report_notifications_notification_type_check');
      const unknown=(await client.query("INSERT INTO artwork_report_notifications(report_id,recipient_wallet,notification_type) VALUES($1,$2,'STAFF_REVIEW') RETURNING id::TEXT",[report,A])).rows[0].id;
      assert.equal((await summary(A,CORE,[true,true,true],client)).moderationCount,1);assert.deepEqual(await mark(A,[unknown],true,client),{updated:false});
    }finally{await client.query('ROLLBACK');client.release();}
  });

  await t.test('unmaterialized reminders honor recipients, durable identity and extensions without resetting read state',async()=>{
    await register(1);await auction(1);await bid(1);
    assert.equal((await summary()).reminderCount,1);assert.equal((await summary(B)).reminderCount,1);assert.equal((await summary(C)).reminderCount,0);
    const item=(await inbox()).reminders[0];await markAuction(A,[item.id],true);assert.equal((await summary()).reminderCount,0);
    await extend(now+2100);assert.equal((await summary()).reminderCount,0);assert.equal((await inbox()).reminders[0].id,item.id);
    await markAuction(A,[item.id],false);assert.equal((await summary()).nextReminderDeadline,String(now+2100));
    const extension=await extend(now+7200);assert.equal((await summary()).reminderCount,0);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[extension.blockNumber]);
    assert.equal((await summary()).reminderCount,1);assert.equal((await summary()).nextReminderDeadline,String(now+2100));
    assert.equal((await inbox()).reminders[0].id,item.id);
  });

  await t.test('unknown newer rounds, reverted bids and creation rewinds cannot leave a reminder badge',async()=>{
    await register(1);const creation=await auction(1);const placed=await bid(1);await inbox(B);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[placed.blockNumber]);
    assert.equal((await summary(B)).reminderCount,0);assert.equal((await summary()).reminderCount,1);
    const unknown=await auction(2,1,now+1800,null);assert.equal((await summary()).reminderCount,0);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[unknown.blockNumber]);assert.equal((await summary()).reminderCount,1);
    const extension=await extend(now+2100,null);assert.equal((await summary()).reminderCount,0);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[extension.blockNumber]);assert.equal((await summary()).reminderCount,1);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[creation.blockNumber]);
    const result=await summary();assert.equal(result.auctionCount,0);assert.equal(result.reminderCount,0);assert.equal(result.nextReminderDeadline,null);
  });

  await t.test('payment reminders follow only the current proven winner and cease on settlement',async()=>{
    await register(1);await auction(1);await bid(1);
    await event('AuctionEnded',{auctionId:'1',winner:B,winningBid:'2000',settlementDeadline:String(now+1200)});
    assert.equal((await summary()).reminderCount,0);assert.equal((await summary(C)).reminderCount,0);
    assert.equal((await summary(B)).reminderCount,1);assert.equal((await summary(B)).nextReminderDeadline,String(now+1200));
    await event('SettlementCompleted',{auctionId:'1',artworkId:'1',winner:B,finalPrice:'2000',tokenId:'0'});
    assert.equal((await summary(B)).reminderCount,0);assert.equal((await summary(B)).auctionCount,2);
    assert.equal((await summary()).auctionCount,3);
  });

  await t.test('stale or missing confirmed evidence suppresses active reminders but disabled preferences remain complete',async()=>{
    await register(1);await auction(1);await notice();const before=await summary();assert.equal(before.remindersAvailable,true);
    await pool.query('UPDATE block_hashes SET timestamp=$1 WHERE block_number=10000',[now-121]);
    let result=await summary();assert.equal(result.remindersAvailable,false);assert.equal(result.reminderCount,0);assert.equal(result.nextReminderDeadline,null);
    assert.equal(result.auctionCount,before.auctionCount);assert.equal(result.moderationCount,1);
    assert.equal((await summary(A,CORE,[true,true,false])).remindersAvailable,true);
    await save(true,true,true,false);assert.equal((await summary()).remindersAvailable,true);await save();
    await pool.query('UPDATE block_hashes SET timestamp=$1 WHERE block_number=10000',[now]);
    await pool.query("UPDATE indexer_state SET last_indexed_at=now()-interval '121 seconds'");assert.equal((await summary()).remindersAvailable,false);
    await pool.query("UPDATE indexer_state SET last_indexed_at=now(),status='stopped'");assert.equal((await summary()).remindersAvailable,false);
    await pool.query("UPDATE indexer_state SET status='running'");await pool.query('DELETE FROM block_hashes WHERE block_number=10000');assert.equal((await summary()).remindersAvailable,false);
  });

  await t.test('same-key malformed reminder rows and injection-shaped deadlines never produce a count',async()=>{
    await register(1);const creation=await auction(1);const item=(await inbox()).reminders[0];
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)) WHERE id=$2",[C,item.id]);
    assert.equal((await summary()).reminderCount,0);assert.equal((await summary(C)).reminderCount,0);assert.equal((await inbox()).reminders.length,0);
    await pool.query("UPDATE contract_events SET event_data=jsonb_set(event_data,'{endTime}',to_jsonb($1::TEXT)) WHERE transaction_hash=$2",["1); DROP TABLE outbox_events;--",creation.transactionHash]);
    assert.equal((await summary()).reminderCount,0);assert.ok((await pool.query("SELECT to_regclass('outbox_events') name")).rows[0].name);
    for(const wallet of [null,"x' OR true --",`0x${'0'.repeat(40)}`])await assert.rejects(summary(wallet),{code:'22023'});
    for(const flags of [[null,false,false],[false,true,false],[true,false,true]])await assert.rejects(summary(A,CORE,flags),{code:'22023'});
  });

  await t.test('shared chain locks fence rewinds and moderation row locks preserve recipient ownership',async()=>{
    const id=await notice(),reader=await pool.connect(),writer=await pool.connect();
    try{
      await reader.query('BEGIN');await summary(A,CORE,[true,true,true],reader);await mark(A,[id],true,reader);
      await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(writer.query('UPDATE artwork_media_chain_revisions SET revision=revision+1'),{code:'55P03'});await writer.query('ROLLBACK');
      await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(writer.query('UPDATE artwork_report_notifications SET recipient_wallet=$1 WHERE id=$2',[B,id]),{code:'55P03'});await writer.query('ROLLBACK');
      await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");assert.equal((await summary(B,CORE,[true,true,true],writer)).chainRevision,'0');
      await writer.query('COMMIT');await reader.query('COMMIT');
      await pool.query('UPDATE artwork_media_chain_revisions SET revision=9007199254740993');assert.equal((await summary()).chainRevision,'9007199254740993');
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await assert.rejects(summary(A,CORE,[true,true,true],reader),{code:'55000'});
    }finally{await reader.query('ROLLBACK');await writer.query('ROLLBACK');reader.release();writer.release();}
  });

  await t.test('explicit service grants work without default grants and repeated migration preserves all prior RPCs and data',async()=>{
    await register(1);await auction(1);const id=await notice();await mark(A,[id],true);await save(false,true,true,false);
    const before=await stateHash();await pool.query(sql);assert.equal(await stateHash(),before);assert.equal(await legacyHash(),originalHash);
    for(const signature of [summarySignature,markSignature]){
      const row=(await pool.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') service,has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated",[signature])).rows[0];
      assert.deepEqual(row,{service:true,anon:false,authenticated:false});
      assert.equal((await pool.query("SELECT count(*)::INT n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'",[signature])).rows[0].n,0);
    }
    const client=await pool.connect();try{
      for(const role of ['anon','authenticated','service_role']){
        await client.query(`SET ROLE ${role}`);
        if(role==='service_role'){assert.equal((await summary(A,CORE,[true,true,true],client)).moderationCount,0);assert.equal((await mark(A,[id],false,client)).updated,true);}
        else{await assert.rejects(summary(A,CORE,[true,true,true],client),{code:'42501'});await assert.rejects(mark(A,[id],false,client),{code:'42501'});await assert.rejects(client.query('SELECT * FROM artwork_report_notifications'),{code:'42501'});}
        await client.query('RESET ROLE');
      }
    }finally{await client.query('RESET ROLE');client.release();}
    const rls=(await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='artwork_report_notifications'::regclass")).rows[0];
    assert.deepEqual(rls,{relrowsecurity:true,relforcerowsecurity:true});
  });
});
