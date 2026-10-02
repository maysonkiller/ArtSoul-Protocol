// Disposable PostgreSQL only. No live migration, wallet or deployment is used.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const test = require('node:test');
const {Pool} = require('pg');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-donation-review-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const STAFF = `0x${'1'.repeat(40)}`, SUPPORT = `0x${'2'.repeat(40)}`, DONOR = `0x${'3'.repeat(40)}`;
const CREATOR = `0x${'4'.repeat(40)}`, A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`;
const tx = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const migration = name => fs.readFileSync(path.join(ROOT, 'sql/migrations', name), 'utf8');
function docker(...args) { return execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore','pipe','pipe']}).trim(); }
function haveDocker() { try { return docker('version','--format','{{.Server.Os}}') === 'linux'; } catch { return false; } }

test('typed message moderation remains atomic, private and independent from donated value (PostgreSQL 17)', {
  skip: haveDocker() ? false : 'Docker is unavailable; disposable PostgreSQL is required'
}, async t => {
  let created = false, pool;
  t.after(async () => { if (pool) await pool.end(); if (created) docker('rm','-f',CONTAINER); });
  docker('run','-d','--name',CONTAINER,'-e','POSTGRES_PASSWORD=local-review-only','-e','POSTGRES_DB=artsoul',
    '-p','127.0.0.1::5432','postgres:17'); created = true;
  const endpoint = docker('port', CONTAINER, '5432/tcp'); assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
  pool = new Pool({host: '127.0.0.1', port: Number(endpoint.split(':')[1]), database: 'artsoul', user: 'postgres',
    password: 'local-review-only', connectionTimeoutMillis: 1000, max: 12});
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { await pool.query('SELECT 1'); await delay(250); await pool.query('SELECT 1'); ready = true; break; }
    catch { await delay(500); }
  }
  assert.ok(ready, 'disposable PostgreSQL became ready');
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.v41_artworks (chain_id NUMERIC(78,0), artwork_id NUMERIC(78,0), creator TEXT,
      canonical_floor NUMERIC(78,0) DEFAULT 0, token_id NUMERIC(78,0), PRIMARY KEY(chain_id,artwork_id));
    CREATE TABLE public.contract_events (chain_id NUMERIC(78,0),transaction_hash TEXT,log_index INTEGER,
      PRIMARY KEY(chain_id,transaction_hash,log_index));`);
  for (const name of ['phase18_artwork_moderation_visibility.sql','a8b_artwork_report_intake.sql',
    'a8c_protocol_admin_review.sql','artist_support.sql','artist_support_moderation.sql']) await pool.query(migration(name));
  async function seed() {
    await pool.query(`TRUNCATE public.artwork_report_notifications,public.artwork_report_events,public.artwork_reports,
      public.artwork_moderation_log,public.artwork_moderation_visibility,public.donation_message_visibility,
      public.contract_events,public.v41_artworks RESTART IDENTITY CASCADE;
      INSERT INTO public.v41_artworks(chain_id,artwork_id,creator,canonical_floor,token_id)
      VALUES(84532,28,'${CREATOR}',123,8),(84532,29,'${CREATOR}',0,NULL),(11155111,28,'${CREATOR}',99,9);`);
    for (let n = 1; n <= 5; n++) {
      await pool.query('INSERT INTO public.contract_events VALUES(84532,$1,0)', [tx(n)]);
      await pool.query(`INSERT INTO public.artwork_donations(chain_id,contract_address,transaction_hash,log_index,block_number,
        artwork_id,creator,donor,amount,anonymous,message,recorded_at) VALUES(84532,$1,$2,0,100,28,$3,$4,999,true,$5,now())`,
        [SUPPORT,tx(n),CREATOR,DONOR,`Message ${n}`]);
    }
  }
  t.beforeEach(seed);
  async function submit({wallet = A, category = 'spam', event = 1, target = 'donation_message', work = 28, contract = SUPPORT, limit = 5} = {}) {
    const args = [84532,work,wallet,category,'Evidence for review.',null,true,limit];
    if (target === 'artwork') return (await pool.query('SELECT * FROM public.submit_artwork_report($1,$2,$3,$4,$5,$6,$7,$8)',args)).rows[0];
    return (await pool.query('SELECT * FROM public.submit_moderation_report($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [...args,target,contract,tx(event),0])).rows[0];
  }
  async function row(id) { return (await pool.query('SELECT *,updated_at::TEXT AS version FROM public.artwork_reports WHERE id=$1',[id])).rows[0]; }
  async function review(id,action,target = 'donation_message',version) {
    const parameters = [id,version || (await row(id)).version,action,'Verified evidence.',STAFF];
    const sql = target === 'artwork' ? 'SELECT * FROM public.review_artwork_report($1,$2,$3,$4,$5)'
      : 'SELECT * FROM public.review_moderation_report($1,$2,$3,$4,$5,$6)';
    return (await pool.query(sql,target === 'artwork' ? parameters : [...parameters,target])).rows[0];
  }
  async function donations() { return (await pool.query('SELECT * FROM public.artwork_donations ORDER BY transaction_hash')).rows; }
  async function artworks() { return (await pool.query('SELECT * FROM public.v41_artworks ORDER BY chain_id,artwork_id')).rows; }
  async function hidden(event) { return (await pool.query('SELECT hidden FROM public.donation_message_visibility WHERE transaction_hash=$1',[tx(event)])).rows[0]?.hidden || false; }
  async function audit(id) { return (await pool.query('SELECT event_type,actor_wallet,reason FROM public.artwork_report_events WHERE report_id=$1 ORDER BY id',[id])).rows; }

  await t.test('old artwork RPC signatures remain functional and distinct targets have independent deduplication', async () => {
    const artwork = await submit({target:'artwork'}), first = await submit(), second = await submit({event:2});
    assert.equal(new Set([artwork.report_id,first.report_id,second.report_id]).size,3);
    assert.equal((await submit()).report_id,first.report_id); assert.equal((await submit()).already_submitted,true);
    assert.equal((await submit({target:'artwork'})).report_id,artwork.report_id);
    assert.equal((await row(first.report_id)).target_author_wallet,DONOR);
    assert.equal((await row(artwork.report_id)).target_type,'artwork');
    assert.equal((await review(artwork.report_id,'hide','artwork')).artwork_hidden,true);
    assert.equal(await hidden(1),false);
    assert.equal((await review(artwork.report_id,'restore','artwork')).artwork_hidden,false);
    assert.equal((await pool.query('SELECT COUNT(*) FROM public.artwork_reports')).rows[0].count,'3');
  });
  await t.test('intake resolves exact indexed content and never accepts another work, deployment, absent or empty text', async () => {
    for (const input of [{work:29},{contract:CREATOR},{event:99}]) {
      await assert.rejects(submit(input),/DONATION_MESSAGE_NOT_FOUND/);
    }
    await pool.query('UPDATE public.artwork_donations SET message=NULL WHERE transaction_hash=$1',[tx(1)]);
    await assert.rejects(submit(),/DONATION_MESSAGE_NOT_FOUND/);
    await pool.query("UPDATE public.artwork_donations SET message='' WHERE transaction_hash=$1",[tx(1)]);
    await assert.rejects(submit(),/DONATION_MESSAGE_NOT_FOUND/);
    assert.equal((await pool.query('SELECT COUNT(*) FROM public.artwork_reports')).rows[0].count,'0');
    await assert.rejects(pool.query(`SELECT * FROM public.submit_moderation_report(84532,28,$1,'spam','Evidence',NULL,true,5,'artwork',$2,$3,0)`,[A,SUPPORT,tx(2)]),/INVALID_REPORT_TARGET/);
  });
  await t.test('one rolling cap covers concurrent artwork and donation-message intake without dropping idempotent receipts', async () => {
    const categories = ['spam','other','copyright','impersonation','prohibited_content'];
    const outcomes = await Promise.allSettled(categories.flatMap((category,i) => [submit({category,event:i+1}),submit({category,target:'artwork'})]));
    assert.equal(outcomes.filter(x => x.status==='fulfilled').length,5);
    assert.equal(outcomes.filter(x => x.status==='rejected').length,5);
    assert.ok(outcomes.filter(x => x.status==='rejected').every(x => /REPORT_DAILY_LIMIT_REACHED/.test(x.reason.message)));
    const accepted = (await pool.query('SELECT * FROM public.artwork_reports LIMIT 1')).rows[0];
    const replay = await submit({category:accepted.category,target:accepted.target_type,
      event:accepted.donation_transaction_hash ? Number(BigInt(accepted.donation_transaction_hash)) : 1});
    assert.equal(replay.already_submitted,true); assert.equal(replay.report_id,accepted.id);
    const versions = (await pool.query('SELECT COUNT(*) FROM public.artwork_reports')).rows[0].count;
    assert.equal(versions,'5');
  });
  await t.test('hide changes only message visibility; independent complaints restore only their exact content target', async () => {
    const beforeDonations = await donations(), beforeArtworks = await artworks();
    const first = await submit(), other = await submit({wallet:B}), anotherMessage = await submit({event:2}), work = await submit({target:'artwork'});
    for (const id of [first.report_id,other.report_id,anotherMessage.report_id]) assert.equal((await review(id,'hide')).target_hidden,true);
    await review(work.report_id,'hide','artwork');
    assert.equal((await review(first.report_id,'restore')).target_hidden,true);
    assert.equal(await hidden(1),true); assert.equal(await hidden(2),true);
    assert.equal((await review(other.report_id,'restore')).target_hidden,false);
    assert.equal(await hidden(1),false); assert.equal(await hidden(2),true);
    assert.equal((await pool.query('SELECT hidden FROM public.artwork_moderation_visibility WHERE chain_id=84532 AND artwork_id=28')).rows[0].hidden,true);
    assert.deepEqual(await donations(),beforeDonations); assert.deepEqual(await artworks(),beforeArtworks);
    assert.equal((await pool.query("SELECT COUNT(*) FROM public.artwork_report_notifications WHERE notification_type='DONATION_MESSAGE_RESTORED'")).rows[0].count,'1');
    assert.ok((await audit(other.report_id)).some(e => e.event_type==='REPORT_RESTORED'));
    assert.ok((await audit(first.report_id)).some(e => e.event_type==='REPORT_RESOLVED'));
  });
  await t.test('target mismatch and concurrent stale versions cannot redirect or duplicate a recorded decision', async () => {
    const report = await submit();
    await assert.rejects(review(report.report_id,'hide','artwork'),/REPORT_TARGET_MISMATCH/);
    await assert.rejects(review(report.report_id,'hide','invented'),/REPORT_TARGET_MISMATCH/);
    assert.equal(await hidden(1),false);
    const version = (await row(report.report_id)).version;
    const outcomes = await Promise.allSettled([review(report.report_id,'hide','donation_message',version),review(report.report_id,'dismiss','donation_message',version)]);
    assert.equal(outcomes.filter(x => x.status==='fulfilled').length,1);
    assert.match(outcomes.find(x => x.status==='rejected').reason.message,/REPORT_REVIEW_CONFLICT/);
    const events = await audit(report.report_id);
    assert.equal(events.filter(e => ['REPORT_HIDDEN','REPORT_DISMISSED'].includes(e.event_type)).length,1);
  });
  await t.test('typed reopen collision is isolated to matching event and cannot strand an actioned report', async () => {
    const closed = await submit(); await review(closed.report_id,'dismiss');
    const replacement = await submit(); assert.notEqual(replacement.report_id,closed.report_id);
    await assert.rejects(review(closed.report_id,'reopen'),/REPORT_ALREADY_PENDING/);
    await review(replacement.report_id,'hide'); await assert.rejects(review(replacement.report_id,'reopen'),/REPORT_ACTION_NOT_ALLOWED/);
    const different = await submit({event:2}); await review(different.report_id,'dismiss');
    assert.equal((await review(different.report_id,'reopen')).report_status,'pending_review');
    assert.equal(await hidden(1),true); assert.equal(await hidden(2),false);
  });
  await t.test('audit or notification insertion failure rolls back visibility, status and all earlier writes', async () => {
    for (const table of ['artwork_report_events','artwork_report_notifications']) {
      const report = await submit({event:table==='artwork_report_events'?1:2});
      await pool.query(`CREATE FUNCTION public.local_fail_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_REVIEW_FAILURE'; END $$;
        CREATE TRIGGER local_review_failure BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.local_fail_review();`);
      try { await assert.rejects(review(report.report_id,'hide'),/LOCAL_REVIEW_FAILURE/); }
      finally { await pool.query(`DROP TRIGGER local_review_failure ON public.${table}; DROP FUNCTION public.local_fail_review();`); }
      assert.equal((await row(report.report_id)).status,'pending_review');
      assert.equal(await hidden(table==='artwork_report_events'?1:2),false);
      assert.equal((await audit(report.report_id)).length,1);
      assert.equal((await pool.query('SELECT COUNT(*) FROM public.artwork_report_notifications WHERE report_id=$1',[report.report_id])).rows[0].count,'0');
      await review(report.report_id,'hide');
      assert.equal((await pool.query('SELECT COUNT(*) FROM public.artwork_report_notifications WHERE report_id=$1',[report.report_id])).rows[0].count,'2');
    }
  });
  await t.test('anonymous author notices and moderation evidence survive projection rollback and replay', async () => {
    const report = await submit(); await review(report.report_id,'hide');
    const notices = (await pool.query('SELECT recipient_wallet,notification_type FROM public.artwork_report_notifications WHERE report_id=$1 ORDER BY id',[report.report_id])).rows;
    assert.deepEqual(notices,[{recipient_wallet:A,notification_type:'REPORT_ACTIONED'},{recipient_wallet:DONOR,notification_type:'DONATION_MESSAGE_HIDDEN'}]);
    const original = (await donations())[0];
    await pool.query('DELETE FROM public.contract_events WHERE transaction_hash=$1',[tx(1)]);
    assert.equal((await pool.query('SELECT * FROM public.artwork_donations WHERE transaction_hash=$1',[tx(1)])).rowCount,0);
    assert.equal((await row(report.report_id)).target_author_wallet,DONOR); assert.equal(await hidden(1),true);
    const resolved = await review(report.report_id,'restore'); assert.equal(resolved.target_hidden,false);
    assert.equal((await pool.query("SELECT recipient_wallet FROM public.artwork_report_notifications WHERE report_id=$1 AND notification_type='DONATION_MESSAGE_RESTORED'",[report.report_id])).rows[0].recipient_wallet,DONOR);
    await pool.query('INSERT INTO public.contract_events VALUES(84532,$1,0)',[tx(1)]);
    const keys = Object.keys(original), values = Object.values(original);
    await pool.query(`INSERT INTO public.artwork_donations(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,values);
    assert.equal(await hidden(1),false); assert.equal((await audit(report.report_id)).length,5);
  });
  await t.test('one bounded read resolves stored targets and hidden text without donor leakage or unrelated projections', async () => {
    const first = await submit(), second = await submit({event:2}), artwork = await submit({target:'artwork'});
    await review(first.report_id,'hide');
    await pool.query('UPDATE public.artwork_donations SET message=$1 WHERE transaction_hash=$2',['<img src=x onerror=alert(1)>',tx(1)]);
    const ids = [first.report_id,second.report_id,artwork.report_id];
    const before = (await pool.query('SELECT * FROM public.read_donation_report_messages($1)',[ids])).rows;
    assert.equal(before.length,2); const map = new Map(before.map(row=>[row.report_id,row]));
    assert.deepEqual(map.get(first.report_id),{report_id:first.report_id,message:'<img src=x onerror=alert(1)>',available:true,hidden:true});
    assert.deepEqual(Object.keys(before[0]).sort(),['available','hidden','message','report_id']);
    // Replacement projections with the same event key but a different work or
    // deployment must not become the content under review.
    await pool.query('UPDATE public.artwork_donations SET contract_address=$1 WHERE transaction_hash=$2',[CREATOR,tx(1)]);
    assert.equal((await pool.query('SELECT * FROM public.read_donation_report_messages($1)',[[first.report_id]])).rows[0].available,false);
    await pool.query('DELETE FROM public.contract_events WHERE transaction_hash=$1',[tx(2)]);
    const missing = (await pool.query('SELECT * FROM public.read_donation_report_messages($1)',[[second.report_id]])).rows[0];
    assert.deepEqual(missing,{report_id:second.report_id,message:null,available:false,hidden:false});
    await assert.rejects(pool.query('SELECT * FROM public.read_donation_report_messages($1)',[Array(201).fill(first.report_id)]),/INVALID_REPORT_BATCH/);
  });
  await t.test('browser roles have no typed RPC or private-table privileges; service RPC is explicitly granted', async () => {
    const signatures = ['submit_moderation_report(numeric,numeric,text,text,text,text,boolean,integer,text,text,text,integer)',
      'review_moderation_report(uuid,timestamptz,text,text,text,text)', 'submit_artwork_report(numeric,numeric,text,text,text,text,boolean,integer)',
      'review_artwork_report(uuid,timestamptz,text,text,text)', 'read_donation_report_messages(uuid[])'];
    for (const role of ['anon','authenticated']) {
      for (const signature of signatures) assert.equal((await pool.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,`public.${signature}`])).rows[0].allowed,false);
      for (const table of ['artwork_reports','artwork_report_events','artwork_report_notifications','donation_message_visibility']) {
        assert.equal((await pool.query('SELECT has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') AS allowed',[role,`public.${table}`])).rows[0].allowed,false);
      }
      const client = await pool.connect();
      try { await client.query(`BEGIN; SET LOCAL ROLE ${role}`);
        await assert.rejects(client.query('SELECT * FROM public.review_moderation_report(NULL,NULL,\'hide\',\'Evidence\',$1,\'donation_message\')',[STAFF]),e => e.code==='42501');
      } finally { await client.query('ROLLBACK'); client.release(); }
    }
    for (const signature of signatures) assert.equal((await pool.query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS allowed',[`public.${signature}`])).rows[0].allowed,true);
    const client = await pool.connect();
    try { await client.query('BEGIN; SET LOCAL ROLE service_role');
      const result = await client.query('SELECT * FROM public.submit_moderation_report(84532,28,$1,\'spam\',\'Evidence\',NULL,true,5,\'donation_message\',$2,$3,0)',[A,SUPPORT,tx(1)]);
      assert.ok(result.rows[0].report_id); await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  await t.test('reapplying the additive migration retains typed reports, decisions and notices', async () => {
    const report = await submit(); await review(report.report_id,'hide');
    const before = await row(report.report_id), beforeAudit = await audit(report.report_id);
    await pool.query(migration('artist_support_moderation.sql'));
    assert.deepEqual(await row(report.report_id),before); assert.deepEqual(await audit(report.report_id),beforeAudit); assert.equal(await hidden(1),true);
    assert.equal((await review(report.report_id,'restore')).target_hidden,false);
  });
  await t.test('catalog-only activation preflight executes in a read-only transaction without altering data', async () => {
    const report = await submit(), before = await row(report.report_id);
    for (const file of ['artist_support.sql','artist_support_moderation.sql']) {
      const sql = fs.readFileSync(path.join(ROOT,'sql/verification',file),'utf8');
      assert.match(sql,/BEGIN TRANSACTION READ ONLY/);
      const results = await pool.query(sql);
      assert.ok(results.length > 2);
    }
    assert.deepEqual(await row(report.report_id),before);
  });
});
