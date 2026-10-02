// Disposable PostgreSQL integration only; never a live migration or deployment.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');
const test = require('node:test');
const {ethers} = require('ethers');
const {Pool} = require('pg');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-donation-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const CORE = `0x${'1'.repeat(40)}`, SUPPORT = `0x${'2'.repeat(40)}`;
const DONOR = `0x${'3'.repeat(40)}`, CREATOR = `0x${'4'.repeat(40)}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => `0x${value.toString(16).padStart(64, '0')}`;
function docker(...args) {
  return execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
function haveDocker() {
  try { return docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch { return false; }
}
function migration(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); }

test('Creator support pipeline, RLS and reorg integration (PostgreSQL 17)', {
  skip: haveDocker() ? false : 'Docker is unavailable; disposable PostgreSQL is required'
}, async t => {
  let created = false, pool, engine, listener, eventApi, migrationSql, donationInterface;
  const previousRedis = process.env.REDIS_URL;
  t.after(async () => {
    if (pool) await pool.end();
    if (created) docker('rm', '-f', CONTAINER);
    if (previousRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previousRedis;
  });
  // The real engine imports the repository queue module, which loads .env.
  // An explicit empty value prevents any external Redis/queue connection.
  process.env.REDIS_URL = '';
  docker('run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=local-donation-only',
    '-e', 'POSTGRES_DB=artsoul', '-p', '127.0.0.1::5432', 'postgres:17');
  created = true;
  const endpoint = docker('port', CONTAINER, '5432/tcp');
  assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
  pool = new Pool({host: '127.0.0.1', port: Number(endpoint.split(':')[1]), database: 'artsoul',
    user: 'postgres', password: 'local-donation-only', connectionTimeoutMillis: 1000});
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { await pool.query('SELECT 1'); await delay(250); await pool.query('SELECT 1'); ready = true; break; }
    catch { await delay(500); }
  }
  assert.ok(ready, 'disposable PostgreSQL became ready');
  await pool.query(`CREATE EXTENSION pgcrypto;
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.contract_events (
      chain_id NUMERIC(78,0) NOT NULL, transaction_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
      event_name TEXT NOT NULL, artwork_id NUMERIC(78,0), block_number BIGINT NOT NULL,
      event_data JSONB NOT NULL DEFAULT '{}', indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(chain_id,transaction_hash,log_index));`);
  await pool.query(`CREATE TABLE public.block_hashes(chain_id NUMERIC(78,0),block_number BIGINT,
    block_hash TEXT,parent_hash TEXT,timestamp BIGINT NOT NULL,PRIMARY KEY(chain_id,block_number));
    CREATE TABLE public.indexer_state(chain_id NUMERIC(78,0) PRIMARY KEY,last_indexed_block BIGINT NOT NULL DEFAULT 0,
      last_indexed_at TIMESTAMPTZ,total_events_indexed BIGINT NOT NULL DEFAULT 0,confirmation_depth INTEGER NOT NULL DEFAULT 3,
      last_confirmed_block BIGINT NOT NULL DEFAULT 0,state_hash TEXT);
    INSERT INTO public.indexer_state(chain_id) VALUES(84532);`);
  await pool.query(migration('src/indexer/migrations/005_event_idempotency.sql'));
  await pool.query(migration('src/indexer/migrations/006_ownership_observability.sql'));
  await pool.query(`ALTER TABLE public.event_processing_registry ADD COLUMN chain_id NUMERIC(78,0) NOT NULL;
    ALTER TABLE public.event_processing_registry DROP CONSTRAINT unique_tx_log;
    CREATE UNIQUE INDEX idx_registry_chain_tx_log ON public.event_processing_registry(chain_id,transaction_hash,log_index);`);
  // Real rollback 014 touches these canonical projections even when empty.
  for (const table of ['v41_genesis_holders', 'v41_project_eligibility', 'v41_resale_history',
    'v41_resale_listings', 'v41_floor_history', 'v41_settlements', 'v41_auction_endings',
    'v41_auction_extensions', 'v41_bid_withdrawals', 'v41_bids', 'v41_auctions', 'v41_artworks']) {
    await pool.query(`CREATE TABLE public.${table} (chain_id NUMERIC(78,0), block_number BIGINT,
      transaction_hash TEXT, log_index INTEGER, indexed_at TIMESTAMPTZ, creator TEXT,
      winner TEXT, buyer TEXT, price NUMERIC(78,0), final_price NUMERIC(78,0), settlement_status TEXT);`);
  }
  await pool.query('CREATE TABLE public.outbox_events (correlation_id TEXT, idempotency_key TEXT);');
  await pool.query(migration('src/indexer/migrations/014_schema_aware_reorg_rollback.sql'));
  await pool.query(migration('src/indexer/migrations/015_public_metrics_projection.sql'));
  await pool.query(`INSERT INTO public.v41_public_metrics
    (chain_id,artists_onboarded,auctions_completed,unique_collectors,settled_volume_wei) VALUES (84532,4,5,6,7);`);
  migrationSql = migration('sql/migrations/artist_support.sql');
  await pool.query(migrationSql);
  const [{default: SyncEngine}, {default: EventListener}, events] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'src/indexer/sync-engine.js'))),
    import(pathToFileURL(path.join(ROOT, 'src/indexer/event-listener.js'))),
    import(pathToFileURL(path.join(ROOT, 'src/indexer/donation-events.js')))
  ]);
  eventApi = events;
  donationInterface = new ethers.Interface(events.DONATION_ABI);
  listener = Object.create(EventListener.prototype);
  Object.assign(listener, {contractAddress: CORE, contract: {interface: new ethers.Interface([])},
    chainId: 84532, donationAddress: SUPPORT, donationInterface,
    maxBlockRange: 1000, maxBlockRangeLimit: 1000, _retryRpcCall: operation => operation()});
  engine = new SyncEngine({pool, isBackpressure() {return false;},
    async query(sql, params) { return (await pool.query(sql, params)).rows; },
    async batchInsert(table, columns, rows, conflict) {
      assert.equal(table,'block_hashes');
      assert.deepEqual(columns,['chain_id','block_number','block_hash','parent_hash','timestamp']);
      const slots = rows.map((row,i) => `(${row.map((_,j)=>`$${i*columns.length+j+1}`).join(',')})`).join(',');
      return await pool.query(`INSERT INTO public.block_hashes(${columns.join(',')}) VALUES ${slots} ON CONFLICT ${conflict}`,rows.flat());
    }}, listener);

  async function fromLog(index, message = '', amount = 500000000000000n, block = 100 + index) {
    const encoded = donationInterface.encodeEventLog(donationInterface.getEvent('Donation'),
      [DONOR, CREATOR, 28, amount, message, false]);
    listener.provider = {async getLogs() { return [{...encoded, address: SUPPORT, blockNumber: block,
      transactionHash: hash(index), index: 0}]; }};
    const [event] = await listener._queryLogsChunk(block, block);
    assert.ok(event, 'the actual event listener parsed the contract log');
    return {...event, timestamp: Date.UTC(2026, 8, 30, 12, 0, index)};
  }
  async function snapshot() {
    return (await pool.query(`SELECT artists_onboarded,auctions_completed,unique_collectors,settled_volume_wei
      FROM public.v41_public_metrics WHERE chain_id=84532`)).rows[0];
  }

  await t.test('forced RLS denies browser reads and writes while the service role remains operational', async () => {
    const catalog = (await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid IN ('public.artwork_donations'::regclass,'public.donation_message_visibility'::regclass)`)).rows;
    assert.equal(catalog.length, 2);
    assert.ok(catalog.every(row => row.relrowsecurity && row.relforcerowsecurity));
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['artwork_donations', 'donation_message_visibility']) {
        const privileges = (await pool.query(`SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed`,
          [role, `public.${table}`])).rows[0];
        assert.equal(privileges.allowed, false);
        const client = await pool.connect();
        try {
          await client.query(`BEGIN; SET LOCAL ROLE ${role}`);
          await assert.rejects(client.query(`SELECT * FROM public.${table}`), error => error.code === '42501');
        } finally { await client.query('ROLLBACK'); client.release(); }
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN; SET LOCAL ROLE service_role');
      assert.equal((await client.query('SELECT * FROM public.artwork_donations')).rowCount, 0);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  await t.test('real listener and processEvent persist NUL and over-display-limit support without poisoning JSONB or changing metrics', async () => {
    const beforeMetrics = await snapshot();
    const messages = ['<img src=x onerror=alert(1)>', 'before\0after', 'a'.repeat(141)];
    for (let index = 1; index <= messages.length; index++) {
      const event = await fromLog(index, messages[index - 1]);
      await engine.processEvent(event);
      await engine.processEvent(event);
    }
    const rows = (await pool.query(`SELECT d.transaction_hash,d.message,e.event_data,r.processing_status
      FROM public.artwork_donations d JOIN public.contract_events e USING(chain_id,transaction_hash,log_index)
      JOIN public.event_processing_registry r USING(chain_id,transaction_hash,log_index)
      ORDER BY d.transaction_hash`)).rows;
    assert.equal(rows.length, 3);
    for (let index = 0; index < rows.length; index++) {
      assert.equal(rows[index].processing_status, 'completed');
      assert.equal(Buffer.from(rows[index].event_data.message_utf8_hex, 'hex').toString('utf8'), messages[index]);
      assert.equal(rows[index].message, index === 0 ? messages[0] : null);
    }
    assert.deepEqual(await snapshot(), beforeMetrics);
    assert.equal((await pool.query('SELECT * FROM public.v41_public_metric_events')).rowCount, 0);
  });

  await t.test('duplicate and concurrent replay never changes amount or creates a second support projection', async () => {
    const event = await fromLog(4, 'Original', 1n);
    // Every nonzero amount can carry a message. The parser trusts verified
    // contract events, not a client-reported payment.
    await engine.processEvent(event);
    await Promise.all([eventApi.projectDonation(pool, event, 84532, SUPPORT, new Date(event.timestamp)),
      eventApi.projectDonation(pool, {...event, eventData: {...event.eventData, amount: 99n}},
        84532, SUPPORT, new Date(event.timestamp))]);
    const rows = (await pool.query('SELECT amount,message FROM public.artwork_donations WHERE transaction_hash=$1', [hash(4)])).rows;
    assert.deepEqual(rows, [{amount: '1', message: 'Original'}]);
  });

  await t.test('foreign deployment rolls back event and projection atomically and records a retryable failed lease', async () => {
    const event = {...await fromLog(5), contractAddress: CORE};
    await assert.rejects(engine.processEvent(event), /outside the configured deployment/);
    assert.equal((await pool.query('SELECT * FROM public.contract_events WHERE transaction_hash=$1', [hash(5)])).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM public.artwork_donations WHERE transaction_hash=$1', [hash(5)])).rowCount, 0);
    assert.equal((await pool.query('SELECT processing_status FROM public.event_processing_registry WHERE transaction_hash=$1', [hash(5)])).rows[0].processing_status, 'failed');
  });

  await t.test('amount and newest ordering retain deterministic block and log ties with exact large wei values', async () => {
    for (const [index, amount, block] of [[6, 10n ** 30n + 1n, 200], [7, 10n ** 30n + 1n, 201], [8, 10n ** 30n, 202]]) {
      await engine.processEvent(await fromLog(index, '', amount, block));
    }
    const amountRows = (await pool.query(`SELECT transaction_hash,amount FROM public.artwork_donations
      WHERE block_number>=200 ORDER BY amount DESC,block_number DESC,log_index DESC`)).rows;
    assert.deepEqual(amountRows.map(row => row.transaction_hash), [hash(7), hash(6), hash(8)]);
    assert.equal(amountRows[0].amount, (10n ** 30n + 1n).toString());
    const newest = (await pool.query(`SELECT transaction_hash FROM public.artwork_donations
      WHERE block_number>=200 ORDER BY block_number DESC,log_index DESC`)).rows;
    assert.deepEqual(newest.map(row => row.transaction_hash), [hash(8), hash(7), hash(6)]);
  });

  await t.test('actual chain-scoped rollback cascades support and preserves independent message visibility evidence', async () => {
    await pool.query(`INSERT INTO public.donation_message_visibility(chain_id,transaction_hash,log_index,hidden)
      VALUES(84532,$1,0,true)`, [hash(7)]);
    await pool.query(`INSERT INTO public.contract_events(chain_id,transaction_hash,log_index,event_name,block_number)
      VALUES(11155111,$1,0,'Legacy',201)`, [hash(7)]);
    const beforeMetrics = await snapshot();
    await pool.query('SELECT * FROM public.rollback_events_from_block(200,84532)');
    assert.equal((await pool.query('SELECT * FROM public.artwork_donations WHERE block_number>=200')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM public.artwork_donations WHERE block_number<200')).rowCount, 4);
    assert.equal((await pool.query('SELECT * FROM public.contract_events WHERE chain_id=11155111')).rowCount, 1);
    assert.equal((await pool.query('SELECT hidden FROM public.donation_message_visibility WHERE transaction_hash=$1', [hash(7)])).rows[0].hidden, true);
    assert.deepEqual(await snapshot(), beforeMetrics);
    // Re-indexing the same event after a reorg is possible; it must not erase
    // the separately retained on-site message visibility decision.
    await engine.processEvent(await fromLog(7, 'Reindexed message', 10n ** 30n + 1n, 201));
    assert.equal((await pool.query('SELECT * FROM public.artwork_donations WHERE transaction_hash=$1', [hash(7)])).rowCount, 1);
    assert.equal((await pool.query('SELECT hidden FROM public.donation_message_visibility WHERE transaction_hash=$1', [hash(7)])).rows[0].hidden, true);
  });

  await t.test('unattached projections and messages exceeding the byte ceiling fail at the database boundary', async () => {
    const event = await fromLog(9);
    await assert.rejects(eventApi.projectDonation(pool, event, 84532, SUPPORT, new Date(event.timestamp)),
      error => error.code === '23503');
    await assert.rejects(pool.query('UPDATE public.artwork_donations SET message=$1 WHERE transaction_hash=$2',
      ['a'.repeat(561), hash(1)]), error => error.code === '23514');
    await pool.query('UPDATE public.artwork_donations SET message=$1 WHERE transaction_hash=$2', ['🌍'.repeat(140), hash(1)]);
    assert.equal((await pool.query('SELECT OCTET_LENGTH(message) AS bytes FROM public.artwork_donations WHERE transaction_hash=$1', [hash(1)])).rows[0].bytes, 560);
  });

  await t.test('reapplying this new migration preserves projections and visibility rows', async () => {
    const before = (await pool.query(`SELECT (SELECT count(*) FROM public.artwork_donations) AS donations,
      (SELECT count(*) FROM public.donation_message_visibility) AS visibility`)).rows[0];
    await pool.query(migrationSql);
    assert.deepEqual((await pool.query(`SELECT (SELECT count(*) FROM public.artwork_donations) AS donations,
      (SELECT count(*) FROM public.donation_message_visibility) AS visibility`)).rows[0], before);
  });

  await t.test('real historical sync projects chain time from the stored event block with one block fetch for multiple donations', async () => {
    const priorSkip = process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL;
    try {
      for (const [index,skip] of ['false','true'].entries()) {
        process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL = skip;
        const block = 500+index, seconds = 1578000000+index;
        let blockFetches = 0;
        listener.getBlock = async requested => {blockFetches++; assert.equal(requested,block);
          return {hash:hash(block),parentHash:hash(block-1),timestamp:seconds};};
        const logs = [0,1,2].map(n => ({...donationInterface.encodeEventLog(donationInterface.getEvent('Donation'),
          [DONOR,CREATOR,28,500000000000000n,`Historical ${n}`,false]), address:SUPPORT, blockNumber:block,
          transactionHash:hash(block*10+n),index:n}));
        listener.provider = {async getLogs(){return logs;}};
        listener.queryAllHistoricalEvents = async(from,to) => await listener._queryLogsChunk(from,to);
        await pool.query('INSERT INTO public.block_hashes VALUES(11155111,$1,$2,$3,1999999999)',[block,hash(block),hash(block-1)]);
        assert.equal(await engine.syncHistoricalEvents(block,block,{currentBlock:block+3}),3);
        assert.equal(blockFetches,1,'existing block storage fetch is reused by every donation');
        const projected = (await pool.query('SELECT recorded_at FROM public.artwork_donations WHERE block_number=$1',[block])).rows;
        assert.equal(projected.length,3);
        for (const row of projected) assert.equal(row.recorded_at.getTime(),seconds*1000);
      }
    } finally {if(priorSkip===undefined) delete process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL; else process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL=priorSkip;}
  });
  await t.test('refetched replacement blocks update their stored timestamp before donation replay', async () => {
    await pool.query('INSERT INTO public.block_hashes VALUES(84532,550,$1,$2,1578000000)',[hash(550),hash(549)]);
    listener.getBlock = async () => ({hash:hash(551),parentHash:hash(549),timestamp:1578000010});
    await engine._storeBlockHashesForBlocks([550]);
    const row = (await pool.query('SELECT block_hash,timestamp FROM public.block_hashes WHERE chain_id=84532 AND block_number=550')).rows[0];
    assert.equal(row.block_hash,hash(551)); assert.equal(row.timestamp,'1578000010');
  });
  await t.test('a missing block timestamp fails the range retryably without inventing dates or advancing its cursor', async () => {
    const before = (await pool.query('SELECT last_indexed_block,total_events_indexed FROM public.indexer_state WHERE chain_id=84532')).rows[0];
    const block = 600;
    listener.provider = {async getLogs(){return [{...donationInterface.encodeEventLog(donationInterface.getEvent('Donation'),
      [DONOR,CREATOR,28,9n,'',false]),address:SUPPORT,blockNumber:block,transactionHash:hash(6000),index:0}];}};
    listener.queryAllHistoricalEvents = async(from,to) => await listener._queryLogsChunk(from,to);
    listener.getBlock = async () => {throw new Error('Local missing block fixture');};
    await assert.rejects(engine.syncHistoricalEvents(block,block,{currentBlock:block+3}),error=>error.code==='INDEXER_RANGE_INCOMPLETE');
    assert.deepEqual((await pool.query('SELECT last_indexed_block,total_events_indexed FROM public.indexer_state WHERE chain_id=84532')).rows[0],before);
    assert.equal((await pool.query('SELECT * FROM public.artwork_donations WHERE transaction_hash=$1',[hash(6000)])).rowCount,0);
    assert.equal((await pool.query('SELECT * FROM public.contract_events WHERE transaction_hash=$1',[hash(6000)])).rowCount,0);
    assert.equal((await pool.query('SELECT processing_status FROM public.event_processing_registry WHERE transaction_hash=$1',[hash(6000)])).rows[0].processing_status,'failed');
    listener.getBlock = async () => ({hash:hash(block),parentHash:hash(block-1),timestamp:1578000020});
    assert.equal(await engine.syncHistoricalEvents(block,block,{currentBlock:block+3}),1);
    assert.equal((await pool.query('SELECT recorded_at FROM public.artwork_donations WHERE transaction_hash=$1',[hash(6000)])).rows[0].recorded_at.getTime(),1578000020000);
  });
});
