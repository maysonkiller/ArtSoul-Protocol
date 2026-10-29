// Synthetic indexer logs and disposable PostgreSQL only; no live credentials or RPCs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import {listIndexerMigrations} from '../scripts/apply-migrations.js';

const A=`0x${'1'.repeat(40)}`,B=`0x${'2'.repeat(40)}`,C=`0x${'3'.repeat(40)}`,CORE=`0x${'4'.repeat(40)}`,OLD=`0x${'5'.repeat(40)}`,ZERO=`0x${'0'.repeat(40)}`;
const sql=fs.readFileSync('sql/migrations/auction_notification_lifecycle.sql','utf8');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('lifecycle inbox uses actual indexer events and private versioned PostgreSQL RPCs',{
  skip:available?false:'Disposable PostgreSQL requires Docker',timeout:120000
},async t=>{
  const container=`artsoul-inbox-lifecycle-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
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
  await pool.query(`INSERT INTO distributed_locks(lock_name,instance_id,fencing_token,expires_at)
    VALUES('notification-fixture','worker-fixture',1,clock_timestamp()+interval '1 hour')`);
  await pool.query(`CREATE TABLE artwork_moderation_visibility(chain_id NUMERIC,artwork_id NUMERIC,hidden BOOLEAN);
    CREATE TABLE artwork_media_chain_revisions(chain_id NUMERIC PRIMARY KEY,revision NUMERIC(78,0) NOT NULL);
    INSERT INTO artwork_media_chain_revisions VALUES(84532,0);
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;`);
  await pool.query(fs.readFileSync('sql/migrations/auction_notifications.sql','utf8'));
  await pool.query('INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,last_indexed_at,started_at) VALUES(84532,$1,10000,10000,now(),now())',[CORE]);
  // An existing v1 preference row must survive installation with lifecycle enabled.
  await pool.query('SELECT save_auction_notification_preferences($1,$2,0,true,false)',[C,CORE]);
  async function v1Snapshot(){
    const functions=(await pool.query(`SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('canonical_auction_notifications','read_auction_notifications','mark_auction_notifications','save_auction_notification_preferences') ORDER BY proname`)).rows;
    const columns=(await pool.query(`SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('auction_notification_reads','auction_notification_preferences','outbox_events')
      AND column_name<>'lifecycle' ORDER BY table_name,ordinal_position`)).rows;
    const constraints=(await pool.query(`SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint
      WHERE conrelid IN ('auction_notification_reads'::regclass,'auction_notification_preferences'::regclass,'outbox_events'::regclass) ORDER BY conname`)).rows;
    return crypto.createHash('sha256').update(JSON.stringify({functions,columns,constraints})).digest('hex');
  }
  const v1Hash=await v1Snapshot();
  await pool.query(sql);
  assert.equal(await v1Snapshot(),v1Hash,'install preserves v1 function definitions, existing columns and constraints');
  const {default:Engine}=await import('../src/indexer/sync-engine.js');
  const engine=new Engine({pool,query:async(q,p)=>(await pool.query(q,p)).rows},{chainId:84532,contractAddress:CORE,donationAddress:OLD});
  engine.getRecoveryAuthority=()=>({lockName:'notification-fixture',instanceId:'worker-fixture',fencingToken:'1',isCurrent:()=>true});
  let block=100;
  const hash=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
  async function event(name,data,source=CORE){
    const context=await engine._captureWriteContext();
    const n=++block;
    await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES(84532,$1,$2,$3,$4)',[n,hash(n+10000),hash(n+9999),1700000000+n]);
    const value={eventName:name,eventData:data,blockNumber:n,logIndex:0,transactionHash:hash(n),timestamp:(1700000000+n)*1000};
    if(source!==null)value.contractAddress=source;
    await engine._processEvent(value,context);return value;
  }
  const register=id=>event('ArtworkRegistered',{artworkId:String(id),creator:A,metadataURI:'ipfs://fixture'});
  const auction=(id,artwork=id,source=CORE)=>event('AuctionCreated',{auctionId:String(id),artworkId:String(artwork),creator:A,startPrice:'1000',duration:'86400',endTime:'2000000000',chainId:'84532'},source);
  const bid=(id,bidder=B,source=CORE)=>event('BidPlaced',{auctionId:String(id),bidder,bidAmount:'2000',depositAmount:'1000'},source);
  const end=(id,winner=B)=>event('AuctionEnded',{auctionId:String(id),winner,winningBid:winner===ZERO?'0':'2000',settlementDeadline:winner===ZERO?'0':'2000086400'});
  const settle=(id,artwork=id,token=id,source=CORE)=>event('SettlementCompleted',{auctionId:String(id),artworkId:String(artwork),winner:B,finalPrice:'2000',tokenId:String(token)},source);
  const resale=(token,buyer=C,seller=B)=>event('ResaleCompleted',{tokenId:String(token),seller,buyer,price:'3000',royaltyAmount:'165',platformFee:'30'});
  const read=async(wallet=A,before=null,v=2)=>(await pool.query(`SELECT read_auction_notifications${v===2?'_v2':''}($1,$2,$3) result`,[wallet,CORE,before])).rows[0].result;
  const mark=async(wallet,ids,value)=>(await pool.query('SELECT mark_auction_notifications_v2($1,$2,$3,$4) result',[wallet,CORE,ids,value])).rows[0].result;
  const prefs=async(wallet,revision,created=true,outbid=true,lifecycle=true)=>(await pool.query('SELECT save_auction_notification_preferences_v2($1,$2,$3,$4,$5,$6) result',[wallet,CORE,revision,created,outbid,lifecycle])).rows[0].result;
  const sourceRows=async(value)=>(await pool.query("SELECT id::TEXT,payload,idempotency_key FROM outbox_events WHERE correlation_id=$1 AND event_type='notification' ORDER BY id",[`84532-${value.transactionHash}-${value.logIndex}`])).rows;
  const types=async(wallet,artwork)=>(await read(wallet)).items.filter(row=>row.artwork_id===String(artwork)).map(row=>row.type).sort();
  let settlement,resaleEvent;

  await t.test('all personal lifecycle recipients are deterministic and v1 retains its exact categories and shape',async()=>{
    assert.deepEqual((await read(C)).preferences,{auction_created:true,outbid:false,lifecycle:true});
    assert.equal((await read(C)).preferencesRevision,1);
    await register(1);await auction(1);await bid(1,C);const second=await bid(1,B);await end(1);settlement=await settle(1,1,0);resaleEvent=await resale(0);
    assert.deepEqual(await types(A,1),['auction_created','bid_received','bid_received','sale_completed']);
    assert.deepEqual(await types(B,1),['auction_won','purchase_completed','resale_sold']);
    assert.deepEqual(await types(C,1),['resale_purchased']);
    const legacy=(await read(A,null,1)).items;
    assert.deepEqual(legacy.map(row=>row.type),['auction_created']);
    assert.equal(Object.hasOwn(legacy[0],'token_id'),false);
    const v2=(await read(A)).items.find(row=>row.type==='auction_created');
    assert.equal(v2.token_id,null);assert.equal(v2.amount_wei,null);assert.equal(v2.settlement_deadline,null);
    const won=(await read(B)).items.find(row=>row.type==='auction_won');
    assert.equal(won.auction_id,'1');assert.equal(won.amount_wei,'2000');assert.equal(won.settlement_deadline,'2000086400');
    const purchase=(await read(B)).items.find(row=>row.type==='purchase_completed');assert.equal(purchase.token_id,'0');assert.equal(purchase.amount_wei,'2000');
    const sale=(await read(B)).items.find(row=>row.type==='resale_sold');assert.equal(sale.auction_id,null);assert.equal(sale.token_id,'0');assert.equal(sale.amount_wei,'3000');
    const bidRows=await sourceRows(second);assert.equal(bidRows.length,2);
    assert.ok(bidRows.find(row=>row.payload.type==='outbid').idempotency_key.endsWith('-0-notification'));
    assert.equal(bidRows.find(row=>row.payload.type==='bid_received').idempotency_key,
      `notification-v2-${crypto.createHash('sha256').update(`84532-${second.transactionHash}-0-notification-bid_received-${A}`).digest('hex')}`);
    for(const value of [second,settlement,resaleEvent]){const before=await sourceRows(value);await engine._processEvent(value,await engine._captureWriteContext());assert.deepEqual(await sourceRows(value),before);}
    for(const wallet of [A,B,C])for(const item of (await read(wallet)).items)assert.equal(typeof item.id,'string');
  });

  await t.test('no-bid and missed-payment events do not conflate rounds or invent a winner',async()=>{
    await register(2);await auction(2);await end(2,ZERO);await auction(3,2);await bid(3);await end(3);
    await event('SettlementDefaulted',{auctionId:'3',winner:B,artistAmount:'800',platformAmount:'200'});
    assert.ok((await read(A)).items.some(row=>row.type==='auction_ended'&&row.auction_id==='2'));
    assert.equal((await read(B)).items.some(row=>row.type==='auction_won'&&row.auction_id==='2'),false);
    const missed=(await read(B)).items.find(row=>row.type==='payment_missed');assert.equal(missed.auction_id,'3');assert.equal(missed.amount_wei,null);
    const unpaid=(await read(A)).items.find(row=>row.type==='sale_unpaid');assert.equal(unpaid.auction_id,'3');
    await auction(4,2);await bid(4,C);
    assert.ok((await read(A)).items.some(row=>row.type==='bid_received'&&row.auction_id==='4'&&row.artwork_id==='2'));
    assert.equal((await read(A)).items.some(row=>row.type==='sale_completed'&&row.artwork_id==='2'),false);
  });

  await t.test('source, registry, indexed confirmations, creation and original mint proof fail closed',async()=>{
    const bought=(await read(C)).items.find(row=>row.type==='resale_purchased').id;
    async function hidden(){assert.equal((await read(C)).items.some(row=>row.id===bought),false);}
    for(const source of [null,OLD]){
      await pool.query('UPDATE contract_events SET contract_address=$1 WHERE transaction_hash=$2',[source,settlement.transactionHash]);await hidden();
    }
    await pool.query('UPDATE contract_events SET contract_address=$1 WHERE transaction_hash=$2',[CORE,settlement.transactionHash]);
    await pool.query("UPDATE event_processing_registry SET processing_status='failed' WHERE transaction_hash=$1",[settlement.transactionHash]);await hidden();
    await pool.query("UPDATE event_processing_registry SET processing_status='completed' WHERE transaction_hash=$1",[settlement.transactionHash]);
    for(const column of ['last_confirmed_block','last_indexed_block']){
      await pool.query(`UPDATE indexer_state SET ${column}=$1`,[resaleEvent.blockNumber-1]);await hidden();await pool.query(`UPDATE indexer_state SET ${column}=10000`);
    }
    const creation=(await pool.query("SELECT transaction_hash FROM contract_events WHERE event_name='AuctionCreated' AND event_data->>'auctionId'='1'")).rows[0].transaction_hash;
    await pool.query("UPDATE event_processing_registry SET processing_status='failed' WHERE transaction_hash=$1",[creation]);await hidden();
    await pool.query("UPDATE event_processing_registry SET processing_status='completed' WHERE transaction_hash=$1",[creation]);
    await pool.query('UPDATE contract_events SET contract_address=NULL WHERE transaction_hash=$1',[creation]);await hidden();
    await pool.query('UPDATE contract_events SET contract_address=$1 WHERE transaction_hash=$2',[CORE,creation]);
    const blockRow=(await pool.query('DELETE FROM block_hashes WHERE chain_id=84532 AND block_number=$1 RETURNING *',[settlement.blockNumber])).rows[0];await hidden();
    await pool.query('INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp) VALUES($1,$2,$3,$4,$5)',[blockRow.chain_id,blockRow.block_number,blockRow.block_hash,blockRow.parent_hash,blockRow.timestamp]);
    assert.equal((await read(C)).items.some(row=>row.id===bought),true);
    await register(5);await auction(5,5,null);const unknown=await bid(5);assert.equal((await sourceRows(unknown)).some(row=>row.payload.type==='bid_received'),false);
    await register(6);await auction(6);const missing=await bid(6,B,null);assert.equal((await sourceRows(missing)).some(row=>row.payload.type==='bid_received'),false);
    await assert.rejects(bid(6,B,OLD),/source does not match/);
    await register(7);await auction(7);await settle(7,7,7,null);const unknownMint=await resale(7);assert.equal((await sourceRows(unknownMint)).length,0);
    assert.equal((await read(C)).items.some(row=>row.token_id==='7'),false);
  });

  await t.test('mixed legacy and lifecycle marks are atomic, recipient-bound and share durable read state',async()=>{
    const mine=(await read(A)).items;const legacy=mine.find(row=>row.type==='auction_created').id,lifecycle=mine.find(row=>row.type==='bid_received').id;
    const other=(await read(B)).items[0].id;
    assert.deepEqual(await mark(A,[legacy,lifecycle,other],true),{updated:false});
    assert.equal((await read(A)).items.find(row=>row.id===legacy).read,false);
    assert.deepEqual(await mark(A,[legacy,lifecycle],true),{updated:true,ids:[legacy,lifecycle].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),read:true});
    assert.equal((await read(A,null,1)).items.find(row=>row.id===legacy).read,true);
    await assert.rejects(mark(A,[lifecycle,lifecycle],false),{code:'22023'});
    assert.deepEqual(await mark(A,[lifecycle,'9223372036854775806'],false),{updated:false});
    await mark(A,[lifecycle],false);assert.equal((await read(A)).items.find(row=>row.id===lifecycle).read,false);
    // Even a matching forged key cannot redirect the source event's recipient.
    const originalKey=(await pool.query('SELECT idempotency_key FROM outbox_events WHERE id=$1',[lifecycle])).rows[0].idempotency_key;
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)),idempotency_key='notification-v2-'||encode(sha256(convert_to(correlation_id||'-notification-'||(payload->>'type')||'-'||$1,'UTF8')),'hex') WHERE id=$2",[B,lifecycle]);
    assert.deepEqual(await mark(B,[lifecycle],true),{updated:false});
    await pool.query("UPDATE outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb($1::TEXT)),idempotency_key=$3 WHERE id=$2",[A,lifecycle,originalKey]);
  });

  await t.test('v1 and v2 preferences share CAS while v1 preserves lifecycle and v2 filtering happens before pagination',async()=>{
    const outcomes=await Promise.all([prefs(A,0,true,true,false),prefs(A,0,true,true,false)]);assert.equal(outcomes.filter(row=>row.saved).length,1);
    assert.equal((await read(A)).items.some(row=>row.type==='bid_received'),false);
    const v1=(await pool.query('SELECT save_auction_notification_preferences($1,$2,1,true,true) result',[A,CORE])).rows[0].result;
    assert.deepEqual(v1.preferences,{auction_created:true,outbid:true});assert.equal((await read(A)).preferences.lifecycle,false);
    assert.deepEqual(await prefs(A,1),{saved:false});await prefs(A,2,false,false,true);
    await pool.query("SELECT setval('outbox_events_id_seq',9007199254740993,false)");
    for(let id=20;id<45;id++){await register(id);await auction(id);}
    assert.ok((await read(A)).items.some(row=>row.type==='bid_received'));
    for(let id=20;id<45;id++)await bid(id);
    const first=await read(A);assert.equal(first.items.length,21);assert.ok(BigInt(first.items[0].id)>9007199254740991n);
    const second=await read(A,first.items.at(-1).id);assert.ok(second.items.length>0);assert.ok(second.items.every(row=>BigInt(row.id)<BigInt(first.items.at(-1).id)));
    assert.ok(first.items.every(row=>row.type==='bid_received'));
    await prefs(A,3,true,true,false);assert.equal((await read(A)).items.length,21);assert.ok((await read(A)).items.every(row=>row.type==='auction_created'));
    await prefs(A,4,true,true,true);
    await pool.query('INSERT INTO artwork_moderation_visibility VALUES(84532,44,true)');
    assert.equal((await read(A)).items.find(row=>row.artwork_id==='44').artworkAvailable,false);
  });

  await t.test('paired notices roll back together with their read rows and replay remains idempotent',async()=>{
    await register(60);await auction(60);await bid(60);await end(60);const completed=await settle(60);const rows=await sourceRows(completed);assert.equal(rows.length,2);
    for(const row of rows)await mark(row.payload.recipient,[row.id],true);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[completed.blockNumber]);
    assert.equal((await sourceRows(completed)).length,0);
    assert.equal((await pool.query('SELECT count(*)::INT n FROM auction_notification_reads WHERE outbox_id=ANY($1::BIGINT[])',[rows.map(row=>row.id)])).rows[0].n,0);
    assert.deepEqual(await mark(B,[rows[0].id],true),{updated:false});
    await engine._processEvent(completed,await engine._captureWriteContext());const rebuilt=await sourceRows(completed);assert.equal(rebuilt.length,2);
    await engine._processEvent(completed,await engine._captureWriteContext());assert.deepEqual(await sourceRows(completed),rebuilt);
    for(const row of rebuilt)assert.equal((await read(row.payload.recipient)).items.find(item=>item.id===row.id).read,false);
  });

  await t.test('a notification insertion failure rolls back the source and both recipients; retry applies once',async()=>{
    await register(61);await auction(61);await bid(61);await end(61);
    await pool.query(`CREATE FUNCTION reject_sale_notice_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.payload->>'type'='sale_completed' THEN RAISE EXCEPTION 'fixture notice failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_sale_notice_fixture BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_sale_notice_fixture();`);
    await assert.rejects(settle(61),/fixture notice failure/);
    const failedTx=hash(block);
    assert.equal((await pool.query('SELECT count(*)::INT n FROM contract_events WHERE transaction_hash=$1',[failedTx])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::INT n FROM outbox_events WHERE correlation_id=$1",[`84532-${failedTx}-0`])).rows[0].n,0);
    assert.equal((await pool.query('SELECT minted FROM v41_artworks WHERE chain_id=84532 AND artwork_id=61')).rows[0].minted,false);
    assert.equal((await pool.query('SELECT processing_status FROM event_processing_registry WHERE transaction_hash=$1',[failedTx])).rows[0].processing_status,'failed');
    await pool.query('DROP TRIGGER reject_sale_notice_fixture ON outbox_events; DROP FUNCTION reject_sale_notice_fixture();');
    const retry={eventName:'SettlementCompleted',eventData:{auctionId:'61',artworkId:'61',winner:B,finalPrice:'2000',tokenId:'61'},
      blockNumber:block,logIndex:0,transactionHash:failedTx,timestamp:(1700000000+block)*1000,contractAddress:CORE};
    await engine._processEvent(retry,await engine._captureWriteContext());assert.equal((await sourceRows(retry)).length,2);
    await engine._processEvent(retry,await engine._captureWriteContext());assert.equal((await sourceRows(retry)).length,2);
  });

  await t.test('completed pre-rollout events are not replayed to backfill lifecycle notices',async()=>{
    await register(62);await auction(62);
    const producer=engine._writeAuctionLifecycleNotificationsTx;
    let historical;
    try{engine._writeAuctionLifecycleNotificationsTx=async()=>{};historical=await bid(62);}finally{engine._writeAuctionLifecycleNotificationsTx=producer;}
    assert.equal((await sourceRows(historical)).length,0);
    await engine._processEvent(historical,await engine._captureWriteContext());assert.equal((await sourceRows(historical)).length,0);
  });

  await t.test('v2 RPCs have explicit grants, private helpers and fail-closed revision state after idempotent install',async()=>{
    await pool.query(sql);
    assert.equal(await v1Snapshot(),v1Hash,'applying twice preserves the exact v1 database contract');
    for(const name of ['read_auction_notifications_v2(text,text,bigint)','mark_auction_notifications_v2(text,text,bigint[],boolean)',
      'save_auction_notification_preferences_v2(text,text,integer,boolean,boolean,boolean)']){
      const row=(await pool.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') service,has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated",[name])).rows[0];
      assert.deepEqual(row,{service:true,anon:false,authenticated:false});
    }
    const helper='canonical_auction_notifications_v2(text,text,bigint,bigint[],boolean,boolean,boolean)';
    assert.equal((await pool.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[helper])).rows[0].allowed,false);
    for(const table of ['auction_notification_reads','auction_notification_preferences']){
      const row=(await pool.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') client,has_table_privilege('service_role',oid,'INSERT,UPDATE,DELETE') direct_write FROM pg_class WHERE oid=$1::regclass",[table])).rows[0];
      assert.deepEqual(row,{relrowsecurity:true,relforcerowsecurity:true,client:false,direct_write:false});
    }
    const client=await pool.connect();try{await client.query('SET ROLE service_role');assert.ok((await client.query('SELECT read_auction_notifications_v2($1,$2) result',[B,CORE])).rows[0].result.items.length>0);}finally{await client.query('RESET ROLE');client.release();}
    await pool.query('UPDATE artwork_media_chain_revisions SET revision=9007199254740993');assert.equal((await read()).chainRevision,'9007199254740993');
    await pool.query('DELETE FROM artwork_media_chain_revisions');await assert.rejects(read(),{code:'55000'});
    await pool.query('INSERT INTO artwork_media_chain_revisions VALUES(84532,0)');
  });

  await t.test('rewinding the original mint removes its later resale notices and private read acknowledgements',async()=>{
    const rows=await sourceRows(resaleEvent);assert.equal(rows.length,2);
    for(const row of rows)await mark(row.payload.recipient,[row.id],true);
    await pool.query('SELECT * FROM rollback_events_from_block($1,84532)',[settlement.blockNumber]);
    assert.equal((await sourceRows(settlement)).length,0);assert.equal((await sourceRows(resaleEvent)).length,0);
    assert.equal((await pool.query('SELECT count(*)::INT n FROM auction_notification_reads WHERE outbox_id=ANY($1::BIGINT[])',[rows.map(row=>row.id)])).rows[0].n,0);
    assert.equal((await read(C)).items.some(row=>row.type==='resale_purchased'),false);
    assert.deepEqual(await mark(C,rows.filter(row=>row.payload.recipient===C).map(row=>row.id),true),{updated:false});
  });
});
