// TA-10 foundation: actual PostgreSQL 17, never a project database. These tests
// do not prove website enforcement, live byte verification or indexer activation.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {execFileSync, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const migration = fs.readFileSync(path.join(__dirname, '../sql/migrations/artwork_media_identity.sql'), 'utf8');
const container = `artsoul-media-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const creator = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
const core = '0x' + 'aa'.repeat(20), otherCore = '0x' + 'bb'.repeat(20);
const digest = 'cc'.repeat(32), otherDigest = 'dd'.repeat(32);
const q = value => value == null ? 'NULL' : "'" + String(value).replace(/'/g, "''") + "'";
const args = query => ['exec', container, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', query];
const sql = query => execFileSync('docker', args(query), {encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:20000}).trim();
const parallel = async query => (await run('docker', args(query), {timeout:20000})).stdout.trim();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let docker = false;
try { docker = execFileSync('docker', ['version', '--format', '{{.Server.Os}}'], {encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:15000}).trim() === 'linux'; } catch {}

function fixture(overrides = {}) {
  const values = {id:crypto.randomUUID(), chain:84532, core, artwork:34, creator, hash:digest,
    bytes:25763, metadata:'https://storage.example/metadata/first.json',
    tx:'0x' + 'ee'.repeat(32), block:100, log:0, ...overrides};
  values.path ??= `uploads/${values.creator.toLowerCase()}/1700000000000-original.png`;
  values.media ??= `https://storage.example/storage/v1/object/public/artworks/${values.path}`;
  return values;
}
function claim(value) {
  return `SELECT public.claim_artwork_media_publication(${[
    value.id, value.chain, value.core, value.creator, value.hash, value.path, value.bytes, value.metadata
  ].map(q).join(',')})`;
}
function record(value) {
  return `SELECT public.record_artwork_media_identity(${[
    value.chain, value.core, value.artwork, value.creator, value.hash, value.media, value.bytes,
    value.metadata, value.tx, value.block, value.log
  ].map(q).join(',')})`;
}
const asService = query => `SET ROLE service_role; ${query}`;
function error(query, pattern) {
  let failed;
  try {sql(query);} catch (caught) {failed = String(caught.stderr || caught.message);}
  assert(failed, 'SQL must fail');
  assert.match(failed, pattern);
  return failed;
}
function applyMigration() {
  execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    {input:migration, stdio:['pipe','ignore','pipe'], timeout:30000});
}

test('media identity migration keeps the foundation private and introduces no release operation', () => {
  for (const table of ['artwork_media_catalog', 'artwork_media_publications']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT SELECT ON public\.artwork_media_catalog, public\.artwork_media_publications TO service_role/);
  assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) || []).length, 2);
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|TRUNCATE|expires_at|release_artwork)\b/i);
});

test('media identity claims and catalog use real PostgreSQL transactions', {skip:docker ? false : 'Docker unavailable; atomic behavior remains unverified'}, async t => {
  execFileSync('docker', ['run','-d','--name',container,'-e','POSTGRES_PASSWORD=postgres','-e','POSTGRES_DB=artsoul','postgres:17'], {stdio:'ignore',timeout:120000});
  t.after(() => execFileSync('docker', ['rm','-f',container], {stdio:'ignore',timeout:30000}));
  let ready = false;
  for(let attempt=0;attempt<60;attempt++) {
    try {sql('SELECT 1');await delay(300);sql('SELECT 1');ready=true;break;} catch {await delay(500);}
  }
  assert(ready, 'disposable PostgreSQL is ready');
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;`);
  applyMigration();
  t.beforeEach(() => sql('TRUNCATE public.artwork_media_publications, public.artwork_media_catalog'));

  // Observe an in-flight transaction after its RPC has completed. The competing
  // RPC must wait on the shared hash lock until this transaction commits.
  async function held(query) {
    const name = 'media-' + crypto.randomBytes(6).toString('hex');
    const finished = parallel(`SET application_name=${q(name)}; BEGIN; ${query}; SELECT pg_sleep(1.5); COMMIT`);
    for(let i=0;i<45;i++) {
      if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name)} AND wait_event='PgSleep')`) === 't') return {finished};
      await delay(20);
    }
    await finished;
    throw Error('Did not observe the held transaction');
  }

  await t.test('identical operation retry resumes without changing immutable data or timestamps', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    const before = sql('SELECT row_to_json(p) FROM artwork_media_publications p');
    assert.equal(sql(asService(claim({...value, chain:'84532.0', core:core.toUpperCase().replace('0X','0x')}))), 'RESUME');
    assert.equal(sql('SELECT row_to_json(p) FROM artwork_media_publications p'), before);
  });

  await t.test('different UUID cannot claim identical bytes, even for the same wallet or renamed file', async () => {
    const one = fixture(), two = fixture({path:`uploads/${creator}/renamed.png`});
    const results = await Promise.all([parallel(asService(claim(one))), parallel(asService(claim(two)))]);
    assert.deepEqual(results.sort(), ['CLAIMED','DUPLICATE_MEDIA']);
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '1');
    assert.equal(sql(asService(claim(fixture({creator:other})))), 'DUPLICATE_MEDIA');
  });

  await t.test('concurrent identical UUID requests produce one claim and one resume', async () => {
    const value = fixture();
    const results = await Promise.all([parallel(asService(claim(value))), parallel(asService(claim(value)))]);
    assert.deepEqual(results.sort(), ['CLAIMED','RESUME']);
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '1');
  });

  await t.test('foreign wallet and every mutated operation field are rejected without changing the claim', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    for (const change of [
      {creator:other,path:`uploads/${other}/other.png`}, {chain:8453}, {core:otherCore}, {hash:otherDigest},
      {path:`uploads/${creator}/another.png`}, {bytes:12}, {metadata:'https://storage.example/metadata/other.json'}
    ]) assert.equal(sql(asService(claim({...value,...change}))), 'PUBLICATION_MISMATCH');
    assert.equal(sql(asService(claim(value))), 'RESUME');
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '1');
  });

  await t.test('concurrent mutated same-UUID requests serialize across different hashes', async () => {
    const value = fixture();
    const results = await Promise.all([parallel(asService(claim(value))), parallel(asService(claim({...value,hash:otherDigest})))]);
    assert.deepEqual(results.sort(), ['CLAIMED','PUBLICATION_MISMATCH']);
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '1');
  });

  await t.test('chain and core scope distinguish deployments without weakening same-deployment uniqueness', () => {
    for (const value of [fixture(),fixture({chain:8453}),fixture({core:otherCore})]) {
      assert.equal(sql(asService(claim(value))), 'CLAIMED');
      assert.equal(sql(asService(claim({...value,id:crypto.randomUUID()}))), 'DUPLICATE_MEDIA');
    }
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '3');
  });

  await t.test('legacy duplicates retain all artwork references and block new claims', () => {
    const first = fixture(), second = fixture({artwork:35,creator:other,metadata:'ipfs://legacy-metadata',tx:'0x'+'ab'.repeat(32)});
    assert.equal(sql(asService(record(first))), 'RECORDED');
    assert.equal(sql(asService(record(second))), 'RECORDED');
    assert.equal(sql('SELECT string_agg(artwork_id::TEXT,\',\' ORDER BY artwork_id) FROM artwork_media_catalog'), '34,35');
    assert.equal(sql(asService(claim(fixture()))), 'DUPLICATE_MEDIA');
    assert.equal(sql(asService(claim(fixture({creator:other})))), 'DUPLICATE_MEDIA');
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '0');
  });

  await t.test('exact confirmed registration reconciles a claim and repeated evidence is idempotent', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    assert.equal(sql(asService(record(value))), 'RECORDED');
    assert.equal(sql(asService(claim(value))), 'REGISTERED');
    assert.equal(sql('SELECT claim_status,registered_artwork_id FROM artwork_media_publications'), 'registered|34');
    const before = sql('SELECT row_to_json(c) FROM artwork_media_catalog c');
    assert.equal(sql(asService(record(value))), 'ALREADY_RECORDED');
    assert.equal(sql('SELECT row_to_json(c) FROM artwork_media_catalog c'), before);
    assert.equal(sql(asService(claim({...value,id:crypto.randomUUID()}))), 'DUPLICATE_MEDIA');
  });

  await t.test('conflicting registration preserves evidence and blocks resumes without timeout', () => {
    const value = fixture(), foreign = fixture({creator:other,metadata:'https://storage.example/metadata/foreign.json'});
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    assert.equal(sql(asService(record(foreign))), 'RECORDED');
    assert.equal(sql(asService(claim(value))), 'PUBLICATION_BLOCKED');
    assert.equal(sql('SELECT count(*) FROM artwork_media_catalog'), '1');
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '1');
    assert.equal(sql(asService(record({...value,artwork:35,tx:'0x'+'ab'.repeat(32)}))), 'RECORDED');
    assert.equal(sql(asService(claim(value))), 'PUBLICATION_BLOCKED');
    assert.equal(sql(asService(claim({...value,id:crypto.randomUUID()}))), 'DUPLICATE_MEDIA');
    assert.equal(sql('SELECT count(*) FROM artwork_media_catalog'), '2');
  });

  await t.test('a second registration cannot masquerade as an idempotent publication retry', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    assert.equal(sql(asService(record(value))), 'RECORDED');
    assert.equal(sql(asService(record({...value,artwork:35,tx:'0x'+'ab'.repeat(32)}))), 'RECORDED');
    assert.equal(sql('SELECT claim_status,registered_artwork_id FROM artwork_media_publications'), 'conflict|34');
    assert.equal(sql(asService(claim(value))), 'PUBLICATION_BLOCKED');
  });

  await t.test('catalog-first concurrent registration blocks a waiting publication claim', async () => {
    const value = fixture();
    const pending = await held(asService(record(value)));
    const result = await parallel(asService(claim({...value,chain:'84532.0'})));
    await pending.finished;
    assert.equal(result, 'DUPLICATE_MEDIA');
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '0');
  });

  await t.test('claim-first concurrent foreign registration blocks subsequent resumes and new claims', async () => {
    const value = fixture();
    const pending = await held(asService(claim(value)));
    const result = await parallel(asService(record({...value,metadata:'https://storage.example/metadata/foreign.json'})));
    await pending.finished;
    assert.equal(result, 'RECORDED');
    assert.equal(sql(asService(claim(value))), 'PUBLICATION_BLOCKED');
    assert.equal(sql(asService(claim({...value,id:crypto.randomUUID()}))), 'DUPLICATE_MEDIA');
    assert.equal(sql('SELECT count(*) FROM artwork_media_catalog'), '1');
  });

  await t.test('conflicting evidence for the same artwork fails without overwriting previous facts', () => {
    const value = fixture();
    assert.equal(sql(asService(record(value))), 'RECORDED');
    const before = sql('SELECT row_to_json(c) FROM artwork_media_catalog c');
    for (const change of [{creator:other},{hash:otherDigest},{media:'https://storage.example/other.png'},
      {bytes:12},{metadata:'ipfs://other'},{tx:'0x'+'ab'.repeat(32)},{block:101},{log:1}]) {
      error(asService(record({...value,...change})), /MEDIA_IDENTITY_CONFLICT/);
    }
    assert.equal(sql('SELECT row_to_json(c) FROM artwork_media_catalog c'), before);
  });

  await t.test('a digest cannot acquire inconsistent measured lengths through the catalog', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    error(asService(record({...value,bytes:value.bytes+1})), /MEDIA_IDENTITY_CONFLICT/);
    assert.equal(sql('SELECT count(*) FROM artwork_media_catalog'), '0');
    assert.equal(sql(asService(claim(value))), 'RESUME');
  });

  await t.test('failure while reconciling rolls back both catalog insertion and claim mutation', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    sql(`CREATE FUNCTION _media_fail_update() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_RECONCILE_FAILURE'; END $f$;
      CREATE TRIGGER _media_fail_update BEFORE UPDATE ON artwork_media_publications
      FOR EACH ROW EXECUTE FUNCTION _media_fail_update()`);
    try {
      error(asService(record(value)), /FORCED_RECONCILE_FAILURE/);
      assert.equal(sql('SELECT count(*) FROM artwork_media_catalog'), '0');
      assert.equal(sql(asService(claim(value))), 'RESUME');
    } finally {sql('DROP TRIGGER _media_fail_update ON artwork_media_publications; DROP FUNCTION _media_fail_update()');}
  });

  await t.test('invalid deployment, identity and non-raw media paths fail before claims are stored', () => {
    const value = fixture();
    for (const change of [{id:null},{chain:0},{chain:'84532.5'},{chain:'1e78'},{core:null},{core:'0x0'},
      {creator:null},{hash:'wrong'},{path:`uploads/${other}/foreign.png`},{path:'https://storage.example/file.png'},
      {path:`uploads/${creator}/../foreign.png`},{path:`uploads/${creator}/a.png?width=1`},{bytes:0},{metadata:''}]) {
      error(asService(claim({...value,...change})), /INVALID_MEDIA_PUBLICATION/);
    }
    for (const change of [{chain:null},{artwork:0},{artwork:'1.5'},{core:null},{creator:null},{hash:null},
      {media:''},{bytes:0},{metadata:null},{tx:'not-a-hash'},{block:-1},{block:'1.5'},{log:-1}]) {
      error(asService(record({...value,...change})), /INVALID_MEDIA_IDENTITY/);
    }
    assert.equal(sql('SELECT count(*) FROM artwork_media_catalog'), '0');
    assert.equal(sql('SELECT count(*) FROM artwork_media_publications'), '0');
  });

  await t.test('fixed-snapshot transaction isolation fails closed rather than missing a concurrent catalog insert', () => {
    const value = fixture();
    for (const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
      error(`BEGIN ISOLATION LEVEL ${isolation}; ${asService(claim(value))}`, /MEDIA_IDENTITY_REQUIRES_READ_COMMITTED/);
      error(`BEGIN ISOLATION LEVEL ${isolation}; ${asService(record(value))}`, /MEDIA_IDENTITY_REQUIRES_READ_COMMITTED/);
    }
  });

  await t.test('browser roles cannot read or execute, service writes must use the RPCs', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    assert.equal(sql(asService('SELECT count(*) FROM artwork_media_publications')), '1');
    for (const role of ['anon','authenticated']) {
      for (const table of ['artwork_media_catalog','artwork_media_publications']) error(`SET ROLE ${role}; SELECT * FROM ${table}`, /permission denied/);
      error(`SET ROLE ${role}; ${claim(value)}`, /permission denied for function/);
      error(`SET ROLE ${role}; ${record(value)}`, /permission denied for function/);
    }
    for (const table of ['artwork_media_catalog','artwork_media_publications']) {
      error(asService(`DELETE FROM ${table}`), /permission denied/);
      error(asService(`TRUNCATE ${table}`), /permission denied/);
      assert.equal(sql(`SELECT has_table_privilege('service_role','public.${table}','INSERT,UPDATE,DELETE,TRUNCATE')`), 'f');
    }
    assert.equal(sql(`SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
      WHERE oid IN ('public.artwork_media_catalog'::regclass,'public.artwork_media_publications'::regclass)`), 't');
    assert.equal(sql(`SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema='public'
      AND routine_name IN ('claim_artwork_media_publication','record_artwork_media_identity') AND grantee='PUBLIC'`), '0');
  });

  await t.test('migration rerun preserves existing evidence and locked publication state', () => {
    const value = fixture();
    assert.equal(sql(asService(claim(value))), 'CLAIMED');
    assert.equal(sql(asService(record(value))), 'RECORDED');
    const before = sql('SELECT row_to_json(c) FROM artwork_media_catalog c');
    applyMigration();
    assert.equal(sql('SELECT row_to_json(c) FROM artwork_media_catalog c'), before);
    assert.equal(sql(asService(claim(value))), 'REGISTERED');
  });
});
