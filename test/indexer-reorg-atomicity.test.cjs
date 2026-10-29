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
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {Pool} = require('pg');
const {Interface} = require('ethers');

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
    "const cacheService = {purge: async () => { if (this.fixtureFailCachePurge) throw new Error('fixture cache purge failure'); }};");
  return source.replace(/from '([^']+)'/g, (whole, specifier) => specifier.startsWith('.')
    ? `from '${pathToFileURL(path.resolve(ROOT, 'src/indexer', specifier)).href}'` : whole);
}

test('rewind events, cursor, hashes and media revision atomically (isolated PostgreSQL)', {
  skip: BIN ? false : 'Set ARTSOUL_TEST_POSTGRES_BIN; no database connection attempted',
  timeout: 120000
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
    cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 30000,
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
      if (running) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
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
    '20261029212603_notification_reorg_identity'];
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
  let rpcHook = null, leaderCurrent = true, leaderEpoch = 0;
  target.getRecoveryAuthority = () => {
    const epoch = leaderEpoch;
    return {lockName:'fixture-reorg',instanceId:'fixture-worker',fencingToken:'1',
      isCurrent: () => leaderCurrent && leaderEpoch === epoch};
  };
  target.eventListener._readRpcCall = async operation => operation({async send(method, params) {
    await rpcHook?.(method,params);
    if(method==='eth_chainId') return '0x14a34';
    if(method==='eth_getBlockByNumber') return {hash:hash(Number(BigInt(params[0])))};
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
    'v41_project_eligibility','v41_genesis_holders'];
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
    beforeSql = null;rpcHook = null;leaderCurrent = true;leaderEpoch = 0;resaleStates.clear();resaleReads.length=0;
    await pool.query(`INSERT INTO distributed_locks(lock_name,instance_id,fencing_token,expires_at)
      VALUES('fixture-reorg','fixture-worker',1,clock_timestamp()+INTERVAL '1 hour')`);
    await pool.query('INSERT INTO artwork_media_chain_revisions VALUES(84532,0)');
    for (const instance of [target, other]) {
      instance.fixtureFailCachePurge = false;
      instance.recoveryCachePurgePending = false;
      instance.isRunning = false;
      await pool.query(`INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,
        last_indexed_at,started_at,state_hash) VALUES($1,$2,115,115,NOW(),NOW(),'0x0')`, [instance.chainId, CORE]);
      for (const block of [100, 105, 110, 115]) await pool.query(`INSERT INTO block_hashes
        (chain_id,block_number,block_hash,parent_hash,timestamp) VALUES($1,$2,$3,$4,$5)`,
        [instance.chainId, block, hash(block), hash(block - 1), 1700000000 + block * 2]);
      await apply(instance, 'ArtworkRegistered', 100, {artworkId: 1, creator: CREATOR, metadataURI: 'ipfs://fixture-only'});
      await apply(instance, 'AuctionCreated', 105, {auctionId: 1, artworkId: 1, creator: CREATOR,
        startPrice: 1000, duration: 86400, endTime: 1700086400});
      await pool.query('UPDATE indexer_state SET state_hash=$1 WHERE chain_id=$2',
        [await instance._computeStateHash(115), instance.chainId]);
    }
  }
  t.beforeEach(reset);
  function historicalWriter(events) {
    const writer = engine(CHAIN);
    writer.getRecoveryAuthority = target.getRecoveryAuthority;
    writer._shouldSkipEmptyBlockHashBackfill = () => true;
    Object.assign(writer.eventListener, {
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
    assert.deepEqual(after.block_hashes.map(row => row.block_number), [100, 105]);
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
  for (const failedTable of ['contract_events', 'block_hashes', 'indexer_state']) {
    await t.test(`failure at ${failedTable} rolls back all earlier SQL including media revision`, async () => {
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
    assert.deepEqual(await snapshot(CHAIN), after, 'purge retry must not delete or bump revision again');
    evidence.results.push({scenario: 'post_commit_purge_retry', after, noRepeatedRewind: true});
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
      VALUES($1,109,$2,$3,1700000218)`,[CHAIN,hash(109),hash(108)]);
  }
  const resaleRow = async () => (await pool.query('SELECT * FROM v41_resale_listings WHERE chain_id=$1 AND token_id=7',[CHAIN])).rows[0];
  const dirtyResale = async (active=false) => pool.query(`UPDATE v41_resale_listings
    SET active=$1,last_updated_block=112 WHERE chain_id=$2 AND token_id=7`,[active,CHAIN]);
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
    assert.deepEqual(sizes,[8,2]);assert.equal(new Set(resaleReads).size,10);
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
      if(failure==='missing header') await pool.query('DELETE FROM block_hashes WHERE chain_id=$1 AND block_number=109',[CHAIN]);
      if(failure==='conflicting header') await pool.query('UPDATE block_hashes SET block_hash=$1 WHERE chain_id=$2 AND block_number=109',[hash(999),CHAIN]);
      if(failure==='archive unavailable') rpcHook=async method=>{if(method==='eth_call')throw new Error('archive unavailable');};
      if(failure==='wrong chain') target.eventListener._readRpcCall=operation=>operation({async send(){return '0x1';}});
      if(failure==='header changed after read') {
        let headers=0;rpcHook=async method=>{if(method==='eth_getBlockByNumber'&&++headers===2)throw new Error('canonical block changed');};
      }
      if(failure==='default mapping') resaleStates.set('7',['0x'+'0'.repeat(40),0n,false]);
      if(failure==='partial batch') target.eventListener._readRpcCall=async()=>[];
      const before=await snapshot(CHAIN);
      try{await assert.rejects(target._handleReorg(BOUNDARY),/boundary unavailable|canonical block changed|archive unavailable|chain mismatch|Invalid reorg resale snapshot/);}
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
});
