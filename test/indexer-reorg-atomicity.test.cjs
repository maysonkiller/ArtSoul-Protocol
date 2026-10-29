// Atomic rewind and primary-projection reconstruction regression. Resale state,
// legacy eligibility and writer fencing remain separate acceptance gates.
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
  source = source.replaceAll("await import('../queue.js')", '{recoveryQueue: {add: async () => {}}}');
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
  const db = {pool, query: async (sql, values) => (await pool.query(sql, values)).rows};
  const engine = chain => new Engine(db, {chainId: chain});
  const target = engine(CHAIN), other = engine(OTHER_CHAIN);
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
    'artwork_media_rewinds', 'artwork_media_chain_revisions'];
  async function snapshot(chain) {
    const result = {};
    for (const table of tables) result[table] = (await pool.query(
      `SELECT to_jsonb(t) AS value FROM ${table} t WHERE chain_id=$1 ORDER BY to_jsonb(t)::TEXT`, [chain]))
      .rows.map(row => row.value);
    return result;
  }
  async function reset() {
    // Local database only; all included tables were just created by this test.
    await pool.query(`TRUNCATE ${tables.join(',')},outbox_events CASCADE`);
    await pool.query('INSERT INTO artwork_media_chain_revisions VALUES(84532,0)');
    for (const instance of [target, other]) {
      instance.fixtureFailCachePurge = false;
      instance.recoveryCachePurgePending = false;
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
      const otherBefore = await snapshot(OTHER_CHAIN);
      let reads = 0, replay;
      target.eventListener.getCurrentBlock = async () => { reads++; return 115; };
      target.syncHistoricalEvents = async (...args) => { replay = args; await assertRewound(otherBefore); };
      if (method === '_handleReorg') await target._handleReorg(BOUNDARY);
      else await target.recoverFromSafeBlock({last_confirmed_block: String(BOUNDARY - 1)});
      const after = await assertRewound(otherBefore);
      assert.equal(target.recoveryCachePurgePending, false);
      assert.equal(reads, method === '_handleReorg' ? 0 : 1);
      assert.deepEqual(replay, method === '_handleReorg' ? undefined : [BOUNDARY, 115]);
      evidence.results.push({scenario: method, after, otherChainUnchanged: true});
    });
  }
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
});
