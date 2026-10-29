// Atomic rewind, primary projections and boundary-pinned resale regression.
// Includes legacy prototype predecessors; writer fencing remains a separate gate.
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
  evidence.migrations = [...migrations, ...['identity', 'preparation', 'submission', 'registration', 'reorg']
    .map(name => `sql/migrations/artwork_media_${name}.sql`)];
  const engineFile = path.join(directory, 'isolated-engine.mjs');
  fs.writeFileSync(engineFile, isolatedEngineSource());
  const Engine = (await import(pathToFileURL(engineFile).href)).default;
  let beforeSql = null;
  const db = {pool: {async connect() {
    const client = await pool.connect();
    return {async query(sql, values) {await beforeSql?.(sql, client);return client.query(sql, values);},
      release: () => client.release()};
  }}, query: async (sql, values) => (await pool.query(sql, values)).rows};
  const engine = chain => new Engine(db, {chainId: chain,contractAddress:CORE});
  const target = engine(CHAIN), other = engine(OTHER_CHAIN);
  const resaleInterface = new Interface(['function resaleListings(uint256) view returns(address seller,uint256 price,bool active)']);
  const resaleStates = new Map(), resaleReads = [];
  let rpcHook = null, leaderCurrent = true;
  target.getRecoveryAuthority = () => ({lockName:'fixture-reorg',instanceId:'fixture-worker',fencingToken:'1',
    isCurrent: () => leaderCurrent});
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
    await pool.query(`TRUNCATE ${tables.join(',')},outbox_events,distributed_locks CASCADE`);
    beforeSql = null;rpcHook = null;leaderCurrent = true;resaleStates.clear();resaleReads.length=0;
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
