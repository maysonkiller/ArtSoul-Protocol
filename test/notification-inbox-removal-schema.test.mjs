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
const sql=fs.readFileSync('sql/migrations/notification_inbox_removal.sql','utf8');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const summarySignature='read_notification_summary(text,text,boolean,boolean,boolean)';
const markSignature='mark_personal_moderation_notifications(text,bigint[],boolean)';

test('recipient inbox removal preserves protocol and complaint records in PostgreSQL',{
  skip:available?false:'Disposable PostgreSQL requires Docker',timeout:120000
},async t=>{
  const container=`artsoul-inbox-removal-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
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
  await pool.query(`INSERT INTO distributed_locks(lock_name,instance_id,fencing_token,expires_at)
    VALUES('notification-fixture','worker-fixture',1,clock_timestamp()+interval '1 hour')`);
  await pool.query('CREATE TABLE artwork_media_chain_revisions(chain_id NUMERIC PRIMARY KEY,revision NUMERIC(78,0) NOT NULL);');
  for(const name of ['phase18_artwork_moderation_visibility','a8b_artwork_report_intake','a8c_protocol_admin_review',
    'artist_support','artist_support_moderation','auction_notifications','auction_notification_lifecycle','auction_notification_reminders','notification_summary']){
    await pool.query(fs.readFileSync(`sql/migrations/${name}.sql`,'utf8'));
  }
  await pool.query(sql);
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
    await pool.query("INSERT INTO artwork_report_events(report_id,event_type,actor_wallet) VALUES($1,'REPORT_SUBMITTED',$2)",[report,A]);
    await pool.query("INSERT INTO artwork_moderation_log(chain_id,artwork_id,action,reason,actor_wallet) VALUES(84532,1,'HIDE','Synthetic audit record',$1)",[A]);
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


  const remove=async(wallet,ids,core=CORE,client=pool)=>(await client.query('SELECT remove_auction_notifications($1,$2,$3) result',[wallet,core,ids])).rows[0].result;
  const removeModeration=async(wallet,ids,client=pool)=>(await client.query('SELECT remove_personal_moderation_notifications($1,$2) result',[wallet,ids])).rows[0].result;
  const retained=async()=>(await pool.query(`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM outbox_events t) outbox,
    (SELECT jsonb_agg(t ORDER BY id) FROM contract_events t) events,
    (SELECT jsonb_agg(t ORDER BY id) FROM artwork_reports t) reports,
    (SELECT jsonb_agg(t ORDER BY id) FROM artwork_report_events t) report_events,
    (SELECT jsonb_agg(t ORDER BY id) FROM artwork_moderation_log t) moderation_log`)).rows;

  await t.test('mixed ownership rejects atomically, bounded exact IDs replay, and read writes cannot restore removals',async()=>{
    await register(1);await auction(1);await bid(1);await bid(1,C);
    const own=(await inbox()).items.map(item=>item.id),foreign=(await inbox(B)).items[0].id;
    await notice();const other=await notice(B);
    const before=await retained();
    assert.deepEqual(await remove(A,[own[0],foreign]),{removed:false});
    assert.equal((await inbox()).items.length,own.length);
    for(const ids of [[],[own[0],own[0]],[null],['0'],Array.from({length:21},(_,i)=>String(i+1))]) {
      await assert.rejects(remove(A,ids),{code:'22023'});
      await assert.rejects(removeModeration(A,ids),{code:'22023'});
    }
    assert.deepEqual(await remove(A,own,OLD),{removed:false});
    const expected={removed:true,ids:[...own].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)};
    assert.deepEqual(await remove(A,own),expected);const saved=await stateHash();
    assert.deepEqual(await remove(A,own),expected);assert.equal(await stateHash(),saved);
    await markAuction(A,own,false);
    for(const suffix of ['', '_v2','_v3']) assert.equal((await pool.query(`SELECT read_auction_notifications${suffix}($1,$2) result`,[A,CORE])).rows[0].result.items.length,0);
    assert.equal((await summary()).auctionCount,0);assert.equal((await summary(B)).auctionCount,1);
    assert.equal((await inbox(B)).items[0].id,foreign);
    assert.deepEqual(await retained(),before);
    assert.equal((await pool.query('SELECT dismissed_at FROM artwork_report_notifications WHERE id=$1',[other])).rows[0].dismissed_at,null);
  });

  await t.test('dismissal precedes every history bound and exact bigint pagination reaches older rows',async()=>{
    await pool.query("SELECT setval('outbox_events_id_seq',9007199254740993,false)");
    for(let id=1;id<=44;id++){await register(id);await auction(id);}
    const newest=(await inbox()).items.slice(0,20).map(item=>item.id);
    assert.ok(BigInt(newest[0])>9007199254740991n);await remove(A,newest);
    const next=(await inbox()).items.slice(0,20).map(item=>item.id);await remove(A,next);
    for(const suffix of ['', '_v2','_v3']) {
      const result=(await pool.query(`SELECT read_auction_notifications${suffix}($1,$2) result`,[A,CORE])).rows[0].result;
      assert.equal(result.items.length,4);assert.deepEqual(result.items.map(item=>item.artwork_id),['4','3','2','1']);
      const older=(await pool.query(`SELECT read_auction_notifications${suffix}($1,$2,$3) result`,[A,CORE,result.items[1].id])).rows[0].result;
      assert.deepEqual(older.items.map(item=>item.artwork_id),['2','1']);
    }
    assert.equal((await summary()).auctionCount,4);
    await save(false,true,true,false);assert.equal((await inbox()).items.length,0);
    await save(true,true,true,false);assert.equal((await inbox()).items.length,4);
  });

  await t.test('removal of reminders does not starve later candidates or erase original events; expired replay succeeds',async()=>{
    for(let id=1;id<=24;id++){await register(id);await auction(id,id,now+300+id);}
    const page=await inbox();assert.equal(page.reminders.length,20);assert.equal(page.remindersCapped,true);
    const ids=page.reminders.map(item=>item.id),before=await retained();
    assert.equal((await summary()).reminderCount,24);await remove(A,ids);
    assert.deepEqual(await retained(),before);
    const next=await inbox();assert.equal(next.reminders.length,4);assert.equal(next.remindersCapped,false);
    assert.equal((await summary()).reminderCount,4);assert.ok(next.reminders.every(item=>!ids.includes(item.id)));
    await markAuction(A,ids,false);assert.equal((await summary()).reminderCount,4);
    await pool.query("UPDATE indexer_state SET last_indexed_at=now()-INTERVAL '10 minutes'");
    assert.deepEqual(await remove(A,ids),{removed:true,ids:[...ids].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)});
    assert.equal((await inbox()).reminders.length,0);
  });

  await t.test('moderation removal is recipient-only, repeatable and keeps complaint/audit/notification records',async()=>{
    const own=[];for(let i=0;i<25;i++)own.push(await notice());const foreign=await notice(B);
    const before=await retained();assert.deepEqual(await removeModeration(A,[own[0],foreign]),{removed:false});
    assert.equal((await summary()).moderationCount,25);
    assert.deepEqual(await removeModeration(A,own.slice(0,20)),{removed:true,ids:own.slice(0,20)});const saved=await stateHash();
    assert.deepEqual(await removeModeration(A,own.slice(0,20)),{removed:true,ids:own.slice(0,20)});assert.equal(await stateHash(),saved);
    await mark(A,own.slice(0,20),false);
    assert.equal((await summary()).moderationCount,5);assert.equal((await summary(B)).moderationCount,1);
    assert.equal((await pool.query('SELECT count(*)::INT n FROM artwork_report_notifications')).rows[0].n,26);
    assert.equal((await pool.query('SELECT count(*)::INT n FROM artwork_report_notifications WHERE recipient_wallet=$1 AND dismissed_at IS NULL',[A])).rows[0].n,5);
    assert.deepEqual(await retained(),before);
  });

  await t.test('private functions retain explicit ACLs, service access works, reapplying preserves dismissal',async()=>{
    await register(1);await auction(1);const id=(await inbox()).items[0].id,personal=await notice();
    const signatures=['remove_auction_notifications(text,text,bigint[])','remove_personal_moderation_notifications(text,bigint[])',
      summarySignature,markSignature,'read_auction_notifications(text,text,bigint)','read_auction_notifications_v2(text,text,bigint)','read_auction_notifications_v3(text,text,bigint)'];
    for(const role of ['anon','authenticated','service_role']){
      const client=await pool.connect();try{await client.query(`SET ROLE ${role}`);
        for(const signature of signatures)assert.equal((await client.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') ok",[signature])).rows[0].ok,role==='service_role');
        for(const table of ['auction_notification_reads','artwork_report_notifications'])if(role!=='service_role')await assert.rejects(client.query(`SELECT * FROM ${table}`),{code:'42501'});
        await assert.rejects(client.query('SELECT * FROM canonical_auction_notifications($1,$2)',[A,CORE]),{code:'42501'});
        if(role==='service_role') {
          assert.equal((await remove(A,[id],CORE,client)).removed,true);assert.equal((await removeModeration(A,[personal],client)).removed,true);
          await assert.rejects(client.query('UPDATE auction_notification_reads SET dismissed_at=NULL'),{code:'42501'});
        } else {
          await assert.rejects(remove(A,[id],CORE,client),{code:'42501'});
          await assert.rejects(removeModeration(A,[personal],client),{code:'42501'});
        }
      }finally{await client.query('RESET ROLE');client.release();}
    }
    const before=await stateHash();await pool.query(sql);assert.equal(await stateHash(),before);
    assert.equal((await summary()).auctionCount,0);assert.equal((await summary()).moderationCount,0);
    const acl=(await pool.query(`SELECT p.oid::regprocedure::TEXT name FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%notification%' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`)).rows;
    assert.deepEqual(acl,[]);
  });
});
