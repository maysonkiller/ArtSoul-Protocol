// Local EVM receipts -> production decoder/worker -> disposable PostgreSQL ->
// authenticated API. This is engineering evidence, not hosted/iPhone acceptance.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import dotenv from 'dotenv';
import pg from 'pg';
import {BrowserProvider, ContractFactory, Interface, Wallet, parseEther} from 'ethers';
import EventListener from '../src/indexer/event-listener.js';
import {V41_CORE_ABI} from '../src/indexer/v4-1-event-schema.js';
import handler from '../src/api/routes/notifications.js';
import {setWalletSession} from '../src/api/backend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN = 84532;
const ORIGIN = 'https://artsoul.example.test';
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const runDocker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true
}).trim();
let dockerHost;
const docker = (...args) => runDocker('--host', dockerHost, ...args);
let dockerAvailable = false;
try {
  dockerHost = process.env.DOCKER_HOST || runDocker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
  const isLocal = dockerHost.startsWith('unix:///') || dockerHost.startsWith('npipe:////./pipe/');
  dockerAvailable = isLocal && docker('version', '--format', '{{.Server.Os}}') === 'linux';
} catch { /* Docker is optional for ordinary local unit runs. */ }
const mustRun = process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const response = () => ({headers: {}, statusCode: 200,
  setHeader(key, value) {this.headers[key] = value;},
  status(value) {this.statusCode = value; return this;},
  json(value) {this.body = value; return this;}, end() {}});

async function compileContracts() {
  // Installed solc only: no Hardhat config, compiler download, artifact cache or
  // inherited HARDHAT_NETWORK/RPC/PRIVATE_KEY can choose a remote write target.
  const {default: solc} = await import('solc');
  const names = ['ArtSoulCore', 'ArtSoulNFT', 'ArtSoulProjectNFT'];
  const input = {language: 'Solidity', sources: Object.fromEntries(names.map(name =>
    [`contracts/${name}.sol`, {content: read(`contracts/${name}.sol`)}])), settings: {
      optimizer: {enabled: true, runs: 200}, evmVersion: 'cancun',
      outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object']}}
    }};
  const result = JSON.parse(solc.compile(JSON.stringify(input), {import(name) {
    const base = name.startsWith('@openzeppelin/') ? path.join(ROOT, 'node_modules') : ROOT;
    const resolved = path.resolve(base, name);
    assert.ok(resolved.startsWith(base + path.sep), 'Solidity imports must stay inside the repository/dependencies');
    return {contents: fs.readFileSync(resolved, 'utf8')};
  }}));
  assert.deepEqual((result.errors || []).filter(error => error.severity === 'error'), []);
  return Object.fromEntries(names.map(name => [name, result.contracts[`contracts/${name}.sol`][name]]));
}

test('real local auction extension and settlement preserve private reminder identity and retire paid deadlines', {
  skip: dockerAvailable || mustRun ? false : 'Disposable PostgreSQL requires a local Linux Docker engine',
  timeout: 180000
}, async t => {
  assert.ok(dockerAvailable, 'The Linux CI job must exercise the loopback PostgreSQL fixture');
  const container = `artsoul-reminder-evm-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const environment = {
    REDIS_URL: '', SESSION_SECRET: 'local-reminder-evm-session-only',
    SUPABASE_URL: 'https://reminders.example.test', NEXT_PUBLIC_SUPABASE_URL: 'https://reminders.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'local-reminder-evm-service-only',
    ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED: 'true', ARTSOUL_AUCTION_LIFECYCLE_ENABLED: 'true',
    ARTSOUL_AUCTION_REMINDERS_ENABLED: 'true', ARTSOUL_PUBLIC_ORIGIN: ORIGIN,
    API_ALLOWED_ORIGINS: '', ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL: 'true',
    ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: ''
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let pool, provider, created = false;
  Object.assign(process.env, environment);
  // Every fetch is denied until the explicit local PostgREST transport is ready.
  globalThis.fetch = async () => {throw new Error('External HTTP is forbidden in the local reminder fixture');};
  t.after(async () => {
    try {provider?.destroy(); await pool?.end();}
    finally {
      try {if (created) docker('rm', '-f', '-v', container);}
      finally {
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    }
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  // The worker's queue module normally loads the working directory's .env.
  t.mock.method(dotenv, 'config', () => ({parsed: {}}));
  const contracts = await compileContracts();
  docker('create', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=local-reminder-evm',
    '-e', 'POSTGRES_DB=artsoul', '-p', '127.0.0.1::5432', 'postgres:17');
  created = true;
  docker('start', container);
  const endpoint = docker('port', container, '5432/tcp');
  assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
  pool = new pg.Pool({host: '127.0.0.1', port: Number(endpoint.split(':')[1]),
    database: 'artsoul', user: 'postgres', password: 'local-reminder-evm',
    connectionTimeoutMillis: 1000, statement_timeout: 10000, max: 3});
  for (let attempt = 0; ; attempt++) {
    try {await pool.query('SELECT 1'); await delay(100); await pool.query('SELECT 1'); break;}
    catch (error) {if (attempt >= 80) throw error; await delay(250);}
  }
  await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE EXTENSION pgcrypto;');
  // Reuse the shipped setup sequence and actual recovery-aware notification
  // migrations, not the legacy synthetic notification-writer test adapter.
  for (const [, migration] of read('src/indexer/setup-database.sql').matchAll(/^\\i (.+)$/gm)) {
    await pool.query(read(migration.trim()));
  }
  for (const name of ['identity', 'preparation', 'submission', 'registration', 'reorg']) {
    await pool.query(read(`sql/migrations/artwork_media_${name}.sql`));
  }
  for (const name of ['phase18_artwork_moderation_visibility', 'a8b_artwork_report_intake',
    'a8c_protocol_admin_review', 'artist_support', 'artist_support_moderation', 'auction_notifications',
    'auction_notification_lifecycle', 'auction_notification_reminders', 'notification_summary',
    'notification_inbox_removal', '20261029212603_notification_reorg_identity']) {
    await pool.query(read(`sql/migrations/${name}.sql`));
  }
  await pool.query(`INSERT INTO distributed_locks(lock_name,instance_id,fencing_token,expires_at)
    VALUES('reminder-evm','local-worker',1,clock_timestamp()+interval '1 hour')`);

  // Only this in-memory EVM clock starts in the past. PostgreSQL keeps its real
  // clock, and confirmed boundary headers must pass the unchanged <=120s proof.
  // One round expires naturally in the fixture's past; another ends soon now.
  const now = Number((await pool.query('SELECT floor(extract(epoch FROM statement_timestamp()))::TEXT n')).rows[0].n);
  const localAccounts = Array.from({length: 3}, () => ({
    privateKey: Wallet.createRandom().privateKey, balance: parseEther('100').toString()
  }));
  const {default: hardhatProvider} = await import('hardhat/internal/hardhat-network/provider/provider.js');
  const evm = await hardhatProvider.createHardhatNetworkProvider({
    chainId: CHAIN, networkId: CHAIN, hardfork: 'cancun', chains: new Map(),
    blockGasLimit: 30000000, minGasPrice: 0n, automine: true, intervalMining: 0,
    mempoolOrder: 'priority', genesisAccounts: localAccounts, initialDate: new Date((now - 90000) * 1000),
    allowUnlimitedContractSize: false, throwOnTransactionFailures: true, throwOnCallFailures: true,
    allowBlocksWithSameTimestamp: false, enableTransientStorage: true, enableRip7212: false
  }, {enabled: false});
  assert.equal(await evm.request({method: 'eth_chainId'}), '0x14a34');
  assert.match(await evm.request({method: 'web3_clientVersion'}), /^HardhatNetwork\//);
  provider = new BrowserProvider(evm, {chainId: CHAIN, name: 'isolated-hardhat'}, {cacheTimeout: -1});
  provider.pollingInterval = 10;
  const [creator, winner, other] = await Promise.all([0, 1, 2].map(index => provider.getSigner(index)));
  const creatorAddress = (await creator.getAddress()).toLowerCase();
  const winnerAddress = (await winner.getAddress()).toLowerCase();
  const otherAddress = (await other.getAddress()).toLowerCase();
  const mine = () => evm.request({method: 'evm_mine', params: []});
  const setNextTime = timestamp => evm.request({method: 'evm_setNextBlockTimestamp', params: [timestamp]});
  const transact = async transaction => {
    const receipt = await (await transaction).wait(); assert.equal(receipt.status, 1); return receipt;
  };
  async function deploy(name, args = []) {
    const compiled = contracts[name];
    const contract = await new ContractFactory(compiled.abi, compiled.evm.bytecode.object, creator).deploy(...args);
    await contract.waitForDeployment(); return contract;
  }
  const nft = await deploy('ArtSoulNFT');
  const project = await deploy('ArtSoulProjectNFT');
  const core = await deploy('ArtSoulCore', [await nft.getAddress(), await project.getAddress(), otherAddress]);
  const coreAddress = (await core.getAddress()).toLowerCase();
  process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = coreAddress;
  await transact(nft.setCore(coreAddress)); await transact(project.setCore(coreAddress));
  await transact(core.registerArtwork('ipfs://local-reminder-old-round'));
  await transact(core.createAuction(1, parseEther('0.001'), 86400));
  await transact(core.connect(winner).placeBid(1, parseEther('0.001'), {value: parseEther('0.01')}));
  await transact(core.registerArtwork('ipfs://local-reminder-extension'));
  await setNextTime(now - 86400 + 300);
  await transact(core.createAuction(2, parseEther('0.001'), 86400));
  const originalDeadline = (await core.auctions(2)).endTime.toString();
  assert.equal(originalDeadline, String(now + 300));
  await setNextTime(now - 30); await mine();

  const listener = Object.assign(Object.create(EventListener.prototype), {
    chainId: CHAIN, contractAddress: coreAddress, donationAddress: '',
    contract: {interface: new Interface(V41_CORE_ABI)}, provider,
    maxBlockRange: 1000, maxBlockRangeLimit: 1000, minBlockRange: 10,
    _retryRpcCall: operation => operation(), _readRpcCall: operation => operation(provider)
  });
  const {default: Engine} = await import('../src/indexer/sync-engine.js');
  const engine = new Engine({pool, query: async (sql, params) => (await pool.query(sql, params)).rows}, listener);
  engine.getRecoveryAuthority = () => ({lockName: 'reminder-evm', instanceId: 'local-worker', fencingToken: '1', isCurrent: () => true});
  await pool.query(`INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,
    confirmation_depth,last_indexed_at,started_at,status) VALUES(84532,$1,0,0,3,now(),now(),'running')`, [coreAddress]);
  async function sync() {
    const boundary = await listener.getCurrentBlock();
    // Confirmation depth is represented by real extra local blocks, not a
    // fabricated currentBlock argument or a rewritten database checkpoint.
    for (let i = 0; i < 3; i++) await mine();
    const head = await listener.getCurrentBlock();
    const previousBlock = (await engine.getIndexerState()).last_indexed_block;
    await engine.syncHistoricalEvents(previousBlock + 1, boundary, {currentBlock: head});
    assert.equal((await engine.getIndexerState()).last_confirmed_block, boundary);
    assert.equal((await pool.query('SELECT auction_reminders_available($1,statement_timestamp()) ok', [coreAddress])).rows[0].ok, true);
  }

  // Only transport is adapted: production signed-cookie auth, request/response
  // validation and PostgreSQL functions/roles execute unchanged. No live SIWE
  // ceremony or PostgREST deployment is claimed by this local endpoint test.
  let rpcCalls = 0;
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://reminders.example.test');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    const calls = {
      '/rest/v1/rpc/read_auction_notifications_v3': ['SELECT read_auction_notifications_v3($1,$2,$3) result',
        [body.p_wallet, body.p_core, body.p_before]],
      '/rest/v1/rpc/mark_auction_notifications_v3': ['SELECT mark_auction_notifications_v3($1,$2,$3,$4) result',
        [body.p_wallet, body.p_core, body.p_ids, body.p_read]],
      '/rest/v1/rpc/save_auction_notification_preferences_v3': ['SELECT save_auction_notification_preferences_v3($1,$2,$3,$4,$5,$6,$7,$8) result',
        [body.p_wallet, body.p_core, body.p_revision, body.p_created, body.p_outbid, body.p_lifecycle, body.p_reminders, body.p_minutes]]
    };
    assert.ok(Object.hasOwn(calls, target.pathname), 'No other HTTP request is allowed');
    const client = await pool.connect();
    try {
      rpcCalls++;
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE service_role');
      const result = (await client.query(...calls[target.pathname])).rows[0].result;
      await client.query('COMMIT'); return Response.json(result);
    } catch (error) {await client.query('ROLLBACK'); throw error;} finally {client.release();}
  };
  const sessions = new Map();
  for (const wallet of [creatorAddress, winnerAddress, otherAddress]) {
    const res = response(); setWalletSession(res, wallet);
    sessions.set(wallet, {cookie: res.headers['Set-Cookie'].split(';')[0], 'x-artsoul-wallet': wallet,
      origin: ORIGIN, 'content-type': 'application/json'});
  }
  async function api(wallet, body, headers = sessions.get(wallet)) {
    const res = response();
    await handler({method: body ? 'PUT' : 'GET', headers, query: {v: '3'}, body}, res);
    assert.equal(res.headers['Cache-Control'], 'private, no-store'); return res;
  }
  async function inbox(wallet) {
    const res = await api(wallet); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body;
  }
  const find = (page, auctionId, type) => page.reminders.find(row => row.auction_id === String(auctionId) && row.type === type);
  const mark = (wallet, id) => api(wallet, {action: 'read', ids: [id], read: true});
  const storedRead = async id => (await pool.query('SELECT read FROM auction_notification_reads WHERE outbox_id=$1', [id])).rows;
  const windowQuery = read('sql/verification/auction_windows.sql');
  const projectedWindow = async (scenario, client = pool) => {
    const {rows} = await client.query(windowQuery);
    return rows.find(row => row.scenario === scenario);
  };

  await sync();
  await t.test('operator preflight finds visible current rounds and respects extension limits', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const active = await projectedWindow('late_bid', client);
      assert.equal(active.artwork_id, '2');
      assert.equal(active.auction_id, '2');
      assert.equal(active.window_state, 'open');
      assert.equal((await projectedWindow('finalize', client)).auction_id, '1');
      assert.equal((await projectedWindow('payment', client)).window_state, 'no_candidate');
      await client.query('ROLLBACK');

      // Temporary projection variations exercise the exact boundaries at one DB instant.
      await client.query('BEGIN');
      await client.query("UPDATE v41_auctions SET original_end_time=now()+interval '10 minutes', end_time=now()+interval '10 minutes' WHERE auction_id=2");
      assert.equal((await projectedWindow('late_bid', client)).window_state, 'open');
      await client.query("UPDATE v41_auctions SET end_time=end_time+interval '1 second' WHERE auction_id=2");
      assert.equal((await projectedWindow('late_bid', client)).window_state, 'waiting');
      await client.query("UPDATE v41_auctions SET end_time=original_end_time+interval '60 minutes' WHERE auction_id=2");
      assert.equal((await projectedWindow('late_bid', client)).window_state, 'no_candidate');
      await client.query("UPDATE v41_auctions SET end_time=now() WHERE auction_id=2");
      assert.equal((await projectedWindow('late_bid', client)).window_state, 'no_candidate');
      await client.query("UPDATE v41_auctions SET end_time=original_end_time WHERE auction_id=2");
      await client.query('INSERT INTO artwork_moderation_visibility (chain_id,artwork_id,hidden) VALUES (84532,2,true)');
      assert.equal((await projectedWindow('late_bid', client)).window_state, 'no_candidate');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  await t.test('authenticated API persists read acknowledgement before a real extension', async () => {
    const before = rpcCalls;
    assert.equal((await api(creatorAddress, undefined, {})).statusCode, 401);
    assert.equal((await api(creatorAddress, undefined, {...sessions.get(creatorAddress), 'x-artsoul-wallet': otherAddress})).statusCode, 401);
    assert.equal(rpcCalls, before, 'unauthenticated callers cannot materialize reminders');
    assert.deepEqual((await inbox(otherAddress)).reminders, []);
    const reminder = find(await inbox(creatorAddress), 2, 'auction_ending');
    assert.ok(reminder); assert.equal(reminder.deadline, originalDeadline); assert.equal(reminder.read, false);
    assert.equal((await mark(otherAddress, reminder.id)).statusCode, 409);
    assert.deepEqual(await storedRead(reminder.id), []);
    assert.equal((await mark(creatorAddress, reminder.id)).statusCode, 200);
    assert.deepEqual(await storedRead(reminder.id), [{read: true}]);
    assert.equal(find(await inbox(creatorAddress), 2, 'auction_ending').read, true);
  });
  const originalReminder = find(await inbox(creatorAddress), 2, 'auction_ending');
  await t.test('actual late bid receipt reaches the worker and reschedules the same read reminder', async () => {
    const receipt = await transact(core.connect(winner).placeBid(2, parseEther('0.001'), {value: parseEther('0.01')}));
    const extension = receipt.logs.map(log => {try {return core.interface.parseLog(log);} catch {return null;}})
      .find(log => log?.name === 'AuctionExtended');
    assert.ok(extension, 'the real contract, not a fixture event, must extend the round');
    assert.equal(extension.args.oldEndTime.toString(), originalDeadline);
    await sync();
    const row = (await pool.query("SELECT event_data,transaction_hash FROM contract_events WHERE event_name='AuctionExtended'")).rows;
    assert.equal(row.length, 1); assert.equal(row[0].transaction_hash, receipt.hash);
    assert.equal(row[0].event_data.newEndTime, extension.args.newEndTime.toString());
    const nextWindow = await projectedWindow('late_bid');
    assert.equal(nextWindow.deadline.getTime(), Number(extension.args.newEndTime) * 1000);
    const updated = find(await inbox(creatorAddress), 2, 'auction_ending');
    assert.equal(updated.id, originalReminder.id); assert.equal(updated.read, true);
    assert.equal(updated.deadline, extension.args.newEndTime.toString());
    assert.equal(updated.transaction_hash, receipt.hash);
    const copies = await pool.query("SELECT count(*)::INT n FROM outbox_events WHERE payload->>'type'='auction_ending' AND payload->>'recipient'=$1 AND payload->>'auctionId'='2'", [creatorAddress]);
    assert.equal(copies.rows[0].n, 1);
  });
  await t.test('real end opens winner-only payment reminder; settlement retires it but keeps acknowledged history', async () => {
    const ended = await transact(core.endAuction(1)); await sync();
    const payable = await projectedWindow('payment');
    assert.equal(payable.auction_id, '1');
    assert.equal(payable.window_state, 'open');
    assert.equal((await projectedWindow('finalize')).window_state, 'no_candidate');
    const page = await inbox(winnerAddress);
    const saved = await api(winnerAddress, {action: 'preferences', expected_revision: page.preferencesRevision,
      preferences: page.preferences, reminderMinutes: [1440]});
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
    const payment = find(await inbox(winnerAddress), 1, 'payment_due');
    assert.ok(payment); assert.equal(payment.transaction_hash, ended.hash);
    assert.equal(payment.deadline, (await core.auctions(1)).settlementDeadline.toString());
    assert.equal(find(await inbox(creatorAddress), 1, 'payment_due'), undefined);
    assert.equal(find(await inbox(otherAddress), 1, 'payment_due'), undefined);
    assert.equal((await mark(otherAddress, payment.id)).statusCode, 409);
    assert.equal((await mark(winnerAddress, payment.id)).statusCode, 200);
    assert.equal(find(await inbox(winnerAddress), 1, 'payment_due').read, true);
    const settled = await transact(core.connect(winner).settleAuction(1, {value: 0})); await sync();
    assert.equal((await projectedWindow('payment')).window_state, 'no_candidate');
    const settlement = settled.logs.map(log => {try {return core.interface.parseLog(log);} catch {return null;}})
      .find(log => log?.name === 'SettlementCompleted');
    assert.ok(settlement);
    assert.equal((await nft.ownerOf(settlement.args.tokenId)).toLowerCase(), winnerAddress);
    assert.equal(await core.pendingWithdrawals(winnerAddress), parseEther('0.009'));
    const after = await inbox(winnerAddress);
    assert.equal(find(after, 1, 'payment_due'), undefined);
    assert.ok(after.items.some(row => row.type === 'purchase_completed' && row.transaction_hash === settled.hash));
    assert.equal((await mark(winnerAddress, payment.id)).statusCode, 409);
    assert.deepEqual(await storedRead(payment.id), [{read: true}], 'retirement does not erase the recipient acknowledgement');
    assert.equal((await pool.query("SELECT count(*)::INT n FROM event_processing_registry WHERE processing_status<>'completed'")).rows[0].n, 0);
  });
  t.diagnostic('In-memory Hardhat, installed solc, actual receipt/log decoding, worker writes and recovery-aware SQL passed. Local signed-session API uses a loopback PostgreSQL transport adapter; no hosted event, physical device or external wallet action is asserted.');
});
