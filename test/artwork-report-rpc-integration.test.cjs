// A8b report-intake integration coverage against disposable PostgreSQL 17.
// The real SQL proves atomic report+event writes, pending-report deduplication,
// target validation, and forced-RLS privileges. If Docker is unavailable the
// suite skips without weakening the pure handler/source tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'sql/migrations/a8b_artwork_report_intake.sql'), 'utf8');
const CONTAINER = `artsoul-a8b-pg-${process.pid}`;
const IMAGE = 'postgres:17';
const REPORTER = '0x1111111111111111111111111111111111111111';

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

function submit(category = 'copyright', artworkId = 42) {
  return psql(`SELECT report_id, report_status, already_submitted
    FROM public.submit_artwork_report(
      84532,
      ${artworkId},
      '${REPORTER}',
      '${category}',
      'The source artwork predates this upload.',
      'https://example.com/original',
      TRUE
    );`);
}

test('A8b report RPC integration (PostgreSQL 17)', { skip: HAVE_DOCKER ? false : 'Docker is not available' }, async (t) => {
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
        const readinessArgs = ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1;'];
        execFileSync('docker', readinessArgs, { stdio: 'ignore' });
        wait(500);
        execFileSync('docker', readinessArgs, { stdio: 'ignore' });
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
      PRIMARY KEY (chain_id, artwork_id)
    );`);
    execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      { input: MIGRATION, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' }
    );
    psql('INSERT INTO public.v41_artworks (chain_id, artwork_id) VALUES (84532, 42);');
  });

  t.after(() => {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
  });

  t.beforeEach(() => {
    psql('TRUNCATE public.artwork_report_events, public.artwork_reports RESTART IDENTITY;');
  });

  await t.test('submission writes one pending report and one append-only event', () => {
    const result = submit();
    assert.match(result, /^[0-9a-f-]+\|pending_review\|f$/m);
    assert.equal(psql('SELECT COUNT(*) FROM public.artwork_reports;'), '1');
    assert.equal(psql("SELECT COUNT(*) FROM public.artwork_report_events WHERE event_type = 'REPORT_SUBMITTED';"), '1');
  });

  await t.test('a repeated pending category returns the existing report without a second event', () => {
    const first = submit().split('|')[0];
    const second = submit();
    assert.match(second, new RegExp(`^${first}\\|pending_review\\|t$`, 'm'));
    assert.equal(psql('SELECT COUNT(*) FROM public.artwork_reports;'), '1');
    assert.equal(psql('SELECT COUNT(*) FROM public.artwork_report_events;'), '1');
  });

  await t.test('an audit failure rolls back the new report', () => {
    psql(`CREATE OR REPLACE FUNCTION public._a8b_fail_event() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'forced event failure'; END; $f$;`);
    psql(`CREATE TRIGGER _a8b_fail_event BEFORE INSERT ON public.artwork_report_events
      FOR EACH ROW EXECUTE FUNCTION public._a8b_fail_event();`);
    const error = psql(`SELECT * FROM public.submit_artwork_report(
      84532, 42, '${REPORTER}', 'other', 'Review this concern.', NULL, TRUE
    );`, { expectError: true });
    assert.match(error, /forced event failure/);
    assert.equal(psql('SELECT COUNT(*) FROM public.artwork_reports;'), '0');
    psql('DROP TRIGGER _a8b_fail_event ON public.artwork_report_events;');
  });

  await t.test('an unknown artwork is rejected without storing a complaint', () => {
    const error = psql(`SELECT * FROM public.submit_artwork_report(
      84532, 999, '${REPORTER}', 'copyright', 'Unknown target.', NULL, TRUE
    );`, { expectError: true });
    assert.match(error, /Artwork not found/);
    assert.equal(psql('SELECT COUNT(*) FROM public.artwork_reports;'), '0');
  });

  await t.test('forced RLS and grants keep complaint content service-role only', () => {
    assert.equal(psql(`SELECT bool_and(relforcerowsecurity) FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('artwork_reports', 'artwork_report_events');`), 't');
    assert.equal(psql(`SELECT COUNT(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
      AND table_name IN ('artwork_reports', 'artwork_report_events')
      AND grantee IN ('anon', 'authenticated');`), '0');
    assert.equal(psql(`SELECT COUNT(*) FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
      AND routine_name = 'submit_artwork_report'
      AND grantee IN ('anon', 'authenticated');`), '0');
  });
});
