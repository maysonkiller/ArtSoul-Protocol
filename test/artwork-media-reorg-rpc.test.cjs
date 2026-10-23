// Disposable PostgreSQL 17 only. No live database, RPC, wallet or deployment.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {execFileSync} = require('node:child_process');
const {Pool} = require('pg');

const root = path.resolve(__dirname, '..');
const container = `artsoul-media-reorg-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const creator = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
const core = '0x' + 'aa'.repeat(20), otherCore = '0x' + 'bb'.repeat(20);
const reportedHash = '0x' + 'ee'.repeat(32);
const projectionTables = ['v41_genesis_holders', 'v41_project_eligibility', 'v41_resale_history',
  'v41_resale_listings', 'v41_floor_history', 'v41_settlements', 'v41_auction_endings',
  'v41_auction_extensions', 'v41_bid_withdrawals', 'v41_bids', 'v41_auctions', 'v41_artworks'];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const migration = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function docker(...args) {
  return execFileSync('docker', args, {encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:30000}).trim();
}
let available = false;
try {available = docker('version', '--format', '{{.Server.Os}}') === 'linux';} catch {}

function fixture(overrides = {}) {
  const value = {id:crypto.randomUUID(), chain:84532, core, creator, bytes:25763,
    hash:'cc'.repeat(32), ...overrides};
  const nonce = crypto.randomUUID();
  value.mediaPath = `uploads/${value.creator}/1700000000000-${nonce}-image.png`;
  value.metadataPath = `metadata/${value.creator}/1700000000000-${nonce}-metadata.json`;
  value.mediaUri = `https://storage.example/storage/v1/object/public/artworks/${value.mediaPath}`;
  value.metadataUri = `https://storage.example/storage/v1/object/public/artworks/${value.metadataPath}`;
  value.metadata = {name:'Original artwork', creator:value.creator, media_url:value.mediaUri};
  return value;
}
function evidence(value, {artwork='1', block='123', anchor='200'} = {}) {
  const blockHash = '0x' + 'bb'.repeat(32);
  return {state:'verified', can_submit:false, chain_id:value.chain, core_address:value.core,
    core_code_hash:'0x' + 'aa'.repeat(32),
    finalized_anchor:{number:anchor, hash:anchor === block ? blockHash : '0x' + 'cc'.repeat(32)},
    registrations:[{artwork_id:artwork, creator_wallet:value.creator, metadata_uri:value.metadataUri,
      transaction_hash:'0x' + 'dd'.repeat(32), block_number:block, block_hash:blockHash, log_index:'0'}]};
}
function registrationQuery(value, proof=evidence(value), revision='0') {
  const params = [value.id,value.chain,value.core,value.creator,value.hash,value.mediaUri,value.bytes,
    value.metadataUri,proof];
  if (revision !== null) params.push(revision);
  return {text:`SELECT public.reconcile_artwork_media_registration(${params.map((_,i)=>'$'+(i+1)).join(',')}) AS value`, values:params};
}
function identityQuery(value, artwork='1', block='123') {
  return {text:'SELECT public.record_artwork_media_identity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',
    values:[value.chain,value.core,artwork,value.creator,value.hash,value.mediaUri,value.bytes,value.metadataUri,
      '0x'+'dd'.repeat(32),block,0]};
}
function legacyQuery(value, proof=evidence(value), revision='0', artwork=proof?.registrations?.[0]?.artwork_id || '1') {
  return {text:'SELECT public.intake_legacy_artwork_media_registration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',
    values:[value.chain,value.core,artwork,value.creator,value.hash,value.mediaUri,value.bytes,value.metadataUri,proof,revision]};
}

test('media registration and indexer rollback share an atomic revision fence (PostgreSQL 17)',
  {skip:available ? false : 'Docker unavailable; PostgreSQL revision fencing remains unverified'}, async t => {
  let created = false, pool;
  t.after(async () => {
    if (pool) await pool.end();
    if (created) docker('rm','-f',container);
  });
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-media-reorg-only',
    '-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');
  created = true;
  const endpoint = docker('port',container,'5432/tcp');
  assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool = new Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',
    password:'local-media-reorg-only',connectionTimeoutMillis:1000,statement_timeout:10000,max:8});
  let ready = false;
  for(let i=0;i<60;i++) {
    try {await pool.query('SELECT 1');await delay(250);await pool.query('SELECT 1');ready=true;break;}
    catch {await delay(250);}
  }
  assert(ready,'disposable PostgreSQL is ready');
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const name of ['identity','preparation','submission','registration']) {
    await pool.query(migration(`sql/migrations/artwork_media_${name}.sql`));
  }
  await pool.query(`CREATE TABLE public.event_processing_registry(chain_id NUMERIC(78,0),block_number BIGINT);
    CREATE TABLE public.contract_events(chain_id NUMERIC(78,0),block_number BIGINT,transaction_hash TEXT,log_index INTEGER);
    CREATE TABLE public.outbox_events(correlation_id TEXT,idempotency_key TEXT);`);
  for(const table of projectionTables) await pool.query(`CREATE TABLE public.${table}(chain_id NUMERIC(78,0),block_number BIGINT);`);
  await pool.query('ALTER TABLE public.v41_artworks ADD artwork_id NUMERIC(78,0), ADD creator TEXT, ADD metadata_uri TEXT, ADD transaction_hash TEXT;');
  await pool.query(migration('src/indexer/migrations/014_schema_aware_reorg_rollback.sql'));
  // The legacy signature delegates exactly as migration 013 does.
  await pool.query(`CREATE FUNCTION public.rollback_events_from_block(reorg_block BIGINT)
    RETURNS TABLE(events_deleted BIGINT,auctions_deleted BIGINT,bids_deleted BIGINT,outbox_deleted BIGINT)
    LANGUAGE plpgsql AS $f$ BEGIN
      RETURN QUERY SELECT * FROM public.rollback_events_from_block(reorg_block,84532);
    END $f$;`);
  const fenceMigration = migration('sql/migrations/artwork_media_reorg.sql');
  await pool.query(fenceMigration);
  const legacyMigration = migration('sql/migrations/artwork_media_legacy_intake.sql');
  await pool.query(legacyMigration);

  async function service(query, values) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');await client.query('SET LOCAL ROLE service_role');
      const result=await client.query(query,values);await client.query('COMMIT');return result;
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  }
  const rpc = async (query,values) => (await service(query,values)).rows[0].value;
  const reconcile = (value,proof=evidence(value),revision='0') => rpc(registrationQuery(value,proof,revision));
  const revision = (chain=84532) => rpc('SELECT public.read_artwork_media_revision($1) AS value',[chain]);
  const claimRow = async value => (await pool.query('SELECT to_jsonb(p) AS value FROM public.artwork_media_publications p WHERE publication_id=$1',[value.id])).rows[0].value;
  const rollback = (block,chain=84532) => pool.query('SELECT * FROM public.rollback_events_from_block($1,$2)',[block,chain]);
  const intake = async (value,proof=evidence(value),token='0',artwork) =>
    (await pool.query(legacyQuery(value,proof,token,artwork))).rows[0].value;
  async function claimed(value) {
    await rpc('SELECT public.issue_artwork_media_upload($1,$2,$3,$4,$5,$6,$7,$8) AS value',
      [value.id,value.chain,value.core,value.creator,value.mediaPath,value.metadataPath,'image/png',value.bytes]);
    await rpc('SELECT public.prepare_artwork_media_upload($1,$2,$3,$4,$5,$6) AS value',
      [value.id,value.creator,value.hash,value.bytes,'image/png',value.metadata]);
    assert.equal(await rpc('SELECT public.claim_artwork_media_publication($1,$2,$3,$4,$5,$6,$7,$8) AS value',
      [value.id,value.chain,value.core,value.creator,value.hash,value.mediaPath,value.bytes,value.metadataUri]),'CLAIMED');
  }
  async function started(value, withHash=false) {
    const row=await rpc('SELECT public.begin_artwork_media_submission($1,$2,$3,$4,$5) AS value',
      [value.id,value.chain,value.core,value.creator,value.metadataUri]);
    if(withHash) await rpc('SELECT public.report_artwork_media_transaction($1,$2,$3,$4,$5) AS value',
      [value.id,value.chain,value.core,value.creator,reportedHash]);
    return row;
  }
  async function reset() {
    await pool.query(`TRUNCATE public.artwork_media_registration_evidence, public.artwork_media_publications,
      public.artwork_media_catalog, public.artwork_media_preparations, public.artwork_media_rewinds,
      public.artwork_media_chain_revisions, public.contract_events, public.event_processing_registry,
      public.outbox_events, ${projectionTables.map(table=>'public.'+table).join(',')};
      INSERT INTO public.artwork_media_chain_revisions(chain_id,revision) VALUES(84532,0);`);
  }
  async function seedProjection(block=123,chain=84532) {
    await pool.query('INSERT INTO public.contract_events VALUES($1,$2,$3,0)',[chain,block,'0x'+'dd'.repeat(32)]);
    await pool.query('INSERT INTO public.event_processing_registry VALUES($1,$2)',[chain,block]);
    for(const table of projectionTables) await pool.query(`INSERT INTO public.${table}(chain_id,block_number) VALUES($1,$2)`,[chain,block]);
    await pool.query('INSERT INTO public.outbox_events VALUES($1,$2)',
      [`${chain}-0x${'dd'.repeat(32)}-0`,`${chain}-0x${'dd'.repeat(32)}-0-webhook`]);
  }
  async function snapshot() {
    const result={};
    for(const table of ['artwork_media_chain_revisions','artwork_media_rewinds','artwork_media_registration_evidence',
      'artwork_media_publications','artwork_media_catalog','contract_events','event_processing_registry','outbox_events',...projectionTables]) {
      result[table]=(await pool.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::TEXT`)).rows.map(r=>r.row);
    }
    return result;
  }
  async function waitForLock(pid) {
    for(let i=0;i<100;i++) {
      const row=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
      if(row?.wait_event_type==='Lock') return;
      await delay(20);
    }
    assert.fail('the competing transaction must wait on a database lock');
  }
  t.beforeEach(reset);

  await t.test('owner legacy intake preserves exact identifiers and the first anchor without synthetic publications',async()=>{
    const value=fixture(),proof=evidence(value,{artwork:'9007199254740993'});
    assert.deepEqual(await intake(value,proof),{artwork_id:'9007199254740993',catalog_status:'RECORDED',can_submit:false});
    const before=await snapshot();
    assert.equal((await intake(value,proof)).catalog_status,'ALREADY_RECORDED');
    assert.equal((await intake(value,evidence(value,{artwork:'9007199254740993',anchor:'250'}))).catalog_status,'ALREADY_RECORDED');
    assert.deepEqual(await snapshot(),before,'later finalized heads cannot replace the first proof');
    for(const table of ['artwork_media_preparations','artwork_media_publications']) {
      assert.equal((await pool.query(`SELECT count(*) AS count FROM public.${table}`)).rows[0].count,'0');
    }
  });

  await t.test('concurrent owner intakes record one immutable identity',async()=>{
    const value=fixture();
    const results=await Promise.all([intake(value),intake(value)]);
    assert.deepEqual(results.map(r=>r.catalog_status).sort(),['ALREADY_RECORDED','RECORDED']);
    assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_registration_evidence')).rows[0].count,'1');
  });

  await t.test('historical exact-byte duplicates remain separate facts and block a new claim',async()=>{
    const first=fixture(),second=fixture({creator:other});
    await intake(first);await intake(second,evidence(second,{artwork:'2',block:'124'}));
    const rows=(await pool.query('SELECT artwork_id::TEXT,creator_wallet FROM public.artwork_media_catalog ORDER BY artwork_id')).rows;
    assert.deepEqual(rows,[{artwork_id:'1',creator_wallet:creator},{artwork_id:'2',creator_wallet:other}]);
    assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_registration_evidence')).rows[0].count,'2');
    assert.equal(await rpc('SELECT public.claim_artwork_media_publication($1,$2,$3,$4,$5,$6,$7,$8) AS value',
      [first.id,first.chain,first.core,first.creator,first.hash,first.mediaPath,first.bytes,first.metadataUri]),'DUPLICATE_MEDIA');
  });

  await t.test('legacy intake reconciles matching claims then preserves their journal when another artwork conflicts',async()=>{
    const value=fixture(),duplicate=fixture({creator:other});await claimed(value);await started(value,true);
    const initial=await claimRow(value);await intake(value);
    assert.equal((await claimRow(value)).claim_status,'registered');
    await intake(duplicate,evidence(duplicate,{artwork:'2',block:'124'}));
    const after=await claimRow(value);assert.equal(after.claim_status,'conflict');
    assert.equal(after.registered_artwork_id,1);assert.equal(after.reported_transaction_hash,reportedHash);
    assert.equal(after.submission_started_at,initial.submission_started_at);
    assert.equal((await started(value)).submission_created,false);
    const before=await snapshot();await intake(value);assert.deepEqual(await snapshot(),before);
  });

  await t.test('a different legacy creator or metadata never acquires the pending claim',async()=>{
    const value=fixture(),legacy=fixture({creator:other});await claimed(value);await started(value);
    await intake(legacy);const row=await claimRow(value);
    assert.equal(row.claim_status,'conflict');assert.equal(row.registered_artwork_id,null);
    assert.equal(row.creator_wallet,creator);assert.equal(row.reported_transaction_hash,null);
  });

  await t.test('legacy intake rejects malformed, null, multiple and cross-scope evidence before writes',async()=>{
    const value=fixture(),base=evidence(value),before=await snapshot();
    const invalid=[null,{},[],{...base,state:'unresolved'},{...base,can_submit:true},
      {...base,chain_id:1},{...base,core_address:otherCore},{...base,core_code_hash:'0x'+'00'.repeat(32)},
      {...base,registrations:[]},{...base,registrations:[base.registrations[0],base.registrations[0]]}];
    for(const field of ['state','can_submit','chain_id','core_address','core_code_hash','finalized_anchor','registrations']) {
      const missing=structuredClone(base);delete missing[field];invalid.push(missing,{...base,[field]:null});
    }
    for(const field of ['artwork_id','creator_wallet','metadata_uri','transaction_hash','block_number','block_hash','log_index']) {
      const missing=structuredClone(base);delete missing.registrations[0][field];invalid.push(missing);
      const empty=structuredClone(base);empty.registrations[0][field]=null;invalid.push(empty);
    }
    for(const change of [{creator_wallet:other},{metadata_uri:value.metadataUri+'-wrong'},{artwork_id:1},
      {block_number:123},{log_index:0},{log_index:'2147483648'},{block_number:'201'},
      {block_hash:'0x'+'00'.repeat(32)},{transaction_hash:'0x'+'00'.repeat(32)}]) {
      const changed=structuredClone(base);Object.assign(changed.registrations[0],change);invalid.push(changed);
    }
    for(const anchor of [{number:200,hash:'0x'+'cc'.repeat(32)},
      {number:'123',hash:'0x'+'cc'.repeat(32)},{number:(2n**256n).toString(),hash:'0x'+'cc'.repeat(32)}]) {
      invalid.push({...base,finalized_anchor:anchor});
    }
    for(const proof of invalid) await assert.rejects(intake(value,proof,'0','1'),/INVALID_REGISTRATION_EVIDENCE/);
    for(const [field,replacement] of [['chain',null],['chain',1],['core',null],['core','0x'+'00'.repeat(20)],
      ['creator',null],['creator','0x'+'00'.repeat(20)],['hash',null],['hash','invalid'],
      ['mediaUri',null],['mediaUri',' '],['metadataUri',null],['bytes',null],['bytes',0]]) {
      await assert.rejects(intake({...value,[field]:replacement},base),/INVALID_MEDIA_REGISTRATION_REVISION|INVALID_REGISTRATION_EVIDENCE/);
    }
    for(const id of ['',null,'0','01',(2n**256n).toString()]) {
      const proof=structuredClone(base);proof.registrations[0].artwork_id=id;
      await assert.rejects(intake(value,proof,'0',id),/INVALID_REGISTRATION_EVIDENCE/);
    }
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('contradictory legacy catalog or evidence cannot overwrite the original or change claims',async()=>{
    const value=fixture();await claimed(value);await started(value,true);await intake(value);
    const before=await snapshot();
    for(const field of ['transaction_hash','block_hash']) {
      const changed=evidence(value);changed.registrations[0][field]='0x'+'ff'.repeat(32);
      await assert.rejects(intake(value,changed),/MEDIA_IDENTITY_CONFLICT|MEDIA_REGISTRATION_EVIDENCE_CONFLICT/);
    }
    for(const change of [{hash:'ff'.repeat(32)},{bytes:value.bytes+1},{mediaUri:value.mediaUri+'-wrong'},
      {metadataUri:value.metadataUri+'-wrong'},{creator:other}]) {
      const changed={...value,...change};
      await assert.rejects(intake(changed),/MEDIA_IDENTITY_CONFLICT/);
    }
    for(const changed of [{...evidence(value),core_code_hash:'0x'+'ff'.repeat(32)},
      {...evidence(value),finalized_anchor:{number:'200',hash:'0x'+'ff'.repeat(32)}}]) {
      await assert.rejects(intake(value,changed),/MEDIA_REGISTRATION_EVIDENCE_CONFLICT/);
    }
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('legacy intake requires a present exact revision and read committed isolation',async()=>{
    const value=fixture(),before=await snapshot();
    for(const token of [null,'','00','-1','0.0','1e3','1'.repeat(79)]) {
      await assert.rejects(intake(value,evidence(value),token),/INVALID_MEDIA_REGISTRATION_REVISION/);
    }
    const client=await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await assert.rejects(client.query(legacyQuery(value)),/MEDIA_IDENTITY_REQUIRES_READ_COMMITTED/);
    } finally {await client.query('ROLLBACK');client.release();}
    assert.deepEqual(await snapshot(),before);
    await rollback(120);await assert.rejects(intake(value),/MEDIA_REGISTRATION_STALE_REVISION/);
    await pool.query('DELETE FROM public.artwork_media_rewinds; DELETE FROM public.artwork_media_chain_revisions;');
    await assert.rejects(intake(value),/MEDIA_REGISTRATION_REVISION_UNAVAILABLE/);
    assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_catalog')).rows[0].count,'0');
  });

  for(const intakeFirst of [true,false]) await t.test(`legacy intake and rollback serialize when ${intakeFirst?'intake':'rollback'} locks first`,async()=>{
    const value=fixture();await claimed(value);await started(value);const writer=await pool.connect(),rewinder=await pool.connect();let pending;
    try {
      await writer.query('BEGIN');await rewinder.query('BEGIN');
      if(intakeFirst) {
        await writer.query(legacyQuery(value));
        const pid=(await rewinder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending=rewinder.query('SELECT * FROM public.rollback_events_from_block(120,84532)').then(result=>({result}),error=>({error}));
        await waitForLock(pid);await writer.query('COMMIT');assert.ifError((await pending).error);await rewinder.query('COMMIT');
        assert.equal((await claimRow(value)).claim_status,'conflict');
        assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_registration_evidence')).rows[0].count,'1');
      } else {
        await rewinder.query('SELECT * FROM public.rollback_events_from_block(120,84532)');
        const pid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending=writer.query(legacyQuery(value)).then(result=>({result}),error=>({error}));
        await waitForLock(pid);await rewinder.query('COMMIT');
        assert.match((await pending).error?.message||'',/MEDIA_REGISTRATION_STALE_REVISION/);await writer.query('ROLLBACK');
        assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_catalog')).rows[0].count,'0');
      }
      assert.equal(await revision(),'1');assert.equal((await started(value)).submission_created,false);
    } finally {
      await writer.query('ROLLBACK');await rewinder.query('ROLLBACK');if(pending)await pending;
      writer.release();rewinder.release();
    }
  });

  await t.test('a new revision cannot readmit conflicting retained legacy proof or release its quarantined claim',async()=>{
    const value=fixture();await claimed(value);await started(value,true);await intake(value);await rollback(120);
    const before=await snapshot(),changed=evidence(value,{anchor:'250'});changed.registrations[0].block_hash='0x'+'ff'.repeat(32);
    await assert.rejects(intake(value,changed,'1'),/MEDIA_REGISTRATION_EVIDENCE_CONFLICT/);
    assert.equal((await intake(value,evidence(value,{anchor:'250'}),'1')).catalog_status,'ALREADY_RECORDED');
    assert.deepEqual(await snapshot(),before);assert.equal((await claimRow(value)).claim_status,'conflict');
  });

  await t.test('legacy evidence insertion failure rolls back catalog and claim reconciliation together',async()=>{
    const value=fixture();await claimed(value);await started(value,true);const before=await snapshot();
    await pool.query(`CREATE FUNCTION public._fail_legacy_evidence() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_LEGACY_EVIDENCE_FAILURE'; END $f$;
      CREATE TRIGGER _fail_legacy_evidence BEFORE INSERT ON public.artwork_media_registration_evidence
      FOR EACH ROW EXECUTE FUNCTION public._fail_legacy_evidence();`);
    try {await assert.rejects(intake(value),/FORCED_LEGACY_EVIDENCE_FAILURE/);}
    finally {await pool.query('DROP TRIGGER _fail_legacy_evidence ON public.artwork_media_registration_evidence; DROP FUNCTION public._fail_legacy_evidence();');}
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('legacy intake is owner-only and replaying its migration preserves evidence and revoked raw writers',async()=>{
    const value=fixture();await intake(value);await rollback(201);const before=await snapshot();
    await pool.query(legacyMigration);assert.deepEqual(await snapshot(),before);
    const properties=(await pool.query(`SELECT prosecdef,proconfig FROM pg_proc
      WHERE oid='public.intake_legacy_artwork_media_registration(numeric,text,text,text,text,text,bigint,text,jsonb,text)'::regprocedure`)).rows[0];
    assert.equal(properties.prosecdef,false);assert.deepEqual(properties.proconfig,['search_path=pg_catalog, public']);
    for(const role of ['service_role','anon','authenticated']) {
      const client=await pool.connect();
      try {
        for(const query of [legacyQuery(value,evidence(value),'1'),identityQuery(value),registrationQuery(value,evidence(value),null)]) {
          await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(client.query(query),/permission denied for function/);await client.query('ROLLBACK');
        }
      } finally {await client.query('ROLLBACK');client.release();}
    }
    assert.equal((await intake(value,evidence(value),'1')).catalog_status,'ALREADY_RECORDED');
  });

  await t.test('indexer hints are owned and deployment scoped, bounded and preserve numeric precision',async()=>{
    const value=fixture({creator:'0x'+'ab'.repeat(20)});await claimed(value);
    const hintQuery={text:'SELECT public.read_artwork_media_registration_candidates($1,$2,$3,$4) AS value',
      values:[value.id,value.chain,value.core,value.creator]};
    assert.deepEqual(await rpc(hintQuery),[]);
    await pool.query(`INSERT INTO public.v41_artworks(chain_id,block_number,artwork_id,creator,metadata_uri,transaction_hash)
      SELECT 84532,100+i,9007199254740993+i,$1,$2,$3 FROM generate_series(0,9) i`,
      ['0x'+'AB'.repeat(20),value.metadataUri,'0x'+'DD'.repeat(32)]);
    const rows=await rpc(hintQuery);
    assert.equal(rows.length,9,'overflow remains visible to the caller');
    assert.equal(rows[0].artwork_id,'9007199254740993');assert.equal(rows[8].block_number,'108');
    assert.equal(rows[0].transaction_hash,'0x'+'dd'.repeat(32));
    for(const [index,changed] of [[0,crypto.randomUUID()],[1,11155111],[2,otherCore],[3,other]]) {
      const values=[...hintQuery.values];values[index]=changed;
      assert.deepEqual(await rpc({text:hintQuery.text,values}),[]);
    }
    await rollback(100);
    assert.deepEqual(await rpc(hintQuery),[],'rewound projections cannot remain lookup hints');
    assert.equal((await claimRow(value)).claim_status,'claimed','unverified hints never confirm or release a claim');
  });

  await t.test('revision getter is stable, exact and unavailable without the chain row',async()=>{
    assert.equal(await revision(),'0');
    assert.equal((await pool.query("SELECT provolatile FROM pg_proc WHERE oid='public.read_artwork_media_revision(numeric)'::regprocedure")).rows[0].provolatile,'s');
    await pool.query("UPDATE public.artwork_media_chain_revisions SET revision=9007199254740993 WHERE chain_id=84532");
    assert.equal(await revision(),'9007199254740993');
    const value=fixture();await claimed(value);
    assert.equal((await reconcile(value,evidence(value),'9007199254740993')).claim_status,'registered');
    await pool.query('DELETE FROM public.artwork_media_chain_revisions WHERE chain_id=84532');
    assert.equal(await revision(),null,'a missing row is not revision zero');
    await assert.rejects(reconcile(value,evidence(value),'9007199254740993'),/MEDIA_REGISTRATION_REVISION_UNAVAILABLE/);
    const before=await snapshot();
    await assert.rejects(rollback(120),/MEDIA_REGISTRATION_REVISION_UNAVAILABLE/);
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('malformed revision tokens cannot write or quarantine a valid claim',async()=>{
    const value=fixture();await claimed(value);const before=await snapshot();
    for(const token of ['', '00', '-1', '0.0', '1e3', '1'.repeat(79)]) {
      await assert.rejects(reconcile(value,evidence(value),token),/INVALID_MEDIA_REGISTRATION_REVISION/);
    }
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('evidence computed before rollback cannot commit afterward, including a no-hash attempt',async()=>{
    const value=fixture();await claimed(value);const initial=await started(value);
    const observed=await revision();await seedProjection();await rollback(120);
    assert.equal(await revision(),'1');
    await assert.rejects(reconcile(value,evidence(value),observed),/MEDIA_REGISTRATION_STALE_REVISION/);
    const after=await claimRow(value);
    assert.equal(after.submission_started_at,initial.submission_started_at);
    assert.equal(after.reported_transaction_hash,null);assert.equal(after.registered_artwork_id,null);
    assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_catalog')).rows[0].count,'0');
    const resumed=await started(value);assert.equal(resumed.submission_created,false);
  });

  await t.test('registration committing first is followed by a rollback that quarantines it',async()=>{
    const value=fixture();await claimed(value);await started(value,true);await seedProjection();
    const writer=await pool.connect(),rewinder=await pool.connect();let pending;
    try {
      await writer.query('BEGIN');await writer.query('SET LOCAL ROLE service_role');
      assert.equal((await writer.query(registrationQuery(value))).rows[0].value.claim_status,'registered');
      const pid=(await rewinder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await rewinder.query('BEGIN');
      pending=rewinder.query('SELECT * FROM public.rollback_events_from_block(120,84532)').then(result=>({result}),error=>({error}));
      await waitForLock(pid);await writer.query('COMMIT');
      const settled=await pending;assert.ifError(settled.error);await rewinder.query('COMMIT');
      assert.equal(await revision(),'1');assert.equal((await claimRow(value)).claim_status,'conflict');
      assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_registration_evidence')).rows[0].count,'1');
    } finally {
      await writer.query('ROLLBACK');if(pending) await pending;await rewinder.query('ROLLBACK');writer.release();rewinder.release();
    }
  });

  await t.test('rollback committing first makes a waiting registration reject its stale revision',async()=>{
    const value=fixture();await claimed(value);await started(value);await seedProjection();
    const rewinder=await pool.connect(),writer=await pool.connect();let pending;
    try {
      await rewinder.query('BEGIN');await rewinder.query('SELECT * FROM public.rollback_events_from_block(120,84532)');
      const pid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await writer.query('BEGIN');await writer.query('SET LOCAL ROLE service_role');
      pending=writer.query(registrationQuery(value)).then(result=>({result}),error=>({error}));
      await waitForLock(pid);await rewinder.query('COMMIT');
      const settled=await pending;assert.match(settled.error?.message||'',/MEDIA_REGISTRATION_STALE_REVISION/);
      await writer.query('ROLLBACK');
      assert.equal(await revision(),'1');assert.equal((await claimRow(value)).registered_artwork_id,null);
      assert.equal((await pool.query('SELECT count(*) AS count FROM public.artwork_media_catalog')).rows[0].count,'0');
    } finally {
      await rewinder.query('ROLLBACK');if(pending) await pending;await writer.query('ROLLBACK');rewinder.release();writer.release();
    }
  });

  await t.test('a failed projection rollback restores revision, rewind history, claims and all projections',async()=>{
    const value=fixture();await claimed(value);await started(value,true);await reconcile(value);await seedProjection();
    const before=await snapshot();
    await pool.query(`CREATE FUNCTION public._fail_media_reorg() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'FORCED_ROLLBACK_FAILURE'; END $f$;
      CREATE TRIGGER _fail_media_reorg BEFORE DELETE ON public.contract_events
      FOR EACH ROW EXECUTE FUNCTION public._fail_media_reorg();`);
    try {await assert.rejects(rollback(120),/FORCED_ROLLBACK_FAILURE/);}
    finally {await pool.query('DROP TRIGGER _fail_media_reorg ON public.contract_events; DROP FUNCTION public._fail_media_reorg();');}
    assert.deepEqual(await snapshot(),before);
  });

  for(const [boundary,expected] of [[201,'registered'],[200,'conflict'],[124,'conflict'],[123,'conflict']]) {
    await t.test(`rollback from ${boundary} respects the event and original finalized anchor boundary`,async()=>{
      const value=fixture();await claimed(value);await reconcile(value);const before=await snapshot();
      await rollback(boundary);
      assert.equal((await claimRow(value)).claim_status,expected);
      assert.deepEqual((await snapshot()).artwork_media_catalog,before.artwork_media_catalog);
      assert.deepEqual((await snapshot()).artwork_media_registration_evidence,before.artwork_media_registration_evidence);
      assert.equal(await revision(),'1');
    });
  }

  await t.test('chain-wide revision does not mix core identities or quarantine another chain',async()=>{
    const affected=fixture(),older=fixture({core:otherCore}),foreign=fixture({chain:11155111});
    for(const value of [affected,older,foreign]) await claimed(value);
    await reconcile(affected);const olderEvidence=evidence(older,{block:'50',anchor:'80'});
    await reconcile(older,olderEvidence);
    // Historical other-chain catalog data is written only by the trusted owner.
    await pool.query(identityQuery(foreign,'1','150'));
    await rollback(100);
    assert.equal((await claimRow(affected)).claim_status,'conflict');
    assert.equal((await claimRow(older)).claim_status,'registered');
    assert.equal((await claimRow(foreign)).claim_status,'registered');
    assert.equal(await revision(11155111),null,'the active product fence does not invent another testnet');
    await assert.rejects(reconcile(older,olderEvidence,'0'),/MEDIA_REGISTRATION_STALE_REVISION/);
    assert.equal((await reconcile(older,olderEvidence,'1')).claim_status,'registered');
  });

  for(const withHash of [false,true]) {
    await t.test(`rollback preserves the ${withHash?'reported-hash':'unknown-broadcast'} journal and a sticky claim`,async()=>{
      const value=fixture();await claimed(value);await started(value,withHash);await reconcile(value);
      const before=await claimRow(value),catalog=(await snapshot()).artwork_media_catalog;
      await rollback(120);
      const result=await reconcile(value,evidence(value),'1');
      assert.equal(result.claim_status,'conflict');assert.equal(result.can_submit,false);
      const after=await claimRow(value);
      assert.equal(after.submission_started_at,before.submission_started_at);
      assert.equal(after.reported_transaction_hash,withHash?reportedHash:null);
      assert.equal(after.registered_artwork_id,before.registered_artwork_id);
      assert.deepEqual((await snapshot()).artwork_media_catalog,catalog);
      assert.equal((await started(value)).submission_created,false);
      assert.equal(await rpc('SELECT public.claim_artwork_media_publication($1,$2,$3,$4,$5,$6,$7,$8) AS value',
        [value.id,value.chain,value.core,value.creator,value.hash,value.mediaPath,value.bytes,value.metadataUri]),'PUBLICATION_BLOCKED');
    });
  }

  for(const field of ['transaction_hash','block_hash']) {
    await t.test(`contradictory ${field} quarantines the claim and discards earlier batch writes`,async()=>{
      const value=fixture();await claimed(value);await started(value,true);
      const original=evidence(value,{artwork:'2'});await reconcile(value,original);
      const before=await snapshot(),changed=structuredClone(original);
      changed.registrations[0][field]='0x'+'ee'.repeat(32);
      changed.registrations.unshift({...original.registrations[0],artwork_id:'1',block_number:'122',
        block_hash:'0x'+'fa'.repeat(32),transaction_hash:'0x'+'ff'.repeat(32)});
      const result=await reconcile(value,changed);
      assert.equal(result.claim_status,'conflict');assert.equal(result.can_submit,false);
      const after=await snapshot();
      assert.deepEqual(after.artwork_media_catalog,before.artwork_media_catalog);
      assert.deepEqual(after.artwork_media_registration_evidence,before.artwork_media_registration_evidence);
      assert.equal((await claimRow(value)).reported_transaction_hash,reportedHash);
      assert.equal((await reconcile(value,original)).claim_status,'conflict');
    });
  }

  await t.test('invalid or foreign evidence cannot use quarantine to modify another owned claim',async()=>{
    const value=fixture();await claimed(value);await reconcile(value);const before=await snapshot();
    const changed=evidence(value);changed.registrations[0].creator_wallet=other;
    await assert.rejects(reconcile(value,changed),/INVALID_REGISTRATION_EVIDENCE/);
    await assert.rejects(reconcile({...value,creator:other},evidence({...value,creator:other})),/MEDIA_PUBLICATION_NOT_FOUND/);
    await assert.rejects(reconcile({...value,hash:'ff'.repeat(32)}),/MEDIA_PREPARATION_MISMATCH/);
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('only the fenced RPC remains callable by the service and rollback retains owner-only execution',async()=>{
    const value=fixture();await claimed(value);
    await assert.rejects(service(registrationQuery(value,evidence(value),null)),/permission denied for function/);
    await assert.rejects(service(identityQuery(value)),/permission denied for function/);
    for(const query of ['SELECT * FROM public.rollback_events_from_block(120,84532)',
      'SELECT * FROM public.rollback_events_from_block(120)',
      'UPDATE public.artwork_media_chain_revisions SET revision=100',
      'DELETE FROM public.artwork_media_rewinds','TRUNCATE public.artwork_media_chain_revisions']) {
      await assert.rejects(service(query),/permission denied/);
    }
    for(const role of ['anon','authenticated']) {
      const client=await pool.connect();
      try {
        for(const query of [registrationQuery(value),{text:'SELECT public.read_artwork_media_revision(84532)'},
          {text:'SELECT public.read_artwork_media_registration_candidates($1,84532,$2,$3)',values:[value.id,core,creator]},
          {text:'SELECT * FROM public.artwork_media_rewinds'},{text:'SELECT * FROM public.artwork_media_chain_revisions'},
          {text:'SELECT * FROM public.rollback_events_from_block(120,84532)'}]) {
          await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(client.query(query),/permission denied/);await client.query('ROLLBACK');
        }
      } finally {await client.query('ROLLBACK');client.release();}
    }
    await reconcile(value);await pool.query('SELECT * FROM public.rollback_events_from_block(120)');
    assert.equal(await revision(),'1');assert.equal((await claimRow(value)).claim_status,'conflict');
    const before=await snapshot();await pool.query(fenceMigration);assert.deepEqual(await snapshot(),before);
    assert.equal(await revision(),'1');
    await assert.rejects(service(registrationQuery(value,evidence(value),null)),/permission denied for function/);
    await assert.rejects(service(identityQuery(value)),/permission denied for function/);
    const rls=(await pool.query(`SELECT relname,relrowsecurity AND relforcerowsecurity AS private
      FROM pg_class WHERE oid IN ('public.artwork_media_chain_revisions'::regclass,'public.artwork_media_rewinds'::regclass)`)).rows;
    assert.equal(rls.length,2);assert(rls.every(row=>row.private));
  });
});
