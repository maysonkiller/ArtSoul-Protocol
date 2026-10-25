// Real range synchronization and reminder RPCs against disposable PostgreSQL.
// All block headers/logs are synthetic; no live RPC, database, or worker access.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import {listIndexerMigrations} from '../scripts/apply-migrations.js';

const A=`0x${'1'.repeat(40)}`,CORE=`0x${'4'.repeat(40)}`;
const hash=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('event-only backfill keeps one range boundary header for truthful reminder freshness',{
  skip:available?false:'Disposable PostgreSQL requires Docker',timeout:90000
},async t=>{
  const container=`artsoul-boundary-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let created=false,pool;const priorRedis=process.env.REDIS_URL,priorSkip=process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL;
  process.env.REDIS_URL='';process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL='true';
  t.after(async()=>{await pool?.end();if(created)docker('rm','-f',container);
    if(priorRedis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=priorRedis;
    if(priorSkip===undefined)delete process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL;else process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL=priorSkip;});
  t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});t.mock.method(console,'error',()=>{});
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-boundary-fixture','-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');created=true;
  const endpoint=docker('port',container,'5432/tcp');assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool=new pg.Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',password:'local-boundary-fixture',connectionTimeoutMillis:1000});
  for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');await delay(100);await pool.query('SELECT 1');break;}catch(error){if(attempt>=80)throw error;await delay(250);}}
  await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  for(const migration of listIndexerMigrations())await pool.query(migration.sql);
  await pool.query(`CREATE TABLE artwork_moderation_visibility(chain_id NUMERIC,artwork_id NUMERIC,hidden BOOLEAN);
    CREATE TABLE artwork_media_chain_revisions(chain_id NUMERIC PRIMARY KEY,revision NUMERIC(78,0) NOT NULL);
    INSERT INTO artwork_media_chain_revisions VALUES(84532,0);`);
  for(const name of ['auction_notifications','auction_notification_lifecycle','auction_notification_reminders'])await pool.query(fs.readFileSync(`sql/migrations/${name}.sql`,'utf8'));
  await pool.query("INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,confirmation_depth,last_indexed_at,started_at,status) VALUES(84532,$1,100,100,3,now(),now(),'running')",[CORE]);
  const seconds=Number((await pool.query('SELECT floor(extract(epoch FROM statement_timestamp()))::TEXT value')).rows[0].value);
  const db={pool,query:async(q,p)=>(await pool.query(q,p)).rows,isBackpressure:()=>false,
    async batchInsert(table,columns,rows,conflict){
      assert.equal(table,'block_hashes');assert.deepEqual(columns,['chain_id','block_number','block_hash','parent_hash','timestamp']);
      const slots=rows.map((row,i)=>`(${row.map((_,j)=>`$${i*columns.length+j+1}`).join(',')})`).join(',');
      return pool.query(`INSERT INTO block_hashes(${columns.join(',')}) VALUES ${slots} ON CONFLICT ${conflict}`,rows.flat());
    }};
  let supplied=[],fetches=[],failure=null;
  const listener={chainId:84532,contractAddress:CORE,queryAllHistoricalEvents:async()=>supplied,
    async getBlock(number){fetches.push(number);if(failure==='throw')throw new Error('fixture header unavailable');if(failure==='null')return null;
      return {hash:hash(number),parentHash:hash(number-1),timestamp:seconds};}};
  const {default:Engine}=await import('../src/indexer/sync-engine.js');const engine=new Engine(db,listener);
  const event=(eventName,blockNumber,eventData,logIndex=0)=>({eventName,blockNumber,eventData,logIndex,contractAddress:CORE,
    transactionHash:hash(blockNumber*10+logIndex),timestamp:seconds*1000});
  const register=(id,n,logIndex=0)=>event('ArtworkRegistered',n,{artworkId:String(id),creator:A,metadataURI:'ipfs://fixture'},logIndex);
  const auction=(id,n,logIndex=0)=>event('AuctionCreated',n,{auctionId:String(id),artworkId:String(id),creator:A,startPrice:'1000',duration:'86400',endTime:String(seconds+1800),chainId:'84532'},logIndex);
  const run=async(from,to,events=[])=>{supplied=events;fetches=[];return engine.syncHistoricalEvents(from,to,{currentBlock:to+3});};
  const read=async()=>(await pool.query('SELECT read_auction_notifications_v3($1,$2) result',[A,CORE])).rows[0].result;
  const headers=async()=>(await pool.query('SELECT block_number::INTEGER number,timestamp::TEXT FROM block_hashes WHERE chain_id=84532 ORDER BY block_number')).rows;

  await t.test('a large quiet range fetches and stores exactly its boundary, not all empty blocks',async()=>{
    assert.equal(await run(101,100000),0);assert.deepEqual(fetches,[100000]);
    assert.deepEqual(await headers(),[{number:100000,timestamp:String(seconds)}]);
    assert.equal((await read()).remindersAvailable,true);
    const state=(await pool.query('SELECT last_indexed_block::TEXT indexed,last_confirmed_block::TEXT confirmed FROM indexer_state WHERE chain_id=84532')).rows[0];
    assert.deepEqual(state,{indexed:'100000',confirmed:'100000'});
  });

  await t.test('an event boundary is fetched once even when several logs share it',async()=>{
    assert.equal(await run(100001,100010,[register(1,100002),auction(1,100010),register(2,100010,1)]),3);
    assert.deepEqual(fetches,[100002,100010]);assert.equal((await headers()).length,3);
    const result=await read();assert.equal(result.remindersAvailable,true);assert.equal(result.reminders[0].auction_id,'1');
  });

  await t.test('a separate quiet boundary is retained alongside event blocks with no intermediate backfill',async()=>{
    assert.equal(await run(100011,100020,[register(3,100013)]),1);assert.deepEqual(fetches,[100013,100020]);
    assert.deepEqual((await headers()).map(row=>row.number),[100000,100002,100010,100013,100020]);
  });

  await t.test('failed or absent boundary headers keep history readable but suppress reminders without fabricated timestamps',async()=>{
    const before=await read(),reminderId=before.reminders[0].id;
    for(const [mode,boundary] of [['throw',100030],['null',100040]]){
      failure=mode;assert.equal(await run(boundary-9,boundary),0);assert.deepEqual(fetches,[boundary]);
      assert.equal((await pool.query('SELECT count(*)::INT n FROM block_hashes WHERE chain_id=84532 AND block_number=$1',[boundary])).rows[0].n,0);
      const unavailable=await read();assert.equal(unavailable.remindersAvailable,false);assert.deepEqual(unavailable.reminders,[]);assert.deepEqual(unavailable.items,before.items);
      assert.deepEqual((await pool.query('SELECT mark_auction_notifications_v3($1,$2,$3,true) result',[A,CORE,[reminderId]])).rows[0].result,{updated:false});
    }
    failure=null;await run(100041,100050);const recovered=await read();assert.equal(recovered.remindersAvailable,true);assert.equal(recovered.reminders[0].id,reminderId);
  });

  await t.test('explicit full backfill retains its existing all-block behavior',async()=>{
    process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL='false';await run(100051,100053);assert.deepEqual(fetches,[100051,100052,100053]);
    assert.equal((await read()).remindersAvailable,true);
  });
});
