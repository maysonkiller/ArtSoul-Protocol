// Atomic rewind, primary projections and boundary-pinned resale regression.
// Includes legacy prototype predecessors and concurrent writer recovery fences.
// Run with ARTSOUL_TEST_POSTGRES_BIN pointing at local PostgreSQL binaries.
// Always creates its own loopback-only cluster; never accepts a database URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const {execFileSync,spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {Pool} = require('pg');
const {Interface,keccak256} = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const BIN = process.env.ARTSOUL_TEST_POSTGRES_BIN;
const CHAIN = 84532, OTHER_CHAIN = 11155111, BOUNDARY = 110;
const CORE = `0x${'a'.repeat(40)}`, CREATOR = `0x${'b'.repeat(40)}`, WINNER = `0x${'c'.repeat(40)}`;
const hash = value => `0x${Number(value).toString(16).padStart(64, '0')}`;
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function isolatedEngineSource() {
  // Do not import queue/cache modules: queue.js reads .env and cache can contact
  // remote services. Only these external side effects are stubbed; all handlers,
  // digest SQL, rollback sequencing and actual SQL migrations remain unchanged.
  let source = read('src/indexer/sync-engine.js');
  assert(source.includes("import { enqueueAIJob } from '../queue.js';"));
  source = source.replace("import { enqueueAIJob } from '../queue.js';", 'const enqueueAIJob = async () => {};');
  source = source.replace("import cacheService from '../services/cache-service.js';",
    'const cacheService = {invalidateAuctionState: async () => {}, del: async () => {}, keys: {stats: value => value}};');
  const cacheImport = "const cacheService = (await import('../services/cache-service.js')).default;";
  assert(source.includes(cacheImport));
  source = source.replaceAll(cacheImport,
    "const cacheService = {purge: async options => { if (this.fixtureFailCachePurge) throw new Error('fixture cache purge failure'); return this.fixtureCachePurgeHook ? this.fixtureCachePurgeHook(options) : true; }};");
  return source.replace(/from '([^']+)'/g, (whole, specifier) => specifier.startsWith('.')
    ? `from '${pathToFileURL(path.resolve(ROOT, 'src/indexer', specifier)).href}'` : whole);
}

test('rewind events, cursor, hashes and media revision atomically (isolated PostgreSQL)', {
  skip: BIN ? false : 'Set ARTSOUL_TEST_POSTGRES_BIN; no database connection attempted',
  // The complete 250-check matrix includes ownership/history joins and also
  // runs on Windows disks. Only its overall allowance grows; individual SQL
  // statements, lease expiry and concurrency gates retain their short bounds.
  timeout: 900000
}, async t => {
  const suffix = `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const directory = path.join(ROOT, 'docs', 'private', `reorg-atomicity-${suffix}`);
  const data = path.join(directory, 'cluster');
  const executable = name => path.join(path.resolve(BIN), `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  fs.mkdirSync(path.dirname(directory), {recursive: true});
  fs.mkdirSync(directory); // Never reuse or overwrite another cluster.
  const port = await freePort();
  const evidence = {kind: 'atomic-rewind-regression', directory, port, host: '127.0.0.1', results: []};
  let pool, initialized = false;
  const command = (name, args) => execFileSync(executable(name), args, {
    cwd: directory, encoding: 'utf8', windowsHide: true,
    timeout: name === 'pg_ctl' && args.includes('stop') ? 185000 : 30000,
    // A Windows server child can retain inherited pipe handles after pg_ctl
    // exits. Server startup output is already captured by its explicit log.
    stdio: name === 'pg_ctl' && args.includes('start') ? 'ignore' : ['ignore', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
      TMP: process.env.TMP, HOME: directory, USERPROFILE: directory
    }
  });
  t.after(async () => {
    await pool?.end();
    if (initialized) {
      let running = false;
      try {command('pg_ctl', ['-D', data, 'status']); running = true;}
      catch (error) {if (error.status !== 3) throw error;}
      if (running) command('pg_ctl', ['-D', data, '-m', 'fast', '-t', '180', '-w', 'stop']);
      evidence.clusterStopped = true;
    }
    fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
    t.diagnostic(`Evidence retained: ${directory}; cluster stopped: ${evidence.clusterStopped === true}`);
  });
  evidence.postgresVersion = command('postgres', ['--version']).trim();
  command('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C']);
  initialized = true;
  fs.appendFileSync(path.join(data, 'postgresql.conf'), "\nunix_socket_directories = ''\n");
  command('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  pool = new Pool({host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: '',
    max: 3, connectionTimeoutMillis: 2000, statement_timeout: 10000});
  assert.equal(path.resolve((await pool.query('SHOW data_directory')).rows[0].data_directory), path.resolve(data),
    'the connection must be the newly created disposable cluster');
  assert.equal((await pool.query('SHOW listen_addresses')).rows[0].listen_addresses, '127.0.0.1');
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE EXTENSION pgcrypto');
  const migrations = [...read('src/indexer/setup-database.sql').matchAll(/^\\i (.+)$/gm)].map(match => match[1].trim());
  for (const migration of migrations) await pool.query(read(migration));
  for (const name of ['identity', 'preparation', 'submission', 'registration', 'reorg']) {
    await pool.query(read(`sql/migrations/artwork_media_${name}.sql`));
  }
  // Use the shipped inbox tables, source-proof readers and recipient mutation
  // RPCs. These migrations do not start an outbox processor or delivery worker.
  const notificationMigrations = ['phase18_artwork_moderation_visibility','a8b_artwork_report_intake',
    'a8c_protocol_admin_review','artist_support','artist_support_moderation','auction_notifications',
    'auction_notification_lifecycle','auction_notification_reminders','notification_summary','notification_inbox_removal',
    '20261029212603_notification_reorg_identity','20261029220854_recovery_cache_obligation','20261101120000_nft_transfer_coverage',
    '20261101130000_verified_nft_owners','20261101140000_verified_nft_history'];
  for (const name of notificationMigrations) await pool.query(read(`sql/migrations/${name}.sql`));
  evidence.migrations = [...migrations, ...['identity', 'preparation', 'submission', 'registration', 'reorg']
    .map(name => `sql/migrations/artwork_media_${name}.sql`), ...notificationMigrations.map(name=>`sql/migrations/${name}.sql`)];
  const engineFile = path.join(directory, 'isolated-engine.mjs');
  fs.writeFileSync(engineFile, isolatedEngineSource());
  const Engine = (await import(pathToFileURL(engineFile).href)).default;
  // Exercise the shipped confirmation method without importing runner startup,
  // dotenv configuration, provider constructors or monitoring timers.
  const runnerSource = read('src/indexer/production-runner.js');
  const confirmationStart = runnerSource.indexOf('    async _processConfirmations(');
  const confirmationEnd = runnerSource.indexOf('\n    async getHealth(',confirmationStart);
  assert.ok(confirmationStart>0 && confirmationEnd>confirmationStart);
  const runnerFile = path.join(directory,'isolated-confirmation-runner.mjs');
  fs.writeFileSync(runnerFile,`export default class ConfirmationRunner {\n${runnerSource.slice(confirmationStart,confirmationEnd)}\n}\n`);
  const ConfirmationRunner = (await import(pathToFileURL(runnerFile).href)).default;
  const Database = (await import(pathToFileURL(path.join(ROOT, 'src/indexer/postgresql-database.js')).href)).default;
  let beforeSql = null;
  const db = {pool: {async connect() {
    const client = await pool.connect();
    return {async query(sql, values) {await beforeSql?.(sql, client);return client.query(sql, values);},
      release: () => client.release()};
  }}, query: async (sql, values) => (await pool.query(sql, values)).rows,
    batchInsert: Database.prototype.batchInsert};
  const engine = chain => new Engine(db, {chainId: chain,contractAddress:CORE});
  const target = engine(CHAIN), other = engine(OTHER_CHAIN);
  const resaleInterface = new Interface(['function resaleListings(uint256) view returns(address seller,uint256 price,bool active)']);
  const resaleStates = new Map(), resaleReads = [];
  let rpcHook = null, headerHash = hash, leaderCurrent = true, leaderEpoch = 0;
  target.getRecoveryAuthority = () => {
    const epoch = leaderEpoch;
    return {lockName:'fixture-reorg',instanceId:'fixture-worker',fencingToken:'1',
      isCurrent: () => leaderCurrent && leaderEpoch === epoch};
  };
  target.eventListener._readRpcCall = async operation => operation({async send(method, params) {
    await rpcHook?.(method,params);
    if(method==='eth_chainId') return '0x14a34';
    if(method==='eth_getBlockByNumber') return {number:params[0],hash:headerHash(Number(BigInt(params[0])))};
    assert.equal(method,'eth_call');assert.deepEqual(params[1],{blockHash:hash(109),requireCanonical:true});
    const id = resaleInterface.decodeFunctionData('resaleListings',params[0].data)[0].toString();
    resaleReads.push(id);
    return resaleInterface.encodeFunctionResult('resaleListings',resaleStates.get(id) || [WINNER,2500n,true]);
  }});
  async function apply(instance, name, block, eventData, logIndex = 0) {
    const transactionHash = '0x' + crypto.createHash('sha256')
      .update(JSON.stringify([instance.chainId,name,block,eventData,logIndex])).digest('hex');
    const event = {eventName: name, eventData, blockNumber: block, transactionHash,
      logIndex, timestamp: 1700000000000 + block * 2000};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO contract_events(chain_id,event_name,artwork_id,block_number,
        transaction_hash,log_index,event_data,indexed_at) VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0))`,
        [instance.chainId, name, eventData.artworkId || 1, block, event.transactionHash,logIndex,JSON.stringify(eventData),event.timestamp]);
      await client.query(`INSERT INTO event_processing_registry(event_hash,chain_id,transaction_hash,log_index,
        event_name,block_number,processing_status) VALUES($1,$2,$1,$3,$4,$5,'completed')`,
        [event.transactionHash, instance.chainId, logIndex,name,block]);
      await instance[`_handle${name}Tx`](event, client);
      await instance._recordPublicMetricEventTx(event,client);
      await client.query('COMMIT');
    } catch (error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
  }
  const tables = ['v41_artworks', 'v41_auctions', 'v41_bids', 'v41_settlements', 'v41_trust_signals',
    'v41_auction_extensions','v41_auction_endings','v41_floor_history',
    'v41_public_metric_events','v41_public_metric_participants','v41_public_metrics',
    'contract_events', 'event_processing_registry', 'indexer_state', 'block_hashes',
    'artwork_media_rewinds', 'artwork_media_chain_revisions','v41_resale_listings','v41_resale_history',
    'v41_project_eligibility','v41_genesis_holders','nft_transfer_coverage'];
  async function snapshot(chain) {
    const result = {};
    for (const table of tables) result[table] = (await pool.query(
      `SELECT to_jsonb(t) AS value FROM ${table} t WHERE chain_id=$1 ORDER BY to_jsonb(t)::TEXT`, [chain]))
      .rows.map(row => row.value);
    return result;
  }
  async function reset() {
    // Local database only; all included tables were just created by this test.
    await pool.query(`TRUNCATE ${tables.join(',')},outbox_events,distributed_locks,
      auction_notification_reads,auction_notification_preferences CASCADE`);
    beforeSql = null;rpcHook = null;headerHash = hash;leaderCurrent = true;leaderEpoch = 0;resaleStates.clear();resaleReads.length=0;
    await pool.query(`INSERT INTO distributed_locks(lock_name,instance_id,fencing_token,expires_at)
      VALUES('fixture-reorg','fixture-worker',1,clock_timestamp()+INTERVAL '1 hour')`);
    await pool.query('INSERT INTO artwork_media_chain_revisions VALUES(84532,0)');
    for (const instance of [target, other]) {
      instance.fixtureFailCachePurge = false;
      instance.fixtureCachePurgeHook = null;
      instance.recoveryCachePurgePending = false;
      instance.isRunning = false;
      await pool.query(`INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,
        last_indexed_at,started_at,state_hash,recovery_cache_token) VALUES($1,$2,115,115,NOW(),NOW(),'0x0',NULL)`, [instance.chainId, CORE]);
      for (const block of [100, 105, 109, 110, 115]) await pool.query(`INSERT INTO block_hashes
        (chain_id,block_number,block_hash,parent_hash,timestamp) VALUES($1,$2,$3,$4,$5)`,
        [instance.chainId, block, hash(block), hash(block - 1), 1700000000 + block * 2]);
      await apply(instance, 'ArtworkRegistered', 100, {artworkId: 1, creator: CREATOR, metadataURI: 'ipfs://fixture-only'});
      await apply(instance, 'AuctionCreated', 105, {auctionId: 1, artworkId: 1, creator: CREATOR,
        startPrice: 1000, duration: 86400, endTime: 1700086400});
      await pool.query('UPDATE indexer_state SET state_hash=$1 WHERE chain_id=$2',
        [await instance._computeStateHash(115), instance.chainId]);
    }
  }
  async function seedCoverage(chain=CHAIN, changes={}, client=pool) {
    const row={chain_id:chain,core_address:CORE,nft_address:'0x'+'d'.repeat(40),from_block:100,
      origin_block_hash:hash(99),covered_through:115,covered_hash:hash(115),core_code_hash:hash(900),nft_code_hash:hash(901),...changes};
    const keys=Object.keys(row);
    await client.query('INSERT INTO nft_transfer_coverage('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row));
  }
  async function coverageRows(chain) {
    return (await pool.query('SELECT * FROM nft_transfer_coverage WHERE chain_id=$1 ORDER BY core_address,nft_address',[chain])).rows;
  }
  t.beforeEach(reset);

  for (const sampleSize of [12, 2, undefined]) await t.test(
    `a fork before sparse sampled headers removes every orphan auction (sample ${sampleSize ?? 'default'})`, async () => {
      await pool.query('DELETE FROM block_hashes WHERE chain_id=$1 AND block_number=109',[CHAIN]);
      if (sampleSize === undefined) {
        for (let number=111;number<=124;number++) await pool.query(`INSERT INTO block_hashes
          (chain_id,block_number,block_hash,parent_hash,timestamp) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(chain_id,block_number) DO NOTHING`,[CHAIN,number,hash(number),hash(number-1),1700000000+number*2]);
        await pool.query('UPDATE indexer_state SET last_indexed_block=124,last_confirmed_block=124,state_hash=$1 WHERE chain_id=$2',
          [await target._computeStateHash(124),CHAIN]);
      }
      headerHash=number=>hash(number>=103?number+10000:number);
      const original=target.eventListener.getBlock, queried=[];
      target.eventListener.getBlock=async number=>{queried.push(number);return {hash:headerHash(number)};};
      const foreign=await snapshot(OTHER_CHAIN);
      assert.equal((await snapshot(CHAIN)).v41_auctions.length,1);
      try { assert.equal(await target.detectReorg({sampleSize}),true); }
      finally {target.eventListener.getBlock=original;}
      const after=await snapshot(CHAIN);
      assert.equal(after.v41_auctions.length,0,'an orphan predating the first sampled mismatch must not survive');
      assert.equal(after.v41_artworks.length,1,'the retained registration remains');
      assert.deepEqual(after.contract_events.map(row=>row.event_name),['ArtworkRegistered']);
      assert.equal(after.indexer_state[0].last_indexed_block,100);
      assert.equal(after.indexer_state[0].last_confirmed_block,100);
      assert.deepEqual(after.block_hashes.map(row=>row.block_number),[100]);
      assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);
      evidence.results.push({name:'sparse common ancestor',sampleSize:sampleSize??'default',forkStart:103,
        queried,rewindTo:100,orphanAuctions:after.v41_auctions.length});
    });

  await t.test('a state revision changed during detection cannot authorize a fresh rewind',async()=>{
    const original=target.eventListener.getBlock;
    let concurrent;
    target.eventListener.getBlock=async()=>{
      await pool.query('UPDATE indexer_state SET last_indexed_block=last_indexed_block WHERE chain_id=$1',[CHAIN]);
      concurrent=await snapshot(CHAIN);
      return {hash:hash(999)};
    };
    try {await assert.rejects(target.detectReorg(),/snapshot is stale/);}
    finally {target.eventListener.getBlock=original;}
    assert.deepEqual(await snapshot(CHAIN),concurrent);
  });

  await t.test('a changed final ancestor aborts zero-resale recovery before any database mutation',async()=>{
    let headers=0;
    rpcHook=async method=>{if(method==='eth_getBlockByNumber'&&++headers===2)headerHash=()=>hash(999);};
    const before=await snapshot(CHAIN);
    await assert.rejects(target._handleReorg(BOUNDARY),/ancestor changed/);
    assert.deepEqual(await snapshot(CHAIN),before);
  });

  function historicalWriter(events) {
    const writer = engine(CHAIN);
    writer.getRecoveryAuthority = target.getRecoveryAuthority;
    writer._shouldSkipEmptyBlockHashBackfill = () => true;
    Object.assign(writer.eventListener, {
      _readRpcCall: target.eventListener._readRpcCall,
      queryAllHistoricalEvents: async () => events,
      getCurrentBlock: async () => 132,
      getBlock: async number => ({hash:hash(number),parentHash:hash(number-1),timestamp:1700000000+number*2})
    });
    return writer;
  }
  function bufferedBid(block = 118) {
    return {eventName:'BidPlaced',eventData:{auctionId:1,bidder:WINNER,bidAmount:2500,depositAmount:10000},
      blockNumber:block,transactionHash:hash(block+10000),logIndex:0,contractAddress:CORE,
      blockHash:hash(block),timestamp:1700000000000+block*2000};
  }
  async function writerSnapshot() {
    return {chain:await snapshot(CHAIN),
      outbox:(await pool.query('SELECT to_jsonb(o) AS value FROM outbox_events o ORDER BY id')).rows.map(row=>row.value)};
  }
  const fenceLost = error => error?.code === 'INDEXER_WRITE_FENCE_LOST';
  const settle = operation => operation.then(value=>({value}),error=>({error}));
  async function reach(gate, operation) {
    await Promise.race([gate.promise, operation.then(outcome => {
      throw new Error(`Operation finished before reaching its concurrency gate: ${outcome.error?.message || 'unexpected success'}`);
    })]);
  }
  const notificationEvent=(eventName,eventData,blockNumber,logIndex,tx)=>({eventName,eventData,blockNumber,logIndex,
    transactionHash:hash(tx),contractAddress:CORE,blockHash:hash(blockNumber),timestamp:1700000000000+blockNumber*2000});
  async function emitNotificationEvent(writer,value) {
    const context=await writer._captureWriteContext();
    await writer._storeBlockHashesForBlocks([value.blockNumber],context);
    await writer.processEvent(value,context);
  }
  const notificationRows=async value=>(await pool.query(`SELECT id::TEXT,aggregate_type,aggregate_id,payload,
    idempotency_key,correlation_id,processing_status FROM outbox_events WHERE event_type='notification'
    AND correlation_id=$1 ORDER BY id`,[`${CHAIN}-${value.transactionHash}-${value.logIndex}`])).rows;
  const notificationInbox=async wallet=>(await pool.query('SELECT read_auction_notifications_v3($1,$2) AS value',[wallet,CORE])).rows[0].value;
  async function assertReminderSummary(count) {
    const before=await notificationSnapshot();
    const summary=(await pool.query('SELECT read_notification_summary($1,$2,true,true,true) AS value',[CREATOR,CORE])).rows[0].value;
    assert.equal(summary.remindersAvailable,true);assert.equal(summary.reminderCount,count);
    assert.deepEqual(await notificationSnapshot(),before,'summary reads do not materialize or rebind notifications');
  }
  const notificationReads=async ids=>(await pool.query(`SELECT wallet_address,core_address,outbox_id::TEXT,read,dismissed_at,updated_at
    FROM auction_notification_reads WHERE outbox_id=ANY($1::BIGINT[]) ORDER BY outbox_id`,[ids])).rows;
  async function markNotification(wallet,id,{dismiss=false,read=true}={}) {
    assert.equal((await pool.query('SELECT mark_auction_notifications_v3($1,$2,$3,$4) AS value',
      [wallet,CORE,[id],read])).rows[0].value.updated,true);
    if(dismiss) assert.equal((await pool.query('SELECT remove_auction_notifications($1,$2,$3) AS value',
      [wallet,CORE,[id]])).rows[0].value.removed,true);
  }
  async function notificationFixture({dismissReceived=true}={}) {
    const writer=historicalWriter([]), event=notificationEvent;
    await emitNotificationEvent(writer,event('ArtworkRegistered',{artworkId:2,creator:CREATOR,metadataURI:'ipfs://notification-replay-fixture'},100,1,20000));
    await emitNotificationEvent(writer,event('AuctionCreated',{auctionId:2,artworkId:2,creator:CREATOR,startPrice:1000,
      duration:86400,endTime:1700086400,chainId:CHAIN},105,2,20001));
    await emitNotificationEvent(writer,event('BidPlaced',{auctionId:2,bidder:WINNER,bidAmount:1500,depositAmount:10000},108,3,20002));
    const original=event('BidPlaced',{auctionId:2,bidder:`0x${'d'.repeat(40)}`,bidAmount:2500,depositAmount:10000},112,7,29000);
    await emitNotificationEvent(writer,original);
    const rows=await notificationRows(original),outbid=rows.find(row=>row.payload.type==='outbid'),received=rows.find(row=>row.payload.type==='bid_received');
    assert.ok(outbid && received);
    await markNotification(WINNER,outbid.id);
    await markNotification(CREATOR,received.id,{dismiss:dismissReceived});
    return {writer,original,rows,outbid,received,reads:await notificationReads(rows.map(row=>row.id))};
  }
  async function replayNotifications(writer,events) {
    writer.eventListener.queryAllHistoricalEvents=async()=>events;
    await writer.syncHistoricalEvents(110,120,{currentBlock:132});
  }
  const notificationReplay=(original,changes={})=>({...original,blockNumber:118,blockHash:hash(118),
    timestamp:1700000000000+118*2000,logIndex:11,...changes});
  async function notificationSnapshot() {
    return {outbox:(await pool.query('SELECT to_jsonb(o) AS value FROM outbox_events o ORDER BY id')).rows.map(row=>row.value),
      identities:(await pool.query('SELECT to_jsonb(i) AS value FROM artsoul_private.notification_reorg_identities i ORDER BY identity_key')).rows.map(row=>row.value),
      reads:(await pool.query('SELECT to_jsonb(r) AS value FROM auction_notification_reads r ORDER BY outbox_id,wallet_address')).rows.map(row=>row.value)};
  }
  async function assertPostgresWait(waiter,blocker) {
    const deadline=Date.now()+5000;
    while(Date.now()<deadline) {
      const row=(await pool.query('SELECT $2::INT=ANY(pg_blocking_pids($1::INT)) AS blocked',
        [waiter,blocker])).rows[0];
      if(row.blocked) return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail('expected the operation to wait on the real PostgreSQL transaction');
  }
  for (const shiftedIndex of [false,true]) await t.test(`same transaction replay with ${shiftedIndex?'shifted':'unchanged'} log index preserves recipient read and dismissal state`, async () => {
    const {writer,original,rows:originalRows,outbid,received,reads:originalReadRows}=await notificationFixture();
    const sourceItems=async wallet=>(await notificationInbox(wallet)).items.filter(item=>item.transaction_hash===original.transactionHash);
    assert.equal(originalRows.length,2,'actual Engine writes both the outbid and bid-received notices');
    assert.equal(originalReadRows.length,2);
    assert.equal((await sourceItems(WINNER))[0].read,true);
    assert.deepEqual(await sourceItems(CREATOR),[]);

    await target._handleReorg(BOUNDARY);
    const sourceAbsent={winnerItems:await sourceItems(WINNER),creatorItems:await sourceItems(CREATOR),
      readRows:await notificationReads(originalRows.map(row=>row.id)),canonicalProofs:[]};
    for(const [wallet,id] of [[WINNER,outbid.id],[CREATOR,received.id]]) {
      sourceAbsent.canonicalProofs.push((await pool.query(`SELECT id::TEXT FROM canonical_auction_notifications_v2($1,$2,NULL,$3::BIGINT[])`,
        [wallet,CORE,[id]])).rows);
    }
    assert.deepEqual(sourceAbsent.winnerItems,[]);
    assert.deepEqual(sourceAbsent.creatorItems,[]);
    assert.deepEqual(sourceAbsent.canonicalProofs,[[],[]],'removed canonical source cannot authorize either notice');
    assert.deepEqual(sourceAbsent.readRows,originalReadRows,'orphaning preserves recipient intent');

    const replay={...original,blockNumber:118,blockHash:hash(118),timestamp:1700000000000+118*2000,
      logIndex:shiftedIndex?11:original.logIndex};
    writer.eventListener.queryAllHistoricalEvents=async()=>[replay];
    await writer.syncHistoricalEvents(110,120,{currentBlock:132});
    const replayRows=await notificationRows(replay), winnerItems=await sourceItems(WINNER), creatorItems=await sourceItems(CREATOR);
    const replayReadRows=await notificationReads(replayRows.map(row=>row.id));
    evidence.results.push({scenario:`same_transaction_notification_replay_${shiftedIndex?'shifted':'unchanged'}_log_index`,
      transactionHash:original.transactionHash,originalLogIndex:original.logIndex,replayLogIndex:replay.logIndex,
      originalRows,originalReadRows,sourceAbsent,replayRows,replayReadRows,winnerItems,creatorItems});
    assert.deepEqual(replayRows.map(row=>row.id),originalRows.map(row=>row.id),'identical effects keep their original serial IDs');
    assert.deepEqual(replayReadRows,originalReadRows,'read and dismissal timestamps survive unchanged');
    assert.deepEqual({readNoticeRead:winnerItems[0]?.read,dismissedNoticeVisible:creatorItems.length>0},
      {readNoticeRead:true,dismissedNoticeVisible:false},'re-inclusion must not make read or dismissed notifications new again');
  });
  for(const changed of ['transaction','source data']) await t.test(`changed notification ${changed} cannot inherit read or dismissal state`,async()=>{
    const fixture=await notificationFixture();
    await target._handleReorg(BOUNDARY);
    const replay=notificationReplay(fixture.original,changed==='transaction'?{transactionHash:hash(29001)}:
      {eventData:{...fixture.original.eventData,bidAmount:3500}});
    await replayNotifications(fixture.writer,[replay]);
    const rows=await notificationRows(replay);
    assert.equal(rows.length,2);
    assert.ok(rows.every(row=>!fixture.rows.some(old=>old.id===row.id)));
    assert.deepEqual(await notificationReads(rows.map(row=>row.id)),[]);
    assert.deepEqual(await notificationReads(fixture.rows.map(row=>row.id)),fixture.reads);
    for(const wallet of [WINNER,CREATOR]) {
      const items=(await notificationInbox(wallet)).items.filter(item=>item.transaction_hash===replay.transactionHash);
      assert.equal(items.length,1);assert.equal(items[0].read,false);
    }
  });
  await t.test('changed outbid recipient does not inherit another wallet intent',async()=>{
    const fixture=await notificationFixture(),previous=`0x${'e'.repeat(40)}`;
    await target._handleReorg(BOUNDARY);
    const predecessor=notificationEvent('BidPlaced',{auctionId:2,bidder:previous,bidAmount:2000,depositAmount:10000},111,6,29002);
    const replay=notificationReplay(fixture.original);
    await replayNotifications(fixture.writer,[predecessor,replay]);
    const rows=await notificationRows(replay),outbid=rows.find(row=>row.payload.type==='outbid');
    assert.equal(outbid.payload.recipient,previous);assert.notEqual(outbid.id,fixture.outbid.id);
    assert.deepEqual(await notificationReads([outbid.id]),[]);
    assert.equal(rows.find(row=>row.payload.type==='bid_received').id,fixture.received.id,
      'unchanged creator effect retains its separate dismissal');
    const items=(await notificationInbox(previous)).items.filter(item=>item.transaction_hash===replay.transactionHash);
    assert.equal(items.length,1);assert.equal(items[0].read,false);
    assert.deepEqual((await notificationInbox(WINNER)).items.filter(item=>item.transaction_hash===replay.transactionHash),[]);
  });
  await t.test('changed notification payload cannot reuse a durable identity',async()=>{
    const fixture=await notificationFixture(),old=fixture.outbid;
    await target._handleReorg(BOUNDARY);
    const write=fixture.writer._writeToOutbox;
    fixture.writer._writeToOutbox=async function(client,type,aggregate,id,payload,...rest) {
      return write.call(this,client,type,aggregate,id,payload.type==='outbid'?{...payload,newAmount:'3500'}:payload,...rest);
    };
    const replay=notificationReplay(fixture.original);
    await replayNotifications(fixture.writer,[replay]);
    const id=(await notificationRows(replay)).find(row=>row.payload.type==='outbid').id;
    assert.notEqual(id,old.id);assert.deepEqual(await notificationReads([id]),[]);
    assert.deepEqual(await notificationReads(fixture.rows.map(row=>row.id)),fixture.reads);
  });
  await t.test('replay preserves an already completed outbox processing record',async()=>{
    const fixture=await notificationFixture();
    await pool.query(`UPDATE outbox_events SET processing_status='completed',processed_at=clock_timestamp(),
      processing_attempts=2,last_attempt_at=clock_timestamp() WHERE id=$1`,[fixture.outbid.id]);
    const processing=async()=>(await pool.query(`SELECT processing_status,processed_at,processing_attempts,last_attempt_at
      FROM outbox_events WHERE id=$1`,[fixture.outbid.id])).rows[0];
    const before=await processing();
    await target._handleReorg(BOUNDARY);
    await replayNotifications(fixture.writer,[notificationReplay(fixture.original)]);
    assert.deepEqual(await processing(),before,'recovery does not turn a completed effect into pending work');
  });
  await t.test('a different event at the retired global log index cannot collide with its old key',async()=>{
    const fixture=await notificationFixture();
    await target._handleReorg(BOUNDARY);
    const replacement=notificationEvent('AuctionCreated',{auctionId:3,artworkId:2,creator:CREATOR,startPrice:1000,
      duration:86400,endTime:1700086400,chainId:CHAIN},118,7,29000);
    await replayNotifications(fixture.writer,[replacement]);
    const rows=await notificationRows(replacement);
    assert.equal(rows.length,1);assert.equal(rows[0].payload.type,'auction_created');
    assert.notEqual(rows[0].id,fixture.outbid.id);assert.equal(rows[0].idempotency_key,fixture.outbid.idempotency_key);
    assert.deepEqual(await notificationReads([rows[0].id]),[]);
    assert.deepEqual(await notificationReads(fixture.rows.map(row=>row.id)),fixture.reads);
    const items=(await notificationInbox(CREATOR)).items.filter(item=>item.transaction_hash===replacement.transactionHash);
    assert.equal(items.length,1);assert.equal(items[0].id,rows[0].id);assert.equal(items[0].read,false);
  });
  await t.test('identical repeated log occurrences retain distinct notification IDs and recipient intent',async()=>{
    const fixture=await notificationFixture({dismissReceived:false});
    const second={...fixture.original,logIndex:8};
    await emitNotificationEvent(fixture.writer,second);
    const secondNotice=(await notificationRows(second)).find(row=>row.payload.type==='bid_received');
    assert.ok(secondNotice);assert.notEqual(secondNotice.id,fixture.received.id);
    // Give the otherwise identical effects different recipient-owned states.
    await markNotification(CREATOR,secondNotice.id,{dismiss:true});
    const before=await notificationReads([fixture.received.id,secondNotice.id]);
    await target._handleReorg(BOUNDARY);
    const firstReplay=notificationReplay(fixture.original),secondReplay=notificationReplay(second,{logIndex:12});
    await replayNotifications(fixture.writer,[firstReplay,secondReplay]);
    assert.equal((await notificationRows(firstReplay)).find(row=>row.payload.type==='bid_received').id,fixture.received.id);
    assert.equal((await notificationRows(secondReplay)).find(row=>row.payload.type==='bid_received').id,secondNotice.id);
    assert.deepEqual(await notificationReads([fixture.received.id,secondNotice.id]),before);
    const items=(await notificationInbox(CREATOR)).items.filter(item=>item.transaction_hash===fixture.original.transactionHash);
    assert.deepEqual(items.map(item=>[item.id,item.read]),[[fixture.received.id,true]]);
  });
  for(const failure of ['rewind','rebind']) await t.test(`notification ${failure} failure rolls back identity and recipient state`,async()=>{
    const fixture=await notificationFixture();
    if(failure==='rebind') await target._handleReorg(BOUNDARY);
    const before=await notificationSnapshot(),state=await snapshot(CHAIN);
    beforeSql=async sql=>{
      if(failure==='rewind'?sql.startsWith('UPDATE indexer_state'):sql.includes("SET processing_status = 'completed'")) {
        throw new Error('fixture notification identity failure');
      }
    };
    try {
      if(failure==='rewind') await assert.rejects(target._handleReorg(BOUNDARY),/fixture notification identity failure/);
      else await assert.rejects(replayNotifications(fixture.writer,[notificationReplay(fixture.original)]),
        error=>error.code==='INDEXER_RANGE_INCOMPLETE' && error.failures[0]?.error==='fixture notification identity failure');
    } finally {beforeSql=null;}
    assert.deepEqual(await notificationSnapshot(),before);
    const after=await snapshot(CHAIN);
    for(const table of ['contract_events','v41_bids','v41_auctions','indexer_state']) assert.deepEqual(after[table],state[table]);
  });
  await t.test('notification identity privileges and migration reapplication preserve existing data',async()=>{
    await notificationFixture();
    const before=await notificationSnapshot();
    await pool.query(read('sql/migrations/20261029212603_notification_reorg_identity.sql'));
    await pool.query(read('sql/migrations/20261029220854_recovery_cache_obligation.sql'));
    assert.deepEqual(await notificationSnapshot(),before);
    for(const role of ['anon','authenticated','service_role']) {
      const row=(await pool.query(`SELECT has_schema_privilege($1,'artsoul_private','USAGE') AS schema_access,
        has_table_privilege($1,'artsoul_private.notification_reorg_identities','SELECT,INSERT,UPDATE,DELETE') AS table_access`,[role])).rows[0];
      assert.deepEqual(row,{schema_access:false,table_access:false});
      assert.equal((await pool.query(`SELECT has_function_privilege($1,
        'public.write_recoverable_notification(text,text,jsonb,text,text,text)','EXECUTE') AS allowed`,[role])).rows[0].allowed,false);
      assert.equal((await pool.query(`SELECT has_function_privilege($1,
        'artsoul_private.notification_source_identity(text,text,jsonb,text,boolean)','EXECUTE') AS allowed`,[role])).rows[0].allowed,false);
    }
    assert.equal((await pool.query(`SELECT prosecdef FROM pg_proc WHERE oid=
      'public.write_recoverable_notification(text,text,jsonb,text,text,text)'::regprocedure`)).rows[0].prosecdef,false);
  });
  await t.test('concurrent identical notification writers reuse one row without changing recipient intent',async()=>{
    const fixture=await notificationFixture(),row=fixture.outbid;
    const versions=async()=>(await pool.query(`SELECT o.xmin::TEXT AS outbox_revision,i.xmin::TEXT AS identity_revision
      FROM outbox_events o JOIN artsoul_private.notification_reorg_identities i ON i.outbox_id=o.id WHERE o.id=$1`,[row.id])).rows[0];
    const before=await versions();
    const args=[row.aggregate_type,row.aggregate_id,row.payload,row.correlation_id,row.idempotency_key,'pending'];
    const ids=await Promise.all([1,2].map(async()=>
      (await pool.query('SELECT write_recoverable_notification($1,$2,$3,$4,$5,$6)::TEXT AS id',args)).rows[0].id));
    assert.deepEqual(ids,[row.id,row.id]);
    assert.deepEqual(await notificationReads(fixture.rows.map(row=>row.id)),fixture.reads);
    assert.equal((await notificationRows(fixture.original)).length,2);
    assert.deepEqual(await versions(),before,'an already bound identical write does not update either row');
  });
  await t.test('owner rollback waits for a normal writer before acquiring the media fence',async()=>{
    const fixture=await notificationFixture(),owner=await pool.connect();
    const paused=deferred(),release=deferred();let writerPid;
    const event=notificationEvent('BidPlaced',{auctionId:2,bidder:`0x${'e'.repeat(40)}`,bidAmount:3000,depositAmount:10000},118,8,29003);
    const context=await fixture.writer._captureWriteContext();
    await fixture.writer._storeBlockHashesForBlocks([118],context);
    beforeSql=async(sql,client)=>{
      if(sql.includes('SELECT public.write_recoverable_notification') && !writerPid) {
        writerPid=client.processID;paused.resolve();await release.promise;
      }
    };
    const writing=settle(fixture.writer.processEvent(event,context));let rolling;
    try {
      await reach(paused,writing);
      await owner.query('BEGIN');
      rolling=settle(owner.query('SELECT rollback_events_from_block($1,$2)',[BOUNDARY,CHAIN]));
      await assertPostgresWait(owner.processID,writerPid);
      // A rollback that took media before state would block this probe, then
      // deadlock when the normal writer reaches its notification helper.
      const probe=await pool.connect();
      try {
        await probe.query('BEGIN');
        await probe.query('SELECT revision FROM artwork_media_chain_revisions WHERE chain_id=$1 FOR SHARE NOWAIT',[CHAIN]);
        await probe.query('ROLLBACK');
      } finally {await probe.query('ROLLBACK');probe.release();}
      release.resolve();
      assert.ifError((await writing).error);assert.ifError((await rolling).error);
      await owner.query('COMMIT');
    } finally {
      release.resolve();beforeSql=null;await writing;
      if(rolling) await rolling;
      await owner.query('ROLLBACK');owner.release();
    }
    assert.equal((await pool.query('SELECT count(*)::INTEGER AS count FROM contract_events WHERE chain_id=$1 AND block_number>=$2',
      [CHAIN,BOUNDARY])).rows[0].count,0);
    assert.deepEqual(await notificationRows(event),[]);
    assert.deepEqual(await notificationReads(fixture.rows.map(row=>row.id)),fixture.reads);
    assert.deepEqual((await notificationInbox(CREATOR)).items.filter(item=>item.transaction_hash===event.transactionHash),[]);
    evidence.results.push({scenario:'direct_owner_rollback_after_writer',blockedOnStateBeforeMedia:true,noDeadlock:true,noCanonicalStaleNotice:true});
  });
  await t.test('a standalone notification writer waiting behind recovery cannot rebind its removed source',async()=>{
    const fixture=await notificationFixture(),row=fixture.outbid;
    const staleContext=await fixture.writer._captureWriteContext();
    const owner=await pool.connect(),helper=await pool.connect();let writing;
    try {
      await owner.query('BEGIN');
      await owner.query('SELECT rollback_events_from_block($1,$2)',[BOUNDARY,CHAIN]);
      writing=settle(helper.query('SELECT write_recoverable_notification($1,$2,$3,$4,$5,$6)::TEXT AS id',
        [row.aggregate_type,row.aggregate_id,row.payload,row.correlation_id,row.idempotency_key,'pending']));
      await assertPostgresWait(helper.processID,owner.processID);
      await owner.query('COMMIT');
      const result=await writing;
      assert.match(result.error?.message||'',/NOTIFICATION_SOURCE_UNAVAILABLE/);
    } finally {
      await owner.query('ROLLBACK');
      if(writing) await writing;
      owner.release();helper.release();
    }
    assert.deepEqual(await notificationRows(fixture.original),[],'the retired key remains unbound while its source is absent');
    assert.deepEqual(await notificationReads(fixture.rows.map(row=>row.id)),fixture.reads);
    const identities=(await pool.query('SELECT orphaned FROM artsoul_private.notification_reorg_identities WHERE outbox_id=ANY($1::BIGINT[])',
      [fixture.rows.map(row=>row.id)])).rows;
    assert.equal(identities.length,2);assert.ok(identities.every(identity=>identity.orphaned));
    const afterDirectRollback=await notificationSnapshot();
    await assert.rejects(fixture.writer.processEvent(notificationReplay(fixture.original),staleContext),fenceLost);
    assert.deepEqual(await notificationSnapshot(),afterDirectRollback,
      'a committed direct rollback invalidates contexts captured before it');
    // Complete the normal engine rewind, then prove a freshly indexed identical
    // source can still rebind after the rejected delayed helper call.
    await target._handleReorg(BOUNDARY);
    const replay=notificationReplay(fixture.original);
    await replayNotifications(fixture.writer,[replay]);
    assert.deepEqual((await notificationRows(replay)).map(value=>value.id),fixture.rows.map(value=>value.id));
    assert.deepEqual(await notificationReads(fixture.rows.map(row=>row.id)),fixture.reads);
    const before=await notificationSnapshot();
    await pool.query('SELECT read_notification_summary($1,$2,true,true,true)',[CREATOR,CORE]);
    assert.deepEqual(await notificationSnapshot(),before,'summary remains read-only after the concurrent recovery');
    evidence.results.push({scenario:'standalone_notification_waits_for_recovery',blockedOnMedia:true,staleSourceRejected:true,
      staleContextRejected:true,legitimateReplayPreserved:true});
  });
  for(const proved of [true,false]) await t.test(`${proved?'proved':'unknown-source'} legacy notification handling does not invent provenance`,async()=>{
    const fixture=await notificationFixture(),ids=fixture.rows.map(row=>row.id);
    // Remove only the new ledger records to model rows created before migration.
    await pool.query('DELETE FROM artsoul_private.notification_reorg_identities WHERE outbox_id=ANY($1::BIGINT[])',[ids]);
    if(!proved) await pool.query(`UPDATE contract_events SET contract_address=NULL WHERE chain_id=$1
      AND transaction_hash=$2 AND log_index=$3`,[CHAIN,fixture.original.transactionHash,fixture.original.logIndex]);
    await target._handleReorg(BOUNDARY);
    const adopted=(await pool.query('SELECT outbox_id::TEXT,orphaned FROM artsoul_private.notification_reorg_identities WHERE outbox_id=ANY($1::BIGINT[]) ORDER BY outbox_id',[ids])).rows;
    assert.equal(adopted.length,proved?2:0);
    assert.ok(adopted.every(row=>row.orphaned));
    assert.deepEqual(await notificationReads(ids),fixture.reads);
    const replay=notificationReplay(fixture.original);
    await replayNotifications(fixture.writer,[replay]);
    const replayIds=(await notificationRows(replay)).map(row=>row.id);
    if(proved) assert.deepEqual(replayIds,ids);
    else {assert.ok(replayIds.every(id=>!ids.includes(id)));assert.deepEqual(await notificationReads(replayIds),[]);}
  });
  async function reminderFixture({dismiss=false}={}) {
    const writer=historicalWriter([]);
    const now=Number((await pool.query('SELECT floor(extract(epoch FROM clock_timestamp())) AS epoch')).rows[0].epoch);
    writer.eventListener.getBlock=async number=>({hash:hash(number),parentHash:hash(number-1),timestamp:now+(number-120)*2});
    await emitNotificationEvent(writer,notificationEvent('ArtworkRegistered',
      {artworkId:2,creator:CREATOR,metadataURI:'ipfs://reminder-replay-fixture'},100,1,30000));
    const original=notificationEvent('AuctionCreated',{auctionId:2,artworkId:2,creator:CREATOR,startPrice:1000,
      duration:86400,endTime:now+1800,chainId:CHAIN},112,7,30001);
    await emitNotificationEvent(writer,original);
    await pool.query('UPDATE block_hashes SET timestamp=$1 WHERE chain_id=$2 AND block_number=115',[now,CHAIN]);
    const inbox=await notificationInbox(CREATOR);
    assert.equal(inbox.remindersAvailable,true);
    const reminder=inbox.reminders.find(item=>item.auction_id==='2');
    assert.ok(reminder);assert.equal(reminder.type,'auction_ending');
    await markNotification(CREATOR,reminder.id,{dismiss});
    return {writer,now,original,reminder,reads:await notificationReads([reminder.id])};
  }
  for(const dismiss of [false,true]) await t.test(`replayed reminder preserves its serial ID and ${dismiss?'dismissal':'read'} state`,async()=>{
    const fixture=await reminderFixture({dismiss});
    await target._handleReorg(BOUNDARY);
    assert.deepEqual((await notificationInbox(CREATOR)).reminders,[]);
    assert.deepEqual((await pool.query(`SELECT id FROM canonical_auction_reminders($1,$2,ARRAY[60],statement_timestamp(),$3)`,
      [CREATOR,CORE,[fixture.reminder.id]])).rows,[]);
    await replayNotifications(fixture.writer,[notificationReplay(fixture.original)]);
    await assertReminderSummary(0);
    const inbox=await notificationInbox(CREATOR);
    assert.equal(inbox.remindersAvailable,true);
    const reminders=inbox.reminders.filter(item=>item.auction_id==='2');
    assert.deepEqual(reminders.map(item=>[item.id,item.read]),dismiss?[]:[[fixture.reminder.id,true]]);
    assert.deepEqual(await notificationReads([fixture.reminder.id]),fixture.reads);
    const proof=(await pool.query(`SELECT id::TEXT FROM canonical_auction_reminders($1,$2,ARRAY[60],statement_timestamp(),$3)`,
      [CREATOR,CORE,[fixture.reminder.id]])).rows;
    assert.deepEqual(proof,[{id:fixture.reminder.id}]);
  });
  await t.test('a different creation transaction reusing an auction ID cannot inherit reminder dismissal',async()=>{
    const fixture=await reminderFixture({dismiss:true});
    await target._handleReorg(BOUNDARY);
    await replayNotifications(fixture.writer,[notificationReplay(fixture.original,{transactionHash:hash(30002)})]);
    await assertReminderSummary(1);
    const reminders=(await notificationInbox(CREATOR)).reminders.filter(item=>item.auction_id==='2');
    assert.equal(reminders.length,1);assert.notEqual(reminders[0].id,fixture.reminder.id);assert.equal(reminders[0].read,false);
    assert.deepEqual(await notificationReads([fixture.reminder.id]),fixture.reads);
    assert.deepEqual(await notificationReads([reminders[0].id]),[]);
  });
  await t.test('an extension keeps one reminder per unchanged creation and offset',async()=>{
    const fixture=await reminderFixture();
    const extended=notificationEvent('AuctionExtended',{auctionId:2,oldEndTime:fixture.now+1800,newEndTime:fixture.now+2400},114,8,30003);
    await emitNotificationEvent(fixture.writer,extended);
    await assertReminderSummary(0);
    const reminders=(await notificationInbox(CREATOR)).reminders.filter(item=>item.auction_id==='2');
    assert.deepEqual(reminders.map(item=>[item.id,item.read,item.deadline]),[[fixture.reminder.id,true,String(fixture.now+2400)]]);
    assert.deepEqual(await notificationReads([fixture.reminder.id]),fixture.reads);
    assert.equal((await pool.query(`SELECT count(*)::INTEGER AS count FROM outbox_events
      WHERE event_type='notification' AND payload->>'type'='auction_ending' AND payload->>'auctionId'='2'`)).rows[0].count,1);
  });
  for (const withEvent of [true,false]) await t.test(`stale buffered ${withEvent?'event':'empty header-only'} range cannot write after rewind`, async () => {
    const entered = deferred(), release = deferred();
    const events = withEvent ? [bufferedBid()] : [];
    const writer = historicalWriter(events);
    writer.eventListener.queryAllHistoricalEvents = async () => {entered.resolve();await release.promise;return events;};
    const result = settle(writer.syncHistoricalEvents(116,120,{currentBlock:132}));
    await reach(entered,result);
    let before;
    try {await target._handleReorg(BOUNDARY);before=await writerSnapshot();}
    finally {release.resolve();}
    const outcome = await result, after = await writerSnapshot();
    evidence.results.push({scenario:`buffered_${withEvent?'event':'empty'}_range_after_rewind`,
      rejected:Boolean(outcome.error),error:outcome.error?.message,before,after});
    assert.ok(fenceLost(outcome.error),'a range fetched before recovery must fail with its original fence');
    assert.deepEqual(after,before,'stale logs cannot change projections, registry, outbox, headers, digest or cursors');
  });
  await t.test('same-cursor recovery changes the generation and rejects the older buffered range', async () => {
    const entered = deferred(), release = deferred(), writer = historicalWriter([bufferedBid()]);
    writer.eventListener.queryAllHistoricalEvents = async () => {entered.resolve();await release.promise;return [bufferedBid()];};
    const stateBefore = await target.getIndexerState();
    const result = settle(writer.syncHistoricalEvents(116,120,{currentBlock:132}));
    await reach(entered,result);
    let before;
    try {
      await target._handleReorg(116);
      const stateAfter = await target.getIndexerState();
      assert.equal(stateAfter.last_indexed_block,stateBefore.last_indexed_block);
      assert.equal(stateAfter.last_confirmed_block,stateBefore.last_confirmed_block);
      assert.notEqual(stateAfter.revision,stateBefore.revision);
      before = await writerSnapshot();
    } finally {release.resolve();}
    const outcome = await result;
    assert.ok(fenceLost(outcome.error));
    assert.deepEqual(await writerSnapshot(),before);
    evidence.results.push({scenario:'buffered_range_same_cursor_rewind_ABA',rejected:true,cursorsUnchanged:true});
  });
  for (const loss of ['local leadership loss','same-token epoch ABA','database token replaced','database lease expired']) {
    await t.test(`${loss} during log RPC rejects all later range writes`, async () => {
      const entered = deferred(), release = deferred(), writer = historicalWriter([bufferedBid()]);
      writer.eventListener.queryAllHistoricalEvents = async () => {entered.resolve();await release.promise;return [bufferedBid()];};
      const result = settle(writer.syncHistoricalEvents(116,120,{currentBlock:132}));
      await reach(entered,result);
      let before;
      try {
        if (loss === 'local leadership loss') leaderCurrent = false;
        if (loss === 'same-token epoch ABA') leaderEpoch++;
        if (loss === 'database token replaced') await pool.query('UPDATE distributed_locks SET fencing_token=2');
        if (loss === 'database lease expired') await pool.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'");
        before = await writerSnapshot();
      } finally {release.resolve();}
      const outcome = await result;
      assert.ok(fenceLost(outcome.error));
      assert.deepEqual(await writerSnapshot(),before);
      evidence.results.push({scenario:`range_RPC_${loss}`,rejected:true,noWrites:true});
    });
  }
  await t.test('a header response buffered before recovery cannot overwrite its boundary afterward', async () => {
    const entered = deferred(), release = deferred(), writer = historicalWriter([]);
    writer.eventListener.getBlock = async number => {
      entered.resolve();await release.promise;
      return {hash:hash(number),parentHash:hash(number-1),timestamp:1700000000+number*2};
    };
    const result = settle(writer.syncHistoricalEvents(116,120,{currentBlock:132}));
    await reach(entered,result);
    let before;
    try {await target._handleReorg(BOUNDARY);before=await writerSnapshot();}
    finally {release.resolve();}
    const outcome = await result;
    assert.ok(fenceLost(outcome.error));
    assert.deepEqual(await writerSnapshot(),before);
  });
  await t.test('an event with a committed claim waits behind rewind and cannot adopt its new generation', async () => {
    const writer = historicalWriter([bufferedBid()]), context = await writer._captureWriteContext();
    const eventPaused = deferred(), releaseEvent = deferred(), rewindLocked = deferred(), releaseRewind = deferred();
    let eventLocks = 0, eventClient, rewindClient, rewindStarted = false;
    beforeSql = async (sql, client) => {
      if (!rewindStarted && /FROM\s+(?:public\.)?indexer_state\b/i.test(sql) && /FOR UPDATE/i.test(sql) && ++eventLocks === 2) {
        eventClient=client;eventPaused.resolve();await releaseEvent.promise;
      }
      if (sql.includes('SELECT rollback_events_from_block')) {
        rewindClient=client;rewindLocked.resolve();await releaseRewind.promise;
      }
    };
    const eventResult = settle(writer.processEvent(bufferedBid(),context));
    await reach(eventPaused,eventResult);
    const claim = await pool.query('SELECT processing_status FROM event_processing_registry WHERE chain_id=$1 AND transaction_hash=$2',
      [CHAIN,bufferedBid().transactionHash]);
    assert.equal(claim.rows[0]?.processing_status,'processing','the first claim must already be committed');
    rewindStarted=true;
    const rewindResult = settle(target._handleReorg(BOUNDARY));
    try {
      await reach(rewindLocked,rewindResult);
      releaseEvent.resolve();
      const deadline = Date.now()+5000;
      let blocked = false;
      while (Date.now()<deadline && !blocked) {
        blocked = (await pool.query('SELECT $2::INT=ANY(pg_blocking_pids($1::INT)) AS blocked',
          [eventClient.processID,rewindClient.processID])).rows[0].blocked;
        if (!blocked) await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(blocked,true,'the event must wait on the real rewind transaction, not a JavaScript-only gate');
    } finally {releaseEvent.resolve();releaseRewind.resolve();}
    const rewind = await rewindResult, outcome = await eventResult;
    assert.ifError(rewind.error);assert.ok(fenceLost(outcome.error));
    const after = await writerSnapshot();
    assert.equal(after.chain.v41_bids.length,0);
    assert.equal(after.chain.event_processing_registry.some(row=>row.transaction_hash===bufferedBid().transactionHash),false);
    assert.equal(after.chain.indexer_state[0].last_indexed_block,109);
    await assert.rejects(writer.processEvent(bufferedBid(),context),fenceLost);
    assert.deepEqual(await writerSnapshot(),after,'retrying the same payload must retain its original fence');
    evidence.results.push({scenario:'committed_claim_projection_waits_for_rewind',blockedInPostgres:true,retryRejected:true});
  });
  await t.test('header SQL failure rejects the range before events or checkpoint writes', async () => {
    const writer = historicalWriter([bufferedBid()]), before = await writerSnapshot();
    await pool.query(`CREATE FUNCTION fixture_fail_header() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_HEADER_FAILURE'; END $f$;
      CREATE TRIGGER fixture_fail_header BEFORE INSERT OR UPDATE ON block_hashes
      FOR EACH ROW EXECUTE FUNCTION fixture_fail_header()`);
    try {await assert.rejects(writer.syncHistoricalEvents(116,120,{currentBlock:132}),/FORCED_HEADER_FAILURE/);}
    finally {await pool.query('DROP TRIGGER fixture_fail_header ON block_hashes; DROP FUNCTION fixture_fail_header()');}
    assert.deepEqual(await writerSnapshot(),before);
  });
  for (const failure of ['digest calculation','checkpoint update']) await t.test(`${failure} failure preserves both cursors and the previous digest atomically`, async () => {
    const writer = historicalWriter([]), before = (await snapshot(CHAIN)).indexer_state;
    let failed = false;
    if (failure === 'digest calculation') beforeSql = async (sql,client) => {
      if (sql.includes('string_agg')) {failed=true;await client.query('SELECT 1/0');}
    };
    else await pool.query(`CREATE FUNCTION fixture_fail_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_CHECKPOINT_FAILURE'; END $f$;
      CREATE TRIGGER fixture_fail_checkpoint BEFORE UPDATE OF state_hash ON indexer_state
      FOR EACH ROW EXECUTE FUNCTION fixture_fail_checkpoint()`);
    try {await assert.rejects(writer.syncHistoricalEvents(116,120,{currentBlock:132}),/division by zero|FORCED_CHECKPOINT_FAILURE/);}
    finally {
      beforeSql=null;
      if (failure === 'checkpoint update') await pool.query('DROP TRIGGER fixture_fail_checkpoint ON indexer_state; DROP FUNCTION fixture_fail_checkpoint()');
    }
    if (failure === 'digest calculation') assert.equal(failed,true,'digest computation must use the fenced transaction client');
    assert.deepEqual((await snapshot(CHAIN)).indexer_state,before,'neither cursor nor timestamp/total may escape the failed checkpoint transaction');
    await writer.syncHistoricalEvents(116,120,{currentBlock:132});
    const after = await target.getIndexerState();
    assert.equal(after.last_indexed_block,120);assert.equal(after.last_confirmed_block,120);
    assert.equal(after.state_hash,await target._computeStateHash(120));
    evidence.results.push({scenario:`checkpoint_${failure}_rollback`,bothCursorsAndDigestPreserved:true,retrySucceeded:true});
  });
  await t.test('a fresh range commits ordered events and one coherent checkpoint under the same generation', async () => {
    const first = bufferedBid(118), second = bufferedBid(119);
    second.eventData.bidAmount=3500;second.eventData.bidder=CREATOR;
    const writer = historicalWriter([second,first]), foreign = await snapshot(OTHER_CHAIN);
    assert.equal(await writer.syncHistoricalEvents(116,120,{currentBlock:132}),2);
    const after = await snapshot(CHAIN), state = await target.getIndexerState();
    assert.equal(after.v41_bids.length,2);
    assert.equal(String(after.v41_auctions[0].current_bid),'3500');
    assert.equal(after.v41_auctions[0].current_bidder,CREATOR);
    assert.equal(after.event_processing_registry.filter(row=>row.block_number>115 && row.processing_status==='completed').length,2);
    assert.equal(state.last_indexed_block,120);assert.equal(state.last_confirmed_block,120);
    assert.equal(state.state_hash,await target._computeStateHash(120));
    assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);
    evidence.results.push({scenario:'fresh_ordered_range',events:2,cursor:120,digest:state.state_hash});
  });
  await t.test('a missing header rejects the range before any event or checkpoint is written', async () => {
    const writer = historicalWriter([bufferedBid()]), before = await writerSnapshot();
    writer.eventListener.getBlock = async () => null;
    await assert.rejects(writer.syncHistoricalEvents(116,120,{currentBlock:132}),/Missing or invalid header/);
    assert.deepEqual(await writerSnapshot(),before);
  });
  for (const operation of ['range','event','start']) await t.test(`unconfigured ${operation} authority cannot write`, async () => {
    const writer = historicalWriter([bufferedBid()]), before = await writerSnapshot();
    writer.getRecoveryAuthority=undefined;
    writer.eventListener.queryAllHistoricalEvents=async()=>assert.fail('unconfigured authority must fail before log RPC');
    const run = operation==='range' ? ()=>writer.syncHistoricalEvents(116,120,{currentBlock:132})
      : operation==='event' ? ()=>writer.processEvent(bufferedBid()) : ()=>writer.start();
    await assert.rejects(run(),fenceLost);
    assert.deepEqual(await writerSnapshot(),before);
  });
  await t.test('leadership expiry after the handler rolls back event, projections and notification writes', async () => {
    await apply(target,'BidPlaced',111,{auctionId:1,bidder:CREATOR,bidAmount:1500,depositAmount:10000});
    const writer = historicalWriter([bufferedBid()]), context = await writer._captureWriteContext();
    const before = await writerSnapshot();
    let handlerCompleted = false;
    beforeSql = async (sql,client) => {
      if (sql.includes("SET processing_status = 'completed'")) {
        handlerCompleted=true;
        assert.equal((await client.query('SELECT COUNT(*)::INT AS count FROM v41_bids WHERE chain_id=$1',[CHAIN])).rows[0].count,2);
        assert.ok((await client.query('SELECT COUNT(*)::INT AS count FROM outbox_events')).rows[0].count>before.outbox.length,
          'the outbid notification must have been written inside the transaction');
        await client.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'");
      }
    };
    try {await assert.rejects(writer.processEvent(bufferedBid(),context),fenceLost);}
    finally {beforeSql=null;}
    assert.equal(handlerCompleted,true);
    const after = await writerSnapshot(), claim = after.chain.event_processing_registry.find(row=>row.transaction_hash===bufferedBid().transactionHash);
    assert.ok(claim);assert.notEqual(claim.processing_status,'completed');
    after.chain.event_processing_registry=after.chain.event_processing_registry.filter(row=>row.transaction_hash!==bufferedBid().transactionHash);
    assert.deepEqual(after,before,'only the separately committed processing claim may survive');
    evidence.results.push({scenario:'event_expiry_after_handler',handlerAndNotificationExecuted:true,allProjectionWritesRolledBack:true});
  });
  await t.test('startup expiry before commit leaves the original status and cursor unchanged', async () => {
    const writer = historicalWriter([]), before = await writerSnapshot();
    let attempted = false;
    beforeSql = async (sql,client) => {
      if (sql.includes("status = 'running'")) {
        attempted=true;await client.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'");
      }
    };
    try {await assert.rejects(writer.start(),fenceLost);}
    finally {beforeSql=null;}
    assert.equal(attempted,true);assert.equal(writer.isRunning,false);
    assert.deepEqual(await writerSnapshot(),before);
  });
  await t.test('stopping after leadership loss cannot overwrite the successor running status', async () => {
    const writer = historicalWriter([]);
    writer.isRunning=true;writer.eventListener.stopListening=async()=>{};
    leaderCurrent=false;
    await pool.query("UPDATE distributed_locks SET instance_id='successor',fencing_token=2");
    await pool.query("UPDATE indexer_state SET status='running',last_indexed_at=clock_timestamp() WHERE chain_id=$1",[CHAIN]);
    const before=await writerSnapshot();
    await writer.stop();
    assert.equal(writer.isRunning,false);assert.deepEqual(await writerSnapshot(),before);
  });
  await t.test('a stop awaiting its listener cannot adopt same-token leadership from a later epoch', async () => {
    const writer = historicalWriter([]), entered=deferred(), release=deferred();
    writer.isRunning=true;
    writer.eventListener.stopListening=async()=>{entered.resolve();await release.promise;};
    const result=settle(writer.stop());
    await reach(entered,result);
    let before;
    try {
      leaderEpoch++;
      await pool.query("UPDATE indexer_state SET status='running',last_indexed_at=clock_timestamp() WHERE chain_id=$1",[CHAIN]);
      before=await writerSnapshot();
    } finally {release.resolve();}
    const outcome=await result;assert.ifError(outcome.error);
    assert.equal(writer.isRunning,false);assert.deepEqual(await writerSnapshot(),before);
    evidence.results.push({scenario:'stop_same_token_epoch_ABA',successorStatusPreserved:true});
  });
  async function confirmationRunner() {
    await pool.query('UPDATE indexer_state SET last_confirmed_block=105,state_hash=$1 WHERE chain_id=$2',
      [await target._computeStateHash(105),CHAIN]);
    const writer=historicalWriter([]);
    return Object.assign(new ConfirmationRunner(),{config:{chainId:CHAIN},syncEngine:writer,
      eventListener:writer.eventListener,confirmationDepth:12});
  }
  for (const interruption of ['rewind','leadership loss']) await t.test(`confirmation head RPC buffered before ${interruption} cannot advance state afterward`, async () => {
    const runner=await confirmationRunner(), entered=deferred(), release=deferred();
    runner.eventListener.getCurrentBlock=async()=>{entered.resolve();await release.promise;return 132;};
    const result=settle(runner._processConfirmations());
    await reach(entered,result);
    let before;
    try {
      if(interruption==='rewind') await target._handleReorg(BOUNDARY);
      else leaderCurrent=false;
      before=await writerSnapshot();
    } finally {release.resolve();}
    const outcome=await result;assert.ok(fenceLost(outcome.error));
    assert.deepEqual(await writerSnapshot(),before);
    evidence.results.push({scenario:`confirmation_RPC_${interruption}`,staleCheckpointRejected:true});
  });
  await t.test('confirmation commits its clamped cursor and matching digest together', async () => {
    const runner=await confirmationRunner();
    runner.eventListener.getCurrentBlock=async()=>assert.fail('an observed head should not trigger another RPC');
    await runner._processConfirmations(132);
    const state=await target.getIndexerState();
    assert.equal(state.last_indexed_block,115);assert.equal(state.last_confirmed_block,115);
    assert.equal(state.state_hash,await target._computeStateHash(115));
  });
  await t.test('confirmation failure at commit rolls back the already written cursor and digest', async () => {
    const runner=await confirmationRunner(), before=await writerSnapshot();
    const expectedDigest=await target._computeStateHash(115);
    await pool.query(`CREATE FUNCTION fixture_fail_confirmation_commit() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_CONFIRMATION_COMMIT_FAILURE'; END $f$;
      CREATE CONSTRAINT TRIGGER fixture_fail_confirmation_commit AFTER UPDATE ON indexer_state
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_fail_confirmation_commit()`);
    let updated=false;
    beforeSql=async(sql,client)=>{
      if(sql==='COMMIT') {
        const state=(await client.query('SELECT last_confirmed_block,state_hash FROM indexer_state WHERE chain_id=$1',[CHAIN])).rows[0];
        assert.equal(Number(state.last_confirmed_block),115);assert.equal(state.state_hash,expectedDigest);updated=true;
      }
    };
    try {await assert.rejects(runner._processConfirmations(132),/FORCED_CONFIRMATION_COMMIT_FAILURE/);}
    finally {
      beforeSql=null;
      await pool.query('DROP TRIGGER fixture_fail_confirmation_commit ON indexer_state; DROP FUNCTION fixture_fail_confirmation_commit()');
    }
    assert.equal(updated,true,'both values must have been written before PostgreSQL rejects COMMIT');
    assert.deepEqual(await writerSnapshot(),before);
    evidence.results.push({scenario:'confirmation_deferred_commit_failure',cursorAndDigestWrittenBeforeFailure:true,allStateRolledBack:true});
  });
  async function assertRewound(otherBefore) {
    const after = await snapshot(CHAIN);
    assert.equal(after.v41_bids.length, 0);
    assert.equal(after.contract_events.length, 2);
    assert.equal(after.indexer_state[0].last_indexed_block, BOUNDARY - 1);
    assert.equal(after.indexer_state[0].last_confirmed_block, BOUNDARY - 1);
    assert.deepEqual(after.block_hashes.map(row => row.block_number), [100, 105, 109]);
    assert.equal(after.indexer_state[0].state_hash, await target._computeStateHash(BOUNDARY - 1));
    assert.equal(after.artwork_media_chain_revisions[0].revision, 1);
    assert.deepEqual(await snapshot(OTHER_CHAIN), otherBefore, 'foreign chain is unchanged');
    return after;
  }
  for (const method of ['_handleReorg', 'recoverFromSafeBlock']) {
    await t.test(`${method} commits event deletion, cursor, digest and revision together`, async () => {
      await apply(target, 'BidPlaced', 112, {auctionId: 1, bidder: WINNER, bidAmount: 2500, depositAmount: 10000});
      if (method === 'recoverFromSafeBlock') await pool.query(
        'UPDATE indexer_state SET last_confirmed_block=$1 WHERE chain_id=$2', [BOUNDARY - 1, CHAIN]);
      const otherBefore = await snapshot(OTHER_CHAIN);
      let reads = 0, replay;
      target.eventListener.getCurrentBlock = async () => { reads++; return 115; };
      target.syncHistoricalEvents = async (...args) => { replay = args; await assertRewound(otherBefore); };
      if (method === '_handleReorg') await target._handleReorg(BOUNDARY);
      else await target.recoverFromSafeBlock(await target.getIndexerState());
      const after = await assertRewound(otherBefore);
      assert.equal(target.recoveryCachePurgePending, false);
      assert.equal(reads, 0, 'startup rewind does not read or replay unconfirmed head');
      assert.equal(replay, undefined);
      evidence.results.push({scenario: method, after, otherChainUnchanged: true});
    });
  }
  for (const mutation of ['cursor advanced', 'cursor ABA', 'deployment changed', 'foreign chain', 'unversioned']) {
    await t.test(`startup rejects ${mutation} in the original snapshot`, async () => {
      await pool.query('UPDATE indexer_state SET last_confirmed_block=109 WHERE chain_id=$1', [CHAIN]);
      const state = await target.getIndexerState();
      if (mutation.startsWith('cursor')) {
        await pool.query('UPDATE indexer_state SET last_indexed_block=116 WHERE chain_id=$1', [CHAIN]);
        if (mutation === 'cursor ABA') await pool.query('UPDATE indexer_state SET last_indexed_block=115 WHERE chain_id=$1', [CHAIN]);
      } else if (mutation === 'deployment changed') {
        await pool.query('UPDATE indexer_state SET contract_address=$1 WHERE chain_id=$2', [CREATOR, CHAIN]);
      } else if (mutation === 'foreign chain') state.chain_id = String(OTHER_CHAIN);
      else delete state.revision;
      const before = await snapshot(CHAIN);
      await assert.rejects(target.recoverFromSafeBlock(state), /snapshot is stale|Invalid startup recovery snapshot/);
      assert.deepEqual(await snapshot(CHAIN), before);
      assert.equal(target.recoveryCachePurgePending, false);
    });
  }
  await t.test('startup rechecks its snapshot under the state lock even without resale rows', async () => {
    await pool.query('UPDATE indexer_state SET last_confirmed_block=109 WHERE chain_id=$1', [CHAIN]);
    const state = await target.getIndexerState(), before = await snapshot(CHAIN);
    beforeSql = async sql => {
      if (sql.startsWith('SELECT last_indexed_block') && sql.endsWith('FOR UPDATE')) {
        beforeSql = null;
        await pool.query('UPDATE indexer_state SET last_indexed_block=last_indexed_block WHERE chain_id=$1', [CHAIN]);
      }
    };
    await assert.rejects(target.recoverFromSafeBlock(state), /Reorg preparation is stale/);
    assert.deepEqual(await snapshot(CHAIN), before);
  });
  for (const failure of ['missing authority', 'replaced leader', 'expired leader', 'late expiry']) {
    await t.test(`rewind without resale rows rejects ${failure}`, async () => {
      const authority = target.getRecoveryAuthority;
      if (failure === 'missing authority') target.getRecoveryAuthority = undefined;
      if (failure === 'replaced leader') await pool.query("UPDATE distributed_locks SET fencing_token=2");
      if (failure === 'expired leader') await pool.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'");
      if (failure === 'late expiry') beforeSql = async (sql, client) => {
        if (sql.startsWith('UPDATE indexer_state')) await client.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'");
      };
      const before = await snapshot(CHAIN);
      try { await assert.rejects(target._handleReorg(BOUNDARY), /authority or deployment unavailable|leadership changed|leadership expired/); }
      finally { target.getRecoveryAuthority = authority; }
      assert.deepEqual(await snapshot(CHAIN), before);
      assert.equal(target.recoveryCachePurgePending, false);
    });
  }
  await t.test('startup retries a committed rewind purge without rewinding twice or replaying head', async () => {
    await pool.query('UPDATE indexer_state SET last_confirmed_block=109 WHERE chain_id=$1', [CHAIN]);
    target.fixtureFailCachePurge = true;
    await assert.rejects(target.start(), /fixture cache purge failure/);
    assert.equal(target.isRunning, false);
    assert.equal(target.recoveryCachePurgePending, true);
    const after = await snapshot(CHAIN);
    await assert.rejects(target.start(), /fixture cache purge failure/);
    assert.deepEqual(await snapshot(CHAIN), after);
    target.fixtureFailCachePurge = false;
    await target.start();
    assert.equal(target.isRunning, true);
    assert.equal(target.recoveryCachePurgePending, false);
    assert.deepEqual((await snapshot(CHAIN)).artwork_media_chain_revisions, after.artwork_media_chain_revisions);
    assert.equal((await target.getIndexerState()).last_indexed_block, 109);
  });
  for (const failedTable of ['contract_events', 'block_hashes', 'indexer_state', 'nft_transfer_coverage']) {
    await t.test(`failure at ${failedTable} rolls back all earlier SQL including media revision`, async () => {
      await seedCoverage(); await seedCoverage(OTHER_CHAIN);
      await apply(target, 'BidPlaced', 112, {auctionId: 1, bidder: WINNER, bidAmount: 2500, depositAmount: 10000});
      const before = await snapshot(CHAIN), otherBefore = await snapshot(OTHER_CHAIN);
      await pool.query(`CREATE FUNCTION fixture_fail_rewind() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN RAISE EXCEPTION 'FORCED_REWIND_FAILURE'; END $f$;
        CREATE TRIGGER fixture_fail_rewind BEFORE ${failedTable === 'indexer_state' ? 'UPDATE' : 'DELETE'}
        ON ${failedTable} FOR EACH ROW EXECUTE FUNCTION fixture_fail_rewind()`);
      try { await assert.rejects(target._handleReorg(BOUNDARY), /FORCED_REWIND_FAILURE/); }
      finally { await pool.query(`DROP TRIGGER fixture_fail_rewind ON ${failedTable}; DROP FUNCTION fixture_fail_rewind()`); }
      assert.deepEqual(await snapshot(CHAIN), before);
      assert.deepEqual(await snapshot(OTHER_CHAIN), otherBefore);
      assert.equal(target.recoveryCachePurgePending, false);
      evidence.results.push({scenario: `rollback_on_${failedTable}_failure`, allStateUnchanged: true});
    });
  }
  await t.test('cache failure occurs after a coherent commit and retries without another rewind', async () => {
    await apply(target, 'BidPlaced', 112, {auctionId: 1, bidder: WINNER, bidAmount: 2500, depositAmount: 10000});
    const otherBefore = await snapshot(OTHER_CHAIN);
    target.fixtureFailCachePurge = true;
    await assert.rejects(target._handleReorg(BOUNDARY), /fixture cache purge failure/);
    const after = await assertRewound(otherBefore);
    assert.equal(target.recoveryCachePurgePending, true);
    await assert.rejects(target.detectReorg(), /fixture cache purge failure/);
    assert.deepEqual(await snapshot(CHAIN), after);
    target.fixtureFailCachePurge = false;
    assert.equal(await target.detectReorg(), true);
    assert.equal(target.recoveryCachePurgePending, false);
    after.indexer_state[0].recovery_cache_token=null;
    assert.deepEqual(await snapshot(CHAIN), after, 'purge retry only acknowledges its token without another rewind');
    evidence.results.push({scenario: 'post_commit_purge_retry', after, noRepeatedRewind: true});
  });

  const recoveryToken=async(chain=CHAIN)=>(await pool.query('SELECT recovery_cache_token FROM indexer_state WHERE chain_id=$1',[chain])).rows[0]?.recovery_cache_token;
  const requestPurge=async(chain=CHAIN)=>(await pool.query(`UPDATE indexer_state SET recovery_cache_token=gen_random_uuid()
    WHERE chain_id=$1 RETURNING recovery_cache_token`,[chain])).rows[0].recovery_cache_token;
  async function recoveryCache() {
    const file=path.join(directory,'isolated-cache.mjs'),source=read('src/services/cache-service.js');
    assert.ok(source.includes("import { getRedisConnection } from '../queue.js';"));
    fs.writeFileSync(file,source.replace("import { getRedisConnection } from '../queue.js';",
      'const getRedisConnection = async () => { throw new Error("External Redis disabled in recovery fixture"); };'));
    const cache=(await import(pathToFileURL(file).href)).default;
    // This is only the PostgreSQL fixture's transport adapter, not real Redis.
    // The Docker cache-recovery-rpc suite verifies the actual Lua/Redis behavior.
    const data=new Map(),expires=new Map(),calls={keys:0,deletes:0};
    const current=key=>{
      if(expires.has(key)&&expires.get(key)<=Date.now()){data.delete(key);expires.delete(key);}
      return data.get(key)??null;
    };
    const set=(key,value,...options)=>{
      if(options.includes('NX')&&current(key)!==null)return null;
      data.set(key,value);
      const ex=options.indexOf('EX');
      if(ex>=0)expires.set(key,Date.now()+Number(options[ex+1])*1000);else expires.delete(key);
      return 'OK';
    };
    cache.getRedis=async()=>({
      async get(key){return current(key);},async set(...args){return set(...args);},
      async scan(cursor,...options){
        assert.equal(cursor,'0');assert.deepEqual(options,['MATCH','artsoul:*','COUNT',128]);
        calls.keys++;return ['0',[...data.keys()].filter(key=>key.startsWith('artsoul:'))];
      },
      async del(...keys){calls.deletes++;for(const key of keys){data.delete(key);expires.delete(key);}},
      async eval(script,keyCount,...args){
        assert.equal(typeof script,'string');
        if(keyCount===3){
          const [recoveryKey,entryKey,key,recovery,entry,value,ttl]=args;
          assert.equal(recoveryKey,'artsoul:cache:recovery-generation');
          assert.equal(entryKey,`artsoul:cache:entry-generation:${key}`);
          if(current(recoveryKey)!==recovery||current(entryKey)!==entry)return 0;
          set(key,value,'EX',ttl);return 1;
        }
        assert.equal(keyCount,2);
        const [entryKey,key,generation,ttl]=args;
        assert.equal(entryKey,`artsoul:cache:entry-generation:${key}`);
        set(entryKey,generation,'EX',ttl);
        const deleted=current(key)!==null?1:0;
        data.delete(key);expires.delete(key);calls.deletes++;return deleted;
      }
    });
    return {cache,data,calls};
  }
  await t.test('a new worker drains the committed cache obligation after actual process exit',async()=>{
    await apply(target,'BidPlaced',112,{auctionId:1,bidder:WINNER,bidAmount:2500,depositAmount:10000});
    const {cache,calls}=await recoveryCache(),cacheKey=cache.keys.auction(CHAIN+':artwork:1');
    await cache.set(cacheKey,{current_bid:2500},3600);
    // Real PostgreSQL and process termination; only the Redis transport is a
    // parent-owned Map that survives the worker child, without any live service.
    const childFile=path.join(directory,'crash-after-rewind-commit.cjs'),markerFile=path.join(directory,'cache-crash-boundary.json');
    fs.writeFileSync(childFile,`const fs=require('node:fs');
const {Pool}=require('pg');
const {pathToFileURL}=require('node:url');
(async()=>{
  const config=JSON.parse(process.argv[2]);
  const Engine=(await import(pathToFileURL(config.engineFile).href)).default;
  const pool=new Pool({host:'127.0.0.1',port:config.port,database:'postgres',user:'postgres',password:'',max:2,
    connectionTimeoutMillis:2000,statement_timeout:10000});
  const db={pool,query:async(sql,values)=>(await pool.query(sql,values)).rows};
  const engine=new Engine(db,{chainId:config.chain,contractAddress:config.core});
  engine.eventListener._readRpcCall=operation=>operation({async send(method,params){
    if(method==='eth_chainId')return '0x14a34';
    if(method!=='eth_getBlockByNumber')throw new Error('Unexpected fixture RPC');
    return {number:params[0],hash:'0x'+BigInt(params[0]).toString(16).padStart(64,'0')};
  }});
  engine.getRecoveryAuthority=()=>({lockName:'fixture-reorg',instanceId:'fixture-worker',fencingToken:'1',isCurrent:()=>true});
  engine.fixtureCachePurgeHook=async options=>{
    const state=await engine.getIndexerState();
    fs.writeFileSync(config.markerFile,JSON.stringify({strict:options.strict,state,pending:engine.recoveryCachePurgePending}));
    process.exit(86);
  };
  await engine._handleReorg(110);
  throw new Error('Expected post-commit termination seam was not reached');
})().catch(error=>{console.error(error);process.exit(87);});
`);
    const child=spawnSync(process.execPath,[childFile,JSON.stringify({engineFile,port,markerFile,chain:CHAIN,core:CORE})],
      {cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:15000});
    fs.writeFileSync(path.join(directory,'cache-crashed-worker.log'),(child.stdout||'')+(child.stderr||''));
    assert.ifError(child.error);assert.equal(child.status,86);
    const boundary=JSON.parse(fs.readFileSync(markerFile,'utf8'));
    assert.equal(boundary.strict,true);assert.equal(boundary.pending,true);
    assert.equal(boundary.state.last_indexed_block,109);assert.equal(boundary.state.last_confirmed_block,109);
    assert.ok(boundary.state.recovery_cache_token);assert.equal(await recoveryToken(),boundary.state.recovery_cache_token);
    assert.equal(calls.deletes,0);
    const revisionBefore=(await snapshot(CHAIN)).artwork_media_chain_revisions;
    const replacement=historicalWriter([]);let purges=0,fetches=0;
    replacement.fixtureCachePurgeHook=async options=>{purges++;return cache.purge(options);};
    await replacement.start();
    assert.equal(await replacement.detectReorg(),false);
    const state=await replacement.getIndexerState();
    const dbBid=Number((await pool.query('SELECT current_bid FROM v41_auctions WHERE chain_id=$1 AND auction_id=1',[CHAIN])).rows[0].current_bid);
    const served=await cache.remember(cacheKey,3600,async()=>{fetches++;return {current_bid:dbBid};});
    assert.equal(served.current_bid,0);assert.equal(dbBid,0);assert.equal(fetches,1);
    assert.equal(purges,1);assert.equal(calls.deletes,1);assert.equal(state.recovery_cache_token,null);
    assert.equal(state.last_indexed_block,109);assert.equal(state.last_confirmed_block,109);
    assert.equal(state.state_hash,await replacement._computeStateHash(109));
    assert.deepEqual((await snapshot(CHAIN)).artwork_media_chain_revisions,revisionBefore);
    evidence.results.push({scenario:'cache_obligation_survives_process_exit',childExit:child.status,
      tokenPersistedBeforeExit:true,purges,cacheRead:served.current_bid,databaseBid:dbBid,noRepeatedRewind:true,
      redisTransport:'local Map; actual cache-service methods'});
  });
  await t.test('failed rewind preserves an earlier cache obligation without publishing another token',async()=>{
    const token=await requestPurge(),before=await snapshot(CHAIN);let purges=0;
    target.fixtureCachePurgeHook=async()=>{purges++;return true;};
    beforeSql=async sql=>{if(sql.startsWith('DELETE FROM block_hashes'))throw new Error('fixture rewind before commit');};
    try {await assert.rejects(target._handleReorg(BOUNDARY),/fixture rewind before commit/);}
    finally {beforeSql=null;}
    assert.equal(await recoveryToken(),token);assert.equal(purges,0);assert.deepEqual(await snapshot(CHAIN),before);
  });
  await t.test('a fresh worker cannot start while its durable cache purge fails',async()=>{
    const token=await requestPurge(),before=await snapshot(CHAIN),replacement=historicalWriter([]);
    replacement.fixtureFailCachePurge=true;
    await assert.rejects(replacement.start(),/fixture cache purge failure/);
    assert.equal(replacement.isRunning,false);assert.equal(await recoveryToken(),token);
    assert.deepEqual(await snapshot(CHAIN),before);
    replacement.fixtureFailCachePurge=false;
    await replacement.start();assert.equal(replacement.isRunning,true);assert.equal(await recoveryToken(),null);
    assert.deepEqual((await snapshot(CHAIN)).artwork_media_chain_revisions,before.artwork_media_chain_revisions);
  });
  await t.test('partial cache scanning cannot acknowledge the durable obligation before a complete retry',async()=>{
    const token=await requestPurge(),before=await snapshot(CHAIN),replacement=historicalWriter([]);
    const {cache,data,calls}=await recoveryCache(),redis=await cache.getRedis();
    const firstKey=cache.keys.auction('partial-scan-first'),lastKey=cache.keys.bids('partial-scan-last');
    await cache.set(firstKey,{bid:100});await cache.set(lastKey,[100]);
    let fail=true,scans=0;
    // This injected two-page transport proves the PostgreSQL acknowledgement
    // boundary; actual multi-page Redis behavior belongs to cache-recovery-rpc.
    cache.getRedis=async()=>({...redis,async scan(...args){
      if(!fail)return redis.scan(...args);
      calls.keys++;
      if(++scans===1)return ['1',[firstKey]];
      throw new Error('fixture partial recovery SCAN failure');
    }});
    replacement.fixtureCachePurgeHook=options=>cache.purge(options);
    await assert.rejects(replacement.start(),/fixture partial recovery SCAN failure/);
    assert.equal(scans,2);assert.equal(calls.deletes,1);
    assert.equal(data.has(firstKey),false);assert.equal(data.has(lastKey),true);
    assert.equal(replacement.isRunning,false);assert.equal(await recoveryToken(),token);
    assert.deepEqual(await snapshot(CHAIN),before,'partial deletion must not acknowledge or alter database state');
    fail=false;
    await replacement.start();
    assert.equal(replacement.isRunning,true);assert.equal(await recoveryToken(),null);
    assert.equal(calls.deletes,2);assert.deepEqual([...data.keys()],['artsoul:cache:recovery-generation']);
    assert.deepEqual((await snapshot(CHAIN)).artwork_media_chain_revisions,before.artwork_media_chain_revisions);
    evidence.results.push({scenario:'partial_scan_retains_recovery_obligation',
      partialDeletion:true,tokenRetained:true,retryAcknowledged:true,redisTransport:'local Map; actual cache-service methods'});
  });
  await t.test('a successful purge with failed acknowledgement is retried by the next worker',async()=>{
    const token=await requestPurge(),replacement=historicalWriter([]);let purges=0;
    replacement.fixtureCachePurgeHook=async()=>{purges++;return true;};
    beforeSql=async sql=>{if(sql.includes('SET recovery_cache_token = NULL'))throw new Error('fixture cache acknowledgement failure');};
    try {await assert.rejects(replacement.start(),/fixture cache acknowledgement failure/);}
    finally {beforeSql=null;}
    assert.equal(purges,1);assert.equal(await recoveryToken(),token);assert.equal(replacement.isRunning,false);
    const successor=historicalWriter([]);successor.fixtureCachePurgeHook=async()=>{purges++;return true;};
    await successor.start();assert.equal(purges,2);assert.equal(await recoveryToken(),null);
  });
  await t.test('an older purge cannot acknowledge a newer committed rewind token',async()=>{
    const firstToken=await requestPurge(),replacement=historicalWriter([]),entered=deferred(),release=deferred();
    replacement.fixtureCachePurgeHook=async()=>{entered.resolve();await release.promise;return true;};
    const purging=settle(replacement._purgeRecoveryCache());let newerToken;
    try {
      await reach(entered,purging);
      target.fixtureFailCachePurge=true;
      await assert.rejects(target._handleReorg(BOUNDARY),/fixture cache purge failure/);
      newerToken=await recoveryToken();assert.ok(newerToken);assert.notEqual(newerToken,firstToken);
    } finally {target.fixtureFailCachePurge=false;release.resolve();}
    assert.ok(fenceLost((await purging).error));assert.equal(await recoveryToken(),newerToken);
    const before=(await snapshot(CHAIN)).artwork_media_chain_revisions;
    assert.equal(await historicalWriter([])._purgeRecoveryCache(),true);assert.equal(await recoveryToken(),null);
    assert.deepEqual((await snapshot(CHAIN)).artwork_media_chain_revisions,before);
  });
  await t.test('leadership epoch loss during purge leaves acknowledgement for the successor',async()=>{
    const token=await requestPurge(),replacement=historicalWriter([]);
    replacement.fixtureCachePurgeHook=async()=>{leaderEpoch++;return true;};
    await assert.rejects(replacement._purgeRecoveryCache(),fenceLost);assert.equal(await recoveryToken(),token);
    assert.equal(await historicalWriter([])._purgeRecoveryCache(),true);assert.equal(await recoveryToken(),null);
  });
  await t.test('cache acknowledgement is scoped to its original chain and deployment',async()=>{
    const token=await requestPurge(),foreign=await requestPurge(OTHER_CHAIN),replacement=historicalWriter([]);
    replacement.fixtureCachePurgeHook=async()=>{
      await pool.query('UPDATE indexer_state SET contract_address=$1 WHERE chain_id=$2',[CREATOR,CHAIN]);
      return true;
    };
    await assert.rejects(replacement._purgeRecoveryCache(),fenceLost);
    const changed=await recoveryToken();assert.ok(changed);assert.notEqual(changed,token);assert.equal(await recoveryToken(OTHER_CHAIN),foreign);
    const successor=new Engine(db,{chainId:CHAIN,contractAddress:CREATOR});successor.getRecoveryAuthority=target.getRecoveryAuthority;
    assert.equal(await successor._purgeRecoveryCache(),true);assert.equal(await recoveryToken(),null);
    assert.equal(await recoveryToken(OTHER_CHAIN),foreign);
    assert.equal((await successor.getIndexerState()).contract_address,CREATOR);
  });
  await t.test('disabled caching retains its durable obligation until an enabled purge succeeds',async()=>{
    const token=await requestPurge(),replacement=historicalWriter([]);
    replacement.fixtureCachePurgeHook=async()=>false;
    await replacement.start();assert.equal(replacement.isRunning,true);assert.equal(await recoveryToken(),token);
    assert.equal(await replacement._purgeRecoveryCache(),false);assert.equal(await recoveryToken(),token);
    replacement.fixtureCachePurgeHook=async()=>true;
    assert.equal(await replacement.detectReorg(),true);assert.equal(await recoveryToken(),null);
    assert.equal((await replacement.getIndexerState()).last_indexed_block,115);
  });
  await t.test('a configured cache obligation blocks fresh ranges, events, headers and confirmations until acknowledged',async()=>{
    const previous=process.env.REDIS_URL;
    process.env.REDIS_URL='redis://fixture.invalid:6379';
    try {
      target.fixtureFailCachePurge=true;
      await assert.rejects(target._handleReorg(BOUNDARY),/fixture cache purge failure/);
      target.fixtureFailCachePurge=false;
      const writer=historicalWriter([bufferedBid()]);let rangeReads=0;
      writer.eventListener.queryAllHistoricalEvents=async()=>{rangeReads++;return [bufferedBid()];};
      const before=await writerSnapshot();
      await assert.rejects(writer._captureWriteContext(),fenceLost);
      await assert.rejects(writer.syncHistoricalEvents(110,120,{currentBlock:132}),fenceLost);
      assert.equal(rangeReads,0,'ordinary admission fails before fetching the historical range');
      const runner=Object.assign(new ConfirmationRunner(),{config:{chainId:CHAIN},syncEngine:writer,
        eventListener:writer.eventListener,confirmationDepth:12});
      await assert.rejects(runner._processConfirmations(132),fenceLost);
      // Capture while caching is disabled, then enable it without changing xmin.
      // The locked check must independently reject this otherwise-current context.
      process.env.REDIS_URL='';
      const context=await writer._captureWriteContext();
      process.env.REDIS_URL='redis://fixture.invalid:6379';
      await assert.rejects(writer._storeBlockHashesForBlocks([118],context),fenceLost);
      await assert.rejects(writer.processEvent(bufferedBid(),context),fenceLost);
      assert.deepEqual(await writerSnapshot(),before);
      assert.equal(await writer._purgeRecoveryCache(),true,'only the recovery acknowledgement context bypasses admission');
      assert.equal(await recoveryToken(),null);
      await writer.syncHistoricalEvents(110,120,{currentBlock:132});
      await runner._processConfirmations(132);
      assert.equal((await writer.getIndexerState()).last_indexed_block,120);
      assert.equal(rangeReads,1);
      evidence.results.push({scenario:'configured_cache_obligation_blocks_ordinary_writes',
        captureRejected:true,lockedContextRejected:true,confirmationRejected:true,recoveryAcknowledgementAllowed:true});
    } finally {
      target.fixtureFailCachePurge=false;
      if(previous===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=previous;
    }
  });
  await t.test('disabled caching permits ordinary range and confirmation writes without acknowledging the token',async()=>{
    const previous=process.env.REDIS_URL;process.env.REDIS_URL='';
    try {
      const token=await requestPurge(),writer=historicalWriter([bufferedBid()]);
      await writer.syncHistoricalEvents(116,120,{currentBlock:132});
      const runner=Object.assign(new ConfirmationRunner(),{config:{chainId:CHAIN},syncEngine:writer,
        eventListener:writer.eventListener,confirmationDepth:12});
      await runner._processConfirmations(132);
      assert.equal(await recoveryToken(),token);assert.equal((await writer.getIndexerState()).last_indexed_block,120);
    } finally {if(previous===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=previous;}
  });
  await t.test('cache-obligation migration seeds new rows and preserves acknowledged or pending tokens on reapply',async()=>{
    const pending=await requestPurge();
    await pool.query('DELETE FROM indexer_state WHERE chain_id=$1',[OTHER_CHAIN]);
    await pool.query(`INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,
      last_indexed_at,started_at,state_hash) VALUES($1,$2,115,115,NOW(),NOW(),'0x0')`,[OTHER_CHAIN,CORE]);
    assert.ok(await recoveryToken(OTHER_CHAIN));
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[OTHER_CHAIN]);
    await pool.query(read('sql/migrations/20261029220854_recovery_cache_obligation.sql'));
    assert.equal(await recoveryToken(),pending);assert.equal(await recoveryToken(OTHER_CHAIN),null);
  });

  const bid = (amount=2500,bidder=WINNER) => ({auctionId:1,bidder,bidAmount:amount,depositAmount:10000});
  const ending = {auctionId:1,winner:WINNER,winningBid:2500,settlementDeadline:1700172800};
  const settled = {auctionId:1,artworkId:1,winner:WINNER,finalPrice:2500,tokenId:7};
  const floor = {artworkId:1,tokenId:7,floorPrice:2500};
  const defaulted = {auctionId:1,winner:WINNER,artistAmount:800,platformAmount:200};
  async function primary() {
    const all = await snapshot(CHAIN);
    return {artworks:all.v41_artworks,auctions:all.v41_auctions};
  }
  async function retainedOutbox() {
    return (await pool.query('SELECT to_jsonb(o) AS value FROM outbox_events o ORDER BY id')).rows.map(row=>row.value);
  }
  await t.test('orphaned bid and extension restore retained values and notification identities', async () => {
    await apply(target,'BidPlaced',106,bid(1500));
    await apply(target,'BidPlaced',106,bid(1700,CREATOR),1);
    await apply(target,'AuctionExtended',107,{auctionId:1,oldEndTime:1700086400,newEndTime:1700086500});
    await apply(target,'AuctionExtended',107,{auctionId:1,oldEndTime:1700086500,newEndTime:1700086600},1);
    const before=await primary(), outboxBefore=await retainedOutbox(), otherBefore=await snapshot(OTHER_CHAIN);
    await apply(target,'BidPlaced',112,bid(2500,CREATOR));
    await apply(target,'AuctionExtended',113,{auctionId:1,oldEndTime:1700086600,newEndTime:1700086700});
    await target._handleReorg(BOUNDARY);
    assert.deepEqual(await primary(),before);
    assert.deepEqual(await retainedOutbox(),outboxBefore,'retained notifications are not regenerated');
    assert.deepEqual(await snapshot(OTHER_CHAIN),otherBefore);
  });
  for (const name of ['SettlementCompleted','SettlementDefaulted']) {
    await t.test(`orphaned ${name} restores payment state and preserves independent trust flags`, async () => {
      await apply(target,'BidPlaced',106,bid());
      await apply(target,'AuctionEnded',108,ending);
      const before=await primary();
      await pool.query(`INSERT INTO v41_trust_signals(chain_id,user_address,suspicious_flags)
        VALUES($1,$2,9)`,[CHAIN,WINNER]);
      if(name==='SettlementCompleted') await apply(target,'CanonicalFloorUpdated',115,floor,0);
      await apply(target,name,115,name==='SettlementCompleted'?settled:defaulted,1);
      assert.notDeepEqual(await primary(),before);
      await target._handleReorg(BOUNDARY);
      assert.deepEqual(await primary(),before);
      const trust=(await snapshot(CHAIN)).v41_trust_signals[0];
      assert.equal(trust.successful_settlements,0);assert.equal(trust.failed_settlements,0);
      assert.equal(trust.suspicious_flags,9);assert.equal(trust.last_updated_block,null);
      const again=await primary();
      await target._handleReorg(BOUNDARY);
      assert.deepEqual(await primary(),again,'repeated rewind cannot increment counters or change primary projections');
    });
  }
  await t.test('orphaned no-bid ending and new round restore the older active auction', async () => {
    const before=await primary();
    await apply(target,'AuctionEnded',112,{auctionId:1,winner:`0x${'0'.repeat(40)}`,winningBid:0,settlementDeadline:0});
    await apply(target,'AuctionCreated',114,{auctionId:2,artworkId:1,creator:CREATOR,startPrice:2000,duration:86400,endTime:1700186400});
    await target._handleReorg(BOUNDARY);
    assert.deepEqual(await primary(),before);
  });
  await t.test('retained mint and floor survive a later orphaned floor increase', async () => {
    await apply(target,'BidPlaced',106,bid());await apply(target,'AuctionEnded',107,ending);
    await apply(target,'CanonicalFloorUpdated',108,floor,0);await apply(target,'SettlementCompleted',108,settled,1);
    const before=await primary(),trustBefore=(await snapshot(CHAIN)).v41_trust_signals;
    await apply(target,'CanonicalFloorUpdated',112,{...floor,floorPrice:9000});
    await target._handleReorg(BOUNDARY);
    assert.deepEqual(await primary(),before);
    assert.deepEqual((await snapshot(CHAIN)).v41_trust_signals,trustBefore);
  });
  await t.test('trust recount retains earlier settlements after a later default is orphaned', async () => {
    await apply(target,'BidPlaced',106,bid());await apply(target,'AuctionEnded',107,ending);
    await apply(target,'CanonicalFloorUpdated',108,floor,0);await apply(target,'SettlementCompleted',108,settled,1);
    await pool.query('UPDATE v41_trust_signals SET suspicious_flags=9 WHERE chain_id=$1',[CHAIN]);
    const before=(await snapshot(CHAIN)).v41_trust_signals;
    await apply(target,'ArtworkRegistered',109,{artworkId:2,creator:CREATOR,metadataURI:'ipfs://second-fixture'});
    await apply(target,'AuctionCreated',109,{auctionId:2,artworkId:2,creator:CREATOR,
      startPrice:1000,duration:86400,endTime:1700186400},1);
    await apply(target,'BidPlaced',112,{...bid(),auctionId:2});
    await apply(target,'AuctionEnded',113,{...ending,auctionId:2});
    await apply(target,'SettlementDefaulted',115,{...defaulted,auctionId:2});
    assert.equal((await snapshot(CHAIN)).v41_trust_signals[0].failed_settlements,1);
    await target._handleReorg(BOUNDARY);
    assert.deepEqual((await snapshot(CHAIN)).v41_trust_signals,before);
  });
  await t.test('replacement lifecycle matches clean replay including metrics and trust', async () => {
    const replacement=async()=>{
      await apply(target,'BidPlaced',112,bid());await apply(target,'AuctionEnded',113,ending);
      await apply(target,'CanonicalFloorUpdated',115,floor,0);await apply(target,'SettlementCompleted',115,settled,1);
    };
    const comparable=async()=>{
      const all=await snapshot(CHAIN);
      return Object.fromEntries(['v41_artworks','v41_auctions','v41_bids','v41_settlements',
        'v41_auction_endings','v41_floor_history','v41_trust_signals','v41_public_metrics',
        'v41_public_metric_events','v41_public_metric_participants'].map(table=>[table,
        all[table].map(({id,...row})=>{
          // The aggregate trigger records the wall-clock rewind time; compare
          // its canonical totals/boundary, not that observation timestamp.
          if(table==='v41_public_metrics') delete row.updated_at;
          return row;
        })]));
    };
    await replacement();const expected=await comparable();
    await reset();
    await apply(target,'BidPlaced',112,bid(3000));await apply(target,'AuctionEnded',113,{...ending,winningBid:3000});
    await apply(target,'SettlementDefaulted',115,defaulted);
    await target._handleReorg(BOUNDARY);await replacement();
    assert.deepEqual(await comparable(),expected);
  });
  await t.test('failure during projection reconstruction rolls back deletion and cursor together', async () => {
    await apply(target,'BidPlaced',112,bid());const before=await snapshot(CHAIN);
    await pool.query(`CREATE FUNCTION fixture_fail_projection() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_PROJECTION_FAILURE'; END $f$;
      CREATE TRIGGER fixture_fail_projection BEFORE UPDATE ON v41_auctions
      FOR EACH ROW EXECUTE FUNCTION fixture_fail_projection()`);
    try {await assert.rejects(target._handleReorg(BOUNDARY),/FORCED_PROJECTION_FAILURE/);}
    finally {await pool.query('DROP TRIGGER fixture_fail_projection ON v41_auctions; DROP FUNCTION fixture_fail_projection()');}
    assert.deepEqual(await snapshot(CHAIN),before);
  });

  async function resaleFixture() {
    await apply(target,'ResaleListed',108,{tokenId:7,seller:WINNER,price:2500});
    await apply(other,'ResaleListed',108,{tokenId:7,seller:WINNER,price:2500});
    await pool.query(`INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp)
      VALUES($1,109,$2,$3,1700000218) ON CONFLICT(chain_id,block_number) DO NOTHING`,[CHAIN,hash(109),hash(108)]);
  }
  const resaleRow = async () => (await pool.query('SELECT * FROM v41_resale_listings WHERE chain_id=$1 AND token_id=7',[CHAIN])).rows[0];
  const dirtyResale = async (active=false) => pool.query(`UPDATE v41_resale_listings
    SET active=$1,last_updated_block=112 WHERE chain_id=$2 AND token_id=7`,[active,CHAIN]);
  for(const duringRead of [false,true]) await t.test(`resale reconciliation rejects a cache obligation ${duringRead?'created during RPC':'before RPC'}`,async()=>{
    const previous=process.env.REDIS_URL;process.env.REDIS_URL='redis://fixture.invalid:6379';
    try {
      const {reconcileResaleState}=await import('../src/indexer/resale-state-reconciliation.js');
      await resaleFixture();
      await pool.query(`UPDATE indexer_state SET last_indexed_block=109,last_confirmed_block=109,state_hash=$1 WHERE chain_id=$2`,
        [await target._computeStateHash(109),CHAIN]);
      const before=await resaleRow();let reads=0,token;
      const options={chainId:CHAIN,coreAddress:CORE,blockNumber:109,leader:target.getRecoveryAuthority(),isCurrent:()=>true};
      const readSnapshot=async()=>{
        reads++;if(duringRead)token=await requestPurge();
        return [{tokenId:'7',seller:WINNER,price:'2500',active:false}];
      };
      if(duringRead) {
        const result=await reconcileResaleState(db,options,readSnapshot);
        assert.equal(result.updated,0);assert.equal(reads,1);
      } else {
        token=await requestPurge();
        await assert.rejects(reconcileResaleState(db,options,readSnapshot),/boundary unavailable/);
        assert.equal(reads,0);
      }
      assert.deepEqual(await resaleRow(),before);assert.equal(await recoveryToken(),token);
      assert.equal(await target._purgeRecoveryCache(),true);
      const result=await reconcileResaleState(db,options,async()=>[{tokenId:'7',seller:WINNER,price:'2500',active:false}]);
      assert.equal(result.updated,1);assert.equal((await resaleRow()).active,false);
      assert.equal(await recoveryToken(),null);
    } finally {if(previous===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=previous;}
  });
  for (const active of [true,false]) for (const matching of [true,false]) await t.test(`rewind restores ${active?'active':'cancelled'} boundary state from ${matching?'matching':'opposite'} future observations`,async()=>{
    await resaleFixture();const before=await resaleRow(),foreign=await snapshot(OTHER_CHAIN);
    await dirtyResale(matching?active:!active);resaleStates.set('7',[WINNER,2500n,active]);
    const outboxBefore=await retainedOutbox();
    await target._handleReorg(BOUNDARY);
    const after=await resaleRow();assert.equal(after.active,active);assert.equal(after.last_updated_block,'109');
    for (const field of ['seller','price','block_number','transaction_hash','log_index','indexed_at']) assert.deepEqual(after[field],before[field]);
    assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);assert.deepEqual(await retainedOutbox(),outboxBefore);
    const saved=await snapshot(CHAIN);await target._handleReorg(BOUNDARY);
    assert.deepEqual((await snapshot(CHAIN)).v41_resale_listings,saved.v41_resale_listings);
    assert.equal(resaleReads.length,1,'repeated rewind does not reread restored observations');
  });
  await t.test('orphaned resale completion and reprice restore the retained listing and delete new orphan listings',async()=>{
    await resaleFixture();const original=await resaleRow();
    await apply(target,'ResaleCompleted',112,{tokenId:7,seller:WINNER,buyer:CREATOR,price:2500,royaltyAmount:100,platformFee:10});
    await apply(target,'ResaleListed',113,{tokenId:7,seller:CREATOR,price:9000});
    await apply(target,'ResaleListed',113,{tokenId:8,seller:CREATOR,price:9000},1);
    await target._handleReorg(BOUNDARY);
    const after=await resaleRow();assert.equal(after.seller,WINNER);assert.equal(after.price,'2500');assert.equal(after.active,true);
    for(const field of ['block_number','transaction_hash','log_index','indexed_at']) assert.deepEqual(after[field],original[field]);
    assert.equal((await snapshot(CHAIN)).v41_resale_listings.length,1);
    assert.equal((await snapshot(CHAIN)).v41_resale_history.length,0);assert.deepEqual(resaleReads,['7']);
  });
  await t.test('all resale batches use the same boundary and remain bounded to eight reads',async()=>{
    await resaleFixture();
    for(let id=8;id<17;id++) await apply(target,'ResaleListed',108,{tokenId:id,seller:WINNER,price:2500},id);
    await pool.query('UPDATE v41_resale_listings SET last_updated_block=112 WHERE chain_id=$1',[CHAIN]);
    const original=target.eventListener._readRpcCall;const sizes=[];
    target.eventListener._readRpcCall=async operation=>{const start=resaleReads.length;const result=await original(operation);sizes.push(resaleReads.length-start);return result;};
    try{await target._handleReorg(BOUNDARY);}finally{target.eventListener._readRpcCall=original;}
    assert.deepEqual(sizes.filter(size=>size>0),[8,2]);assert.equal(new Set(resaleReads).size,10);
    assert.ok((await snapshot(CHAIN)).v41_resale_listings.every(row=>row.last_updated_block===109));
  });
  await t.test('recovered resale state and replacement events match clean replay with an eventless cancellation',async()=>{
    const {reconcileResaleState}=await import('../src/indexer/resale-state-reconciliation.js');
    const beforeReplacement=async()=>{
      await resaleFixture();resaleStates.set('7',[WINNER,2500n,false]);
    };
    const replacement=()=>apply(target,'ResaleListed',114,{tokenId:7,seller:WINNER,price:3000});
    const comparable=async()=>{
      const data=await snapshot(CHAIN);
      return {listings:data.v41_resale_listings,history:data.v41_resale_history,
        events:data.contract_events.filter(row=>row.event_name.startsWith('Resale')).map(({id,...row})=>row)};
    };
    await beforeReplacement();
    await pool.query('UPDATE indexer_state SET last_indexed_block=109,last_confirmed_block=109 WHERE chain_id=$1',[CHAIN]);
    await reconcileResaleState(db,{chainId:CHAIN,coreAddress:CORE,blockNumber:109,
      leader:target.getRecoveryAuthority(),isCurrent:()=>true},async()=>[{tokenId:'7',seller:WINNER,price:'2500',active:false}]);
    await replacement();const expected=await comparable();
    await reset();await beforeReplacement();
    await apply(target,'ResaleListed',112,{tokenId:7,seller:WINNER,price:9000});
    await target._handleReorg(BOUNDARY);assert.equal((await resaleRow()).active,false);
    await replacement();assert.deepEqual(await comparable(),expected);
  });
  for(const reason of ['missing authority','wrong deployment','wrong listener chain']) await t.test(`${reason} fails before any archive read`,async()=>{
    await resaleFixture();await dirtyResale();const before=await snapshot(CHAIN);
    const authority=target.getRecoveryAuthority,listener={...target.eventListener};
    if(reason==='missing authority')target.getRecoveryAuthority=undefined;
    if(reason==='wrong deployment')target.eventListener.contractAddress=CREATOR;
    if(reason==='wrong listener chain')target.eventListener.chainId=1;
    try{await assert.rejects(target._handleReorg(BOUNDARY),/authority or deployment unavailable/);}
    finally{target.getRecoveryAuthority=authority;Object.assign(target.eventListener,listener);}
    assert.equal(resaleReads.length,0);assert.deepEqual(await snapshot(CHAIN),before);
  });
  for(const failure of ['missing header','conflicting header','archive unavailable','wrong chain','header changed after read','default mapping','partial batch']) {
    await t.test(`${failure} aborts resale recovery without SQL mutations`,async()=>{
      await resaleFixture();await dirtyResale();
      const original=target.eventListener._readRpcCall;
      if(failure==='missing header') await pool.query('DELETE FROM block_hashes WHERE chain_id=$1 AND block_number<=109',[CHAIN]);
      if(failure==='conflicting header') await pool.query('UPDATE block_hashes SET block_hash=$1 WHERE chain_id=$2 AND block_number<=109',[hash(999),CHAIN]);
      if(failure==='archive unavailable') rpcHook=async method=>{if(method==='eth_call')throw new Error('archive unavailable');};
      if(failure==='wrong chain') target.eventListener._readRpcCall=operation=>operation({async send(){return '0x1';}});
      if(failure==='header changed after read') {
        let headers=0;rpcHook=async method=>{if(method==='eth_getBlockByNumber'&&++headers===2)throw new Error('canonical block changed');};
      }
      if(failure==='default mapping') resaleStates.set('7',['0x'+'0'.repeat(40),0n,false]);
      if(failure==='partial batch') target.eventListener._readRpcCall=async operation=>{
        const start=resaleReads.length;const result=await original(operation);
        return resaleReads.length>start?[]:result;
      };
      const before=await snapshot(CHAIN);
      try{await assert.rejects(target._handleReorg(BOUNDARY),/No proven reorg ancestor|canonical block changed|archive unavailable|RPC chain changed|Invalid reorg resale snapshot/);}
      finally{target.eventListener._readRpcCall=original;}
      assert.deepEqual(await snapshot(CHAIN),before);assert.equal(target.recoveryCachePurgePending,false);
    });
  }
  const preparationMutations = {
    'cursor moved':()=>pool.query('UPDATE indexer_state SET last_indexed_block=116 WHERE chain_id=$1',[CHAIN]),
    'cursor ABA':()=>pool.query('UPDATE indexer_state SET last_indexed_block=last_indexed_block WHERE chain_id=$1',[CHAIN]),
    'deployment changed':()=>pool.query('UPDATE indexer_state SET contract_address=$1 WHERE chain_id=$2',[CREATOR,CHAIN]),
    'row changed':()=>pool.query('UPDATE v41_resale_listings SET price=9000 WHERE chain_id=$1',[CHAIN]),
    'row deleted and reinserted':async()=>{const row=await resaleRow();await pool.query('DELETE FROM v41_resale_listings WHERE chain_id=$1',[CHAIN]);
      await pool.query('INSERT INTO v41_resale_listings SELECT * FROM json_populate_record(NULL::v41_resale_listings,$1)',[JSON.stringify(row)]);},
    'affected token added':async()=>{await apply(target,'ResaleListed',108,{tokenId:8,seller:WINNER,price:2500},1);
      await pool.query('UPDATE v41_resale_listings SET last_updated_block=112 WHERE chain_id=$1 AND token_id=8',[CHAIN]);},
    'leader replaced':()=>pool.query("UPDATE distributed_locks SET fencing_token=2 WHERE lock_name='fixture-reorg'"),
    'leader expired':()=>pool.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE lock_name='fixture-reorg'"),
    'local leader lost':async()=>{leaderCurrent=false;},
    'stored header replaced':()=>pool.query('UPDATE block_hashes SET block_hash=$1 WHERE chain_id=$2 AND block_number=109',[hash(999),CHAIN])
  };
  for(const [name,mutate] of Object.entries(preparationMutations)) await t.test(`${name} rejects the prepared snapshot`,async()=>{
    await resaleFixture();await dirtyResale();let concurrentState;
    rpcHook=async method=>{if(method==='eth_call'&&!concurrentState){await mutate();concurrentState=await snapshot(CHAIN);}};
    await assert.rejects(target._handleReorg(BOUNDARY),/Reorg preparation is stale|Reorg resale (rows changed|leadership|boundary changed)/);
    assert.deepEqual(await snapshot(CHAIN),concurrentState,'only the injected concurrent change persists');
    assert.equal(target.recoveryCachePurgePending,false);
  });
  for (const withResale of [false,true]) await t.test(`leadership expiry after lock wait cannot authorize a rewind ${withResale?'with':'without'} resale rows`,async()=>{
    if(withResale){await resaleFixture();await dirtyResale();}const before=await snapshot(CHAIN);
    const holder=await pool.connect();await holder.query('BEGIN');
    await holder.query("UPDATE distributed_locks SET expires_at=clock_timestamp()+INTERVAL '100 milliseconds' WHERE lock_name='fixture-reorg'");
    let attempting;const waiting=new Promise(resolve=>{attempting=resolve;});
    beforeSql=async sql=>{if(sql.includes('SELECT lock_name FROM public.distributed_locks'))attempting();};
    const rejected=assert.rejects(target._handleReorg(BOUNDARY),/leadership expired/);
    try{await waiting;await holder.query('SELECT pg_sleep(0.2)');await holder.query('COMMIT');await rejected;}
    finally{await holder.query('ROLLBACK');holder.release();}
    assert.deepEqual(await snapshot(CHAIN),before);
  });
  await t.test('leadership expiry during reconstruction rolls back every prior write',async()=>{
    await resaleFixture();await dirtyResale();const before=await snapshot(CHAIN);
    beforeSql=async(sql,client)=>{if(sql.startsWith('UPDATE indexer_state'))await client.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'");};
    await assert.rejects(target._handleReorg(BOUNDARY),/leadership expired/);
    assert.deepEqual(await snapshot(CHAIN),before);
  });
  for(const missing of [false,true]) await t.test(`resale ${missing?'lost row':'apply failure'} rolls back deletion, projections, media revision and cursor`,async()=>{
    await resaleFixture();await dirtyResale();await apply(target,'BidPlaced',112,bid());
    const before=await snapshot(CHAIN);
    await pool.query(`CREATE FUNCTION fixture_fail_resale() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN ${missing?"RETURN NULL;":"RAISE EXCEPTION 'FORCED_RESALE_FAILURE';"} END $f$;
      CREATE TRIGGER fixture_fail_resale BEFORE UPDATE ON v41_resale_listings FOR EACH ROW EXECUTE FUNCTION fixture_fail_resale()`);
    try{await assert.rejects(target._handleReorg(BOUNDARY),missing?/application lost its row/:/FORCED_RESALE_FAILURE/);}
    finally{await pool.query('DROP TRIGGER fixture_fail_resale ON v41_resale_listings; DROP FUNCTION fixture_fail_resale()');}
    assert.deepEqual(await snapshot(CHAIN),before);
  });

  const legacyKinds = [
    ['ProjectNFTEligibilityAchieved','v41_project_eligibility'],
    ['ProjectNFTMinted','v41_genesis_holders']
  ];
  for(const [name,table] of legacyKinds) for(const retained of [true,false]) {
    await t.test(`${name} ${retained?'restores its last retained predecessor':'has no row without a retained predecessor'}`,async()=>{
      const payload=(value,user=WINNER)=>({user,eligibilityHash:hash(value),...(name==='ProjectNFTMinted'?{tokenId:value}:{})});
      await apply(other,name,108,payload(5));const foreign=await snapshot(OTHER_CHAIN);
      if(retained) {
        await apply(target,name,107,payload(1));await apply(target,name,108,payload(2));
        await apply(target,name,108,payload(3),1);
      }
      // A separate retained user and its unknown source must remain unchanged.
      await apply(target,name,106,payload(6,CREATOR));
      const expected=(await snapshot(CHAIN))[table];
      const rawBefore=(await snapshot(CHAIN)).contract_events;
      const notifications=await retainedOutbox();
      await apply(target,name,112,payload(4));
      await target._handleReorg(BOUNDARY);
      const recovered=await snapshot(CHAIN);
      assert.deepEqual(recovered[table],expected);
      assert.deepEqual(recovered.contract_events,rawBefore,'unknown source provenance stays unknown');
      assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);assert.deepEqual(await retainedOutbox(),notifications);
      await target._handleReorg(BOUNDARY);assert.deepEqual((await snapshot(CHAIN))[table],expected);
    });
  }
  for(const [name,table] of legacyKinds) await t.test(`${name} reconstruction failure rolls back the entire rewind`,async()=>{
    const payload=value=>({user:WINNER,eligibilityHash:hash(value),...(name==='ProjectNFTMinted'?{tokenId:value}:{})});
    await apply(target,name,108,payload(1));await apply(target,name,112,payload(2));
    const before=await snapshot(CHAIN);
    await pool.query(`CREATE FUNCTION fixture_fail_legacy() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_LEGACY_FAILURE'; END $f$;
      CREATE TRIGGER fixture_fail_legacy BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_fail_legacy()`);
    try{await assert.rejects(target._handleReorg(BOUNDARY),/FORCED_LEGACY_FAILURE/);}
    finally{await pool.query(`DROP TRIGGER fixture_fail_legacy ON ${table}; DROP FUNCTION fixture_fail_legacy()`);}
    assert.deepEqual(await snapshot(CHAIN),before);
  });
  await t.test('legacy replacement facts match clean replay without source fabrication',async()=>{
    const prefix=async()=>{
      await apply(target,'ProjectNFTEligibilityAchieved',108,{user:WINNER,eligibilityHash:hash(1)});
      await pool.query("UPDATE contract_events SET contract_address=$1 WHERE chain_id=$2 AND event_name='ProjectNFTEligibilityAchieved'",[CORE,CHAIN]);
    };
    const replacement=async()=>{
      await apply(target,'ProjectNFTEligibilityAchieved',114,{user:WINNER,eligibilityHash:hash(3)});
      await apply(target,'ProjectNFTMinted',115,{user:WINNER,eligibilityHash:hash(3),tokenId:7});
    };
    const comparable=async()=>{
      const rows=await snapshot(CHAIN);return {eligibility:rows.v41_project_eligibility,holders:rows.v41_genesis_holders,
        events:rows.contract_events.filter(row=>row.event_name.startsWith('ProjectNFT')).map(({id,...row})=>row)};
    };
    await prefix();await replacement();const expected=await comparable();
    await reset();await prefix();
    await apply(target,'ProjectNFTEligibilityAchieved',112,{user:WINNER,eligibilityHash:hash(2)});
    await apply(target,'ProjectNFTMinted',113,{user:WINNER,eligibilityHash:hash(2),tokenId:9});
    await target._handleReorg(BOUNDARY);await replacement();assert.deepEqual(await comparable(),expected);
  });
  await t.test('NFT coverage migration preserves rows on reapplication and grants read-only service access', async () => {
    await seedCoverage(); const before = await coverageRows(CHAIN);
    await pool.query(read('sql/migrations/20261101120000_nft_transfer_coverage.sql'));
    assert.deepEqual(await coverageRows(CHAIN), before);
    const flags = (await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.nft_transfer_coverage'::regclass")).rows[0];
    assert.deepEqual(flags, {relrowsecurity:true,relforcerowsecurity:true});
    const role = await pool.connect();
    try {
      for (const name of ['anon','authenticated','service_role']) {
        await role.query(`SET ROLE ${name}`);
        if (name === 'service_role') assert.equal((await role.query('SELECT * FROM public.nft_transfer_coverage')).rows.length, 1);
        else await assert.rejects(role.query('SELECT * FROM public.nft_transfer_coverage'), error => error.code === '42501');
        for (const sql of ['INSERT INTO public.nft_transfer_coverage SELECT * FROM public.nft_transfer_coverage',
          'UPDATE public.nft_transfer_coverage SET covered_through=covered_through',
          'DELETE FROM public.nft_transfer_coverage','TRUNCATE public.nft_transfer_coverage']) {
          await assert.rejects(role.query(sql), error => error.code === '42501');
        }
        await role.query('RESET ROLE');
      }
    } finally { await role.query('RESET ROLE'); role.release(); }
    assert.deepEqual(await coverageRows(CHAIN), before);
  });
  await t.test('NFT coverage rejects invalid origin and checkpoint identities', async () => {
    for (const invalid of [
      {from_block:0},{covered_through:98},{covered_through:99,covered_hash:hash(98)},
      {core_address:'0x0'},{nft_address:CORE},{nft_address:`0x${'0'.repeat(40)}`},
      {origin_block_hash:'bad'},{covered_hash:`0x${'0'.repeat(64)}`},{core_code_hash:null},{nft_code_hash:'bad'}
    ]) await assert.rejects(seedCoverage(CHAIN,invalid), error => ['23514','23502'].includes(error.code));
    await assert.rejects(seedCoverage(999), error => error.code === '23503');
    await seedCoverage(CHAIN,{covered_through:99,covered_hash:hash(99)});
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'99');
  });
  await t.test('NFT token index supports source-scoped ordered transfer lookup', async () => {
    const nft=`0x${'d'.repeat(40)}`, foreign=`0x${'e'.repeat(40)}`, token='9007199254740993';
    for (const [chain,source,id,block,log] of [[CHAIN,nft,token,110,3],[CHAIN,nft,token,110,9],
      [CHAIN,foreign,token,111,1],[OTHER_CHAIN,nft,token,112,1],[CHAIN,nft,'2',113,1]]) {
      await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,event_data,block_number,transaction_hash,log_index)
        VALUES($1,'Transfer',$2,$3,$4,$5,$6)`,[chain,source,JSON.stringify({tokenId:id,from:CREATOR,to:WINNER}),block,hash(block*100+log),log]);
    }
    const sql=`SELECT block_number,log_index FROM contract_events WHERE chain_id=$1 AND contract_address=$2
      AND event_name='Transfer' AND event_data->>'tokenId'=$3 ORDER BY block_number DESC,log_index DESC LIMIT 1`;
    assert.deepEqual((await pool.query(sql,[CHAIN,nft,token])).rows,[{block_number:'110',log_index:9}]);
    const client=await pool.connect();
    try {
      await client.query('SET enable_seqscan=off');
      const plan=(await client.query('EXPLAIN (COSTS OFF) '+sql,[CHAIN,nft,token])).rows.map(row=>row['QUERY PLAN']).join('\n');
      assert.match(plan,/contract_events_nft_transfer_token/);
    } finally {await client.query('RESET enable_seqscan');client.release();}
  });
  await t.test('ordinary cursor writes, unchanged purge tokens and acknowledgements preserve NFT coverage', async () => {
    await pool.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
    await seedCoverage(); const before=await coverageRows(CHAIN);
    await pool.query('UPDATE indexer_state SET last_indexed_block=last_indexed_block+1 WHERE chain_id=$1',[CHAIN]);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=recovery_cache_token WHERE chain_id=$1',[CHAIN]);
    await pool.query('UPDATE indexer_state SET contract_address=upper(contract_address) WHERE chain_id=$1',[CHAIN]);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    assert.deepEqual(await coverageRows(CHAIN),before);
  });
  for (const [label,boundary,oneArgument] of [['chain-scoped',110,false],['legacy wrapper',110,true],['empty range',200,false]]) {
    await t.test(`direct ${label} rollback atomically invalidates NFT coverage`, async () => {
      await seedCoverage(); await seedCoverage(OTHER_CHAIN); const foreign=await snapshot(OTHER_CHAIN);
      if (boundary===110) await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,event_data,block_number,transaction_hash,log_index)
        VALUES($1,'Transfer',$2,'{"tokenId":"1"}',112,$3,1)`,[CHAIN,`0x${'d'.repeat(40)}`,hash(12001)]);
      await pool.query(oneArgument ? 'SELECT rollback_events_from_block($1)' : 'SELECT rollback_events_from_block($1,$2)',
        oneArgument ? [boundary] : [boundary,CHAIN]);
      assert.deepEqual(await coverageRows(CHAIN),[]);
      assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);
      assert.equal((await pool.query('SELECT count(*)::INTEGER AS n FROM contract_events WHERE chain_id=$1 AND block_number>=$2',[CHAIN,boundary])).rows[0].n,0);
      assert.ok((await target.getIndexerState()).recovery_cache_token);
    });
  }
  for (const operation of ['replace Core','delete state']) await t.test(`${operation} removes previous deployment NFT coverage`, async () => {
    await seedCoverage(); await seedCoverage(OTHER_CHAIN); const foreign=await coverageRows(OTHER_CHAIN);
    if (operation==='replace Core') await pool.query('UPDATE indexer_state SET contract_address=$1 WHERE chain_id=$2',[`0x${'e'.repeat(40)}`,CHAIN]);
    else await pool.query('DELETE FROM indexer_state WHERE chain_id=$1',[CHAIN]);
    assert.deepEqual(await coverageRows(CHAIN),[]); assert.deepEqual(await coverageRows(OTHER_CHAIN),foreign);
  });
  await t.test('a state-locked token rotation and new NFT checkpoint commit together and survive purge acknowledgement', async () => {
    await seedCoverage(); await seedCoverage(OTHER_CHAIN); const foreign=await coverageRows(OTHER_CHAIN), before=await snapshot(CHAIN);
    const client=await pool.connect();
    try {
      for (const commit of [false,true]) {
        await client.query('BEGIN');
        await client.query('SELECT * FROM indexer_state WHERE chain_id=$1 FOR UPDATE',[CHAIN]);
        const prior=(await client.query('SELECT * FROM nft_transfer_coverage WHERE chain_id=$1 FOR UPDATE',[CHAIN])).rows[0];
        assert.equal(prior.covered_through,'115');
        await client.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
        assert.equal((await client.query('SELECT * FROM nft_transfer_coverage WHERE chain_id=$1',[CHAIN])).rows.length,0);
        await seedCoverage(CHAIN,{covered_through:116,covered_hash:hash(116)},client);
        await client.query(commit?'COMMIT':'ROLLBACK');
        if (!commit) assert.deepEqual(await snapshot(CHAIN),before);
      }
    } finally {await client.query('ROLLBACK');client.release();}
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'116');
    assert.ok((await target.getIndexerState()).recovery_cache_token);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'116');
    assert.deepEqual(await coverageRows(OTHER_CHAIN),foreign);
  });
  await t.test('direct rollback waits for a state-locked NFT checkpoint and deletes the committed coverage', async () => {
    await seedCoverage(); const writer=await pool.connect(),owner=await pool.connect(); let rolling;
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT * FROM indexer_state WHERE chain_id=$1 FOR UPDATE',[CHAIN]);
      await writer.query('UPDATE nft_transfer_coverage SET covered_through=116,covered_hash=$1 WHERE chain_id=$2',[hash(116),CHAIN]);
      rolling=settle(owner.query('SELECT rollback_events_from_block($1,$2)',[200,CHAIN]));
      await assertPostgresWait(owner.processID,writer.processID);
      await writer.query('COMMIT'); assert.ifError((await rolling).error);
      assert.deepEqual(await coverageRows(CHAIN),[]);
    } finally {await writer.query('ROLLBACK');if(rolling) await rolling;writer.release();owner.release();}
  });

  const {syncNftTransferRange} = await import(pathToFileURL(path.join(ROOT,'src/indexer/nft-transfer-sync.js')).href);
  const {readNftTransferProgress,syncNftTransferCheckpoint} = await import(pathToFileURL(path.join(ROOT,'src/indexer/nft-transfer-checkpoint.js')).href);
  function nftFixture(subtest) {
    const original=target.eventListener, originalChain=target.chainId;
    subtest.after(()=>{target.eventListener=original;target.chainId=originalChain;});
    const nft=`0x${'d'.repeat(40)}`, coreCode='0x6001600055', nftCode='0x6002600055';
    const abi=new Interface(['function nftContract() view returns(address)','function totalSupply() view returns(uint256)',
      'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
    const hex=n=>`0x${n.toString(16)}`;
    const log=(block,index,from,to)=>({...abi.encodeEventLog('Transfer',[from,to,'9007199254740993']),
      address:nft,blockNumber:hex(block),blockHash:hash(block),logIndex:hex(index),transactionIndex:'0x0',
      transactionHash:hash(block*100),removed:false});
    const f={calls:[],logs:[log(110,9,WINNER,CREATOR),log(100,1,`0x${'0'.repeat(40)}`,CREATOR),log(110,3,CREATOR,WINNER)]};
    f.options={chainId:CHAIN,coreAddress:CORE,nftAddress:nft,expectedCoreCodeHash:keccak256(coreCode),
      expectedNftCodeHash:keccak256(nftCode),fromBlock:100,previousBlockHash:hash(99),blockNumber:110,blockHash:hash(110),bootstrap:true};
    target.eventListener={chainId:CHAIN,contractAddress:CORE,nftAddress:nft,
      _readRpcCall:operation=>operation({async send(method,params){
        f.calls.push(method);await f.hook?.(method,params);
        if(method==='eth_chainId')return hex(CHAIN);
        if(method==='eth_getBlockByNumber')return{number:params[0],hash:hash(Number(BigInt(params[0]))),timestamp:'0x64'};
        if(method==='eth_getCode')return params[0]===CORE?coreCode:nftCode;
        if(method==='eth_call'){
          const name=abi.parseTransaction(params[0]).name;
          return abi.encodeFunctionResult(name,[name==='totalSupply'?0n:nft]);
        }
        assert.equal(method,'eth_getLogs');return f.logs;
      }})};
    f.run=()=>syncNftTransferRange(target,f.options);
    f.continue=(from,to,logs=[])=>{f.options={...f.options,fromBlock:from,blockNumber:to,
      previousBlockHash:hash(from-1),blockHash:hash(to),bootstrap:false};f.logs=logs;};
    return f;
  }
  const nftRows=async()=> (await pool.query("SELECT * FROM contract_events WHERE chain_id=$1 AND event_name='Transfer' ORDER BY block_number,log_index",[CHAIN])).rows;
  await t.test('NFT runner checkpoint executes its bounded writer and purge against real PostgreSQL',async sub=>{
    const f=nftFixture(sub);target.eventListener.getBlock=async number=>({number,hash:hash(number)});
    const config={...f.options,maxBlocks:11};
    let result=await syncNftTransferCheckpoint(target,config);
    assert.equal(result.advanced,true);assert.equal(result.result.throughBlock,110);
    let progress=await readNftTransferProgress(target,config,await target.getIndexerState());
    assert.equal(progress.blocksBehind,5);assert.equal(progress.cacheReady,true);assert.equal(progress.ready,false);
    f.logs=[];result=await syncNftTransferCheckpoint(target,config);
    assert.equal(result.result.throughBlock,115);
    progress=await readNftTransferProgress(target,config,await target.getIndexerState());
    assert.equal(progress.ready,true);assert.equal(progress.blocksBehind,0);
    f.calls=[];result=await syncNftTransferCheckpoint(target,config);assert.equal(result.advanced,false);assert.deepEqual(f.calls,[]);
  });
  for(const change of ['revision','cursor','cache'])await t.test(`NFT progress rejects a changed ${change} boundary in PostgreSQL`,async sub=>{
    const f=nftFixture(sub);await f.run();
    const captured=await target.getIndexerState();
    if(change==='revision')await pool.query('UPDATE indexer_state SET last_indexed_block=last_indexed_block WHERE chain_id=$1',[CHAIN]);
    if(change==='cursor')await pool.query('UPDATE indexer_state SET last_indexed_block=116 WHERE chain_id=$1',[CHAIN]);
    if(change==='cache')await pool.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
    await assert.rejects(readNftTransferProgress(target,f.options,captured),/state changed/);
  });
  await t.test('NFT writer commits ordered source facts and coverage without changing economic projections or Core progress',async sub=>{
    const f=nftFixture(sub),before=await snapshot(CHAIN),foreign=await snapshot(OTHER_CHAIN);
    const result=await f.run(),after=await snapshot(CHAIN),rows=await nftRows();
    assert.equal(result.eventCount,3);assert.equal(result.cacheInvalidationPending,true);
    assert.deepEqual(rows.map(row=>[row.block_number,row.log_index]),[['100',1],['110',3],['110',9]]);
    assert.ok(rows.every(row=>row.artwork_id===null&&row.contract_address===f.options.nftAddress&&
      row.event_data.tokenId==='9007199254740993'&&row.indexed_at.toISOString()==='1970-01-01T00:01:40.000Z'));
    for(const name of tables.filter(name=>!['contract_events','indexer_state','nft_transfer_coverage'].includes(name)))assert.deepEqual(after[name],before[name],name);
    assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);
    assert.equal(after.indexer_state[0].last_indexed_block,before.indexer_state[0].last_indexed_block);
    assert.equal(after.indexer_state[0].total_events_indexed,before.indexer_state[0].total_events_indexed);
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'110');
    assert.ok(after.indexer_state[0].recovery_cache_token);
  });
  await t.test('empty NFT bootstrap and contiguous empty catch-up still invalidate first public exposure',async sub=>{
    const f=nftFixture(sub);f.logs=[];await f.run();
    assert.deepEqual(await nftRows(),[]);assert.equal((await coverageRows(CHAIN))[0].covered_through,'110');
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    const previousRevision=(await target.getIndexerState()).revision;
    f.continue(111,114);assert.equal((await f.run()).cacheInvalidationPending,false);
    assert.notEqual((await target.getIndexerState()).revision,previousRevision);
    f.continue(115,115);assert.equal((await f.run()).cacheInvalidationPending,true);
    assert.equal((await coverageRows(CHAIN))[0].from_block,'100');
    assert.equal((await coverageRows(CHAIN))[0].origin_block_hash,hash(99));
  });
  await t.test('NFT terminal range commits only at the exact retained Core checkpoint hash',async sub=>{
    const f=nftFixture(sub);f.options.blockNumber=115;f.options.blockHash=hash(115);
    const before=await snapshot(CHAIN),result=await f.run(),after=await snapshot(CHAIN);
    assert.equal(result.throughBlock,115);assert.equal(result.eventCount,3);assert.equal(result.cacheInvalidationPending,true);
    assert.equal((await coverageRows(CHAIN))[0].covered_hash,hash(115));
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'115');
    assert.deepEqual(after.block_hashes,before.block_hashes);
    for(const name of tables.filter(name=>!['contract_events','indexer_state','nft_transfer_coverage'].includes(name)))
      assert.deepEqual(after[name],before[name],name);
  });
  for(const [label,value] of [['missing',null],['wrong',hash(999)],['zero',hash(0)],['malformed','0x1234']]) {
    await t.test(`NFT terminal range rejects a ${label} Core checkpoint hash before RPC`,async sub=>{
      const f=nftFixture(sub);f.options.blockNumber=115;f.options.blockHash=hash(115);
      if(value===null)await pool.query('DELETE FROM block_hashes WHERE chain_id=$1 AND block_number=115',[CHAIN]);
      else await pool.query('UPDATE block_hashes SET block_hash=$2 WHERE chain_id=$1 AND block_number=115',[CHAIN,value]);
      const before=await snapshot(CHAIN),foreign=await snapshot(OTHER_CHAIN);
      await assert.rejects(f.run(),/retained Core checkpoint hash/);assert.deepEqual(f.calls,[]);
      assert.deepEqual(await snapshot(CHAIN),before);assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);
    });
  }
  for(const change of ['changed','deleted'])await t.test(`NFT terminal range rejects its Core header ${change} during RPC without range writes`,async sub=>{
    const f=nftFixture(sub);f.options.blockNumber=115;f.options.blockHash=hash(115);let externalChange;
    f.hook=async method=>{if(method!=='eth_getLogs')return;f.hook=null;
      if(change==='changed')await pool.query('UPDATE block_hashes SET block_hash=$2 WHERE chain_id=$1 AND block_number=115',[CHAIN,hash(999)]);
      else await pool.query('DELETE FROM block_hashes WHERE chain_id=$1 AND block_number=115',[CHAIN]);
      externalChange=await snapshot(CHAIN);
    };
    await assert.rejects(f.run(),/retained Core checkpoint hash/);
    assert.ok(f.calls.includes('eth_getLogs'));assert.ok(externalChange);
    assert.deepEqual(await snapshot(CHAIN),externalChange);assert.deepEqual(await coverageRows(CHAIN),[]);
  });
  await t.test('NFT historical range does not require a retained Core header at its earlier endpoint',async sub=>{
    const f=nftFixture(sub);
    await pool.query('DELETE FROM block_hashes WHERE chain_id=$1 AND block_number=110',[CHAIN]);
    const before=(await snapshot(CHAIN)).block_hashes;
    assert.equal((await f.run()).throughBlock,110);assert.equal((await coverageRows(CHAIN))[0].covered_hash,hash(110));
    assert.deepEqual((await snapshot(CHAIN)).block_hashes,before);
  });
  for(const change of [{fromBlock:112},{previousBlockHash:hash(88)},{expectedNftCodeHash:hash(777)},
    {expectedCoreCodeHash:hash(778)},{bootstrap:true},{blockNumber:116,blockHash:hash(116)}]) {
    await t.test(`NFT continuation rejects ${Object.keys(change).join(',')} before RPC`,async sub=>{
      const f=nftFixture(sub);await f.run();f.continue(111,114);Object.assign(f.options,change);
      f.calls=[];const before=await snapshot(CHAIN);
      await assert.rejects(f.run());assert.deepEqual(f.calls,[]);assert.deepEqual(await snapshot(CHAIN),before);
    });
  }
  await t.test('NFT continuation without coverage cannot silently bootstrap',async sub=>{
    const f=nftFixture(sub);f.options.bootstrap=false;await assert.rejects(f.run(),/bootstrap state/);assert.deepEqual(f.calls,[]);
  });
  for(const stage of ['INSERT INTO public.contract_events','UPDATE public.indexer_state SET last_indexed_block',
    'INSERT INTO public.nft_transfer_coverage'])await t.test(`NFT range failure at ${stage} rolls back journal and coverage`,async sub=>{
      const f=nftFixture(sub),before=await snapshot(CHAIN);
      beforeSql=async sql=>{if(sql.startsWith(stage))throw Error('fixture NFT write failure');};
      await assert.rejects(f.run(),/fixture NFT write failure/);assert.deepEqual(await snapshot(CHAIN),before);
    });
  await t.test('malformed NFT RPC range does not write partial journal facts',async sub=>{
    const f=nftFixture(sub),before=await snapshot(CHAIN);f.logs[0].removed=true;
    await assert.rejects(f.run(),/Invalid NFT Transfer log/);assert.deepEqual(await snapshot(CHAIN),before);
  });
  for(const change of ['state','coverage','leadership','listener'])await t.test(`NFT writer rejects ${change} changing while RPC is outstanding`,async sub=>{
    const f=nftFixture(sub);await f.run();f.continue(111,114);let after;
    f.hook=async method=>{if(method!=='eth_getLogs')return;f.hook=null;
      if(change==='state')await pool.query('UPDATE indexer_state SET last_indexed_block=last_indexed_block WHERE chain_id=$1',[CHAIN]);
      if(change==='coverage')await pool.query('UPDATE nft_transfer_coverage SET covered_hash=$1 WHERE chain_id=$2',[hash(888),CHAIN]);
      if(change==='leadership')leaderCurrent=false;
      if(change==='listener')target.eventListener.nftAddress=WINNER;
      after=await snapshot(CHAIN);
    };
    await assert.rejects(f.run(),/changed|fence lost/);assert.deepEqual(await snapshot(CHAIN),after);
  });
  for(const [column,value] of [['contract_address',null],['contract_address',WINNER],['event_name','Other'],
    ['artwork_id','999'],['indexed_at','2026-01-01T00:00:00Z'],['event_data','{}']]) {
    await t.test(`NFT replay rejects retained ${column} conflicts without overwriting evidence`,async sub=>{
      const f=nftFixture(sub);await f.run();
      await pool.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
      await pool.query(`UPDATE contract_events SET ${column}=$1 WHERE chain_id=$2 AND transaction_hash=$3 AND log_index=1`,[value,CHAIN,hash(10000)]);
      const before=await snapshot(CHAIN);await assert.rejects(f.run(),/journal conflicts/);
      assert.deepEqual(await snapshot(CHAIN),before);
    });
  }
  await t.test('NFT bootstrap rejects extra retained events absent from the canonical range',async sub=>{
    const f=nftFixture(sub);await f.run();await pool.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
    f.logs=[];const before=await snapshot(CHAIN);await assert.rejects(f.run(),/unverified range events/);
    assert.deepEqual(await snapshot(CHAIN),before);
  });
  await t.test('NFT bootstrap replay preserves exact retained facts and never duplicates them',async sub=>{
    const f=nftFixture(sub);await f.run();const rows=await nftRows();
    await pool.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
    await f.run();assert.deepEqual(await nftRows(),rows);assert.equal((await coverageRows(CHAIN))[0].covered_through,'110');
  });
  await t.test('direct rewind removes orphan NFT facts and forces verified replay before coverage returns',async sub=>{
    const f=nftFixture(sub);await f.run();await pool.query('SELECT rollback_events_from_block($1,$2)',[110,CHAIN]);
    assert.deepEqual((await nftRows()).map(row=>row.log_index),[1]);assert.deepEqual(await coverageRows(CHAIN),[]);
    const mint=f.logs.find(log=>log.logIndex==='0x1');f.continue(100,109,[mint]);
    await assert.rejects(f.run(),/bootstrap state/);f.options.bootstrap=true;await f.run();
    assert.deepEqual((await nftRows()).map(row=>row.log_index),[1]);assert.equal((await coverageRows(CHAIN))[0].covered_through,'109');
  });
  await t.test('two concurrent NFT ranges cannot both advance the same captured coverage',async sub=>{
    const f=nftFixture(sub),arrived=deferred();let reads=0;
    f.hook=async method=>{if(method==='eth_getLogs'){if(++reads===2)arrived.resolve();await arrived.promise;}};
    const results=await Promise.allSettled([f.run(),f.run()]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.match(results.find(result=>result.status==='rejected').reason.message,/state changed/);
    assert.equal((await nftRows()).length,3);assert.equal((await coverageRows(CHAIN)).length,1);
  });
  await t.test('NFT writer retains a pending cache obligation and rejects configured-cache progress',async sub=>{
    const f=nftFixture(sub);await f.run();f.continue(111,114);f.calls=[];
    const oldRedis=process.env.REDIS_URL;process.env.REDIS_URL='redis://fixture.invalid';
    try{await assert.rejects(f.run(),/cache purge pending/);assert.deepEqual(f.calls,[]);}
    finally{if(oldRedis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=oldRedis;}
  });
  await t.test('NFT writer captures caller input before the first asynchronous read',async sub=>{
    const f=nftFixture(sub);f.hook=async method=>{if(method==='eth_getLogs')f.options.nftAddress=WINNER;};
    await f.run();assert.equal((await coverageRows(CHAIN))[0].nft_address,`0x${'d'.repeat(40)}`);
  });
  for(const stage of ['SELECT lock_name FROM','INSERT INTO public.contract_events']) {
    await t.test(`NFT listener chain change after proof at ${stage} rolls back the range`,async sub=>{
      const f=nftFixture(sub),before=await snapshot(CHAIN);
      beforeSql=async sql=>{if(sql.startsWith(stage))target.eventListener.chainId=OTHER_CHAIN;};
      await assert.rejects(f.run(),/authority changed/);assert.deepEqual(await snapshot(CHAIN),before);
    });
  }

  const {syncCoordinatedCheckpoint} = await import(pathToFileURL(path.join(ROOT,'src/indexer/coordinated-checkpoint.js')).href);
  function coordinatedEvents() {
    const event=(eventName,eventData,index)=>({eventName,eventData,blockNumber:116,blockHash:hash(116),
      transactionHash:hash(11600+index),transactionIndex:index,logIndex:index,contractAddress:CORE,removed:false});
    return [event('ArtworkRegistered',{artworkId:2,creator:CREATOR,metadataURI:'ipfs://coordinated-fixture'},0),
      event('AuctionCreated',{auctionId:2,artworkId:2,creator:CREATOR,startPrice:1000,duration:86400,
        endTime:1700086400,chainId:CHAIN},1)];
  }
  async function coordinatedFixture(sub,events=[]) {
    const f=nftFixture(sub);
    f.options.blockNumber=115;f.options.blockHash=hash(115);
    await f.run();await target._purgeRecoveryCache();
    const moved={...f.logs[0],blockNumber:'0x75',blockHash:hash(117),transactionHash:hash(11700),logIndex:'0x2'};
    f.config=Object.freeze({...f.options,maxBlocks:10});f.logs=[];f.coreEvents=events;f.calls=[];f.purges=0;
    target.fixtureCachePurgeHook=async()=>{f.purges++;return true;};
    target.eventListener.getBlock=async number=>({number,hash:hash(number),parentHash:hash(number-1),timestamp:100});
    target.eventListener.queryAllHistoricalEvents=async()=>f.coreEvents;
    f.addTransfer=()=>{f.logs=[moved];};
    f.publish=()=>syncCoordinatedCheckpoint(target,f.config,117,132);
    f.boundary=async()=>(await pool.query('SELECT * FROM read_verified_nft_boundary($1,$2,$3,$4)',
      [CORE,f.config.nftAddress,f.config.expectedCoreCodeHash,f.config.expectedNftCodeHash])).rows;
    return f;
  }
  await t.test('coordinated empty publication advances both cursors and coverage without a purge',async sub=>{
    const f=await coordinatedFixture(sub),before=await writerSnapshot(),foreign=await snapshot(OTHER_CHAIN);
    const result=await f.publish(),after=await writerSnapshot(),state=await target.getIndexerState();
    assert.deepEqual(result,{fromBlock:116,throughBlock:117,processedCount:0});assert.equal(f.purges,0);
    assert.equal(state.last_indexed_block,117);assert.equal(state.last_confirmed_block,117);
    assert.equal(state.recovery_cache_token,null);assert.equal(state.state_hash,await target._computeStateHash(117));
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'117');
    assert.equal((await f.boundary())[0].indexed_through,'117');
    for(const table of tables.filter(name=>!['indexer_state','block_hashes','nft_transfer_coverage'].includes(name)))
      assert.deepEqual(after.chain[table],before.chain[table],table);
    assert.deepEqual(after.outbox,before.outbox);assert.deepEqual(await snapshot(OTHER_CHAIN),foreign);
  });
  await t.test('coordinated ordered Core projections and NFT movement publish together',async sub=>{
    const events=coordinatedEvents(),f=await coordinatedFixture(sub,[events[1],events[0]]);f.addTransfer();
    const result=await f.publish(),after=await writerSnapshot();
    assert.equal(result.processedCount,2);assert.equal(f.purges,1);
    assert.equal(String(after.chain.v41_artworks.find(row=>String(row.artwork_id)==='2').active_auction_id),'2');
    assert.equal(after.chain.v41_auctions.find(row=>String(row.auction_id)==='2').status,'active');
    assert.equal(after.chain.event_processing_registry.filter(row=>row.block_number>115&&row.processing_status==='completed').length,2);
    assert.equal(after.chain.contract_events.filter(row=>row.block_number>115).length,3);
    assert.equal((await nftRows()).at(-1).block_number,'117');
    assert.ok(after.outbox.some(row=>row.correlation_id===`${CHAIN}-${events[0].transactionHash}-0`));
    assert.equal((await f.boundary())[0].indexed_through,'117');
  });
  await t.test('coordinated readers see the old complete boundary until commit and the new boundary afterwards',async sub=>{
    const f=await coordinatedFixture(sub,coordinatedEvents()),before=await writerSnapshot();f.addTransfer();
    const paused=deferred(),release=deferred();let intercepted=false;
    beforeSql=async sql=>{if(sql==='COMMIT'&&!intercepted){intercepted=true;paused.resolve();await release.promise;}};
    const publishing=settle(f.publish());
    try {
      await reach(paused,publishing);
      assert.equal((await f.boundary())[0].indexed_through,'115');
      assert.deepEqual(await writerSnapshot(),before,'uncommitted projections, headers, leases and outbox stay invisible');
    } finally {release.resolve();beforeSql=null;}
    assert.ifError((await publishing).error);
    assert.equal((await f.boundary())[0].indexed_through,'117');
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'117');
  });
  for(const name of ['SettlementCompleted','BidPlaced'])await t.test(
    `coordinated retained ${name} without completion cannot replay its projections`,async sub=>{
      const f=await coordinatedFixture(sub);
      const event={...coordinatedEvents()[0],eventName:name,eventData:name==='SettlementCompleted'
        ?{auctionId:1,artworkId:1,winner:WINNER,finalPrice:2000,tokenId:7}
        :{auctionId:1,bidder:WINNER,bidAmount:2000,depositAmount:100},timestamp:100000};
      f.coreEvents=[event];
      if(name==='BidPlaced')f.coreEvents.push({...event,transactionHash:hash(11601),logIndex:1,
        transactionIndex:1,eventData:{...event.eventData,bidder:CREATOR,bidAmount:3000}});
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        for(const retained of f.coreEvents){
          await client.query(`INSERT INTO event_processing_registry(event_hash,chain_id,transaction_hash,
            log_index,event_name,block_number,processing_status) VALUES($1,$2,$3,$4,$5,$6,'completed')`,
          [await target._computeEventHash(retained),CHAIN,retained.transactionHash,
            retained.logIndex,retained.eventName,retained.blockNumber]);
          await target._applyEventProjectionTx(retained,client);
        }
        // Simulate losing the first completion after its projection committed;
        // a later retained bid remains completed and must not be overwritten.
        await client.query('DELETE FROM event_processing_registry WHERE chain_id=$1 AND transaction_hash=$2',
          [CHAIN,event.transactionHash]);
        await client.query('COMMIT');
      } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      // The extra-journal guard is independently covered. Supply the later event
      // too, so this check exercises the missing completion specifically.
      const before=await writerSnapshot();
      await assert.rejects(f.publish(),/missing its completed processing record/);
      const after=await writerSnapshot(),failed=after.chain.event_processing_registry
        .filter(row=>row.transaction_hash===event.transactionHash);
      assert.equal(failed.length,1);assert.equal(failed[0].processing_status,'failed');
      after.chain.event_processing_registry=after.chain.event_processing_registry
        .filter(row=>row.transaction_hash!==event.transactionHash);
      assert.deepEqual(after,before,'no projection, trust, outbox, counter or boundary can change');
      assert.equal(f.purges,0);
    });
  await t.test('coordinated publication clears its cache gate before optional enrichment',async sub=>{
    const f=await coordinatedFixture(sub,coordinatedEvents());let enriched=0;
    sub.mock.method(target,'_afterEventCommit',async()=>{
      enriched++;assert.equal(f.purges,1);
      assert.equal((await f.boundary())[0].indexed_through,'117');
    });
    await f.publish();assert.equal(enriched,2);
  });
  await t.test('coordinated purge failure preserves the committed range and pending obligation',async sub=>{
    const f=await coordinatedFixture(sub,coordinatedEvents());let enriched=0;
    sub.mock.method(target,'_afterEventCommit',async()=>{enriched++;});
    target.fixtureCachePurgeHook=async()=>{throw new Error('fixture purge unavailable');};
    await assert.rejects(f.publish(),/fixture purge unavailable/);
    const committed=await writerSnapshot();
    assert.equal((await target.getIndexerState()).last_indexed_block,117);
    assert.ok((await target.getIndexerState()).recovery_cache_token);
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'117');
    assert.deepEqual(await f.boundary(),[]);assert.equal(enriched,2);
    target.fixtureCachePurgeHook=async()=>true;await target._purgeRecoveryCache();
    assert.equal((await f.boundary())[0].indexed_through,'117');
    const recovered=await writerSnapshot();
    assert.deepEqual(recovered.outbox,committed.outbox);
    assert.deepEqual(recovered.chain.contract_events,committed.chain.contract_events);
  });
  await t.test('coordinated poll/cache acceptance preserves one publication through purge retries and delayed refill',async sub=>{
    const f=await coordinatedFixture(sub,coordinatedEvents());f.addTransfer();
    const {cache,data}=await recoveryCache();
    const phases=[],bytes=value=>Buffer.byteLength(JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item));
    let phase=null,now=Date.now(),head=132,failDeletion=true,refills=0;
    const startedAt=now,entered=deferred(),release=deferred();
    // Load shipped methods without runner startup, dotenv, provider construction
    // or timers. Only this runner's clock advances; PostgreSQL retains real time.
    const methods=(start,end)=>{
      const from=runnerSource.indexOf(start),to=runnerSource.indexOf(end,from);
      assert.ok(from>0&&to>from);return runnerSource.slice(from,to);
    };
    const PollRunner=new Function('readNftTransferProgress','syncNftTransferCheckpoint','syncCoordinatedCheckpoint','Date',
      `return class PollRunner {${methods('    _runConfirmationPoll()','    async _refreshResaleState(')}
      ${methods('    async _catchUpToSafeBlock(','    async getHealth(')}
      ${methods('    async _refreshEventFailureMetric(','    async start()')}}`)
      (readNftTransferProgress,syncNftTransferCheckpoint,syncCoordinatedCheckpoint,{now:()=>now});
    const runner=Object.assign(new PollRunner(),{config:{chainId:CHAIN,contractAddress:CORE,nftTransferConfig:f.config},
      confirmationDepth:15,isLeader:true,isRunning:true,isStopping:false,lastReorgCheckAt:now,
      reorgCheckInterval:60000,syncEngine:target,eventListener:target.eventListener,
      metrics:{updateEventFailures(){}},_refreshResaleState:async()=>{},_refreshSearchMetadata:()=>{}});
    sub.mock.method(console,'error',()=>{});sub.mock.method(console,'warn',()=>{});
    sub.mock.method(globalThis,'fetch',async()=>assert.fail('External HTTP forbidden in combined acceptance'));
    const sqlResult=(sql,result)=>{
      if(phase){phase.sqlCalls++;phase.sqlRowsJsonBytes+=bytes(result.rows);
        if(sql.includes('SELECT encode(digest('))phase.digestCalls++;}
      return result;
    };
    const originalQuery=pool.query.bind(pool),originalConnect=db.pool.connect.bind(db.pool);
    sub.mock.method(pool,'query',async(sql,values)=>sqlResult(sql,await originalQuery(sql,values)));
    sub.mock.method(db.pool,'connect',async()=>{
      const client=await originalConnect();return{release:()=>client.release(),
        query:async(sql,values)=>sqlResult(sql,await client.query(sql,values))};
    });
    const originalRead=target.eventListener._readRpcCall.bind(target.eventListener);
    sub.mock.method(target.eventListener,'_readRpcCall',operation=>originalRead(provider=>operation({
      async send(method,params){const result=await provider.send(method,params);
        if(phase){phase.nftRpc[method]=(phase.nftRpc[method]||0)+1;phase.nftRpcJsonBytes+=bytes(result);}return result;}
    })));
    for(const name of ['getBlock','queryAllHistoricalEvents']){
      const original=target.eventListener[name].bind(target.eventListener);
      sub.mock.method(target.eventListener,name,async(...args)=>{
        const result=await original(...args);if(phase){phase.coreListenerReads[name]=(phase.coreListenerReads[name]||0)+1;
          phase.coreListenerJsonBytes+=bytes(result);}return result;
      });
    }
    target.eventListener.getCurrentBlock=async()=>{if(phase)phase.headReads++;return head;};
    const originalPublish=runner._publishCoordinatedRange.bind(runner);
    sub.mock.method(runner,'_publishCoordinatedRange',async(...args)=>{
      if(phase)phase.publications++;return originalPublish(...args);
    });
    const redis=await cache.getRedis(),transport={};
    for(const name of ['get','set','scan','del','eval'])transport[name]=async(...args)=>{
      if(phase)phase.cacheCommands[name]=(phase.cacheCommands[name]||0)+1;
      if(name==='del'&&failDeletion)throw new Error('fixture cache deletion unavailable');
      return redis[name](...args);
    };
    sub.mock.method(cache,'getRedis',async()=>transport);
    target.fixtureCachePurgeHook=options=>cache.purge(options);
    const key=cache.keys.auction(`${CHAIN}:combined-poll`),oldKey=cache.keys.stats('combined-poll-old');
    await cache.set(oldKey,{indexedThrough:115},3600);
    const fetchSnapshot=async()=>{
      refills++;const rows=await f.boundary();assert.equal(rows.length,1);
      const value={indexedThrough:Number(rows[0].indexed_through)};
      if(refills===1){entered.resolve();await release.promise;}return value;
    };
    const pending=cache.remember(key,3600,fetchSnapshot);
    sub.after(async()=>{release.resolve();await pending.catch(()=>{});});
    await entered.promise;
    const measure=async(name,elapsed,operation=()=>runner._runConfirmationPoll())=>{
      now=startedAt+elapsed;
      phase={name,elapsedMs:elapsed,headReads:0,publications:0,sqlCalls:0,sqlRowsJsonBytes:0,digestCalls:0,
        nftRpc:{},nftRpcJsonBytes:0,coreListenerReads:{},coreListenerJsonBytes:0,cacheCommands:{}};
      const recorded=phase;phases.push(recorded);
      try{await operation();}finally{phase=null;}
      return recorded;
    };
    const initial=await measure('publish-cache-fails',0);
    assert.equal(initial.publications,1);assert.equal(initial.digestCalls,1);
    assert.equal(initial.nftRpc.eth_getLogs,1);assert.equal(initial.coreListenerReads.queryAllHistoricalEvents,1);
    assert.equal(initial.cacheCommands.scan,1);assert.equal(initial.cacheCommands.del,1);
    assert.equal((await target.getIndexerState()).last_indexed_block,117);
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'117');
    assert.ok(await recoveryToken());assert.deepEqual(await f.boundary(),[]);
    assert.equal(runner.nftTransferError,'Verified publication refresh failed');
    const committed=await writerSnapshot(),token=await recoveryToken();
    assert.equal(committed.chain.contract_events.filter(row=>row.block_number>115).length,3);
    const retry=await measure('purge-retry-fails',2000);
    assert.equal(retry.publications,0);assert.equal(retry.headReads,0);assert.deepEqual(retry.nftRpc,{});
    assert.equal(retry.digestCalls,0);assert.equal(retry.cacheCommands.del,1);
    assert.equal(await recoveryToken(),token);assert.deepEqual(await f.boundary(),[]);
    assert.deepEqual(await writerSnapshot(),committed);
    failDeletion=false;
    const recovered=await measure('purge-recovers',4000);
    assert.equal(recovered.publications,0);assert.equal(recovered.headReads,0);assert.deepEqual(recovered.nftRpc,{});
    assert.equal(recovered.digestCalls,0);assert.equal(recovered.cacheCommands.scan,1);
    assert.equal(await recoveryToken(),null);assert.equal((await f.boundary())[0].indexed_through,'117');
    assert.equal(data.has(oldKey),false);
    await measure('delayed-refill-and-cache-hit',4000,async()=>{
      release.resolve();assert.deepEqual(await pending,{indexedThrough:117});assert.equal(refills,2);
      assert.equal(data.has(key),false,'a delayed old publication cannot refill the cache');
      assert.deepEqual(await cache.remember(key,3600,fetchSnapshot),{indexedThrough:117});
      assert.equal(refills,3);
      assert.deepEqual(await cache.remember(key,3600,()=>assert.fail('expected the current cached publication')),{indexedThrough:117});
    });
    const afterRecovery=await writerSnapshot();
    assert.deepEqual(afterRecovery.outbox,committed.outbox);
    for(const table of tables.filter(name=>name!=='indexer_state'))
      assert.deepEqual(afterRecovery.chain[table],committed.chain[table],table);
    head=135;
    for(const elapsed of [6000,8000]){
      const idle=await measure('cadence-holds-publication',elapsed);
      assert.equal(idle.headReads,1);assert.equal(runner.lastObservedBlock,135);
      assert.equal(idle.publications,0);assert.deepEqual(idle.nftRpc,{});assert.deepEqual(idle.coreListenerReads,{});
      assert.deepEqual(idle.cacheCommands,{});assert.equal(idle.digestCalls,0);
      assert.ok(idle.sqlCalls<initial.sqlCalls);assert.equal((await f.boundary())[0].indexed_through,'117');
    }
    f.logs=[];f.coreEvents=[];
    const next=await measure('next-empty-publication',10000);
    assert.equal(next.publications,1);assert.equal(next.digestCalls,1);assert.equal(next.nftRpc.eth_getLogs,1);
    assert.deepEqual(next.cacheCommands,{});assert.equal(runner.nftTransferError,null);
    assert.equal((await target.getIndexerState()).last_indexed_block,120);
    assert.equal((await coverageRows(CHAIN))[0].covered_through,'120');
    assert.equal((await f.boundary())[0].indexed_through,'120');
    const final=await writerSnapshot();
    assert.deepEqual(final.outbox,committed.outbox);
    assert.deepEqual(final.chain.contract_events,committed.chain.contract_events);
    assert.deepEqual(final.chain.event_processing_registry,committed.chain.event_processing_registry);
    assert.deepEqual(final.chain.v41_artworks,committed.chain.v41_artworks);
    assert.deepEqual(final.chain.v41_auctions,committed.chain.v41_auctions);
    evidence.results.push({scenario:'coordinated_poll_cache',phases,cacheFetches:refills,
      limitations:'Synthetic chain/cache transport; SQL row JSON bytes exclude protocol overhead. Auxiliary resale/search refreshes are stubbed. Not production latency, billed egress or Redis atomicity evidence.'});
  });
  for(const stage of ['Core handler','NFT journal','digest','checkpoint'])await t.test(
    `coordinated ${stage} failure rolls back the whole publication`,async sub=>{
      const events=coordinatedEvents(),f=await coordinatedFixture(sub,events);f.addTransfer();
      const before=await writerSnapshot();let injected=false;
      beforeSql=async sql=>{
        const matches=stage==='Core handler'?sql.includes('INSERT INTO v41_auctions'):
          stage==='NFT journal'?sql.startsWith('INSERT INTO public.contract_events'):
          stage==='digest'?sql.includes('SELECT encode(digest('):
          sql.startsWith('UPDATE public.indexer_state SET last_indexed_block=$1');
        if(matches){injected=true;throw new Error(`fixture coordinated ${stage} failure`);}
      };
      try {await assert.rejects(f.publish(),/fixture coordinated/);} finally {beforeSql=null;}
      assert.equal(injected,true);const after=await writerSnapshot();
      if(stage==='Core handler') {
        const failed=after.chain.event_processing_registry.filter(row=>row.transaction_hash===events[1].transactionHash);
        assert.equal(failed.length,1);assert.equal(failed[0].processing_status,'failed');
        after.chain.event_processing_registry=after.chain.event_processing_registry.filter(row=>row.transaction_hash!==events[1].transactionHash);
      }
      assert.deepEqual(after,before,'only the failed event retry record may survive');assert.equal(f.purges,0);
      assert.equal((await f.boundary())[0].indexed_through,'115');
    });
  for(const loss of ['RPC leadership loss','late lease expiry'])await t.test(
    `coordinated ${loss} cannot publish a prepared range`,async sub=>{
      const f=await coordinatedFixture(sub,coordinatedEvents()),before=await writerSnapshot();
      if(loss==='RPC leadership loss')f.hook=async method=>{if(method==='eth_getLogs')leaderCurrent=false;};
      else beforeSql=async(sql,client)=>{if(sql.startsWith('UPDATE public.indexer_state SET last_indexed_block=$1'))
        await client.query("UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'");};
      try {await assert.rejects(f.publish(),/authority changed|fence lost/);} finally {beforeSql=null;}
      assert.deepEqual(await writerSnapshot(),before);assert.equal(f.purges,0);
    });
  await t.test('coordinated direct rewind during proof rejects the stale range and preserves recovery state',async sub=>{
    const f=await coordinatedFixture(sub,coordinatedEvents());let recovered;
    f.hook=async method=>{if(method!=='eth_getLogs')return;f.hook=null;
      await pool.query('SELECT rollback_events_from_block($1,$2)',[116,CHAIN]);recovered=await writerSnapshot();};
    await assert.rejects(f.publish(),/state changed|fence lost/);
    assert.ok(recovered);assert.deepEqual(await writerSnapshot(),recovered);assert.deepEqual(await coverageRows(CHAIN),[]);
  });
  for(const change of ['engine chain','Donation added','Donation replaced'])await t.test(
    `coordinated ${change} during proof rejects even an empty range`,async sub=>{
      const f=await coordinatedFixture(sub),before=await writerSnapshot();
      if(change==='Donation replaced')target.eventListener.donationAddress=CREATOR;
      const originalChain=target.chainId,originalDonation=target.eventListener.donationAddress;
      f.hook=async method=>{if(method!=='eth_getLogs')return;
        if(change==='engine chain')target.chainId=OTHER_CHAIN;
        else target.eventListener.donationAddress=WINNER;
      };
      try {await assert.rejects(f.publish(),/changed|authority/);}
      finally {target.chainId=originalChain;target.eventListener.donationAddress=originalDonation;}
      assert.deepEqual(await writerSnapshot(),before);assert.equal(f.purges,0);
    });
  for(const mismatch of ['fork','source'])await t.test(`coordinated Core ${mismatch} mismatch fails before publication`,async sub=>{
    const events=coordinatedEvents(),f=await coordinatedFixture(sub,events),before=await writerSnapshot();
    if(mismatch==='fork')events[0].blockHash=hash(999);else events[0].contractAddress=WINNER;
    await assert.rejects(f.publish(),/different fork|different source/);
    assert.deepEqual(await writerSnapshot(),before);assert.deepEqual(f.calls,[]);
  });
  await t.test('coordinated Core transaction positions must agree across the entire range',async sub=>{
    const f=await coordinatedFixture(sub),before=await writerSnapshot();
    for(const mismatch of ['one transaction across blocks','two transactions at one position','reversed transaction order']) {
      const events=coordinatedEvents();f.coreEvents=events;
      if(mismatch==='one transaction across blocks')Object.assign(events[1],
        {blockNumber:117,blockHash:hash(117),transactionHash:events[0].transactionHash});
      if(mismatch==='two transactions at one position')events[1].transactionIndex=0;
      if(mismatch==='reversed transaction order'){events[0].transactionIndex=1;events[1].transactionIndex=0;}
      await assert.rejects(f.publish(),/transaction positions/);assert.deepEqual(await writerSnapshot(),before,mismatch);
    }
  });
  await t.test('coordinated Core and NFT facts cannot conflict on transaction or log positions',async sub=>{
    const events=coordinatedEvents(),f=await coordinatedFixture(sub,events),before=await writerSnapshot();
    for(const mismatch of ['transaction across blocks','duplicate log position','shared position with different transaction']) {
      f.addTransfer();const log=f.logs[0];
      if(mismatch==='transaction across blocks')log.transactionHash=events[0].transactionHash;
      else {
        log.blockNumber='0x74';log.blockHash=hash(116);
        if(mismatch==='duplicate log position'){log.logIndex='0x0';log.transactionHash=events[0].transactionHash;}
        else log.transactionIndex='0x1';
      }
      await assert.rejects(f.publish(),/transaction positions/);assert.deepEqual(await writerSnapshot(),before,mismatch);
    }
  });
  await t.test('coordinated publication rejects extra retained Core, Donation and unknown-source events',async sub=>{
    const f=await coordinatedFixture(sub);target.eventListener.donationAddress=WINNER;
    for(const source of [CORE,WINNER,null]) {
      await pool.query(`INSERT INTO contract_events(chain_id,event_name,artwork_id,block_number,transaction_hash,
        log_index,event_data,indexed_at,contract_address) VALUES($1,$2,2,116,$3,0,$4,to_timestamp(100),$5)`,
      [CHAIN,source===WINNER?'Donation':'ArtworkRegistered',hash(11600),
        JSON.stringify({artworkId:'2',creator:CREATOR,metadataURI:'ipfs://retained-unverified'}),source]);
      const before=await writerSnapshot();await assert.rejects(f.publish(),/unverified range events/);
      assert.deepEqual(await writerSnapshot(),before);assert.equal(f.purges,0);
      await pool.query('DELETE FROM contract_events WHERE chain_id=$1 AND transaction_hash=$2',[CHAIN,hash(11600)]);
    }
  });

  const OWNER_NFT=`0x${'d'.repeat(40)}`, HOLDER=`0x${'e'.repeat(40)}`, LAST_HOLDER=`0x${'f'.repeat(40)}`;
  const ownerSql='SELECT * FROM public.read_verified_nft_owners($1,$2,$3,$4,$5)';
  const ownerParams=(ids=['1'])=>[CORE,OWNER_NFT,hash(900),hash(901),ids];
  const owners=async(client=pool,ids=['1'])=>(await client.query(ownerSql,ownerParams(ids))).rows;
  async function seedOwnerProof() {
    await apply(target,'SettlementCompleted',106,{auctionId:1,artworkId:1,winner:WINNER,finalPrice:2000,tokenId:7},4);
    await pool.query('UPDATE contract_events SET contract_address=$1 WHERE chain_id=$2',[CORE,CHAIN]);
    const settlement=(await pool.query("SELECT * FROM contract_events WHERE chain_id=$1 AND event_name='SettlementCompleted'",[CHAIN])).rows[0];
    for(const [block,log,tx,from,to] of [[106,1,settlement.transaction_hash,'0x'+'0'.repeat(40),WINNER],
      [110,3,hash(501),WINNER,HOLDER],[110,9,hash(501),HOLDER,LAST_HOLDER]]) {
      await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data,indexed_at)
        VALUES($1,'Transfer',$2,$3,$4,$5,$6,to_timestamp($7))`,[CHAIN,OWNER_NFT,block,tx,log,
        JSON.stringify({from,to,tokenId:'7',blockHash:hash(block),transactionIndex:2}),1700000000+block*2]);
    }
    await seedCoverage();return settlement;
  }
  await t.test('NFT ownership proof follows the latest transfer while preserving First Collector and indexed boundary',async()=>{
    await seedOwnerProof();const before=await snapshot(CHAIN);const [row]=await owners();
    assert.equal(row.verified,true);assert.equal(row.artwork_id,'1');assert.equal(row.token_id,'7');
    assert.equal(row.current_owner_address,LAST_HOLDER);assert.equal(row.first_collector_address,WINNER);
    assert.equal(row.latest_transfer.log_index,9);assert.equal(row.latest_transfer.block_number,110);
    assert.equal(row.latest_transfer.from_address,HOLDER);assert.equal(row.latest_transfer.to_address,LAST_HOLDER);
    assert.equal(row.indexed_through,'115');assert.equal(row.confirmed_through,'115');assert.equal(row.covered_hash,hash(115));
    assert.match(row.state_revision,/^\d+$/);assert.equal(row.latest_transfer.price,undefined);
    assert.deepEqual(await snapshot(CHAIN),before,'ownership reads cannot change lifecycle, floor, journal or balances');
  });
  for(const [name,sql,params] of [
    ['registration source is unknown',"UPDATE contract_events SET contract_address=NULL WHERE chain_id=$1 AND event_name='ArtworkRegistered'",[CHAIN]],
    ['registration belongs to another Core',"UPDATE contract_events SET contract_address=$2 WHERE chain_id=$1 AND event_name='ArtworkRegistered'",[CHAIN,CREATOR]],
    ['registration creator disagrees',"UPDATE contract_events SET event_data=jsonb_set(event_data,'{creator}',to_jsonb($2::TEXT)) WHERE chain_id=$1 AND event_name='ArtworkRegistered'",[CHAIN,HOLDER]],
    ['registration media disagrees',"UPDATE v41_artworks SET metadata_uri='ipfs://changed' WHERE chain_id=$1",[CHAIN]],
    ['settlement source is unknown',"UPDATE contract_events SET contract_address=NULL WHERE chain_id=$1 AND event_name='SettlementCompleted'",[CHAIN]],
    ['settlement belongs to another Core',"UPDATE contract_events SET contract_address=$2 WHERE chain_id=$1 AND event_name='SettlementCompleted'",[CHAIN,HOLDER]],
    ['settlement token disagrees',"UPDATE contract_events SET event_data=jsonb_set(event_data,'{tokenId}','8') WHERE chain_id=$1 AND event_name='SettlementCompleted'",[CHAIN]],
    ['settlement winner disagrees',"UPDATE v41_settlements SET winner=$2 WHERE chain_id=$1",[CHAIN,HOLDER]],
    ['settlement price disagrees',"UPDATE v41_settlements SET final_price=3000 WHERE chain_id=$1",[CHAIN]],
    ['settlement is not completed',"UPDATE v41_settlements SET settlement_status='pending' WHERE chain_id=$1",[CHAIN]],
    ['artwork is not minted',"UPDATE v41_artworks SET minted=false WHERE chain_id=$1",[CHAIN]],
    ['mint is missing',"DELETE FROM contract_events WHERE chain_id=$1 AND event_name='Transfer' AND block_number=106",[CHAIN]],
    ['mint comes from a foreign NFT',"UPDATE contract_events SET contract_address=$2 WHERE chain_id=$1 AND event_name='Transfer' AND block_number=106",[CHAIN,HOLDER]],
    ['mint token is different',"UPDATE contract_events SET event_data=jsonb_set(event_data,'{tokenId}','8') WHERE chain_id=$1 AND event_name='Transfer' AND block_number=106",[CHAIN]],
    ['mint is from a foreign transaction',"UPDATE contract_events SET transaction_hash=$2 WHERE chain_id=$1 AND event_name='Transfer' AND block_number=106",[CHAIN,hash(999)]],
    ['mint follows settlement log',"UPDATE contract_events SET log_index=5 WHERE chain_id=$1 AND event_name='Transfer' AND block_number=106",[CHAIN]],
    ['mint recipient is different',"UPDATE contract_events SET event_data=jsonb_set(event_data,'{to}',to_jsonb($2::TEXT)) WHERE chain_id=$1 AND event_name='Transfer' AND block_number=106",[CHAIN,HOLDER]],
    ['latest movement recipient is invalid',"UPDATE contract_events SET event_data=jsonb_set(event_data,'{to}','\"invalid\"') WHERE chain_id=$1 AND event_name='Transfer' AND log_index=9",[CHAIN]],
    ['latest movement is an unexpected second mint',"UPDATE contract_events SET event_data=jsonb_set(event_data,'{from}',to_jsonb($2::TEXT)) WHERE chain_id=$1 AND event_name='Transfer' AND log_index=9",[CHAIN,'0x'+'0'.repeat(40)]],
    ['latest movement has an unverified artwork link',"UPDATE contract_events SET artwork_id=1 WHERE chain_id=$1 AND event_name='Transfer' AND log_index=9",[CHAIN]],
    ['coverage is partial',"UPDATE nft_transfer_coverage SET covered_through=114 WHERE chain_id=$1",[CHAIN]],
    ['coverage is ahead of Core',"UPDATE nft_transfer_coverage SET covered_through=116 WHERE chain_id=$1",[CHAIN]],
    ['runtime pin differs',"UPDATE nft_transfer_coverage SET nft_code_hash=$2 WHERE chain_id=$1",[CHAIN,hash(902)]],
    ['recovery is pending',"UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1",[CHAIN]],
    ['deployment changed',"UPDATE indexer_state SET contract_address=$2 WHERE chain_id=$1",[CHAIN,HOLDER]]
  ])await t.test(`NFT ownership proof refuses ${name}`,async()=>{
    await seedOwnerProof();await pool.query(sql,params);const [row]=await owners();
    assert.equal(row.verified,false);assert.equal(row.current_owner_address,null);assert.equal(row.first_collector_address,null);
    assert.equal(row.latest_transfer,null);
  });
  await t.test('NFT ownership proof ignores foreign chain, NFT, token and future records',async()=>{
    await seedOwnerProof();
    for(const [chain,nft,token,block,tx] of [[OTHER_CHAIN,OWNER_NFT,'7',114,601],[CHAIN,HOLDER,'7',114,602],
      [CHAIN,OWNER_NFT,'8',114,603],[CHAIN,OWNER_NFT,'7',116,604]]) {
      await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
        VALUES($1,'Transfer',$2,$3,$4,1,$5)`,[chain,nft,block,hash(tx),JSON.stringify({tokenId:token,from:LAST_HOLDER,to:CREATOR})]);
    }
    assert.equal((await owners())[0].current_owner_address,LAST_HOLDER);
  });
  await t.test('NFT ownership proof refuses ambiguous settlement mapping',async()=>{
    const s=await seedOwnerProof();
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
      VALUES($1,'SettlementCompleted',$2,107,$3,4,$4)`,[CHAIN,CORE,hash(610),s.event_data]);
    assert.equal((await owners())[0].verified,false);
  });
  await t.test('NFT ownership proof refuses a second token for the same original artwork',async()=>{
    const s=await seedOwnerProof();
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
      VALUES($1,'SettlementCompleted',$2,107,$3,4,$4)`,[CHAIN,CORE,hash(611),{...s.event_data,tokenId:'8',auctionId:'2'}]);
    assert.equal((await owners())[0].verified,false);
  });
  await t.test('NFT ownership proof refuses a foreign Core token even when its artwork number matches',async()=>{
    const s=await seedOwnerProof();
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
      VALUES($1,'SettlementCompleted',$2,107,$3,4,$4)`,[CHAIN,HOLDER,hash(612),{...s.event_data,tokenId:'8'}]);
    await pool.query('UPDATE v41_artworks SET token_id=8 WHERE chain_id=$1',[CHAIN]);
    await pool.query('UPDATE v41_settlements SET token_id=8,block_number=107,transaction_hash=$2 WHERE chain_id=$1',[CHAIN,hash(612)]);
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
      VALUES($1,'Transfer',$2,107,$3,1,$4)`,[CHAIN,OWNER_NFT,hash(612),{tokenId:'8',from:'0x'+'0'.repeat(40),to:WINNER}]);
    assert.equal((await owners())[0].verified,false);
  });
  await t.test('NFT ownership proof keeps new coverage unavailable until its cache obligation is acknowledged',async()=>{
    await seedOwnerProof();await pool.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
    await seedCoverage();assert.equal((await owners())[0].verified,false);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    assert.equal((await owners())[0].verified,true);
  });
  await t.test('NFT ownership proof retains exact uint256 identifiers and request ordering',async()=>{
    await seedOwnerProof();const huge='115792089237316195423570985008687907853269984665640564039457584007913129639935';
    await pool.query('UPDATE v41_artworks SET artwork_id=$1,token_id=$1 WHERE chain_id=$2',[huge,CHAIN]);
    await pool.query('UPDATE v41_settlements SET artwork_id=$1,token_id=$1 WHERE chain_id=$2',[huge,CHAIN]);
    await pool.query(`UPDATE contract_events SET event_data=CASE
      WHEN event_name='ArtworkRegistered' THEN jsonb_set(event_data,'{artworkId}',to_jsonb($1::TEXT))
      WHEN event_name='SettlementCompleted' THEN jsonb_set(jsonb_set(event_data,'{artworkId}',to_jsonb($1::TEXT)),'{tokenId}',to_jsonb($1::TEXT))
      WHEN event_name='Transfer' THEN jsonb_set(event_data,'{tokenId}',to_jsonb($1::TEXT)) ELSE event_data END WHERE chain_id=$2`,[huge,CHAIN]);
    const rows=await owners(pool,[huge,'2']);assert.equal(rows[0].verified,true);assert.equal(rows[0].artwork_id,huge);
    assert.equal(rows[0].token_id,huge);assert.equal(rows[1].artwork_id,'2');assert.equal(rows[1].verified,false);
  });
  await t.test('NFT ownership proof uses bounded indexed lookups with unrelated history present',async()=>{
    await seedOwnerProof();
    await pool.query(`INSERT INTO v41_settlements(chain_id,auction_id,artwork_id,token_id,winner,final_price,
      settlement_status,block_number,transaction_hash,log_index)
      SELECT $1,1000+g,1000+g,1000+g,$2,2000,'completed',107,'0x'||lpad(to_hex(10000+g),64,'0'),4
      FROM generate_series(1,5000) g`,[CHAIN,WINNER]);
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
      SELECT chain_id,'SettlementCompleted',$2,block_number,transaction_hash,log_index,
        jsonb_build_object('artworkId',artwork_id::TEXT,'tokenId',token_id::TEXT,'auctionId',auction_id::TEXT,'winner',winner,'finalPrice','2000')
      FROM v41_settlements WHERE chain_id=$1 AND artwork_id>1000`,[CHAIN,CORE]);
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
      SELECT chain_id,'Transfer',$2,block_number,transaction_hash,1,
        jsonb_build_object('tokenId',token_id::TEXT,'from','0x'||repeat('0',40),'to',winner)
      FROM v41_settlements WHERE chain_id=$1 AND artwork_id>1000`,[CHAIN,OWNER_NFT]);
    await pool.query('ANALYZE v41_settlements; ANALYZE contract_events; ANALYZE v41_artworks; ANALYZE nft_transfer_coverage; ANALYZE indexer_state');
    const sql=read('sql/migrations/20261101130000_verified_nft_owners.sql');
    const statement=sql.slice(sql.indexOf('WITH scope AS'),sql.indexOf('ORDER BY requested.position;')+'ORDER BY requested.position;'.length)
      .replace(/\bp_core_address\b/g,'$1::TEXT').replace(/\bp_nft_address\b/g,'$2::TEXT')
      .replace(/\bp_core_code_hash\b/g,'$3::TEXT').replace(/\bp_nft_code_hash\b/g,'$4::TEXT')
      .replace(/\bp_artwork_ids\b/g,'$5::TEXT[]');
    const plan=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+statement,ownerParams())).rows[0]['QUERY PLAN'];
    fs.writeFileSync(path.join(directory,'nft-owner-query-plan.json'),JSON.stringify(plan,null,2));
    const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.Plans||[])visit(child);};visit(plan[0].Plan);
    assert.ok(nodes.some(node=>node['Index Name']==='artwork_search_settlements_latest'));
    assert.ok(nodes.some(node=>node['Index Name']==='contract_events_nft_transfer_token'));
    assert.ok(nodes.some(node=>node['Index Name']==='contract_events_core_settlement_artwork'));
    assert.ok(nodes.some(node=>node['Index Name']==='contract_events_core_settlement_token'));
    assert.equal(nodes.some(node=>node['Node Type']==='Seq Scan'&&['v41_settlements','contract_events'].includes(node['Relation Name'])),false);
    assert.equal((await owners())[0].current_owner_address,LAST_HOLDER);
  });
  await t.test('NFT ownership proof validates lookup bounds and pins before reading data',async()=>{
    for(const ids of [[],Array.from({length:21},(_,i)=>String(i+1)),['1','1'],[null],['0'],['01'],['-1'],['1.5'],['1e3'],
      ['1); DELETE FROM contract_events'],['115792089237316195423570985008687907853269984665640564039457584007913129639936']]) {
      await assert.rejects(pool.query(ownerSql,ownerParams(ids)),e=>e.code==='22023');
    }
    for(const [index,value] of [[0,null],[0,HOLDER.toUpperCase()],[1,CORE],[2,'0x0'],[3,'0x'+'0'.repeat(64)]]) {
      const args=ownerParams();args[index]=value;await assert.rejects(pool.query(ownerSql,args),e=>e.code==='22023');
    }
  });
  await t.test('NFT ownership proof stays coherent across a concurrent journal and coverage change',async()=>{
    await seedOwnerProof();const writer=await pool.connect(),reader=await pool.connect();
    try {
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      assert.equal((await owners(reader))[0].current_owner_address,LAST_HOLDER);
      await writer.query('BEGIN');await writer.query("DELETE FROM contract_events WHERE chain_id=$1 AND event_name='Transfer' AND log_index=9",[CHAIN]);
      await writer.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
      assert.equal((await owners())[0].current_owner_address,LAST_HOLDER,'uncommitted recovery is invisible');
      await writer.query('COMMIT');
      assert.equal((await owners(reader))[0].current_owner_address,LAST_HOLDER,'old snapshot keeps all matching facts');
      await reader.query('COMMIT');assert.equal((await owners())[0].verified,false,'new snapshot cannot combine old coverage with changed facts');
      await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
      await seedCoverage();assert.equal((await owners())[0].current_owner_address,HOLDER);
    }finally{await writer.query('ROLLBACK');await reader.query('ROLLBACK');writer.release();reader.release();}
  });
  await t.test('NFT ownership proof after engine rewind requires restored coverage and never invents a missing mint',async()=>{
    await seedOwnerProof();await target._handleReorg(110);
    assert.equal((await owners())[0].verified,false);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    await seedCoverage(CHAIN,{covered_through:109,covered_hash:hash(109)});
    assert.equal((await owners())[0].current_owner_address,WINNER);
    await target._handleReorg(106);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    await seedCoverage(CHAIN,{covered_through:105,covered_hash:hash(105)});
    assert.equal((await owners())[0].verified,false);
  });
  await t.test('NFT ownership proof is a stable invoker-only read with explicit service execution',async()=>{
    await seedOwnerProof();await pool.query(read('sql/migrations/20261101130000_verified_nft_owners.sql'));
    const fn=(await pool.query("SELECT provolatile,prosecdef FROM pg_proc WHERE oid='public.read_verified_nft_owners(text,text,text,text,text[])'::regprocedure")).rows[0];
    assert.equal(fn.provolatile,'s');assert.equal(fn.prosecdef,false);
    const role=await pool.connect();try {
      for(const name of ['anon','authenticated']){
        await role.query(`SET ROLE ${name}`);await assert.rejects(owners(role),e=>e.code==='42501');await role.query('RESET ROLE');
      }
      // The existing legacy classifier provides these read grants in the real
      // migration sequence; model only those existing permissions here.
      await pool.query('GRANT SELECT ON indexer_state,contract_events,v41_artworks,v41_settlements TO service_role');
      await role.query('SET ROLE service_role');assert.equal((await owners(role))[0].verified,true);
    }finally{await role.query('RESET ROLE');role.release();}
  });
  const nftBoundarySql='SELECT * FROM public.read_verified_nft_boundary($1,$2,$3,$4)';
  const nftHistorySql='SELECT public.read_verified_nft_history($1,$2,$3,$4,$5) AS data';
  const nftBoundary=async(client=pool)=>(await client.query(nftBoundarySql,ownerParams().slice(0,4))).rows;
  const nftHistory=async(client=pool,id='1')=>(await client.query(nftHistorySql,[...ownerParams().slice(0,4),id])).rows[0].data;
  const nftCards=async(client=pool,ids=['1'])=>(await client.query(
    'SELECT public.read_verified_nft_cards($1,$2,$3,$4,$5) AS data',ownerParams(ids))).rows[0].data;
  await t.test('NFT history returns ordered non-sale movements and the same owner boundary without mutating state',async()=>{
    await seedOwnerProof();const before=await snapshot(CHAIN),result=await nftHistory(),[checkpoint]=await nftBoundary();
    assert.equal(result.ownership.current_owner_address,LAST_HOLDER);assert.equal(result.ownership.first_collector_address,WINNER);
    assert.equal(result.complete,true);assert.deepEqual(result.transfers.map(event=>[event.block_number,event.log_index]),[[110,3],[110,9]]);
    assert.equal(result.transfers[0].from_address,WINNER);assert.equal(result.transfers[1].to_address,LAST_HOLDER);
    assert.ok(result.transfers.every(event=>event.price===undefined&&event.from_address!=='0x'+'0'.repeat(40)));
    assert.equal(result.lifecycle_available,true);assert.equal(result.lifecycle_complete,true);
    assert.deepEqual(result.lifecycle.map(event=>event.event_name),['ArtworkRegistered','AuctionCreated','SettlementCompleted']);
    for(const key of ['indexed_through','confirmed_through','covered_hash','state_revision'])assert.equal(String(result.ownership[key]),String(checkpoint[key]));
    assert.deepEqual(await snapshot(CHAIN),before);
  });
  await t.test('NFT history excludes records before coverage, beyond its endpoint and from foreign sources',async()=>{
    await seedOwnerProof();
    for(const [chain,nft,token,block,tx] of [[CHAIN,OWNER_NFT,'7',99,701],[CHAIN,OWNER_NFT,'7',116,702],
      [OTHER_CHAIN,OWNER_NFT,'7',110,703],[CHAIN,HOLDER,'7',110,704],[CHAIN,OWNER_NFT,'8',110,705]]) {
      await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
        VALUES($1,'Transfer',$2,$3,$4,12,$5)`,[chain,nft,block,hash(tx),{tokenId:token,from:WINNER,to:HOLDER}]);
    }
    const result=await nftHistory();assert.equal(result.complete,true);
    assert.deepEqual(result.transfers.map(event=>[event.block_number,event.log_index]),[[110,3],[110,9]]);
  });
  await t.test('NFT history cannot use a token number when its original settlement source is unknown',async()=>{
    await seedOwnerProof();await pool.query("UPDATE contract_events SET contract_address=NULL WHERE chain_id=$1 AND event_name='SettlementCompleted'",[CHAIN]);
    const result=await nftHistory();assert.equal(result.ownership.verified,false);
    assert.equal(result.ownership.current_owner_address,null);assert.deepEqual(result.transfers,[]);assert.equal(result.complete,false);
    assert.equal((await nftBoundary()).length,1,'deployment coverage does not independently prove this association');
    const absent=await nftHistory(pool,'2');assert.equal(absent.ownership.verified,false);assert.deepEqual(absent.transfers,[]);
  });
  await t.test('NFT history returns exactly one lookahead row when the 200 movement limit is exceeded',async()=>{
    await seedOwnerProof();await pool.query("DELETE FROM contract_events WHERE chain_id=$1 AND event_name='Transfer' AND block_number=110",[CHAIN]);
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data,indexed_at)
      SELECT $1,'Transfer',$2,110,'0x'||lpad(to_hex(20000+g),64,'0'),10+g,
        jsonb_build_object('tokenId','7','from',CASE WHEN g%2=1 THEN $3 ELSE $4 END,'to',CASE WHEN g%2=1 THEN $4 ELSE $3 END),to_timestamp(1700000220)
      FROM generate_series(1,200) g`,[CHAIN,OWNER_NFT,WINNER,HOLDER]);
    let result=await nftHistory();assert.equal(result.complete,true);assert.equal(result.transfers.length,200);
    assert.equal(result.ownership.current_owner_address,WINNER);
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data,indexed_at)
      VALUES($1,'Transfer',$2,110,$3,211,$4,to_timestamp(1700000220))`,[CHAIN,OWNER_NFT,hash(20201),{tokenId:'7',from:WINNER,to:HOLDER}]);
    result=await nftHistory();assert.equal(result.complete,false);assert.equal(result.transfers.length,201);
    assert.equal(result.transfers[200].log_index,211);assert.equal(result.ownership.current_owner_address,HOLDER);
  });
  await t.test('NFT boundary and history reject malformed identifiers and explicit deployment pins',async()=>{
    for(const id of [null,'','0','01','-1','1.5','1e3',String(2n**256n),'1); SELECT 1']) {
      await assert.rejects(nftHistory(pool,id),e=>e.code==='22023');
    }
    for(const [index,value] of [[0,null],[0,CORE.toUpperCase()],[1,CORE],[1,'0x'+'0'.repeat(40)],
      [2,'0x0'],[3,null],[3,'0x'+'0'.repeat(64)]]) {
      const args=ownerParams().slice(0,4);args[index]=value;
      await assert.rejects(pool.query(nftBoundarySql,args),e=>e.code==='22023');
      await assert.rejects(pool.query(nftHistorySql,[...args,'1']),e=>e.code==='22023');
    }
  });
  await t.test('NFT boundary and history remain unavailable through partial coverage and pending recovery',async()=>{
    await seedOwnerProof();await pool.query('UPDATE nft_transfer_coverage SET covered_through=114 WHERE chain_id=$1',[CHAIN]);
    assert.deepEqual(await nftBoundary(),[]);assert.equal((await nftHistory()).ownership.verified,false);
    await pool.query('UPDATE nft_transfer_coverage SET covered_through=115 WHERE chain_id=$1',[CHAIN]);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=gen_random_uuid() WHERE chain_id=$1',[CHAIN]);
    await seedCoverage();assert.deepEqual(await nftBoundary(),[]);assert.deepEqual((await nftHistory()).transfers,[]);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    assert.equal((await nftBoundary()).length,1);assert.equal((await nftHistory()).complete,true);
  });
  await t.test('NFT history and boundary use coherent old or new recovery snapshots',async()=>{
    await seedOwnerProof();const reader=await pool.connect(),writer=await pool.connect();
    try {
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const initial=await nftHistory(reader),checkpoint=await nftBoundary(reader);
      await writer.query('BEGIN');await writer.query('SELECT rollback_events_from_block($1,$2)',[110,CHAIN]);
      assert.deepEqual(await nftHistory(),initial,'uncommitted rewind cannot expose mixed history');
      await writer.query('COMMIT');
      assert.deepEqual(await nftHistory(reader),initial);assert.deepEqual(await nftBoundary(reader),checkpoint);
      assert.deepEqual(await nftBoundary(),[]);const fresh=await nftHistory();
      assert.equal(fresh.ownership.verified,false);assert.deepEqual(fresh.transfers,[]);assert.equal(fresh.complete,false);
      await reader.query('COMMIT');
    }finally{await writer.query('ROLLBACK');await reader.query('ROLLBACK');writer.release();reader.release();}
  });
  await t.test('NFT history after engine rewind cannot include orphaned transfers or invent a mint',async()=>{
    await seedOwnerProof();await target._handleReorg(110);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    await seedCoverage(CHAIN,{covered_through:109,covered_hash:hash(109)});
    let result=await nftHistory();assert.equal(result.ownership.current_owner_address,WINNER);
    assert.deepEqual(result.transfers,[]);assert.equal(result.complete,true);
    await target._handleReorg(106);
    await pool.query('UPDATE indexer_state SET recovery_cache_token=NULL WHERE chain_id=$1',[CHAIN]);
    await seedCoverage(CHAIN,{covered_through:105,covered_hash:hash(105)});
    result=await nftHistory();assert.equal(result.ownership.verified,false);assert.deepEqual(result.transfers,[]);assert.equal(result.complete,false);
  });
  await t.test('NFT boundary and history are stable invoker reads callable only by the explicit service role',async()=>{
    await seedOwnerProof();const before=await snapshot(CHAIN);
    await pool.query(read('sql/migrations/20261101140000_verified_nft_history.sql'));
    for(const signature of ['read_verified_nft_boundary(text,text,text,text)','read_verified_nft_history(text,text,text,text,text)',
      'read_verified_nft_cards(text,text,text,text,text[])']) {
      const fn=(await pool.query('SELECT provolatile,prosecdef FROM pg_proc WHERE oid=$1::regprocedure',[`public.${signature}`])).rows[0];
      assert.equal(fn.provolatile,'s');assert.equal(fn.prosecdef,false);
    }
    const role=await pool.connect();try {
      for(const name of ['anon','authenticated']) {
        await role.query(`SET ROLE ${name}`);
        await assert.rejects(nftBoundary(role),e=>e.code==='42501');await assert.rejects(nftHistory(role),e=>e.code==='42501');
        await assert.rejects(nftCards(role),e=>e.code==='42501');
        await role.query('RESET ROLE');
      }
      await pool.query('GRANT SELECT ON indexer_state,contract_events,v41_artworks,v41_settlements,v41_resale_listings TO service_role');
      await role.query('SET ROLE service_role');assert.equal((await nftBoundary(role)).length,1);assert.equal((await nftHistory(role)).complete,true);
      assert.equal((await nftCards(role))[0].verified,true);
    }finally{await role.query('RESET ROLE');role.release();}
    assert.deepEqual(await snapshot(CHAIN),before);
  });

  let lifecycleTx=30000;
  const journalLifecycle=async(name,data,block=111,log=1,core=CORE,chain=CHAIN)=>pool.query(
    `INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data,indexed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp(1700000220))`,[chain,name,core,block,hash(++lifecycleTx),log,data]);
  await t.test('NFT history binds lifecycle to original Core registration and auction identities inside the boundary',async()=>{
    await seedOwnerProof();
    await journalLifecycle('AuctionEnded',{auctionId:'1',winner:WINNER,winningBid:'2000'},106,0);
    await journalLifecycle('ResaleListed',{tokenId:'7',seller:LAST_HOLDER,price:'2500'},111);
    await journalLifecycle('ResaleCompleted',{tokenId:'7',seller:LAST_HOLDER,buyer:HOLDER,price:'2500'},112);
    for(const [name,data,block,core,chain] of [
      ['AuctionCreated',{artworkId:'1',auctionId:'77'},107,HOLDER,CHAIN],
      ['AuctionEnded',{auctionId:'77'},108,CORE,CHAIN],
      ['AuctionCreated',{artworkId:'2',auctionId:'88'},107,CORE,CHAIN],
      ['AuctionEnded',{auctionId:'88'},108,CORE,CHAIN],
      ['SettlementCompleted',{auctionId:'1',artworkId:'2',tokenId:'8'},108,CORE,CHAIN],
      ['ResaleCompleted',{tokenId:'7',price:'9900'},114,HOLDER,CHAIN],
      ['ResaleListed',{tokenId:'7',price:'9900'},114,null,CHAIN],
      ['ResaleCompleted',{tokenId:'8',price:'9900'},114,CORE,CHAIN],
      ['ResaleCompleted',{tokenId:'7',price:'9900'},114,CORE,OTHER_CHAIN],
      ['AuctionEnded',{auctionId:'1'},116,CORE,CHAIN],
      ['ResaleCompleted',{tokenId:'7',price:'9900'},116,CORE,CHAIN]
    ])await journalLifecycle(name,data,block,1,core,chain);
    const result=await nftHistory();
    assert.deepEqual(result.lifecycle.map(row=>row.event_name),['ArtworkRegistered','AuctionCreated','AuctionEnded','SettlementCompleted','ResaleListed','ResaleCompleted']);
    assert.ok(result.lifecycle.every(row=>row.contract_address===CORE&&row.chain_id===CHAIN&&row.block_number<=115));
    assert.equal(result.lifecycle.at(-1).event_data.price,'2500');
  });
  for(const [label,sql,values] of [
    ['unknown Core',"UPDATE contract_events SET contract_address=NULL WHERE chain_id=$1 AND event_name='ArtworkRegistered'",[CHAIN]],
    ['wrong creator',"UPDATE contract_events SET event_data=jsonb_set(event_data,'{creator}',to_jsonb($2::TEXT)) WHERE chain_id=$1 AND event_name='ArtworkRegistered'",[CHAIN,HOLDER]],
    ['wrong metadata',"UPDATE v41_artworks SET metadata_uri='ipfs://another' WHERE chain_id=$1",[CHAIN]],
    ['wrong transaction','UPDATE v41_artworks SET transaction_hash=$2 WHERE chain_id=$1',[CHAIN,hash(99999)]]
  ])await t.test(`NFT history exposes no lifecycle when registration has ${label}`,async()=>{
    await seedOwnerProof();await pool.query(sql,values);const result=await nftHistory();
    assert.deepEqual(result.lifecycle,[]);assert.equal(result.lifecycle_available,false);assert.equal(result.lifecycle_complete,false);
  });
  await t.test('NFT history retains proven registration before NFT coverage and the real unminted lifecycle',async()=>{
    await seedOwnerProof();await pool.query('UPDATE nft_transfer_coverage SET from_block=101 WHERE chain_id=$1',[CHAIN]);
    assert.equal((await nftHistory()).lifecycle[0].block_number,100);
    await pool.query("DELETE FROM contract_events WHERE chain_id=$1 AND event_name IN ('SettlementCompleted','Transfer')",[CHAIN]);
    await pool.query('DELETE FROM v41_settlements WHERE chain_id=$1',[CHAIN]);
    await pool.query('UPDATE v41_artworks SET minted=false,token_id=NULL WHERE chain_id=$1',[CHAIN]);
    await journalLifecycle('ResaleListed',{tokenId:'7',seller:LAST_HOLDER,price:'2500'});
    const result=await nftHistory();assert.equal(result.ownership.verified,false);assert.equal(result.complete,false);
    assert.equal(result.lifecycle_complete,true);assert.deepEqual(result.lifecycle.map(row=>row.event_name),['ArtworkRegistered','AuctionCreated']);
  });
  await t.test('NFT history bounds lifecycle to one total 201st lookahead row',async()=>{
    await seedOwnerProof();
    for(let i=0;i<197;i++)await journalLifecycle('AuctionCreated',{auctionId:String(100+i),artworkId:'1'},111,i);
    let result=await nftHistory();assert.equal(result.lifecycle.length,200);assert.equal(result.lifecycle_complete,true);
    await journalLifecycle('AuctionCreated',{auctionId:'999',artworkId:'1'},112);
    result=await nftHistory();assert.equal(result.lifecycle.length,201);assert.equal(result.lifecycle_complete,false);
    await journalLifecycle('AuctionCreated',{auctionId:'1000',artworkId:'1'},113);
    assert.deepEqual((await nftHistory()).lifecycle,result.lifecycle);
  });
  async function seedVerifiedListing(block=111,log=1) {
    await seedOwnerProof();await apply(target,'ResaleListed',block,{tokenId:7,seller:LAST_HOLDER,price:2500},log);
    await pool.query("UPDATE contract_events SET contract_address=$1 WHERE chain_id=$2 AND event_name='ResaleListed'",[CORE,CHAIN]);
  }
  await t.test('NFT cards expose an exact original Core listing only after the latest transfer',async()=>{
    await seedVerifiedListing(110,10);const before=await snapshot(CHAIN),rows=await nftCards(pool,['2','1']);
    assert.equal(rows[0].artwork_id,'2');assert.equal(rows[0].active_listing,null);
    assert.deepEqual(rows[1].active_listing,{token_id:'7',seller:LAST_HOLDER,price:'2500',last_updated_block:110});
    assert.deepEqual(await snapshot(CHAIN),before);
  });
  for(const [label,sql,values] of [
    ['foreign Core',"UPDATE contract_events SET contract_address=$2 WHERE chain_id=$1 AND event_name='ResaleListed'",[CHAIN,HOLDER]],
    ['unknown Core',"UPDATE contract_events SET contract_address=NULL WHERE chain_id=$1 AND event_name='ResaleListed'",[CHAIN]],
    ['changed seller','UPDATE v41_resale_listings SET seller=$2 WHERE chain_id=$1',[CHAIN,WINNER]],
    ['changed price','UPDATE v41_resale_listings SET price=2600 WHERE chain_id=$1',[CHAIN]],
    ['inactive listing','UPDATE v41_resale_listings SET active=false WHERE chain_id=$1',[CHAIN]],
    ['future update','UPDATE v41_resale_listings SET last_updated_block=116 WHERE chain_id=$1',[CHAIN]],
    ['unmatched update','UPDATE v41_resale_listings SET last_updated_block=112 WHERE chain_id=$1',[CHAIN]],
    ['missing coverage','DELETE FROM nft_transfer_coverage WHERE chain_id=$1',[CHAIN]]
  ])await t.test(`NFT cards suppress a listing with ${label}`,async()=>{
    await seedVerifiedListing();await pool.query(sql,values);assert.equal((await nftCards())[0].active_listing,null);
  });
  await t.test('NFT cards reject a listing before a same-block transfer and a later ownership roundtrip',async()=>{
    await seedVerifiedListing(110,5);assert.equal((await nftCards())[0].active_listing,null);
    await pool.query("UPDATE contract_events SET block_number=111 WHERE chain_id=$1 AND event_name='ResaleListed'",[CHAIN]);
    await pool.query('UPDATE v41_resale_listings SET last_updated_block=111 WHERE chain_id=$1',[CHAIN]);
    assert.ok((await nftCards())[0].active_listing);
    for(const [log,from,to] of [[6,LAST_HOLDER,HOLDER],[7,HOLDER,LAST_HOLDER]])await pool.query(
      `INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data,indexed_at)
       VALUES($1,'Transfer',$2,111,$3,$4,$5,to_timestamp(1700000222))`,[CHAIN,OWNER_NFT,hash(++lifecycleTx),log,{tokenId:'7',from,to}]);
    const row=(await nftCards())[0];assert.equal(row.current_owner_address,LAST_HOLDER);assert.equal(row.active_listing,null);
  });
  await t.test('NFT cards use the latest exact listing and preserve all original input bounds',async()=>{
    await seedVerifiedListing();await journalLifecycle('ResaleListed',{tokenId:'7',seller:LAST_HOLDER,price:'2600'},111,2);
    assert.equal((await nftCards())[0].active_listing,null);
    await pool.query('UPDATE v41_resale_listings SET price=2600 WHERE chain_id=$1',[CHAIN]);
    assert.equal((await nftCards())[0].active_listing.price,'2600');
    for(const ids of [[],['1','1'],['01'],Array.from({length:21},(_,i)=>String(i+1))])await assert.rejects(nftCards(pool,ids),e=>e.code==='22023');
  });
  await t.test('NFT history and cards use indexed source-qualified queries with unrelated lifecycle history',async()=>{
    await seedVerifiedListing();
    await pool.query(`INSERT INTO contract_events(chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data)
      SELECT $1,kind.name,$2,107,'0x'||lpad(to_hex(50000+g*3+kind.position),64,'0'),kind.position,
        jsonb_build_object('artworkId',(1000+g)::TEXT,'auctionId',(1000+g)::TEXT,'tokenId',(1000+g)::TEXT)
      FROM generate_series(1,2000) g CROSS JOIN (VALUES ('AuctionCreated',0),('AuctionEnded',1),('ResaleListed',2)) kind(name,position)`,[CHAIN,CORE]);
    await pool.query('ANALYZE contract_events; ANALYZE v41_artworks; ANALYZE v41_resale_listings; ANALYZE nft_transfer_coverage; ANALYZE indexer_state');
    const registration=(await pool.query("SELECT * FROM contract_events WHERE chain_id=$1 AND event_name='ArtworkRegistered'",[CHAIN])).rows[0];
    const sql=read('sql/migrations/20261101140000_verified_nft_history.sql');
    const historyStatement=sql.slice(sql.indexOf('WITH auctions AS MATERIALIZED'),sql.indexOf('FROM (SELECT * FROM events ORDER BY block_number,log_index LIMIT 201) e;')+
      'FROM (SELECT * FROM events ORDER BY block_number,log_index LIMIT 201) e;'.length)
      .replace('SELECT v_registration.* WHERE','SELECT r.* FROM public.contract_events r WHERE r.id=$2 AND')
      .replace(/\bv_registration.id\b/g,'$2::BIGINT').replace(/\bv_registration.block_number\b/g,'$4::BIGINT')
      .replace(/\bv_registration.log_index\b/g,'$5::INTEGER').replace(/\bv_proof.indexed_through\b/g,'115')
      .replace(/\bv_proof.verified\b/g,'true').replace(/\bv_proof.token_id\b/g,"'7'")
      .replace(/\bp_core_address\b/g,'$1::TEXT').replace(/\bp_artwork_id\b/g,'$3::TEXT').replace(' INTO v_lifecycle','');
    const historyPlan=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+historyStatement,
      [CORE,registration.id,'1',registration.block_number,registration.log_index])).rows[0]['QUERY PLAN'];
    const cardsStart=sql.indexOf('SELECT coalesce(jsonb_agg(to_jsonb(p)');
    const cardsStatement=sql.slice(cardsStart,sql.indexOf('$$;',cardsStart))
      .replace(/\bp_core_address\b/g,'$1::TEXT').replace(/\bp_nft_address\b/g,'$2::TEXT')
      .replace(/\bp_core_code_hash\b/g,'$3::TEXT').replace(/\bp_nft_code_hash\b/g,'$4::TEXT')
      .replace(/\bp_artwork_ids\b/g,'$5::TEXT[]');
    const cardsPlan=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+cardsStatement,ownerParams())).rows[0]['QUERY PLAN'];
    fs.writeFileSync(path.join(directory,'nft-history-cards-query-plan.json'),JSON.stringify({historyPlan,cardsPlan},null,2));
    const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.Plans||[])visit(child);};
    visit(historyPlan[0].Plan);visit(cardsPlan[0].Plan);
    for(const name of ['contract_events_core_auction_artwork','contract_events_core_auction_history','contract_events_core_resale_token'])
      assert.ok(nodes.some(node=>node['Index Name']===name),name);
    assert.equal(nodes.some(node=>node['Node Type']==='Seq Scan'&&node['Relation Name']==='contract_events'),false);
    assert.equal((await nftHistory()).lifecycle.length,4);assert.equal((await nftCards())[0].active_listing.price,'2500');
  });
});
