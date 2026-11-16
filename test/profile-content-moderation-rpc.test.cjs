// Disposable PostgreSQL only; no hosted database, wallet or deployment.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const test = require('node:test');
const {Pool} = require('pg');
const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-profile-review-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const OWNER = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`, A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`, STAFF = `0x${'3'.repeat(40)}`, CORE = `0x${'4'.repeat(40)}`;
const migration = name => fs.readFileSync(path.join(ROOT, 'sql/migrations', name), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function docker(...args) { return execFileSync('docker', args, {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim(); }
let available = false; try { available = docker('version','--format','{{.Server.Os}}') === 'linux'; } catch {}

test('profile complaints preserve content, privacy and atomic review (PostgreSQL 17)', {
  skip: available ? false : 'Disposable PostgreSQL requires Docker', timeout:120000
}, async t => {
  let created = false, pool;
  t.after(async () => { if (pool) await pool.end(); if (created) docker('rm','-f',CONTAINER); });
  docker('run','-d','--name',CONTAINER,'-e','POSTGRES_PASSWORD=local-profile-only','-e','POSTGRES_DB=artsoul',
    '-p','127.0.0.1::5432','postgres:17'); created = true;
  const endpoint = docker('port',CONTAINER,'5432/tcp'); assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool = new Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',
    password:'local-profile-only',connectionTimeoutMillis:1000,max:8,options:'-c statement_timeout=10000'});
  let ready = false;
  for (let n=0;n<60;n++) { try { await pool.query('SELECT 1'); await delay(250); await pool.query('SELECT 1'); ready=true; break; } catch { await delay(500); } }
  assert.ok(ready);
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE profiles(id UUID DEFAULT gen_random_uuid(),created_at TIMESTAMPTZ DEFAULT now(),wallet_address TEXT PRIMARY KEY,
      username TEXT,bio TEXT,avatar_url TEXT,twitter_handle TEXT,twitter_username TEXT,twitter_id TEXT,discord_username TEXT,discord_id TEXT,email TEXT);
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
    CREATE POLICY artsoul_public_read ON profiles FOR SELECT TO anon,authenticated USING(true);
    GRANT SELECT ON profiles TO anon,authenticated; GRANT ALL ON profiles TO service_role;
    CREATE TABLE v41_artworks(chain_id NUMERIC,artwork_id NUMERIC,creator TEXT,canonical_floor NUMERIC DEFAULT 0,
      token_id NUMERIC,block_number BIGINT DEFAULT 1,PRIMARY KEY(chain_id,artwork_id));
    CREATE TABLE contract_events(chain_id NUMERIC,transaction_hash TEXT,log_index INTEGER,PRIMARY KEY(chain_id,transaction_hash,log_index));
    CREATE TABLE indexer_state(chain_id NUMERIC,contract_address TEXT,last_confirmed_block BIGINT);
    CREATE TABLE artwork_search_metadata(chain_id NUMERIC,artwork_id NUMERIC,terms TSVECTOR);
    CREATE TABLE v41_auctions(chain_id NUMERIC,artwork_id NUMERIC,auction_id NUMERIC,status TEXT,end_time TIMESTAMPTZ);`);
  for (const name of ['phase18_artwork_moderation_visibility.sql','a8b_artwork_report_intake.sql',
    'a8c_protocol_admin_review.sql','artist_support.sql','artist_support_moderation.sql',
    'moderation_report_email_delivery.sql','profile_content_moderation.sql']) await pool.query(migration(name));
  t.beforeEach(async () => {
    await pool.query(`TRUNCATE artwork_report_notifications,artwork_report_events,artwork_reports,
      artwork_moderation_log,artwork_moderation_visibility,donation_message_visibility,profiles,
      contract_events,v41_artworks,indexer_state,artwork_search_metadata,v41_auctions RESTART IDENTITY CASCADE;
      INSERT INTO profiles(wallet_address,username,bio,avatar_url,twitter_handle,twitter_username,twitter_id,discord_username,discord_id,email)
      VALUES('${OWNER}','DistinctIdentity','Reported biography','https://example.test/avatar.png','@self_reported','VerifiedName','private-oauth-id','DiscordName','123456789','private@example.test'),
        ('${OTHER}','OtherIdentity','Other biography',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO v41_artworks(chain_id,artwork_id,creator,canonical_floor,token_id) VALUES(84532,28,'${OWNER}',123,7);
      INSERT INTO indexer_state VALUES(84532,'${CORE}',100);
      INSERT INTO artwork_search_metadata VALUES(84532,28,to_tsvector('simple','IndependentTitle'));`);
  });
  async function submit({owner=OWNER,reporter=A,category='impersonation',limit=5}={}) {
    return (await pool.query('SELECT * FROM submit_profile_content_report($1,$2,$3,$4,NULL,TRUE,$5)',
      [owner,reporter,category,'Evidence for review.',limit])).rows[0];
  }
  async function row(id) { return (await pool.query('SELECT *,updated_at::TEXT AS version FROM artwork_reports WHERE id=$1',[id])).rows[0]; }
  async function review(id,action,version) { return (await pool.query('SELECT * FROM review_profile_content_report($1,$2,$3,$4,$5)',
    [id,version || (await row(id)).version,action,'Reviewed the captured content.',STAFF])).rows[0]; }
  async function visibility(owner=OWNER) { return (await pool.query('SELECT * FROM profile_content_visibility WHERE profile_wallet=$1',[owner])).rows[0]; }
  async function publicProfile(owner=OWNER) { return (await pool.query('SELECT * FROM public_profile_content WHERE wallet_address=$1',[owner])).rows[0]; }
  async function search(query,category='artists') { return (await pool.query('SELECT * FROM search_public_artworks($1,$2,$3)',[query,category,CORE])).rows.map(r=>r.result_key); }

  await t.test('intake snapshots public content privately, leaves content visible and enqueues durable email evidence', async () => {
    const report = await submit(), stored = await row(report.report_id);
    assert.equal(stored.chain_id,null); assert.equal(stored.artwork_id,null); assert.equal(stored.profile_wallet,OWNER);
    assert.equal(stored.profile_content_snapshot.bio,'Reported biography');
    assert.equal(stored.profile_content_snapshot.discord_profile_url,'https://discord.com/users/123456789');
    assert.doesNotMatch(JSON.stringify(stored.profile_content_snapshot),/private-oauth-id|private@example|twitter_id|discord_id/);
    assert.match(stored.profile_content_hash,/^[0-9a-f]{64}$/);
    assert.equal((await publicProfile()).profile_content_hidden,false);
    assert.deepEqual((await pool.query('SELECT event_type FROM artwork_report_events WHERE report_id=$1',[report.report_id])).rows,[{event_type:'REPORT_SUBMITTED'}]);
    assert.equal((await pool.query('SELECT * FROM pending_moderation_report_emails()')).rows[0].report_id,report.report_id);
    await assert.rejects(submit({owner:`0x${'f'.repeat(40)}`}),/PROFILE_NOT_FOUND/);
  });
  await t.test('concurrent duplicate intake deduplicates and profile/artwork complaints share one rolling quota', async () => {
    const duplicate = await Promise.all([submit(),submit()]);
    assert.equal(duplicate[0].report_id,duplicate[1].report_id);
    assert.equal(duplicate.filter(r=>r.already_submitted).length,1);
    const attempts = await Promise.allSettled([
      submit({category:'spam',limit:2}),
      pool.query("SELECT * FROM submit_artwork_report(84532,28,$1,'other','Evidence',NULL,TRUE,2)",[A])
    ]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.match(attempts.find(r=>r.status==='rejected').reason.message,/REPORT_DAILY_LIMIT_REACHED/);
    assert.equal((await pool.query('SELECT count(*) FROM artwork_report_events')).rows[0].count,'2');
    assert.equal((await submit({limit:1})).already_submitted,true,'duplicates do not consume the cap');
  });
  await t.test('hide masks every public identity field without modifying profile, OAuth or artwork records', async () => {
    const before = (await pool.query('SELECT * FROM profiles ORDER BY wallet_address')).rows;
    const artwork = (await pool.query('SELECT * FROM v41_artworks')).rows;
    const report = await submit(); assert.equal((await review(report.report_id,'hide')).profile_hidden,true);
    const masked = await publicProfile();
    for (const key of ['username','bio','avatar_url','twitter_handle','twitter_username','discord_username','twitter_id','discord_id']) assert.equal(masked[key],null,key);
    assert.equal(masked.wallet_address,OWNER); assert.ok(masked.id); assert.ok(masked.created_at);
    assert.equal(masked.profile_content_hidden,true); assert.equal((await publicProfile(OTHER)).username,'OtherIdentity');
    assert.deepEqual((await pool.query('SELECT * FROM profiles ORDER BY wallet_address')).rows,before);
    assert.deepEqual((await pool.query('SELECT * FROM v41_artworks')).rows,artwork);
  });
  await t.test('independent actioned complaints keep content hidden until the last restore', async () => {
    const first=await submit(), second=await submit({reporter:B});
    await Promise.all([review(first.report_id,'hide'),review(second.report_id,'hide')]);
    assert.equal((await review(first.report_id,'restore')).profile_hidden,true);
    assert.equal((await visibility()).hidden,true);
    assert.equal((await review(second.report_id,'restore')).profile_hidden,false);
    assert.equal((await publicProfile()).username,'DistinctIdentity');
    assert.equal((await pool.query("SELECT count(*) FROM artwork_report_notifications WHERE notification_type='PROFILE_CONTENT_RESTORED'")).rows[0].count,'1');
    const notices=(await pool.query('SELECT recipient_wallet,notification_type FROM artwork_report_notifications WHERE report_id=$1 ORDER BY id',[second.report_id])).rows;
    assert.ok(notices.some(r=>r.recipient_wallet===OWNER && r.notification_type==='PROFILE_CONTENT_RESTORED'));
  });
  await t.test('changed content cannot be hidden or reopened under an older captured report', async () => {
    const first=await submit();
    await pool.query("UPDATE profiles SET bio='Edited biography' WHERE wallet_address=$1",[OWNER]);
    await assert.rejects(review(first.report_id,'hide'),/PROFILE_CONTENT_CHANGED/);
    await review(first.report_id,'dismiss');
    await assert.rejects(review(first.report_id,'reopen'),/PROFILE_CONTENT_CHANGED/);
    const next=await submit(); assert.notEqual(next.report_id,first.report_id);
    assert.notEqual((await row(next.report_id)).profile_content_hash,(await row(first.report_id)).profile_content_hash);
    await review(next.report_id,'hide');
    await pool.query("UPDATE profiles SET bio='New unreviewed content' WHERE wallet_address=$1",[OWNER]);
    assert.equal((await publicProfile()).profile_content_hidden,false);
    await review(next.report_id,'restore');
    assert.equal((await pool.query("SELECT count(*) FROM artwork_report_notifications WHERE notification_type='PROFILE_CONTENT_RESTORED'")).rows[0].count,'0');
  });
  await t.test('a profile edit committing while review waits is rechecked before hiding', async () => {
    const report=await submit(), version=(await row(report.report_id)).version;
    const editor=await pool.connect(), reviewer=await pool.connect();
    try {
      await editor.query('BEGIN');
      await editor.query("UPDATE profiles SET bio='Concurrent edit' WHERE wallet_address=$1",[OWNER]);
      const pid=(await reviewer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending=reviewer.query("SELECT * FROM review_profile_content_report($1,$2,'hide','Review',$3)",[report.report_id,version,STAFF]);
      const rejected=assert.rejects(pending,/PROFILE_CONTENT_CHANGED/);
      let blocked=false;
      for(let n=0;n<50;n++) {
        blocked=(await pool.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked;
        if(blocked)break; await delay(10);
      }
      assert.equal(blocked,true,'the decision waits for the in-flight profile edit');
      await editor.query('COMMIT'); await rejected;
      assert.equal((await publicProfile()).bio,'Concurrent edit');
      assert.equal((await row(report.report_id)).status,'pending_review');
    } finally { await editor.query('ROLLBACK'); editor.release(); reviewer.release(); }
  });
  await t.test('stale review versions and target substitution cannot duplicate or redirect a decision', async () => {
    const report=await submit(), version=(await row(report.report_id)).version;
    const decisions=await Promise.allSettled([review(report.report_id,'hide',version),review(report.report_id,'dismiss',version)]);
    assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);
    assert.match(decisions.find(r=>r.status==='rejected').reason.message,/REPORT_REVIEW_CONFLICT/);
    await assert.rejects(pool.query("SELECT * FROM review_artwork_report($1,$2,'restore','Review',$3)",[report.report_id,(await row(report.report_id)).version,STAFF]),/REPORT_TARGET_MISMATCH/);
    const artwork=(await pool.query("SELECT * FROM submit_artwork_report(84532,28,$1,'spam','Evidence',NULL,TRUE,5)",[B])).rows[0];
    await assert.rejects(review(artwork.report_id,'hide'),/REPORT_TARGET_MISMATCH/);
  });
  await t.test('reopen collision cannot strand an active report', async () => {
    const first=await submit(); await review(first.report_id,'dismiss'); const next=await submit();
    await assert.rejects(review(first.report_id,'reopen'),/REPORT_ALREADY_PENDING/);
    await review(next.report_id,'hide'); await assert.rejects(review(next.report_id,'reopen'),/REPORT_ACTION_NOT_ALLOWED/);
    await review(next.report_id,'restore'); assert.equal((await review(first.report_id,'reopen')).report_status,'pending_review');
  });
  await t.test('audit and notification errors roll back decisions and public masking atomically', async () => {
    for (const table of ['artwork_report_events','artwork_report_notifications']) {
      const report=await submit({category:table==='artwork_report_events'?'spam':'other'});
      await pool.query(`CREATE FUNCTION local_fail_profile_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_REVIEW_FAILURE'; END $$;
        CREATE TRIGGER local_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION local_fail_profile_review();`);
      try { await assert.rejects(review(report.report_id,'hide'),/LOCAL_REVIEW_FAILURE/); }
      finally { await pool.query(`DROP TRIGGER local_failure ON ${table}; DROP FUNCTION local_fail_profile_review();`); }
      assert.equal((await row(report.report_id)).status,'pending_review'); assert.equal((await visibility()).hidden,false);
      assert.equal((await pool.query('SELECT count(*) FROM artwork_report_events WHERE report_id=$1',[report.report_id])).rows[0].count,'1');
    }
  });
  await t.test('search cannot match hidden identity text but keeps exact wallet and artwork queries', async () => {
    assert.deepEqual(await search('DistinctIdentity'),[OWNER]); assert.deepEqual(await search('VerifiedName','artworks'),['28']);
    const report=await submit(); await review(report.report_id,'hide');
    assert.deepEqual(await search('DistinctIdentity'),[]); assert.deepEqual(await search('VerifiedName','artworks'),[]);
    assert.deepEqual(await search('DiscordName'),[]); assert.deepEqual(await search(OWNER),[OWNER]);
    assert.deepEqual(await search('IndependentTitle','artworks'),['28']); assert.deepEqual(await search('#28','artworks'),['28']);
    await review(report.report_id,'restore'); assert.deepEqual(await search('DistinctIdentity'),[OWNER]);
  });
  await t.test('existing artwork and donation review RPCs still work after the profile migration', async () => {
    const artwork=(await pool.query("SELECT * FROM submit_artwork_report(84532,28,$1,'spam','Evidence',NULL,TRUE,5)",[A])).rows[0];
    const decideArtwork=async action=>(await pool.query('SELECT * FROM review_artwork_report($1,$2,$3,$4,$5)',
      [artwork.report_id,(await row(artwork.report_id)).version,action,'Review',STAFF])).rows[0];
    assert.equal((await decideArtwork('hide')).artwork_hidden,true); assert.equal((await decideArtwork('restore')).artwork_hidden,false);
    const tx=`0x${'d'.repeat(64)}`;
    await pool.query('INSERT INTO contract_events VALUES(84532,$1,0)',[tx]);
    await pool.query(`INSERT INTO artwork_donations(chain_id,contract_address,transaction_hash,log_index,block_number,
      artwork_id,creator,donor,amount,anonymous,message,recorded_at) VALUES(84532,$1,$2,0,1,28,$3,$4,999,false,'Message',now())`,[CORE,tx,OWNER,A]);
    const donation=(await pool.query("SELECT * FROM submit_moderation_report(84532,28,$1,'spam','Evidence',NULL,TRUE,5,'donation_message',$2,$3,0)",[B,CORE,tx])).rows[0];
    const decideDonation=async action=>(await pool.query("SELECT * FROM review_moderation_report($1,$2,$3,'Review',$4,'donation_message')",
      [donation.report_id,(await row(donation.report_id)).version,action,STAFF])).rows[0];
    assert.equal((await decideDonation('hide')).target_hidden,true); assert.equal((await decideDonation('restore')).target_hidden,false);
    assert.equal((await visibility()).hidden,false);
  });
  await t.test('browser roles cannot bypass masking through raw profiles, evidence, views or privileged functions', async () => {
    await submit();
    const client=await pool.connect();
    try {
      for (const role of ['anon','authenticated']) {
        await client.query(`SET ROLE ${role}`);
        for (const table of ['profiles','artwork_reports','artwork_report_events','artwork_report_notifications','public_profile_content','profile_content_visibility'])
          await assert.rejects(client.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
        await assert.rejects(client.query("SELECT * FROM submit_profile_content_report($1,$2,'spam','Evidence',NULL,TRUE,5)",[OWNER,A]),e=>e.code==='42501');
        await assert.rejects(client.query("SELECT * FROM review_profile_content_report(NULL,NULL,'hide','Review',$1)",[STAFF]),e=>e.code==='42501');
        await client.query('RESET ROLE');
      }
      await client.query('SET ROLE service_role');
      assert.equal((await client.query('SELECT wallet_address FROM public_profile_content')).rowCount,2);
    } finally { await client.query('RESET ROLE'); client.release(); }
  });
  await t.test('migration reapplication preserves recorded evidence and active masks', async () => {
    const report=await submit(); await review(report.report_id,'hide'); const before=await row(report.report_id);
    await pool.query(migration('profile_content_moderation.sql'));
    assert.deepEqual(await row(report.report_id),before); assert.equal((await visibility()).hidden,true);
  });
});
