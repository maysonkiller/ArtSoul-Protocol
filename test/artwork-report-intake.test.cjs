const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const STAFF = '0x1111111111111111111111111111111111111111';

process.env.SESSION_SECRET = 'artwork-report-intake-test-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
process.env.ARTSOUL_REPORTING_ENABLED = 'true';
process.env.ARTSOUL_REPORT_DAILY_LIMIT = '5';

function moduleUrl(relativePath, suffix = '') {
  return `${pathToFileURL(path.join(ROOT, relativePath)).href}${suffix}`;
}

const modules = Promise.all([
  import(moduleUrl('src/api/routes/moderation/reports.js')),
  import(moduleUrl('src/api/backend.js'))
]);

function responseHarness() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    }
  };
}

async function sessionCookie() {
  const [, backend] = await modules;
  const res = responseHarness();
  backend.setWalletSession(res, STAFF);
  return String(res.headers['Set-Cookie']).split(';')[0];
}

function request(body = {}, cookie = '') {
  return {
    method: 'POST',
    headers: { cookie },
    body,
    query: {},
    url: '/api/moderation/reports'
  };
}

function supabaseResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test('reporting stays fail-closed when the server feature flag is disabled', async () => {
  const [{ default: handler }] = await modules;
  process.env.ARTSOUL_REPORTING_ENABLED = 'false';
  try {
    const res = responseHarness();
    await handler(request({}), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'REPORTING_DISABLED');
  } finally {
    process.env.ARTSOUL_REPORTING_ENABLED = 'true';
  }
});

test('reporting stays fail-closed until a positive daily intake limit is configured', async () => {
  const [{ default: handler }] = await modules;
  const previousLimit = process.env.ARTSOUL_REPORT_DAILY_LIMIT;
  delete process.env.ARTSOUL_REPORT_DAILY_LIMIT;
  try {
    const res = responseHarness();
    await handler(request({}), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'REPORTING_LIMIT_NOT_CONFIGURED');
  } finally {
    process.env.ARTSOUL_REPORT_DAILY_LIMIT = previousLimit;
  }
});

test('an authenticated wallet is required before complaint data reaches Supabase', async () => {
  const [{ default: handler }] = await modules;
  let fetchCalled = false;
  const previousFetch = global.fetch;
  global.fetch = async () => {
    fetchCalled = true;
    return supabaseResponse([]);
  };
  try {
    const res = responseHarness();
    await handler(request({}), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'UNAUTHENTICATED');
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('report input fails closed for unsupported chains, categories, URLs, and declarations', async () => {
  const [{ default: handler }] = await modules;
  const cookie = await sessionCookie();
  const cases = [
    [{ chain_id: 8453, artwork_id: '9', category: 'copyright', details: 'Concern', good_faith_confirmed: true }, 'UNSUPPORTED_ARTWORK_CHAIN'],
    [{ chain_id: 84532, artwork_id: '9', category: 'invented', details: 'Concern', good_faith_confirmed: true }, 'INVALID_REPORT_CATEGORY'],
    [{ chain_id: 84532, artwork_id: '9', category: 'copyright', details: '', good_faith_confirmed: true }, 'INVALID_REPORT_DETAILS'],
    [{ chain_id: 84532, artwork_id: '9', category: 'copyright', details: 'x'.repeat(2001), good_faith_confirmed: true }, 'INVALID_REPORT_DETAILS'],
    [{ chain_id: 84532, artwork_id: '9', category: 'copyright', details: 'Concern', reference_url: 'javascript:alert(1)', good_faith_confirmed: true }, 'INVALID_REFERENCE_URL'],
    [{ chain_id: 84532, artwork_id: '9', category: 'copyright', details: 'Concern', reference_url: `https://example.com/${'x'.repeat(500)}`, good_faith_confirmed: true }, 'INVALID_REFERENCE_URL'],
    [{ chain_id: 84532, artwork_id: '9', category: 'copyright', details: 'Concern', good_faith_confirmed: false }, 'GOOD_FAITH_REQUIRED']
  ];

  for (const [body, expectedCode] of cases) {
    const res = responseHarness();
    await handler(request(body, cookie), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, expectedCode);
  }
});

test('a valid report uses the atomic service-role RPC and returns an opaque reference', async () => {
  const [{ default: handler }] = await modules;
  const cookie = await sessionCookie();
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return supabaseResponse([{
      report_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      report_status: 'pending_review',
      report_created_at: '2026-07-21T10:00:00.000Z',
      already_submitted: false
    }]);
  };

  try {
    const res = responseHarness();
    await handler(request({
      chain_id: 84532,
      artwork_id: '42',
      category: 'copyright',
      details: '  The source artwork predates this upload.  ',
      reference_url: 'https://example.com/original',
      good_faith_confirmed: true
    }, cookie), res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, {
      success: true,
      alreadySubmitted: false,
      report: {
        reference: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'pending_review',
        created_at: '2026-07-21T10:00:00.000Z'
      }
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/submit_artwork_report$/);
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(calls[0].body, {
      p_chain_id: 84532,
      p_artwork_id: '42',
      p_reporter_wallet: STAFF,
      p_category: 'copyright',
      p_details: 'The source artwork predates this upload.',
      p_reference_url: 'https://example.com/original',
      p_good_faith_confirmed: true,
      p_daily_limit: 5
    });
  } finally {
    global.fetch = previousFetch;
  }
});

test('the database intake-limit signal is returned as a stable 429 response', async () => {
  const [{ default: handler }] = await modules;
  const cookie = await sessionCookie();
  const previousFetch = global.fetch;
  global.fetch = async () => supabaseResponse({ message: 'REPORT_DAILY_LIMIT_REACHED' }, 400);

  try {
    const res = responseHarness();
    await handler(request({
      chain_id: 84532,
      artwork_id: '42',
      category: 'copyright',
      details: 'A bounded report concern.',
      good_faith_confirmed: true
    }, cookie), res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.error, 'REPORT_DAILY_LIMIT_REACHED');
  } finally {
    global.fetch = previousFetch;
  }
});

test('a duplicate pending category returns the existing report without creating a second receipt', async () => {
  const [{ default: handler }] = await modules;
  const cookie = await sessionCookie();
  const previousFetch = global.fetch;
  global.fetch = async () => supabaseResponse([{
    report_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    report_status: 'pending_review',
    report_created_at: '2026-07-21T10:00:00.000Z',
    already_submitted: true
  }]);

  try {
    const res = responseHarness();
    await handler(request({
      chain_id: 11155111,
      artwork_id: '7',
      category: 'spam',
      details: 'Duplicate listing concern.',
      good_faith_confirmed: true
    }, cookie), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.alreadySubmitted, true);
    assert.equal(res.body.report.reference, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  } finally {
    global.fetch = previousFetch;
  }
});

test('the SQL path is atomic, private, deduplicated, and never auto-hides artwork', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'sql/migrations/a8b_artwork_report_intake.sql'), 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.submit_artwork_report/);
  assert.match(sql, /ON CONFLICT \(chain_id, artwork_id, reporter_wallet, category\)[\s\S]*WHERE status = 'pending_review'[\s\S]*DO NOTHING/);
  assert.match(sql, /INSERT INTO public\.artwork_report_events/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /created_at >= NOW\(\) - INTERVAL '24 hours'/);
  assert.match(sql, /REPORT_DAILY_LIMIT_REACHED/);
  assert.match(sql, /ALTER TABLE public\.artwork_reports FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.artwork_reports FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /set_artwork_moderation_visibility|INSERT INTO public\.artwork_moderation_visibility/);
});

test('the artwork UI exposes a flag-gated accessible Report form with no wallet or contract mutation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/entries/artwork.jsx'), 'utf8');
  assert.match(source, /reportingEnabled && \(/);
  assert.match(source, />\s*Report\s*<\/button>/);
  assert.match(source, /aria-labelledby="artworkReportTitle"/);
  assert.match(source, /ref=\{reportTriggerRef\}/);
  assert.match(source, /reportTriggerRef\.current\?\.focus\(\)/);
  assert.match(source, /fetch\('\/api\/moderation\/reports'/);
  assert.match(source, /await window\.ensureAuthenticated\?\.\(\)/);
  const submitBlock = source.slice(
    source.indexOf('async function submitArtworkReport'),
    source.indexOf('async function passkeyApi')
  );
  assert.doesNotMatch(submitBlock, /ArtSoulContracts|eth_sendTransaction|writeContract|set_artwork_moderation_visibility/);
});

test('the Vercel router and public config expose only the gated report contract', () => {
  const router = fs.readFileSync(path.join(ROOT, 'api/[...route].js'), 'utf8');
  const config = fs.readFileSync(path.join(ROOT, 'src/api/routes/public/config.js'), 'utf8');
  const reportingConfig = fs.readFileSync(path.join(ROOT, 'src/api/reporting-config.js'), 'utf8');
  assert.match(router, /\['moderation\/reports', reportsHandler\]/);
  assert.match(config, /reportingEnabled: readReportingConfig\(\)\.enabled/);
  assert.match(reportingConfig, /ARTSOUL_REPORTING_ENABLED/);
  assert.match(reportingConfig, /ARTSOUL_REPORT_DAILY_LIMIT/);
});
