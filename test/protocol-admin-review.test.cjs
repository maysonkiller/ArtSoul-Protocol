const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const STAFF = '0x1111111111111111111111111111111111111111';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'protocol-admin-wallet-session-secret';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED = 'true';
process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED = 'true';
process.env.ARTSOUL_WEBAUTHN_RP_ID = 'example.com';
process.env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN = 'https://example.com';
process.env.ARTSOUL_WEBAUTHN_RP_NAME = 'ArtSoul';
process.env.ARTSOUL_MODERATION_SESSION_SECRET = 'protocol-admin-passkey-session-secret';

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(ROOT, relativePath)).href;
}

const modules = Promise.all([
  import(moduleUrl('src/api/routes/moderation/access.js')),
  import(moduleUrl('src/api/routes/moderation/review-queue.js')),
  import(moduleUrl('src/api/routes/moderation/review-action.js')),
  import(moduleUrl('src/api/backend.js')),
  import(moduleUrl('src/api/moderation-passkey.js'))
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

async function authCookie({ stepUp = false } = {}) {
  const [, , , backend, passkeys] = await modules;
  const walletResponse = responseHarness();
  backend.setWalletSession(walletResponse, STAFF);
  const cookies = [String(walletResponse.headers['Set-Cookie']).split(';')[0]];
  if (stepUp) {
    const stepUpResponse = responseHarness();
    passkeys.setModerationSession(stepUpResponse, STAFF, 'credential-1');
    cookies.push(String(stepUpResponse.headers['Set-Cookie']).split(';')[0]);
  }
  return cookies.join('; ');
}

function request(method, url, { body, cookie = '', query = {} } = {}) {
  return {
    method,
    url,
    query,
    body,
    headers: { cookie }
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

test('Protocol Admin and passkey flags fail closed independently', async () => {
  const [{ default: accessHandler }] = await modules;
  const previousAdmin = process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED;
  const previousPasskey = process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED;
  const previousFetch = global.fetch;
  const disabledCalls = [];
  global.fetch = async url => {
    disabledCalls.push(String(url));
    return supabaseResponse([]);
  };
  try {
    process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED = 'false';
    const disabled = responseHarness();
    await accessHandler(request('GET', '/api/moderation/access', { cookie: await authCookie() }), disabled);
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.body.enabled, false);
    assert.equal(disabled.body.eligible, false);
    // With the flag off the endpoint answers without any Supabase lookup.
    assert.equal(disabledCalls.length, 0);

    process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED = 'true';
    process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED = 'false';
    const missingPasskey = responseHarness();
    await accessHandler(request('GET', '/api/moderation/access'), missingPasskey);
    assert.equal(missingPasskey.statusCode, 503);
    assert.equal(missingPasskey.body.error, 'PROTOCOL_ADMIN_PASSKEY_REQUIRED');
  } finally {
    process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED = previousAdmin;
    process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED = previousPasskey;
    global.fetch = previousFetch;
  }
});

test('menu discovery exposes eligibility but no wallet or protected complaint data', async () => {
  const [{ default: accessHandler }] = await modules;
  const cookie = await authCookie();
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async url => {
    calls.push(String(url));
    return supabaseResponse([{ role: 'moderator' }]);
  };
  try {
    const res = responseHarness();
    await accessHandler(request('GET', '/api/moderation/access', { cookie }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.eligible, true);
    assert.equal(res.body.access.role, 'moderator');
    assert.equal(res.body.access.stepUpActive, false);
    assert.equal(JSON.stringify(res.body).includes(STAFF), false);
    assert.equal(JSON.stringify(res.body).includes('details'), false);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /artsoul_staff_roles/);
  } finally {
    global.fetch = previousFetch;
  }
});

test('protected queue data is denied before passkey step-up', async () => {
  const [, { default: queueHandler }] = await modules;
  const cookie = await authCookie();
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async url => {
    calls.push(String(url));
    return supabaseResponse([{ role: 'admin' }]);
  };
  try {
    const res = responseHarness();
    await queueHandler(request('GET', '/api/moderation/review-queue', {
      cookie,
      query: { status: 'pending_review' }
    }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'STEP_UP_REQUIRED');
    assert.equal(calls.some(url => /artwork_reports\?status/.test(url)), false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('an invalid queue status returns a stable error after authorization', async () => {
  const [, { default: queueHandler }] = await modules;
  const cookie = await authCookie({ stepUp: true });
  const previousFetch = global.fetch;
  global.fetch = async url => {
    const value = String(url);
    if (value.includes('artsoul_staff_roles')) return supabaseResponse([{ role: 'moderator' }]);
    if (value.includes('artsoul_staff_passkeys')) return supabaseResponse([{ credential_id: 'credential-1' }]);
    throw new Error(`Protected queue query should not run for invalid status: ${value}`);
  };
  try {
    const res = responseHarness();
    await queueHandler(request('GET', '/api/moderation/review-queue', {
      cookie,
      query: { status: 'invented' }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_REVIEW_STATUS');
  } finally {
    global.fetch = previousFetch;
  }
});

test('review actions derive the actor from the server session and return stable output', async () => {
  const [, , { default: actionHandler }] = await modules;
  const cookie = await authCookie({ stepUp: true });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: value, body });
    if (value.includes('artsoul_staff_roles')) return supabaseResponse([{ role: 'admin' }]);
    if (value.includes('artsoul_staff_passkeys')) return supabaseResponse([{ credential_id: 'credential-1' }]);
    if (value.endsWith('/rpc/review_artwork_report')) {
      return supabaseResponse([{
        report_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        report_status: 'actioned',
        report_updated_at: '2026-07-21T10:01:00.000Z',
        artwork_hidden: true
      }]);
    }
    return supabaseResponse([]);
  };
  try {
    const res = responseHarness();
    await actionHandler(request('POST', '/api/moderation/review-action', {
      cookie,
      body: {
        report_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expected_updated_at: '2026-07-21T10:00:00.000Z',
        action: 'hide',
        reason: '  Verified complaint evidence.  ',
        actor_wallet: '0x9999999999999999999999999999999999999999'
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.report, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'actioned',
      updated_at: '2026-07-21T10:01:00.000Z',
      artwork_hidden: true
    });
    const rpc = calls.find(call => call.url.endsWith('/rpc/review_artwork_report'));
    assert.equal(rpc.body.p_actor_wallet, STAFF);
    assert.equal(rpc.body.p_reason, 'Verified complaint evidence.');
    assert.equal(Object.hasOwn(rpc.body, 'actor_wallet'), false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('malformed JSON and stale review versions map to stable client errors', async () => {
  const [, , { default: actionHandler }] = await modules;
  const cookie = await authCookie({ stepUp: true });
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.includes('artsoul_staff_roles')) return supabaseResponse([{ role: 'admin' }]);
    if (value.includes('artsoul_staff_passkeys')) return supabaseResponse([{ credential_id: 'credential-1' }]);
    if (value.endsWith('/rpc/review_artwork_report')) {
      return supabaseResponse({ message: 'REPORT_REVIEW_CONFLICT' }, 400);
    }
    return supabaseResponse([]);
  };
  try {
    const malformed = responseHarness();
    await actionHandler(request('POST', '/api/moderation/review-action', {
      cookie,
      body: '{not-json'
    }), malformed);
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.body.error, 'INVALID_JSON');

    const conflict = responseHarness();
    await actionHandler(request('POST', '/api/moderation/review-action', {
      cookie,
      body: {
        report_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expected_updated_at: '2026-07-21T10:00:00.000Z',
        action: 'dismiss',
        reason: 'Evidence does not support the claim.'
      }
    }), conflict);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.error, 'REPORT_REVIEW_CONFLICT');
  } finally {
    global.fetch = previousFetch;
  }
});

test('reopening into a duplicate pending report maps to a stable 409', async () => {
  const [, , { default: actionHandler }] = await modules;
  const cookie = await authCookie({ stepUp: true });
  const previousFetch = global.fetch;
  global.fetch = async url => {
    const value = String(url);
    if (value.includes('artsoul_staff_roles')) return supabaseResponse([{ role: 'admin' }]);
    if (value.includes('artsoul_staff_passkeys')) return supabaseResponse([{ credential_id: 'credential-1' }]);
    if (value.endsWith('/rpc/review_artwork_report')) {
      return supabaseResponse({ message: 'REPORT_ALREADY_PENDING' }, 400);
    }
    return supabaseResponse([]);
  };
  try {
    const res = responseHarness();
    await actionHandler(request('POST', '/api/moderation/review-action', {
      cookie,
      body: {
        report_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expected_updated_at: '2026-07-21T10:00:00.000Z',
        action: 'reopen',
        reason: 'Re-examining the original complaint.'
      }
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'REPORT_ALREADY_PENDING');
  } finally {
    global.fetch = previousFetch;
  }
});

test('a raw one-pending unique violation still maps to REPORT_ALREADY_PENDING', async () => {
  const [, , { default: actionHandler }] = await modules;
  const cookie = await authCookie({ stepUp: true });
  const previousFetch = global.fetch;
  global.fetch = async url => {
    const value = String(url);
    if (value.includes('artsoul_staff_roles')) return supabaseResponse([{ role: 'admin' }]);
    if (value.includes('artsoul_staff_passkeys')) return supabaseResponse([{ credential_id: 'credential-1' }]);
    if (value.endsWith('/rpc/review_artwork_report')) {
      return supabaseResponse({
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_artwork_reports_one_pending_category"'
      }, 409);
    }
    return supabaseResponse([]);
  };
  try {
    const res = responseHarness();
    await actionHandler(request('POST', '/api/moderation/review-action', {
      cookie,
      body: {
        report_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expected_updated_at: '2026-07-21T10:00:00.000Z',
        action: 'reopen',
        reason: 'Re-examining the original complaint.'
      }
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'REPORT_ALREADY_PENDING');
  } finally {
    global.fetch = previousFetch;
  }
});

test('Protocol Admin UI treats complaint text as untrusted and menu authority as server-owned', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/entries/admin.jsx'), 'utf8');
  const header = fs.readFileSync(path.join(ROOT, 'avatar-dropdown.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const vite = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  const verifyBuild = fs.readFileSync(path.join(ROOT, 'scripts/verify-build.mjs'), 'utf8');

  assert.match(page, /\{report\.details\}/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.match(page, /url\.protocol === 'https:' \|\| url\.protocol === 'http:'/);
  assert.match(page, /href=\{safeExternalUrl\(report\.reference_url\)\}/);
  assert.match(page, /event\.key !== 'Tab'/);
  assert.match(page, /event\.key === 'Escape'/);
  assert.match(page, /previousFocusRef\.current\?\.focus/);
  // Audit fix P2-2/P2-4: an actioned report offers only resolve/restore, a
  // closed (dismissed or resolved) report offers reopen, and the queue can
  // filter the resolved state.
  const actionedBlock = page.slice(
    page.indexOf("if (report.status === 'actioned')"),
    page.indexOf("if (report.status === 'dismissed'")
  );
  assert.match(actionedBlock, /onChoose\(report, 'restore'\)/);
  assert.doesNotMatch(actionedBlock, /'reopen'/);
  assert.match(page, /report\.status === 'dismissed' \|\| report\.status === 'resolved'/);
  assert.match(page, /\['pending_review', 'actioned', 'dismissed', 'resolved'\]/);
  assert.match(header, /fetch\('\/api\/moderation\/access'/);
  assert.match(header, /result\.eligible === true/);
  assert.doesNotMatch(header, /localStorage[^\n]*(?:admin|moderator|staff)/i);
  assert.match(html, /noindex,nofollow/);
  assert.match(vite, /admin: 'admin\.html'/);
  assert.match(verifyBuild, /'admin\.html'/);
});

test('A8c SQL preserves independent reports, append-only reasons and serialized transitions', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'sql/migrations/a8c_protocol_admin_review.sql'), 'utf8');
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /REPORT_REVIEW_CONFLICT/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /other_report\.id <> current_report\.id/);
  assert.match(sql, /other_report\.status = 'actioned'/);
  assert.match(sql, /INSERT INTO public\.artwork_report_events[\s\S]*normalized_reason/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /DELETE FROM public\.artwork_reports|DELETE FROM public\.artwork_report_events/);
  // Audit fixes P2-1..P2-4: duplicate-pending guard, no reopen from
  // actioned, a distinct resolved status, and restore semantics that read
  // the artwork's actual visibility before claiming a restoration.
  assert.match(sql, /REPORT_ALREADY_PENDING/);
  assert.match(sql, /other_report\.reporter_wallet = current_report\.reporter_wallet/);
  assert.match(sql, /other_report\.category = current_report\.category/);
  assert.match(sql, /normalized_action = 'reopen' AND current_report\.status NOT IN \('dismissed', 'resolved'\)/);
  assert.match(sql, /next_status := 'resolved';/);
  assert.match(sql, /'resolved'\s*\)\);/);
  assert.match(sql, /artwork_was_hidden/);
  assert.match(sql, /artwork_report_notifications_notification_type_check CHECK \(notification_type IN \([\s\S]*?'REPORT_RESOLVED',/);
});
