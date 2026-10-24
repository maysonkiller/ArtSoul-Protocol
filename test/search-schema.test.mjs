// Disposable PostgreSQL only: no project connection strings or credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import { listIndexerMigrations } from '../scripts/apply-migrations.js';
import { refreshSearchMetadata } from '../src/indexer/search-metadata.js';

const migration = fs.readFileSync('sql/migrations/public_artwork_search.sql','utf8');
const currentRoundMigration = fs.readFileSync('sql/migrations/public_artwork_search_current_round.sql','utf8');
const container = `artsoul-search-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const A=`0x${'1'.repeat(40)}`,B=`0x${'2'.repeat(40)}`,C=`0x${'3'.repeat(40)}`,CORE=`0x${'4'.repeat(40)}`;
function docker(...args) { return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim(); }
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}

test('search migration participates in the ledger and no-default-grants rehearsal',()=>{
  assert.match(fs.readFileSync('docs/security/MIGRATION_RUNBOOK.md','utf8'),/public_artwork_search\.sql/);
  assert.match(fs.readFileSync('test/data-api-grants-integration.test.cjs','utf8'),/'public_artwork_search'/);
  assert.match(fs.readFileSync('docs/security/MIGRATION_RUNBOOK.md','utf8'),/public_artwork_search_current_round\.sql/);
  assert.match(fs.readFileSync('test/data-api-grants-integration.test.cjs','utf8'),/'public_artwork_search_current_round'/);
});

test('indexed global search, visibility and metadata lifecycle in PostgreSQL 17',{
  skip:available?false:'Disposable PostgreSQL requires Docker'
},async t=>{
  let created=false,pool;
  t.after(async()=>{if(pool)await pool.end();if(created)docker('rm','-f',container);});
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-search-fixture','-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');created=true;
  const endpoint=docker('port',container,'5432/tcp');assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool=new pg.Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',password:'local-search-fixture',connectionTimeoutMillis:1000});
  let ready=false;
  for(let n=0;n<60;n++){try{await pool.query('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
  assert.ok(ready);
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;`);
  for(const item of listIndexerMigrations())await pool.query(item.sql);
  await pool.query(`CREATE TABLE profiles(id UUID DEFAULT gen_random_uuid(),created_at TIMESTAMPTZ DEFAULT now(),wallet_address TEXT PRIMARY KEY,
    username TEXT,bio TEXT,avatar_url TEXT,twitter_handle TEXT,twitter_username TEXT,twitter_id TEXT,discord_username TEXT,discord_id TEXT,email TEXT);`);
  await pool.query(fs.readFileSync('sql/migrations/phase18_artwork_moderation_visibility.sql','utf8'));
  await pool.query(fs.readFileSync('sql/migrations/phase18_7b_supabase_security_hardening.sql','utf8'));
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;`);
  await pool.query(migration);
  await pool.query(`INSERT INTO indexer_state(chain_id,contract_address,last_confirmed_block,last_indexed_block,last_indexed_at,started_at) VALUES(84532,$1,1000,1000,now(),now());
  `,[CORE]);
  await pool.query(`INSERT INTO profiles(wallet_address,username,twitter_username,twitter_id,discord_username,discord_id,email) VALUES
    ($1,'Alice Artist','verified_alice','provider-private-123','AliceDiscord','123456789','private-inbox@example.test'),
    ($2,'Богдан','unverified_spoof',NULL,'unverified_discord',NULL,'other-private@example.test'),
    ($3,'Staff profile only',NULL,NULL,NULL,NULL,'staff-private@example.test')`,[A,B,C]);
  await pool.query(`INSERT INTO v41_artworks(chain_id,artwork_id,creator,metadata_uri,block_number,transaction_hash,log_index,last_updated_block)
    SELECT 84532,n,$1,jsonb_build_object('name',CASE WHEN n=1 THEN 'Oldest Искусство' ELSE 'Common artwork '||n END)::TEXT,100,
      '0x'||lpad(to_hex(n),64,'0'),0,100 FROM generate_series(1,260) n`,[A]);
  await pool.query(`UPDATE artwork_search_metadata SET title=metadata_uri::JSONB->>'name',metadata=metadata_uri::JSONB,metadata_status='ready';`);
  const rpc=async(q,category='artworks',before=null,limit=21)=>
    (await pool.query('SELECT result_key FROM search_public_artworks($1,$2,$3,$4,$5)',[q,category,CORE,before,limit])).rows.map(row=>row.result_key);
  const register=async(id,uri,creator=B)=>pool.query(`INSERT INTO v41_artworks(chain_id,artwork_id,creator,metadata_uri,block_number,transaction_hash,log_index,last_updated_block)
    VALUES(84532,$1::NUMERIC,$2,$3,101,'0x'||lpad(to_hex($1::NUMERIC::BIGINT),64,'0'),0,101)`,[id,creator,uri]);
  const db={query:async(sql,params)=>(await pool.query(sql,params)).rows};

  await t.test('full-corpus title and Unicode prefix lookup finds work older than the latest 200',async()=>{
    assert.deepEqual(await rpc('Oldest'),['1']);assert.deepEqual(await rpc('Искус'),['1']);
    assert.deepEqual(await rpc('artwork:1'),['1']);assert.deepEqual(await rpc('#1'),['1']);
    assert.deepEqual(await rpc('1'),['1']);assert.equal((await rpc('Common')).length,21);
    assert.deepEqual(await rpc("unknown') | !%_"),[]);
  });
  await t.test('creator names, verified handles and whole addresses match without private fields',async()=>{
    assert.equal((await rpc('Alice')).length,21);assert.deepEqual(await rpc('@verified_alice','artists'),[A]);
    assert.deepEqual(await rpc('AliceDiscord','artists'),[A]);assert.deepEqual(await rpc(A.toUpperCase(),'artists'),[A]);
    assert.deepEqual(await rpc('private-inbox'),[]);assert.deepEqual(await rpc('provider-private'),[]);
    assert.deepEqual(await rpc('Staff','artists'),[]);
    await register('261',JSON.stringify({name:'Separate'}));
    assert.deepEqual(await rpc('Бог','artists'),[B]);
    assert.deepEqual(await rpc('unverified_spoof'),[]);assert.deepEqual(await rpc('unverified_discord'),[]);
  });
  await t.test('hidden and other-chain results are excluded even for exact identifiers and addresses',async()=>{
    await pool.query('INSERT INTO artwork_moderation_visibility(chain_id,artwork_id,hidden) VALUES(84532,261,true)');
    assert.deepEqual(await rpc('261'),[]);assert.deepEqual(await rpc(B,'artists'),[]);
    await pool.query(`INSERT INTO v41_artworks(chain_id,artwork_id,creator,metadata_uri,block_number,transaction_hash,log_index,last_updated_block)
      VALUES(11155111,800,$1,'{"name":"Other chain"}',100,'0xlegacy',0,100)`,[B]);
    assert.deepEqual(await rpc('#800'),[]);
  });
  await t.test('pagination is descending and exact beyond JavaScript integer precision',async()=>{
    const big=String(2n**200n);
    await pool.query(`INSERT INTO v41_artworks(chain_id,artwork_id,creator,metadata_uri,block_number,transaction_hash,log_index,last_updated_block)
      VALUES(84532,$1,$2,'{"name":"Common huge"}',100,'0xhuge',0,100)`,[big,A]);
    await pool.query(`UPDATE artwork_search_metadata SET title='Common huge',metadata='{"name":"Common huge"}',metadata_status='ready' WHERE artwork_id=$1`,[big]);
    const first=await rpc('Alice');assert.equal(first[0],big);
    const second=await rpc('Alice','artworks',first.at(-1));assert.ok(second.every(id=>BigInt(id)<BigInt(first.at(-1))));
    assert.equal(new Set([...first,...second]).size,42);assert.deepEqual(await rpc(`#${big}`),[big]);
  });
  await t.test('Live auctions uses the current round and actual deadline',async()=>{
    await pool.query(`INSERT INTO v41_auctions(chain_id,auction_id,artwork_id,creator,start_price,duration,original_end_time,end_time,status,block_number,transaction_hash,log_index,last_updated_block)
      SELECT 84532,n,n/10,$1,10000000000000,86400,now()+INTERVAL '1 day',CASE WHEN n=40 THEN now()-INTERVAL '1 second' ELSE now()+INTERVAL '1 day' END,
      'active',100,'0xauction'||n,0,100 FROM unnest(ARRAY[30,40,50,51]) n`,[A]);
    await pool.query(`UPDATE v41_artworks SET active_auction_id=CASE artwork_id WHEN 3 THEN 30 WHEN 4 THEN 40 WHEN 5 THEN 51 END WHERE artwork_id IN(3,4,5);`);
    assert.deepEqual(await rpc('Alice','auctions'),['5','3']);
  });
  await t.test('forward repair matches the latest public round when mapping is absent or stale',async()=>{
    await pool.query('UPDATE v41_artworks SET active_auction_id=NULL WHERE chain_id=84532 AND artwork_id=3');
    assert.deepEqual(await rpc('Alice','auctions'),['5'],'the applied original misses a live round without its mapping');
    await pool.query(currentRoundMigration);
    assert.deepEqual(await rpc('Alice','auctions'),['5','3']);
    assert.deepEqual(await rpc('#3','auctions'),['3']);
    assert.equal((await pool.query('SELECT active_auction_id FROM v41_artworks WHERE chain_id=84532 AND artwork_id=3')).rows[0].active_auction_id,null,
      'the migration repairs the read rule, not the indexer data');
    await pool.query("UPDATE v41_auctions SET status='settled' WHERE chain_id=84532 AND auction_id=51");
    await pool.query('UPDATE v41_artworks SET active_auction_id=50 WHERE chain_id=84532 AND artwork_id=5');
    assert.deepEqual(await rpc('Alice','auctions'),['3'],'an older active mapped row cannot supersede a newer settled round');
    assert.deepEqual(await rpc('#5','auctions'),[]);assert.deepEqual(await rpc('#5'),['5']);
    const hydrated=(await pool.query('SELECT read_public_search_cards($1,$2) AS data',[['5'],CORE])).rows[0].data;
    assert.equal(hydrated.auctions[0].auction_id,'51');assert.equal(hydrated.auctions[0].status,'settled');
    await pool.query("UPDATE v41_auctions SET status='active',end_time=now()-INTERVAL '1 second' WHERE chain_id=84532 AND auction_id=51");
    assert.deepEqual(await rpc('Alice','auctions'),['3'],'the latest active-but-expired round is not live');
    await pool.query("UPDATE v41_auctions SET end_time=now()+INTERVAL '1 day' WHERE chain_id=84532 AND auction_id=51");
    assert.deepEqual(await rpc('Alice','auctions'),['5','3']);
  });
  await t.test('batch hydration preserves current owner, first collector and exact price without history truncation',async()=>{
    const token=String(2n**200n),price='1234567890123456789';
    await pool.query(`UPDATE v41_artworks SET minted=true,token_id=$1,canonical_floor=$2 WHERE chain_id=84532 AND artwork_id=6`,[token,price]);
    await pool.query(`INSERT INTO v41_settlements(chain_id,auction_id,artwork_id,winner,final_price,token_id,settlement_status,block_number,transaction_hash,log_index)
      VALUES(84532,60,6,$1,$2,$3,'completed',101,'0xsettled',0)`,[B,price,token]);
    await pool.query(`INSERT INTO v41_resale_history(chain_id,token_id,seller,buyer,price,royalty_amount,platform_fee,block_number,transaction_hash,log_index)
      VALUES(84532,$1,$2,$3,$4,0,0,102,'0xresold',0)`,[token,B,C,price]);
    await pool.query(`INSERT INTO artwork_social_signals(chain_id,artwork_id,wallet_address,signal_type)
      VALUES(84532,'6',$1,'like'),(84532,'6',upper($1),'like')`,[A]);
    const data=(await pool.query('SELECT read_public_search_cards($1,$2) AS data',[['6','1','261'],CORE])).rows[0].data;
    assert.deepEqual(data.artworks.map(row=>row.artwork_id),['1','6']);
    assert.equal(data.artworks[1].token_id,token);assert.equal(data.artworks[1].canonical_floor,price);
    assert.equal(data.settlements[0].winner,B);assert.equal(data.resales[0].buyer,C);assert.equal(data.signals[1].like,1);
    assert.equal(data.metadata[0].name,'Oldest Искусство');
  });
  await t.test('public roles cannot enumerate projection metadata or call internal RPCs',async()=>{
    const client=await pool.connect();try{
      for(const role of ['anon','authenticated']){
        await client.query(`SET ROLE ${role}`);
        await assert.rejects(client.query('SELECT * FROM artwork_search_metadata'),{code:'42501'});
        await assert.rejects(client.query("SELECT * FROM search_public_artworks('Alice','artists',$1)",[CORE]),{code:'42501'});
        await assert.rejects(client.query('SELECT read_public_search_cards($1,$2)',[['1'],CORE]),{code:'42501'});
        await client.query('RESET ROLE');
      }
      await client.query('SET ROLE service_role');
      assert.equal((await client.query("SELECT * FROM search_public_artworks('Oldest','artworks',$1)",[CORE])).rows[0].result_key,'1');
    }finally{await client.query('RESET ROLE');client.release();}
  });
  await t.test('worker drains at most four pending originals and records unavailable retries',async()=>{
    await pool.query(`UPDATE artwork_search_metadata SET metadata_status='ready';`);
    for(let id=500;id<505;id++)await register(String(id),JSON.stringify({name:`Fresh ${id}`}));
    let reads=0;
    const result=await refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE},async uri=>{reads++;return JSON.parse(uri);});
    assert.deepEqual(result,{checked:4,updated:4});assert.equal(reads,4);
    await refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE},async()=>({}));
    const failed=(await pool.query('SELECT metadata_status,next_attempt_at>now() AS delayed FROM artwork_search_metadata WHERE artwork_id=504')).rows[0];
    assert.deepEqual(failed,{metadata_status:'unavailable',delayed:true});
    assert.deepEqual(await rpc('Fresh'),['503','502','501','500']);
    assert.deepEqual(await refreshSearchMetadata(db,{chainId:11155111,coreAddress:CORE}),{checked:0,updated:0});
  });
  await t.test('URI change and same-ID reorg reinsertion reject late enrichment; deletion cascades',async()=>{
    const uri=JSON.stringify({name:'Old metadata'});await register('600',uri);
    let release,started;const beginning=new Promise(resolve=>{started=resolve;});
    const inFlight=refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE},async()=>{started();return new Promise(resolve=>{release=resolve;});});
    await beginning;
    await pool.query(`UPDATE v41_artworks SET metadata_uri='{"name":"Replacement"}' WHERE chain_id=84532 AND artwork_id=600`);
    release({name:'Stale title'});assert.equal((await inFlight).updated,0);
    assert.equal((await pool.query('SELECT metadata_status FROM artwork_search_metadata WHERE artwork_id=600')).rows[0].metadata_status,'pending');
    await refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE},async uri=>JSON.parse(uri));
    assert.deepEqual(await rpc('Replacement'),['600']);
    await register('601',uri);
    const againStart=new Promise(resolve=>{started=resolve;});
    const again=refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE},async()=>{started();return new Promise(resolve=>{release=resolve;});});
    await againStart;await pool.query('DELETE FROM v41_artworks WHERE chain_id=84532 AND artwork_id=601');await register('601',uri);
    release({name:'Stale same URI'});assert.equal((await again).updated,0);
    assert.equal((await pool.query('SELECT metadata_status FROM artwork_search_metadata WHERE artwork_id=601')).rows[0].metadata_status,'pending');
    await pool.query('DELETE FROM v41_artworks WHERE chain_id=84532 AND artwork_id=601');
    assert.equal((await pool.query('SELECT 1 FROM artwork_search_metadata WHERE artwork_id=601')).rowCount,0);
  });
  await t.test('malformed and oversized accepted JSON is deferred as unavailable without starving later originals',async()=>{
    const sources=[
      '{"name":"Bad\\u0000title"}',
      '{"name":"Nested invalid key","properties":{"bad\\u0000key":"value"}}',
      '{"name":"Nested surrogate","properties":{"value":"\\ud800"}}',
      '{"name":"Oversized decimal expansion","values":['+Array(25000).fill('1e20').join(',')+']}'
    ];
    // These are valid JSON documents accepted by the metadata reader. PostgreSQL
    // rejects the first three or exceeds our JSONB storage bound for the fourth.
    for(const source of sources)assert.doesNotThrow(()=>JSON.parse(source));
    for(const source of sources.slice(0,3))await assert.rejects(pool.query('SELECT $1::JSONB',[source]),error=>['22P02','22P05'].includes(error.code));
    assert.equal((await pool.query('SELECT octet_length($1::JSONB::TEXT)>524288 AS oversized',[sources[3]])).rows[0].oversized,true);
    for(let i=0;i<sources.length;i++)await register(String(700+i),sources[i]);
    const ordinary={name:'Ordinary 😀 \\u0000 title',properties:{text:'Искусство',enabled:true,zero:0}};
    await register('704',JSON.stringify(ordinary));
    assert.deepEqual(await refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE}),{checked:4,updated:4});
    const unavailable=(await pool.query(`SELECT artwork_id::TEXT,title,metadata,metadata_status,next_attempt_at>now()+INTERVAL '50 minutes' AS delayed
      FROM artwork_search_metadata WHERE artwork_id BETWEEN 700 AND 703 ORDER BY artwork_id`)).rows;
    assert.equal(unavailable.length,4);
    for(const row of unavailable){
      assert.equal(row.metadata_status,'unavailable');assert.equal(row.metadata,null);assert.equal(row.title,`Artwork #${row.artwork_id}`);assert.equal(row.delayed,true);
    }
    assert.deepEqual(await refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE}),{checked:1,updated:1});
    const retained=(await pool.query('SELECT title,metadata,metadata_status FROM artwork_search_metadata WHERE artwork_id=704')).rows[0];
    assert.equal(retained.title,ordinary.name);assert.deepEqual(retained.metadata,ordinary);assert.equal(retained.metadata_status,'ready');
  });
  await t.test('a failed database write cannot finish the batch before a slower sibling write completes',async()=>{
    await register('710','{"name":"Slow sibling"}');await register('711','{"name":"Failed write"}');
    let releaseSlow,markSlow,markFailure,finished=false;
    const slowGate=new Promise(resolve=>{releaseSlow=resolve;});
    const slowStarted=new Promise(resolve=>{markSlow=resolve;});
    const failedWrite=new Promise(resolve=>{markFailure=resolve;});
    const controlled={query:async(sql,params)=>{
      if(sql.startsWith('UPDATE') && params[2]==='710'){markSlow();await slowGate;}
      if(sql.startsWith('UPDATE') && params[2]==='711'){
        try{return(await pool.query(sql,params.map((value,index)=>index===1?'invalid-status':value))).rows;}
        catch(error){assert.equal(error.code,'23514');markFailure();throw error;}
      }
      return db.query(sql,params);
    }};
    const outcome=refreshSearchMetadata(controlled,{chainId:84532,coreAddress:CORE})
      .then(value=>{finished=true;return{value};},error=>{finished=true;return{error};});
    await Promise.all([slowStarted,failedWrite]);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(finished,false,'the in-flight guard must remain active until every row finishes');
    releaseSlow();const result=await outcome;assert.match(result.error.message,/Search metadata batch write failed/);
    const rows=(await pool.query('SELECT artwork_id::TEXT,metadata_status FROM artwork_search_metadata WHERE artwork_id IN(710,711) ORDER BY artwork_id')).rows;
    assert.deepEqual(rows,[{artwork_id:'710',metadata_status:'ready'},{artwork_id:'711',metadata_status:'pending'}]);
    assert.deepEqual(await refreshSearchMetadata(db,{chainId:84532,coreAddress:CORE}),{checked:1,updated:1});
  });
  await t.test('indexed text plans, validation, deployment guard and migration reapply',async()=>{
    await pool.query('SET enable_seqscan=off');
    const plan=(await pool.query("EXPLAIN SELECT artwork_id FROM artwork_search_metadata WHERE terms@@to_tsquery('simple','oldest:*')")).rows.map(row=>row['QUERY PLAN']).join('\n');
    assert.match(plan,/artwork_search_metadata_terms/);await pool.query('RESET enable_seqscan');
    for(const args of [['a','artworks',CORE,null,21],['Alice','all',CORE,null,21],['Alice','artists',CORE,null,22]]){
      await assert.rejects(pool.query('SELECT * FROM search_public_artworks($1,$2,$3,$4,$5)',args),{code:'22023'});
    }
    await assert.rejects(pool.query("SELECT * FROM search_public_artworks('Alice','artworks',$1)",[A]),{code:'55000'});
    await assert.rejects(pool.query('SELECT read_public_search_cards($1,$2)',[[String(2n**256n)],CORE]),{code:'22023'});
    const before=(await pool.query('SELECT count(*)::INT AS total FROM artwork_search_metadata')).rows[0].total;
    await pool.query(migration);
    await pool.query(currentRoundMigration);
    assert.equal((await pool.query('SELECT count(*)::INT AS total FROM artwork_search_metadata')).rows[0].total,before);
    assert.deepEqual(await rpc('Oldest'),['1']);
    assert.deepEqual(await rpc('#3','auctions'),['3'],'fresh installs and reapplication retain the forward repair');
  });
});
