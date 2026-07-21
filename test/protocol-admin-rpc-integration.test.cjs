// A8c Protocol Admin integration coverage against disposable PostgreSQL 17.
// The real SQL proves deterministic review transitions, independent complaint
// records, append-only evidence, notification obligations, and rollback safety.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execSync, execFileSync, spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const VISIBILITY = fs.readFileSync(path.join(ROOT, 'sql/migrations/phase18_artwork_moderation_visibility.sql'), 'utf8');
const INTAKE = fs.readFileSync(path.join(ROOT, 'sql/migrations/a8b_artwork_report_intake.sql'), 'utf8');
const REVIEW = fs.readFileSync(path.join(ROOT, 'sql/migrations/a8c_protocol_admin_review.sql'), 'utf8');
const CONTAINER = `artsoul-a8c-pg-${process.pid}`;
const IMAGE = 'postgres:17';
const STAFF = '0x1111111111111111111111111111111111111111';
const REPORTER_A = '0x2222222222222222222222222222222222222222';
const REPORTER_B = '0x3333333333333333333333333333333333333333';
const CREATOR = '0x4444444444444444444444444444444444444444';

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return execSync('docker version --format {{.Server.Os}}', { encoding: 'utf8' }).trim() === 'linux';
  } catch {
    return false;
  }
}

const HAVE_DOCKER = dockerAvailable();

function psql(sql, { expectError = false } = {}) {
  try {
    const output = execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (expectError) throw new Error(`Expected SQL failure but statement succeeded:\n${sql}`);
    return output.trim();
  } catch (error) {
    if (expectError) return String(error.stderr || error.message);
    throw new Error(`psql failed: ${sql}\n${error.stderr || error.message}`);
  }
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul',
      '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', sql
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `parallel psql failed (${code})`));
    });
  });
}

function applySql(sql) {
  execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: sql, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' }
  );
}

function submit(reporter, category = 'copyright') {
  return psql(`SELECT report_id FROM public.submit_artwork_report(
    84532, 42, '${reporter}', '${category}', 'Evidence for independent review.',
    'https://example.com/evidence', TRUE, 5
  );`).split('|')[0];
}

function versionOf(reportId) {
  return psql(`SELECT updated_at::TEXT FROM public.artwork_reports WHERE id = '${reportId}';`);
}

function review(reportId, action, reason) {
  const version = versionOf(reportId);
  return psql(`SELECT report_id, report_status, report_updated_at, artwork_hidden
    FROM public.review_artwork_report(
      '${reportId}', '${version}', '${action}', '${reason}', '${STAFF}'
    );`);
}

test('A8c review RPC integration (PostgreSQL 17)', { skip: HAVE_DOCKER ? false : 'Docker is not available' }, async t => {
  t.before(() => {
    try {
      execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
    } catch {
      // The disposable container does not normally exist before the test.
    }
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=artsoul ${IMAGE}`,
      { stdio: 'ignore' }
    );

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const args = ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1;'];
        execFileSync('docker', args, { stdio: 'ignore' });
        wait(500);
        execFileSync('docker', args, { stdio: 'ignore' });
        ready = true;
        break;
      } catch {
        wait(500);
      }
    }
    if (!ready) throw new Error('PostgreSQL did not become ready in time');

    psql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
    psql(`CREATE TABLE public.v41_artworks (
      chain_id NUMERIC(78, 0) NOT NULL,
      artwork_id NUMERIC(78, 0) NOT NULL,
      creator VARCHAR(42) NOT NULL,
      PRIMARY KEY (chain_id, artwork_id)
    );`);
    applySql(VISIBILITY);
    applySql(INTAKE);
    applySql(REVIEW);
    psql(`INSERT INTO public.v41_artworks (chain_id, artwork_id, creator) VALUES (84532, 42, '${CREATOR}');`);
  });

  t.after(() => {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
  });

  t.beforeEach(() => {
    psql(`TRUNCATE
      public.artwork_report_notifications,
      public.artwork_report_events,
      public.artwork_reports,
      public.artwork_moderation_log,
      public.artwork_moderation_visibility
      RESTART IDENTITY CASCADE;`);
  });

  await t.test('two stale concurrent decisions produce one transition and one conflict', async () => {
    const reportId = submit(REPORTER_A);
    const version = versionOf(reportId);
    const base = `FROM public.review_artwork_report(
      '${reportId}', '${version}',`;
    const outcomes = await Promise.allSettled([
      psqlAsync(`SELECT report_status ${base} 'hide', 'Verified copyright evidence.', '${STAFF}');`),
      psqlAsync(`SELECT report_status ${base} 'dismiss', 'Claim was not substantiated.', '${STAFF}');`)
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
    assert.match(String(outcomes.find(result => result.status === 'rejected').reason), /REPORT_REVIEW_CONFLICT/);
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE event_type IN ('REPORT_HIDDEN', 'REPORT_DISMISSED');`), '1');
  });

  await t.test('independent actioned reports keep artwork hidden until the last one is resolved', () => {
    const first = submit(REPORTER_A, 'copyright');
    const second = submit(REPORTER_B, 'impersonation');
    assert.match(review(first, 'hide', 'Copyright evidence verified.'), /\|actioned\|.*\|t$/m);
    assert.match(review(second, 'hide', 'Impersonation evidence verified.'), /\|actioned\|.*\|t$/m);

    // A valid actioned complaint closes as 'resolved', never 'dismissed'.
    assert.match(review(first, 'restore', 'First complaint has been resolved.'), /\|resolved\|.*\|t$/m);
    assert.equal(psql('SELECT hidden FROM public.artwork_moderation_visibility WHERE chain_id = 84532 AND artwork_id = 42;'), 't');

    assert.match(review(second, 'restore', 'Final complaint has been resolved.'), /\|resolved\|.*\|f$/m);
    assert.equal(psql('SELECT hidden FROM public.artwork_moderation_visibility WHERE chain_id = 84532 AND artwork_id = 42;'), 'f');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE event_type IN ('REPORT_HIDDEN', 'REPORT_RESOLVED', 'REPORT_RESTORED') AND reason IS NOT NULL;`), '4');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE event_type = 'REPORT_RESOLVED';`), '1');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE event_type = 'REPORT_RESTORED';`), '1');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_notifications
      WHERE notification_type = 'REPORT_RESOLVED';`), '2');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_notifications
      WHERE notification_type = 'REPORT_DISMISSED';`), '0');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_notifications
      WHERE notification_type = 'ARTWORK_RESTORED';`), '1');
  });

  await t.test('resolving the final actioned report of an already-visible artwork does not claim a restoration', () => {
    const reportId = submit(REPORTER_A);
    assert.match(review(reportId, 'hide', 'Evidence verified.'), /\|actioned\|.*\|t$/m);

    // Staff restores visibility out-of-band (the A-20 visibility path).
    psql(`SELECT public.set_artwork_moderation_visibility(84532, 42, FALSE, NULL, '${STAFF}');`);
    assert.equal(psql('SELECT hidden FROM public.artwork_moderation_visibility WHERE chain_id = 84532 AND artwork_id = 42;'), 'f');

    assert.match(review(reportId, 'restore', 'Complaint resolved after manual restore.'), /\|resolved\|.*\|f$/m);
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE report_id = '${reportId}' AND event_type = 'REPORT_RESOLVED';`), '1');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE event_type = 'REPORT_RESTORED';`), '0');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_notifications
      WHERE notification_type = 'ARTWORK_RESTORED';`), '0');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_notifications
      WHERE report_id = '${reportId}' AND notification_type = 'REPORT_RESOLVED';`), '1');
  });

  await t.test('an actioned report cannot be reopened; closed reports can, once', () => {
    const reportId = submit(REPORTER_A);
    assert.match(review(reportId, 'hide', 'Evidence verified.'), /\|actioned\|.*\|t$/m);

    // Reopening an active hide would strand the artwork hidden without an
    // active report, so it is rejected outright.
    const blocked = psql(`SELECT * FROM public.review_artwork_report(
      '${reportId}', '${versionOf(reportId)}', 'reopen', 'Second look requested.', '${STAFF}'
    );`, { expectError: true });
    assert.match(blocked, /REPORT_ACTION_NOT_ALLOWED/);

    // resolved -> pending_review is a legal reopen and reactivates review.
    assert.match(review(reportId, 'restore', 'Complaint resolved.'), /\|resolved\|/m);
    assert.match(review(reportId, 'reopen', 'New evidence arrived.'), /\|pending_review\|/m);
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE report_id = '${reportId}' AND event_type = 'REPORT_REOPENED';`), '1');
  });

  await t.test('reopen fails with REPORT_ALREADY_PENDING when a newer pending duplicate exists', () => {
    const first = submit(REPORTER_A, 'copyright');
    assert.match(review(first, 'dismiss', 'Claim was not substantiated.'), /\|dismissed\|/m);

    // The same reporter files a fresh pending report of the same category.
    const second = submit(REPORTER_A, 'copyright');
    assert.notEqual(second, first);

    const conflict = psql(`SELECT * FROM public.review_artwork_report(
      '${first}', '${versionOf(first)}', 'reopen', 'Revisiting the first claim.', '${STAFF}'
    );`, { expectError: true });
    assert.match(conflict, /REPORT_ALREADY_PENDING/);

    // Both rows survive as independent records and the first stays dismissed.
    assert.equal(psql(`SELECT status FROM public.artwork_reports WHERE id = '${first}';`), 'dismissed');
    assert.equal(psql(`SELECT status FROM public.artwork_reports WHERE id = '${second}';`), 'pending_review');
    assert.equal(psql('SELECT COUNT(*) FROM public.artwork_reports;'), '2');

    // A different category from the same reporter does not block the reopen.
    assert.match(review(second, 'dismiss', 'Duplicate of the dismissed claim.'), /\|dismissed\|/m);
    assert.match(review(first, 'reopen', 'No pending duplicate remains.'), /\|pending_review\|/m);
  });

  await t.test('notification failure rolls back the report, visibility and audit transition', () => {
    const reportId = submit(REPORTER_A);
    const version = versionOf(reportId);
    psql(`CREATE OR REPLACE FUNCTION public._a8c_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'forced notification failure'; END; $f$;`);
    psql(`CREATE TRIGGER _a8c_fail_notification BEFORE INSERT ON public.artwork_report_notifications
      FOR EACH ROW EXECUTE FUNCTION public._a8c_fail_notification();`);
    const error = psql(`SELECT * FROM public.review_artwork_report(
      '${reportId}', '${version}', 'hide', 'Verified evidence.', '${STAFF}'
    );`, { expectError: true });
    assert.match(error, /forced notification failure/);
    assert.equal(psql(`SELECT status FROM public.artwork_reports WHERE id = '${reportId}';`), 'pending_review');
    assert.equal(psql('SELECT COUNT(*) FROM public.artwork_moderation_visibility;'), '0');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artwork_report_events
      WHERE event_type <> 'REPORT_SUBMITTED';`), '0');
    psql('DROP TRIGGER _a8c_fail_notification ON public.artwork_report_notifications;');
  });

  await t.test('complaint, audit and notification data remain service-role only', () => {
    assert.equal(psql(`SELECT bool_and(relforcerowsecurity) FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('artwork_reports', 'artwork_report_events', 'artwork_report_notifications');`), 't');
    assert.equal(psql(`SELECT COUNT(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
      AND table_name IN ('artwork_reports', 'artwork_report_events', 'artwork_report_notifications')
      AND grantee IN ('anon', 'authenticated');`), '0');
    assert.equal(psql(`SELECT COUNT(*) FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
      AND routine_name = 'review_artwork_report'
      AND grantee IN ('anon', 'authenticated');`), '0');
  });
});
