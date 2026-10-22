// Actual disposable PostgreSQL 17. No live upload, claim, signing or deployment.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {execFileSync, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const migration = fs.readFileSync(path.join(__dirname, '../sql/migrations/artwork_media_preparation.sql'), 'utf8');
const submissionMigration = fs.readFileSync(path.join(__dirname, '../sql/migrations/artwork_media_submission.sql'), 'utf8');
const container = `artsoul-prepare-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const creator = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
const core = '0x' + 'aa'.repeat(20), otherCore = '0x' + 'bb'.repeat(20);
const hash = 'cc'.repeat(32);
const q = value => value == null ? 'NULL' : "'" + String(value).replace(/'/g, "''") + "'";
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-qAt'];
const sql = query => execFileSync('docker', [...args, '-f', '-'],
  {input:query, encoding:'utf8', stdio:['pipe','pipe','pipe'], timeout:20000}).trim();
const parallel = async query => (await run('docker', [...args, '-c', query], {timeout:20000})).stdout.trim();
const asService = query => `SET ROLE service_role; ${query}`;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let docker = false;
try {docker = execFileSync('docker', ['version','--format','{{.Server.Os}}'],
  {encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:15000}).trim() === 'linux';} catch {}

function fixture(overrides = {}) {
  const value = {id:crypto.randomUUID(), chain:84532, core, creator, type:'image/png', bytes:25763, hash, ...overrides};
  const nonce = crypto.randomUUID();
  value.mediaPath ??= `uploads/${value.creator.toLowerCase()}/1700000000000-${nonce}-image.png`;
  value.metadataPath ??= `metadata/${value.creator.toLowerCase()}/1700000000000-${nonce}-metadata.json`;
  value.metadata ??= {name:'Ordinary artwork', creator:value.creator, media_url:`https://storage.example/${value.mediaPath}`};
  value.metadataUri ??= `https://storage.example/storage/v1/object/public/artworks/${value.metadataPath}`;
  return value;
}
function claim(value) {
  return `SELECT to_jsonb(public.claim_artwork_media_publication(${[
    value.id,value.chain,value.core,value.creator,value.hash,value.mediaPath,value.bytes,value.metadataUri
  ].map(q).join(',')}));`;
}
function begin(value) {
  return `SELECT public.begin_artwork_media_submission(${[
    value.id,value.chain,value.core,value.creator,value.metadataUri
  ].map(q).join(',')});`;
}
function report(value, tx = '0x'+'dd'.repeat(32)) {
  return `SELECT public.report_artwork_media_transaction(${[
    value.id,value.chain,value.core,value.creator,tx
  ].map(q).join(',')});`;
}
function claimed(value) {rpc(issue(value));rpc(prepare(value));assert.equal(rpc(claim(value)),'CLAIMED');}
function recordIdentity(value, artwork=1, creator=value.creator) {
  return `SELECT to_jsonb(public.record_artwork_media_identity(${[
    value.chain,value.core,artwork,creator,value.hash,'https://storage.example/'+value.mediaPath,
    value.bytes,value.metadataUri,'0x'+'dd'.repeat(32),123,0
  ].map(q).join(',')}));`;
}
function issue(value) {
  return `SELECT public.issue_artwork_media_upload(${[
    value.id, value.chain, value.core, value.creator, value.mediaPath, value.metadataPath, value.type, value.bytes
  ].map(q).join(',')});`;
}
function prepare(value) {
  return `SELECT public.prepare_artwork_media_upload(${[
    value.id, value.creator, value.hash, value.bytes, value.type
  ].map(q).join(',')},${value.metadataSql || q(JSON.stringify(value.metadata))}::JSONB);`;
}
const rpc = query => JSON.parse(sql(asService(query)));
function error(query, pattern) {
  let failed;
  try {sql(query);} catch (caught) {failed = String(caught.stderr || caught.message);}
  assert(failed, 'SQL must fail');
  assert.match(failed, pattern);
  return failed;
}
function applyMigration() {sql(migration);}

test('preparation migration uses explicit private privileges and existing upload limits', async () => {
  const policy = await import('../src/config/upload-policy.js');
  const types = [...migration.match(/declared_content_type IN \(([\s\S]+?)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(types.sort(), [...policy.ALLOWED_ARTWORK_MIME_TYPES].sort());
  assert.match(migration, new RegExp(`declared_size BETWEEN 1 AND ${policy.MAX_ARTWORK_UPLOAD_BYTES}`));
  assert.match(migration, new RegExp(`octet_length\\(metadata_json::TEXT\\) <= ${policy.MAX_METADATA_BYTES}`));
  assert.match(migration, /artwork_media_preparations FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.artwork_media_preparations FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT SELECT ON public\.artwork_media_preparations TO service_role/);
  assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) || []).length, 2);
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|TRUNCATE|expires_at|claim_artwork_media_publication|ALTER DEFAULT PRIVILEGES)\b/i);
});

test('upload issuance and metadata pinning use real PostgreSQL transactions',
  {skip:docker ? false : 'Docker unavailable; atomic behavior remains unverified'}, async t => {
  execFileSync('docker', ['run','-d','--name',container,'-e','POSTGRES_PASSWORD=postgres','-e','POSTGRES_DB=artsoul','postgres:17'],
    {stdio:'ignore',timeout:120000});
  t.after(() => execFileSync('docker', ['rm','-f',container], {stdio:'ignore',timeout:30000}));
  let ready = false;
  for(let attempt=0;attempt<60;attempt++) {
    try {sql('SELECT 1;'); await delay(300); sql('SELECT 1;'); ready=true; break;} catch {await delay(500);}
  }
  assert(ready, 'disposable PostgreSQL is ready');
  // No convenience grants: the migration must establish service access itself.
  sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  applyMigration();
  sql(fs.readFileSync(path.join(__dirname, '../sql/migrations/artwork_media_identity.sql'), 'utf8'));
  sql(submissionMigration);
  t.beforeEach(() => sql('TRUNCATE public.artwork_media_preparations, public.artwork_media_publications, public.artwork_media_catalog;'));

  await t.test('issuance returns owned fixed paths with no measured or metadata fields pinned', () => {
    const value = fixture(), row = rpc(issue(value));
    assert.equal(row.publication_id, value.id);
    assert.equal(row.chain_id, value.chain);
    assert.equal(row.core_address, value.core);
    assert.equal(row.creator_wallet, value.creator);
    assert.equal(row.media_path, value.mediaPath);
    assert.equal(row.metadata_path, value.metadataPath);
    assert.equal(row.declared_content_type, value.type);
    assert.equal(row.declared_size, value.bytes);
    assert.ok(row.created_at);
    for(const field of ['media_sha256','byte_size','content_type','metadata_json']) assert.equal(row[field], null);
  });

  await t.test('issuance retries ignore new path suggestions and preserve the original complete row', () => {
    const value = fixture(), first = rpc(issue(value)), replacement = fixture();
    assert.deepEqual(rpc(issue({...value,mediaPath:replacement.mediaPath,metadataPath:replacement.metadataPath})), first);
    assert.deepEqual(rpc(issue({...value,mediaPath:null,metadataPath:'ignored retry suggestion',chain:'84532.0',
      core:core.toUpperCase().replace('0X','0x'),type:'IMAGE/PNG'})), first);
    assert.equal(sql('SELECT count(*) FROM artwork_media_preparations;'), '1');
  });

  await t.test('concurrent identical issuance with different suggested paths returns one winner to both callers', async () => {
    const one = fixture(), two = fixture({id:one.id});
    const rows = await Promise.all([parallel(asService(issue(one))),parallel(asService(issue(two)))]);
    assert.deepEqual(JSON.parse(rows[0]), JSON.parse(rows[1]));
    assert.ok([one.mediaPath,two.mediaPath].includes(JSON.parse(rows[0]).media_path));
    assert.equal(sql('SELECT count(*) FROM artwork_media_preparations;'), '1');
  });

  await t.test('same UUID cannot change owner, deployment, declared MIME or declared size', () => {
    const value = fixture(), first = rpc(issue(value));
    for (const change of [{creator:other},{chain:8453},{core:otherCore},{type:'image/webp'},{bytes:1}]) {
      const failure = error(asService(issue({...value,...change})), /MEDIA_UPLOAD_MISMATCH/);
      assert.ok(!failure.includes(value.mediaPath) && !failure.includes(value.id));
    }
    assert.deepEqual(rpc(issue(value)), first);
  });

  await t.test('concurrent mismatched UUID requests cannot overwrite the winning owner', async () => {
    const one = fixture(), two = fixture({id:one.id,creator:other});
    const results = await Promise.allSettled([parallel(asService(issue(one))),parallel(asService(issue(two)))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.stderr, /MEDIA_UPLOAD_MISMATCH/);
    assert.equal(sql('SELECT count(*) FROM artwork_media_preparations;'), '1');
  });

  await t.test('media and metadata paths cannot be reused by another publication UUID', () => {
    const value = fixture(); rpc(issue(value));
    const replacement = fixture();
    for (const change of [{mediaPath:value.mediaPath},{metadataPath:value.metadataPath}]) {
      const failure = error(asService(issue({...replacement,...change})), /MEDIA_UPLOAD_PATH_CONFLICT/);
      assert.ok(!failure.includes(value.id) && !failure.includes(value.creator));
    }
    assert.equal(sql('SELECT count(*) FROM artwork_media_preparations;'), '1');
  });

  await t.test('initial issuance enforces wallet-owned original paths and exact integer limits', () => {
    const value = fixture();
    for (const change of [{id:null},{chain:0},{chain:'84532.5'},{chain:'1e78'},{core:'0x0'},
      {core:'0x'+'00'.repeat(20)},{creator:'0x'+'00'.repeat(20)},{bytes:0},{bytes:52428801},{bytes:'1.5'},
      {type:'application/json'},{type:'text/html'},{mediaPath:null},{metadataPath:null},
      {mediaPath:value.mediaPath.replace(creator,other)},{metadataPath:value.metadataPath.replace(creator,other)},
      {mediaPath:`https://storage.example/${value.mediaPath}`},{mediaPath:value.mediaPath+'?width=20'},
      {mediaPath:value.mediaPath+'/../other.png'},{mediaPath:value.mediaPath.replace('image.png','%2e%2e')},
      {metadataPath:value.metadataPath.replace('.json','.png')},{mediaPath:value.mediaPath+'\n'},
      {metadataPath:value.metadataPath+'\n'}]) error(asService(issue({...value,...change})), /INVALID_MEDIA_UPLOAD/);
    assert.equal(sql('SELECT count(*) FROM artwork_media_preparations;'), '0');
  });

  await t.test('every supported MIME and the existing maximum filename and size remain valid', async () => {
    const policy = await import('../src/config/upload-policy.js');
    for (const type of policy.ALLOWED_ARTWORK_MIME_TYPES) {
      const value = fixture({type,bytes:policy.MAX_ARTWORK_UPLOAD_BYTES});
      value.mediaPath = value.mediaPath.replace('image.png','a'.repeat(96)+'.webp');
      value.metadataPath = value.metadataPath.replace('metadata.json','a'.repeat(96)+'.json');
      assert.equal(rpc(issue(value)).declared_content_type, type);
    }
  });

  await t.test('preparation requires issuance and the authenticated owner', () => {
    const value = fixture();
    error(asService(prepare(value)), /MEDIA_UPLOAD_NOT_FOUND/);
    const first = rpc(issue(value));
    const failure = error(asService(prepare({...value,creator:other})), /MEDIA_UPLOAD_MISMATCH/);
    assert.ok(!failure.includes(value.metadataPath) && !failure.includes(value.creator));
    assert.deepEqual(rpc(issue(value)), first);
  });

  await t.test('measured size and MIME must equal the issued declaration', () => {
    const value = fixture(), first = rpc(issue(value));
    for (const change of [{bytes:1},{type:'image/webp'},{type:'text/html'}]) {
      error(asService(prepare({...value,...change})), /MEDIA_PREPARATION_MISMATCH/);
    }
    assert.deepEqual(rpc(issue(value)), first);
  });

  await t.test('one complete pin is immutable and JSONB-equivalent retries return the same row', () => {
    const value = fixture(); rpc(issue(value));
    const pinned = rpc(prepare(value));
    assert.equal(pinned.media_sha256, value.hash);
    assert.equal(pinned.byte_size, value.bytes);
    assert.equal(pinned.content_type, value.type);
    assert.deepEqual(pinned.metadata_json, value.metadata);
    const reordered = Object.fromEntries(Object.entries(value.metadata).reverse());
    assert.deepEqual(rpc(prepare({...value,metadata:reordered,hash:value.hash.toUpperCase(),type:'IMAGE/PNG'})), pinned);
    assert.deepEqual(rpc(issue({...value,mediaPath:null,metadataPath:null})), pinned);
    for (const change of [{hash:'dd'.repeat(32)},{metadata:{...value.metadata,name:'Changed title'}},
      {metadata:{...value.metadata,properties:{creator:other}}}]) {
      error(asService(prepare({...value,...change})), /MEDIA_PREPARATION_MISMATCH/);
    }
    assert.deepEqual(rpc(prepare(value)), pinned);
  });

  await t.test('concurrent identical preparation pins once, changed metadata cannot race over it', async () => {
    const value = fixture(); rpc(issue(value));
    const identical = await Promise.all([parallel(asService(prepare(value))),parallel(asService(prepare(value)))]);
    assert.deepEqual(JSON.parse(identical[0]), JSON.parse(identical[1]));
    sql('TRUNCATE artwork_media_preparations;'); rpc(issue(value));
    const different = {...value,metadata:{...value.metadata,name:'Different title'}};
    const results = await Promise.allSettled([parallel(asService(prepare(value))),parallel(asService(prepare(different)))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.stderr, /MEDIA_PREPARATION_MISMATCH/);
    assert.equal(sql('SELECT count(*) FROM artwork_media_preparations WHERE media_sha256 IS NOT NULL;'), '1');
  });

  await t.test('metadata must be an object within the existing UTF-8 storage bound', () => {
    const value = fixture(); rpc(issue(value));
    for (const change of [{hash:null},{hash:'bad'},{bytes:'1.5'},{metadataSql:'NULL'},
      {metadata:null},{metadata:[]},{metadata:'text'},{metadataSql:"jsonb_build_object('a',repeat('x',262145))"},
      {metadataSql:"jsonb_build_object('a',repeat('é',131073))"}]) {
      error(asService(prepare({...value,...change})), /INVALID_MEDIA_PREPARATION/);
    }
    assert.equal(sql('SELECT media_sha256 IS NULL FROM artwork_media_preparations;'), 't');
    // PostgreSQL serializes this object as {"a": "..."}, adding nine bytes.
    const limit = {...value,metadataSql:"jsonb_build_object('a',repeat('x',262144-9))"};
    rpc(prepare(limit));
    assert.equal(sql('SELECT octet_length(metadata_json::TEXT) FROM artwork_media_preparations;'), '262144');
  });

  await t.test('table constraints prevent partially pinned rows even for a database owner', () => {
    const value = fixture(); rpc(issue(value));
    error(`UPDATE artwork_media_preparations SET media_sha256=${q(hash)};`, /violates check constraint/);
    error(`UPDATE artwork_media_preparations SET media_sha256=${q(hash)},byte_size=1,content_type='image/png',metadata_json='{}';`, /violates check constraint/);
    assert.equal(sql('SELECT num_nonnulls(media_sha256,byte_size,content_type,metadata_json) FROM artwork_media_preparations;'), '0');
  });

  await t.test('a failed database write leaves the original unprepared issuance intact', () => {
    const value = fixture(), first = rpc(issue(value));
    sql(`CREATE FUNCTION _prepare_fail_write() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_PREPARATION_FAILURE'; END $f$;
      CREATE TRIGGER _prepare_fail_write BEFORE UPDATE ON artwork_media_preparations
      FOR EACH ROW EXECUTE FUNCTION _prepare_fail_write();`);
    try {
      error(asService(prepare(value)), /FORCED_PREPARATION_FAILURE/);
      assert.deepEqual(rpc(issue(value)), first);
    } finally {sql('DROP TRIGGER _prepare_fail_write ON artwork_media_preparations; DROP FUNCTION _prepare_fail_write();');}
  });

  await t.test('fixed-snapshot transactions fail closed for both RPCs', () => {
    const value = fixture();
    for (const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
      error(`BEGIN ISOLATION LEVEL ${isolation}; ${asService(issue(value))}`, /MEDIA_IDENTITY_REQUIRES_READ_COMMITTED/);
      error(`BEGIN ISOLATION LEVEL ${isolation}; ${asService(prepare(value))}`, /MEDIA_IDENTITY_REQUIRES_READ_COMMITTED/);
    }
  });

  await t.test('forced RLS and explicit grants allow service reads and RPCs but deny direct writes', () => {
    const value = fixture(); rpc(issue(value));
    assert.equal(sql(asService('SELECT count(*) FROM artwork_media_preparations;')), '1');
    for (const role of ['anon','authenticated']) {
      error(`SET ROLE ${role}; SELECT * FROM artwork_media_preparations;`, /permission denied/);
      error(`SET ROLE ${role}; ${issue(value)}`, /permission denied for function/);
      error(`SET ROLE ${role}; ${prepare(value)}`, /permission denied for function/);
    }
    for (const statement of ['DELETE FROM artwork_media_preparations','TRUNCATE artwork_media_preparations',
      "UPDATE artwork_media_preparations SET metadata_json='{}'"]) error(asService(statement+';'), /permission denied/);
    assert.equal(sql("SELECT has_table_privilege('service_role','public.artwork_media_preparations','INSERT,UPDATE,DELETE,TRUNCATE');"), 'f');
    assert.equal(sql("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.artwork_media_preparations'::regclass;"), 't');
    assert.equal(sql(`SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema='public'
      AND routine_name IN ('issue_artwork_media_upload','prepare_artwork_media_upload') AND grantee='PUBLIC';`), '0');
  });

  await t.test('migration rerun preserves prepared evidence and removes broad inherited grants', () => {
    const value = fixture(); rpc(issue(value)); const pinned = rpc(prepare(value));
    sql('GRANT ALL ON artwork_media_preparations TO anon,authenticated,service_role;');
    applyMigration();
    assert.deepEqual(rpc(prepare(value)), pinned);
    error('SET ROLE anon; SELECT * FROM artwork_media_preparations;', /permission denied/);
    error(asService('DELETE FROM artwork_media_preparations;'), /permission denied/);
  });

  await t.test('submission begins once before any hash, including concurrent and lost-response retries', async () => {
    const value=fixture();claimed(value);
    const results=(await Promise.all([parallel(asService(begin(value))),parallel(asService(begin(value)))])).map(JSON.parse);
    assert.deepEqual(results.map(row=>row.submission_created).sort(),[false,true]);
    assert.equal(results[0].submission_started_at,results[1].submission_started_at);
    const repeated=rpc(begin(value));
    assert.equal(repeated.submission_created,false);assert.equal(repeated.reported_transaction_hash,null);
    assert.ok(repeated.submission_started_at);assert.equal(repeated.claim_status,'claimed');
    assert.equal(repeated.registered_artwork_id,null);
    assert.equal(sql('SELECT count(*) FROM artwork_media_catalog;'),'0');
    assert.equal(rpc(claim({...value,id:crypto.randomUUID()})),'DUPLICATE_MEDIA');
  });

  await t.test('submission requires the exact owned deployment, claim and immutable preparation', () => {
    const value=fixture();
    error(asService(begin(value)),/MEDIA_PUBLICATION_NOT_FOUND/);
    rpc(issue(value));rpc(prepare(value));
    error(asService(begin(value)),/MEDIA_PUBLICATION_NOT_FOUND/);
    rpc(claim(value));
    for(const change of [{creator:other},{chain:8453},{core:otherCore},{metadataUri:'https://other.example/wrong.json'}]) {
      const failure=error(asService(begin({...value,...change})),/MEDIA_PUBLICATION_NOT_FOUND/);
      assert.ok(!failure.includes(value.creator) && !failure.includes(value.metadataUri));
    }
    sql('TRUNCATE artwork_media_preparations;');
    error(asService(begin(value)),/MEDIA_PREPARATION_MISMATCH/);
    rpc(issue(value));
    error(asService(begin(value)),/MEDIA_PREPARATION_MISMATCH/);
    rpc(prepare({...value,hash:'ee'.repeat(32)}));
    error(asService(begin(value)),/MEDIA_PREPARATION_MISMATCH/);
    assert.equal(sql('SELECT submission_started_at IS NULL FROM artwork_media_publications;'),'t');
  });

  await t.test('an indexed conflict blocks a first submission and never resets an earlier attempt', () => {
    const value=fixture();claimed(value);
    sql("UPDATE artwork_media_publications SET claim_status='conflict';");
    error(asService(begin(value)),/PUBLICATION_BLOCKED/);
    sql("UPDATE artwork_media_publications SET claim_status='claimed';");
    const started=rpc(begin(value));
    sql("UPDATE artwork_media_publications SET claim_status='conflict';");
    const repeated=rpc(begin(value));
    assert.equal(repeated.submission_created,false);assert.equal(repeated.claim_status,'conflict');
    assert.equal(repeated.submission_started_at,started.submission_started_at);
    assert.equal(rpc(report(value)).claim_status,'conflict','late hash is evidence, not a state override');
  });

  await t.test('actual identity reconciliation preserves the journal through registration and later conflict', () => {
    const already=fixture();claimed(already);assert.equal(rpc(recordIdentity(already)),'RECORDED');
    error(asService(begin(already)),/PUBLICATION_BLOCKED/);
    const value=fixture({hash:crypto.randomBytes(32).toString('hex')});claimed(value);
    const started=rpc(begin(value)),reported=rpc(report(value));
    assert.equal(rpc(recordIdentity(value,2)),'RECORDED');
    const registered=rpc(begin(value));
    assert.equal(registered.claim_status,'registered');assert.equal(registered.registered_artwork_id,2);
    assert.equal(registered.submission_created,false);assert.equal(registered.submission_started_at,started.submission_started_at);
    assert.equal(registered.reported_transaction_hash,reported.reported_transaction_hash);
    assert.equal(rpc(recordIdentity(value,3,other)),'RECORDED');
    const conflict=rpc(begin(value));
    assert.equal(conflict.claim_status,'conflict');assert.equal(conflict.submission_created,false);
    assert.equal(conflict.submission_started_at,started.submission_started_at);
    assert.equal(conflict.reported_transaction_hash,reported.reported_transaction_hash);
    assert.equal(rpc(report(value)).claim_status,'conflict');
  });

  await t.test('begin rechecks a conflict that commits while waiting for the indexer hash lock', async () => {
    const value=fixture();claimed(value);
    const key=`artsoul-media-hash:${value.chain}:${value.core}:${value.hash}`;
    const writer=parallel(`BEGIN; SET application_name='submission-conflict-fixture';
      SELECT pg_advisory_xact_lock(hashtextextended(${q(key)},0));
      UPDATE artwork_media_publications SET claim_status='conflict'; SELECT pg_sleep(1); COMMIT;`);
    try {
      let sleeping=false;
      for(let i=0;i<30;i++) {
        if(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='submission-conflict-fixture' AND wait_event='PgSleep';") === '1') {sleeping=true;break;}
        await delay(20);
      }
      assert(sleeping,'conflict transaction holds the shared hash lock');
      await assert.rejects(parallel(asService(begin(value))),e=>/PUBLICATION_BLOCKED/.test(e.stderr));
    } finally {await writer;}
    assert.equal(sql('SELECT submission_started_at IS NULL FROM artwork_media_publications;'),'t');
  });

  await t.test('reporting a hash requires an attempt and cannot change ownership or confirm an artwork', async () => {
    const value=fixture();claimed(value);
    error(asService(report(value)),/MEDIA_SUBMISSION_NOT_STARTED/);
    const started=rpc(begin(value));
    for(const change of [{creator:other},{chain:8453},{core:otherCore}]) {
      error(asService(report({...value,...change})),/MEDIA_PUBLICATION_NOT_FOUND/);
    }
    for(const tx of [null,'bad','0x'+'ee'.repeat(31),'0x'+'ee'.repeat(32)+'\n']) {
      error(asService(report(value,tx)),/INVALID_TRANSACTION_HASH/);
    }
    const results=(await Promise.all([parallel(asService(report(value))),parallel(asService(report(value)))])).map(JSON.parse);
    assert.deepEqual(results[0],results[1]);
    assert.equal(results[0].reported_transaction_hash,'0x'+'dd'.repeat(32));
    assert.equal(results[0].submission_started_at,started.submission_started_at);
    assert.equal(results[0].claim_status,'claimed');assert.equal(results[0].registered_artwork_id,null);
    assert.equal(sql('SELECT count(*) FROM artwork_media_catalog;'),'0');
    assert.deepEqual(rpc(report(value,'0x'+'DD'.repeat(32))),results[0]);
    error(asService(report(value,'0x'+'ee'.repeat(32))),/MEDIA_SUBMISSION_HASH_CONFLICT/);
    assert.equal(rpc(begin(value)).submission_created,false);
  });

  await t.test('two different reported hashes cannot overwrite one another concurrently', async () => {
    const value=fixture();claimed(value);rpc(begin(value));
    const results=await Promise.allSettled([parallel(asService(report(value))),parallel(asService(report(value,'0x'+'ee'.repeat(32))))]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.match(results.find(result=>result.status==='rejected').reason.stderr,/MEDIA_SUBMISSION_HASH_CONFLICT/);
    assert.equal(rpc(begin(value)).submission_created,false);
  });

  await t.test('failed begin is atomic and a failed hash write preserves the no-hash attempt', () => {
    const value=fixture();claimed(value);
    const install=()=>sql(`CREATE FUNCTION _submission_fail_write() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_SUBMISSION_FAILURE'; END $f$;
      CREATE TRIGGER _submission_fail_write BEFORE UPDATE ON artwork_media_publications
      FOR EACH ROW EXECUTE FUNCTION _submission_fail_write();`);
    const remove=()=>sql('DROP TRIGGER _submission_fail_write ON artwork_media_publications; DROP FUNCTION _submission_fail_write();');
    install();
    try {error(asService(begin(value)),/FORCED_SUBMISSION_FAILURE/);} finally {remove();}
    assert.equal(sql('SELECT submission_started_at IS NULL FROM artwork_media_publications;'),'t');
    const started=rpc(begin(value));install();
    try {error(asService(report(value)),/FORCED_SUBMISSION_FAILURE/);} finally {remove();}
    const repeated=rpc(begin(value));
    assert.equal(repeated.submission_created,false);assert.equal(repeated.reported_transaction_hash,null);
    assert.equal(repeated.submission_started_at,started.submission_started_at);
  });

  await t.test('journal remains private and migration retries preserve a recorded attempt', () => {
    const value=fixture();claimed(value);rpc(begin(value));const recorded=rpc(report(value));
    sql(submissionMigration);assert.deepEqual(rpc(report(value)),recorded);
    for(const role of ['anon','authenticated']) {
      error(`SET ROLE ${role}; SELECT submission_started_at FROM artwork_media_publications;`,/permission denied/);
      for(const query of [begin(value),report(value)]) error(`SET ROLE ${role}; ${query}`,/permission denied for function/);
    }
    for(const query of ['DELETE FROM artwork_media_publications;','TRUNCATE artwork_media_publications;',
      'UPDATE artwork_media_publications SET submission_started_at=NULL, reported_transaction_hash=NULL;']) {
      error(asService(query),/permission denied/);
    }
    for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
      for(const query of [begin(value),report(value)]) {
        error(`BEGIN ISOLATION LEVEL ${isolation}; ${asService(query)}`,/MEDIA_IDENTITY_REQUIRES_READ_COMMITTED/);
      }
    }
    error('UPDATE artwork_media_publications SET submission_started_at=NULL;',/violates check constraint/);
    assert.equal(sql("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.artwork_media_publications'::regclass;"),'t');
  });

  await t.test('authenticated API prepares and resumes through actual PostgreSQL RPCs without submission permission', async () => {
    const {default:handler} = await import('../src/api/routes/upload/publication.js');
    const {setWalletSession} = await import('../src/api/backend.js');
    const env = {SESSION_SECRET:'private-preparation-integration-test',SUPABASE_URL:'https://storage.example',
      SUPABASE_SERVICE_ROLE_KEY:`x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`,
      ARTSOUL_MEDIA_PREPARATION_ENABLED:'true',ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:core};
    const previous = Object.fromEntries(Object.keys(env).map(key => [key,process.env[key]]));
    const originalFetch = globalThis.fetch;
    const id = crypto.randomUUID(), bytes = Buffer.from('actual stored artwork bytes');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const objects = new Map(), calls = [];
    const response = () => ({headers:{},statusCode:200,body:null,
      setHeader(key,value){this.headers[key]=value;},status(value){this.statusCode=value;return this;},
      json(value){this.body=value;return this;},end(){}});
    const call = async (body, owner=creator) => {
      const signed=response(), result=response();setWalletSession(signed,owner);
      await handler({method:'POST',headers:{'content-type':'application/json',
        cookie:signed.headers['Set-Cookie'].split(';')[0]},body},result);
      assert.equal(result.headers['Cache-Control'],'private, no-store');
      return result;
    };
    const signatures = {
      issue_artwork_media_upload:['p_publication_id','p_chain_id','p_core_address','p_creator_wallet',
        'p_media_path','p_metadata_path','p_content_type','p_declared_size'],
      prepare_artwork_media_upload:['p_publication_id','p_creator_wallet','p_media_sha256','p_byte_size',
        'p_content_type','p_metadata_json'],
      claim_artwork_media_publication:['p_publication_id','p_chain_id','p_core_address','p_creator_wallet',
        'p_media_sha256','p_media_path','p_byte_size','p_metadata_uri'],
      begin_artwork_media_submission:['p_publication_id','p_chain_id','p_core_address','p_creator_wallet','p_metadata_uri'],
      report_artwork_media_transaction:['p_publication_id','p_chain_id','p_core_address','p_creator_wallet','p_transaction_hash']
    };
    Object.assign(process.env,env);
    globalThis.fetch = async (raw, init={}) => {
      const url = new URL(String(raw)), body = init.body ? JSON.parse(init.body) : undefined;
      calls.push(url.pathname);
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.slice('/rest/v1/rpc/'.length);
        assert.ok(Object.hasOwn(signatures,name));
        assert.deepEqual(Object.keys(body).sort(),[...signatures[name]].sort());
        const parameters = signatures[name].map(key => `${key} => ` +
          (key === 'p_metadata_json' ? q(JSON.stringify(body[key]))+'::JSONB' : q(body[key])));
        try {
          return Response.json(rpc(`SELECT to_jsonb(public.${name}(${parameters.join(',')}));`));
        } catch (caught) {
          const message = String(caught.stderr).match(/ERROR:\s+([A-Z_]+)/)?.[1];
          assert.ok(message,'database errors have a stable application code');
          return Response.json({code:'P0001',message},{status:400});
        }
      }
      if (url.pathname === '/rest/v1/artwork_media_preparations') {
        assert.equal(url.searchParams.get('select'),'*');assert.equal(url.searchParams.get('limit'),'1');
        const publication = url.searchParams.get('publication_id'), owner = url.searchParams.get('creator_wallet');
        assert.match(publication,/^eq\.[0-9a-f-]{36}$/);assert.match(owner,/^eq\.0x[0-9a-f]{40}$/);
        return Response.json(rpc(`SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::JSONB)
          FROM public.artwork_media_preparations p WHERE publication_id=${q(publication.slice(3))}
          AND creator_wallet=${q(owner.slice(3))};`));
      }
      if (url.pathname === '/rest/v1/artwork_media_publications') {
        assert.equal(url.searchParams.get('limit'),'1');
        const publication=url.searchParams.get('publication_id'),owner=url.searchParams.get('creator_wallet');
        assert.match(publication,/^eq\.[0-9a-f-]{36}$/);assert.match(owner,/^eq\.0x[0-9a-f]{40}$/);
        assert.equal(url.searchParams.get('chain_id'),'eq.84532');
        assert.equal(url.searchParams.get('core_address'),'eq.'+core);
        return Response.json(rpc(`SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::JSONB)
          FROM public.artwork_media_publications p WHERE publication_id=${q(publication.slice(3))}
          AND creator_wallet=${q(owner.slice(3))} AND chain_id=84532 AND core_address=${q(core)};`));
      }
      const signing = '/storage/v1/object/upload/sign/artworks/';
      if (url.pathname.startsWith(signing)) {
        assert.equal(init.headers['x-upsert'],'false');
        const objectPath=decodeURIComponent(url.pathname.slice(signing.length));
        if (objects.has(objectPath)) return Response.json({message:'The resource already exists'},{status:409});
        return Response.json({url:'/object/upload/sign/artworks/'+objectPath+'?token=fixture-only'});
      }
      const upload = '/storage/v1/object/artworks/', download = '/storage/v1/object/public/artworks/';
      if (url.pathname.startsWith(upload)) {
        assert.equal(init.method,'POST');assert.equal(init.headers['x-upsert'],'false');
        const objectPath=decodeURIComponent(url.pathname.slice(upload.length));
        assert.ok(objectPath.startsWith('metadata/'),'only metadata is written by the server');
        if (objects.has(objectPath)) return Response.json({message:'The resource already exists'},{status:409});
        objects.set(objectPath,{data:Buffer.from(JSON.stringify(body)),type:'application/json'});
        return Response.json({Key:objectPath});
      }
      if (url.pathname.startsWith(download)) {
        assert.equal(init.redirect,'error');
        const stored=objects.get(decodeURIComponent(url.pathname.slice(download.length)));
        return stored ? new Response(stored.data,{headers:{'content-type':stored.type}}) : new Response('',{status:404});
      }
      assert.fail('Unexpected integration HTTP request: '+url.pathname);
    };
    try {
      const input={action:'issue',publication_id:id,file_name:'first.png',content_type:'image/png',size:bytes.length};
      const first=await call(input), again=await call({...input,file_name:'another.png'});
      assert.equal(first.statusCode,200);assert.equal(again.statusCode,200);
      assert.equal(first.body.upload.path,again.body.upload.path);assert.equal(first.body.can_submit,false);
      const issued=rpc(`SELECT to_jsonb(p) FROM artwork_media_preparations p WHERE publication_id=${q(id)};`);
      const metadataPath=issued.metadata_path;
      objects.set(first.body.upload.path,{data:bytes,type:'image/png'});
      const uploaded=await call({...input,file_name:'retry-after-upload.png'});
      assert.equal(uploaded.statusCode,200,JSON.stringify(uploaded.body));
      assert.equal(uploaded.body.upload_complete,true);assert.equal(uploaded.body.upload,null);
      assert.equal(uploaded.body.media.path,issued.media_path);assert.equal(uploaded.body.media.sha256,digest);
      assert.equal(uploaded.body.can_submit,false);
      const vm=require('node:vm'), context=vm.createContext({window:{},console:{log(){}},btoa:value=>Buffer.from(value).toString('base64')});
      vm.runInContext(fs.readFileSync(path.join(__dirname,'../ipfs-client.js'),'utf8'),context);
      const metadata=JSON.parse(JSON.stringify(context.window.IPFSClient.createMetadata({
        title:'An artist\'s work 🎨',description:'Exact metadata survives JSONB storage.',creator,
        imageUrl:first.body.upload.public_url,mediaType:'image/png',creatorValue:'0.0001',
        createdAt:'2026-10-23T00:00:00.000Z'})));
      const prepared=await call({action:'prepare',publication_id:id,metadata});
      assert.equal(prepared.statusCode,200,JSON.stringify(prepared.body));
      assert.equal(prepared.body.claim_status,'CLAIMED');assert.equal(prepared.body.media_sha256,digest);
      assert.equal(prepared.body.can_submit,false);
      const repeated=await call({action:'prepare',publication_id:id,metadata});
      assert.equal(repeated.statusCode,200);assert.equal(repeated.body.claim_status,'RESUME');
      assert.equal(repeated.body.can_submit,false);assert.equal(repeated.body.media_sha256,digest);
      assert.equal(repeated.body.metadata_uri,prepared.body.metadata_uri);
      const pinned=rpc(`SELECT to_jsonb(p) FROM artwork_media_preparations p WHERE publication_id=${q(id)};`);
      assert.equal(pinned.media_path,issued.media_path);assert.equal(pinned.metadata_path,metadataPath);
      assert.equal(pinned.media_sha256,digest);assert.equal(pinned.byte_size,bytes.length);
      assert.deepEqual(pinned.metadata_json,metadata);
      const writes=calls.filter(value=>value.startsWith('/storage/v1/object/artworks/')).length;
      const conflict=await call({action:'prepare',publication_id:id,metadata:{...metadata,name:'Changed after pin'}});
      assert.equal(conflict.statusCode,409);assert.equal(conflict.body.error,'MEDIA_PREPARATION_MISMATCH');
      assert.equal(calls.filter(value=>value.startsWith('/storage/v1/object/artworks/')).length,writes);
      const reads=calls.length;
      const foreign=await call({action:'prepare',publication_id:id,metadata},other);
      assert.equal(foreign.statusCode,404);assert.deepEqual(foreign.body,{error:'MEDIA_UPLOAD_NOT_FOUND'});
      assert.equal(calls.length,reads+1,'foreign operation stops before reading media or metadata');
      assert.equal(sql('SELECT count(*) FROM artwork_media_publications;'),'1');
      assert.deepEqual(JSON.parse(objects.get(metadataPath).data.toString()),metadata);
      const status=await call({action:'status',publication_id:id});
      assert.equal(status.statusCode,200);assert.equal(status.body.submission_started_at,null);
      assert.equal(status.body.can_submit,false);assert.equal(status.body.media_path,undefined);
      const tx='0x'+'dd'.repeat(32);
      assert.equal((await call({action:'report-transaction',publication_id:id,transaction_hash:tx})).body.error,'MEDIA_SUBMISSION_NOT_STARTED');
      const started=await call({action:'begin',publication_id:id,creator_wallet:other,chain_id:1,core_address:other,
        metadata_uri:'https://attacker.example/other.json'});
      assert.equal(started.statusCode,200,JSON.stringify(started.body));
      assert.equal(started.body.submission_created,true);assert.equal(started.body.can_submit,false);
      assert.equal(started.body.metadata_uri,prepared.body.metadata_uri);
      const retry=await call({action:'begin',publication_id:id});
      assert.equal(retry.statusCode,200);assert.equal(retry.body.submission_created,false);
      assert.equal(retry.body.submission_started_at,started.body.submission_started_at);
      assert.equal(retry.body.reported_transaction_hash,null);
      const reported=await call({action:'report-transaction',publication_id:id,transaction_hash:tx});
      assert.equal(reported.statusCode,200);assert.equal(reported.body.reported_transaction_hash,tx);
      assert.equal(reported.body.claim_status,'claimed');assert.equal(reported.body.can_submit,false);
      assert.deepEqual((await call({action:'report-transaction',publication_id:id,transaction_hash:tx})).body,reported.body);
      assert.equal((await call({action:'report-transaction',publication_id:id,transaction_hash:'0x'+'ee'.repeat(32)})).body.error,'MEDIA_SUBMISSION_HASH_CONFLICT');
      const recovered=await call({action:'status',publication_id:id});
      assert.deepEqual(recovered.body,reported.body);
      for(const action of ['begin','report-transaction','status']) {
        const foreign=await call({action,publication_id:id,transaction_hash:tx},other);
        assert.equal(foreign.statusCode,404);assert.ok(!JSON.stringify(foreign.body).includes(id));
      }
      assert.equal(sql('SELECT count(*) FROM artwork_media_catalog;'),'0','a reported hash never becomes verified registration');
    } finally {
      globalThis.fetch=originalFetch;
      for(const [key,value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key]=value;
    }
  });
});
