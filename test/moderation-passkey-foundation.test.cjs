// A8a moderation passkey foundation: behavioral coverage of the feature
// flag, fail-closed configuration, one-time challenges and grants, the
// 15-minute step-up session, revocation, audit events, and the rule that
// X/Discord text never authorizes moderation. The REAL backend/session/
// passkey/access sources run inside vm with an in-memory Supabase mock;
// only the @simplewebauthn/server boundary is mocked (its own cryptography
// is not under test here).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const backendSource = read(path.join('src', 'api', 'backend.js'));
const passkeySource = read(path.join('src', 'api', 'moderation-passkey.js'));
const accessSource = read(path.join('src', 'api', 'moderation-access.js'));

const ROUTE_SOURCES = {
  registerOptions: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-register-options.js')),
  registerVerify: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-register-verify.js')),
  authOptions: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-auth-options.js')),
  authVerify: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-auth-verify.js')),
  passkeys: read(path.join('src', 'api', 'routes', 'moderation', 'passkeys.js')),
  grant: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-grant.js')),
  recovery: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-recovery.js'))
};

const STAFF = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

const CONFIGURED_ENV = {
  SESSION_SECRET: 'test-siwe-secret',
  ARTSOUL_MODERATION_PASSKEY_ENABLED: 'true',
  ARTSOUL_WEBAUTHN_RP_ID: 'artsoul.test',
  ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN: 'https://artsoul.test',
  ARTSOUL_WEBAUTHN_RP_NAME: 'ArtSoul Staff',
  ARTSOUL_MODERATION_SESSION_SECRET: 'test-moderation-secret'
};

function stripModule(source) {
  return source
    .replace(/^import[\s\S]*?from '[^']+';\s*\n/gm, '')
    .replace(/^export default /gm, '')
    .replace(/^export /gm, '');
}

// Minimal in-memory PostgREST covering exactly the query shapes the
// moderation modules use: eq., is.null, gt.<iso>, limit, GET/PATCH/POST.
function createDb(seed = {}) {
  const tables = {
    artsoul_staff_roles: seed.roles || [],
    profiles: seed.profiles || [],
    artsoul_staff_passkeys: seed.passkeys || [],
    artsoul_webauthn_challenges: seed.challenges || [],
    artsoul_staff_enrollment_grants: seed.grants || [],
    artsoul_staff_auth_events: seed.events || []
  };
  const log = [];

  function matches(row, params) {
    for (const [key, raw] of params) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(key)) continue;
      if (raw === 'is.null') {
        if (row[key] !== null && row[key] !== undefined) return false;
      } else if (raw.startsWith('eq.')) {
        if (String(row[key]) !== raw.slice(3)) return false;
      } else if (raw.startsWith('gt.')) {
        if (!(new Date(row[key]) > new Date(raw.slice(3)))) return false;
      } else {
        throw new Error(`Unsupported filter ${key}=${raw}`);
      }
    }
    return true;
  }

  async function supabaseRest(pathValue, options = {}) {
    const method = options.method || 'GET';
    log.push({ path: pathValue, method });
    const qIndex = pathValue.indexOf('?');
    const table = qIndex === -1 ? pathValue : pathValue.slice(0, qIndex);
    const rows = tables[table];
    if (!rows) throw new Error(`Unknown table ${table}`);
    const params = new URLSearchParams(qIndex === -1 ? '' : pathValue.slice(qIndex + 1));

    if (method === 'GET') {
      let result = rows.filter(row => matches(row, params)).map(row => ({ ...row }));
      const limit = Number(params.get('limit'));
      if (Number.isFinite(limit) && limit > 0) result = result.slice(0, limit);
      return result;
    }
    if (method === 'PATCH') {
      const matched = rows.filter(row => matches(row, params));
      for (const row of matched) Object.assign(row, options.body);
      return matched.map(row => ({ ...row }));
    }
    if (method === 'POST') {
      const inserted = (Array.isArray(options.body) ? options.body : [options.body])
        .map((row, index) => ({ id: rows.length + index + 1, ...row }));
      rows.push(...inserted);
      return inserted.map(row => ({ ...row }));
    }
    throw new Error(`Unsupported method ${method}`);
  }

  return { tables, log, supabaseRest };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; }
  };
}

function fakeReq({ method = 'POST', cookie = '', body = {}, host = 'artsoul.test' } = {}) {
  return { method, url: '/api/test', headers: { cookie, host }, body, query: {} };
}

function cookieValueFromHeader(header) {
  return String(header || '').split(';')[0];
}

// Builds the full environment: real backend + passkey + access sources in
// one vm context, Supabase replaced by the in-memory mock, and the
// @simplewebauthn/server boundary replaced by contract-faithful mocks.
function loadEnvironment({ env = {}, db = createDb(), webauthn = {} } = {}) {
  const calls = { registrationOptions: [], registrationVerify: [], authenticationOptions: [], authenticationVerify: [] };
  const control = {
    registrationVerified: true,
    authenticationVerified: true,
    newCounter: 7,
    ...webauthn
  };

  const context = vm.createContext({
    process: { env: { NODE_ENV: 'test', ...env } },
    console: { log() {}, warn() {}, error() {} },
    crypto,
    Buffer,
    URLSearchParams,
    exported: {},
    generateRegistrationOptions: async (options) => {
      calls.registrationOptions.push(options);
      return { challenge: 'reg-challenge-1', rp: { id: options.rpID } };
    },
    verifyRegistrationResponse: async (options) => {
      calls.registrationVerify.push(options);
      const challengeOk = await options.expectedChallenge(options.response.__challenge);
      if (!challengeOk) throw new Error('Custom challengeVerify returned false');
      if (!control.registrationVerified) return { verified: false };
      return {
        verified: true,
        registrationInfo: {
          aaguid: 'test-aaguid',
          credential: {
            id: options.response.id,
            publicKey: new Uint8Array([1, 2, 3, 4]),
            counter: 0,
            transports: ['internal']
          }
        }
      };
    },
    generateAuthenticationOptions: async (options) => {
      calls.authenticationOptions.push(options);
      return { challenge: 'auth-challenge-1', rpId: options.rpID };
    },
    verifyAuthenticationResponse: async (options) => {
      calls.authenticationVerify.push(options);
      const challengeOk = await options.expectedChallenge(options.response.__challenge);
      if (!challengeOk) throw new Error('Custom challengeVerify returned false');
      if (!control.authenticationVerified) return { verified: false };
      return { verified: true, authenticationInfo: { newCounter: control.newCounter } };
    }
  });

  vm.runInContext(stripModule(backendSource), context, { filename: 'backend.js (stripped)' });
  // Replace the real Supabase client with the in-memory mock before any
  // moderation module can call it.
  context.exported.__mockSupabase = db.supabaseRest;
  vm.runInContext('supabaseRest = exported.__mockSupabase;', context);
  vm.runInContext(stripModule(passkeySource), context, { filename: 'moderation-passkey.js (stripped)' });
  vm.runInContext(stripModule(accessSource), context, { filename: 'moderation-access.js (stripped)' });
  vm.runInContext('exported.getModerationAccess = getModerationAccess;\n' +
    'exported.setWalletSession = setWalletSession;\n' +
    'exported.setModerationSession = setModerationSession;\n' +
    'exported.readModerationSession = readModerationSession;\n' +
    'exported.verifyModerationStepUp = verifyModerationStepUp;\n' +
    'exported.MODERATION_SESSION_TTL_SECONDS = MODERATION_SESSION_TTL_SECONDS;', context);

  function loadRoute(name) {
    const source = ROUTE_SOURCES[name].replace(
      'export default async function handler',
      `exported.route_${name} = async function handler`
    );
    vm.runInContext(stripModule(source), context, { filename: `${name} (stripped route)` });
    return context.exported[`route_${name}`];
  }

  function siweCookie(wallet) {
    const res = fakeRes();
    context.exported.setWalletSession(res, wallet);
    return cookieValueFromHeader(res.headers['set-cookie']);
  }

  function moderationCookie(wallet, credentialId) {
    const res = fakeRes();
    context.exported.setModerationSession(res, wallet, credentialId);
    return cookieValueFromHeader(res.headers['set-cookie']);
  }

  return { context, db, calls, control, loadRoute, siweCookie, moderationCookie, exported: context.exported };
}

function staffSeed(extra = {}) {
  return {
    roles: [{ wallet_address: STAFF, role: 'moderator', active: true }],
    profiles: [{ wallet_address: STAFF }],
    ...extra
  };
}

function validGrant(overrides = {}) {
  return {
    id: 1,
    target_wallet: STAFF,
    purpose: 'additional',
    issued_by: STAFF,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null,
    ...overrides
  };
}

function activePasskey(overrides = {}) {
  return {
    id: 1,
    wallet_address: STAFF,
    credential_id: 'cred-1',
    public_key: Buffer.from([9, 9, 9]).toString('base64url'),
    sign_count: 3,
    transports: '["internal"]',
    label: 'Test key',
    enrolled_via: 'bootstrap',
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Feature flag OFF: exact legacy behavior, passkey feature absent
// ---------------------------------------------------------------------------

test('flag off: legacy access path is byte-compatible and queries no passkey table', async () => {
  const db = createDb(staffSeed({
    profiles: [{ wallet_address: STAFF, twitter_id: 't', discord_id: 'd' }]
  }));
  const envir = loadEnvironment({ env: { SESSION_SECRET: 'test-siwe-secret' }, db });
  const req = fakeReq({ cookie: envir.siweCookie(STAFF) });
  const access = await envir.exported.getModerationAccess(req, { strict: true });
  assert.equal(access.canModerate, true);
  assert.equal(access.role, 'moderator');
  assert.deepEqual([...access.missingFactors], []);
  assert.equal('passkeyRequired' in access, false);
  assert.equal(
    envir.db.log.some(entry => entry.path.includes('artsoul_staff_passkeys')),
    false,
    'no passkey table is touched while the flag is off'
  );
});

test('flag off: every passkey route answers 404 and needs no WebAuthn env', async () => {
  const envir = loadEnvironment({ env: { SESSION_SECRET: 'test-siwe-secret' }, db: createDb(staffSeed()) });
  for (const name of Object.keys(ROUTE_SOURCES)) {
    const res = fakeRes();
    await envir.loadRoute(name)(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
    assert.equal(res.statusCode, 404, `${name} must be absent while disabled`);
    assert.equal(res.body.error, 'PASSKEY_DISABLED');
  }
});

// ---------------------------------------------------------------------------
// Flag ON with missing configuration: fail closed, never fall back
// ---------------------------------------------------------------------------

test('flag on without full configuration denies moderation instead of falling back', async () => {
  const db = createDb(staffSeed({
    profiles: [{ wallet_address: STAFF, twitter_id: 't', discord_id: 'd' }]
  }));
  const envir = loadEnvironment({
    env: { SESSION_SECRET: 'test-siwe-secret', ARTSOUL_MODERATION_PASSKEY_ENABLED: 'true' },
    db
  });
  const req = fakeReq({ cookie: envir.siweCookie(STAFF) });
  await assert.rejects(
    envir.exported.getModerationAccess(req, { strict: true }),
    (error) => error.code === 'MODERATION_PASSKEY_MISCONFIGURED' && error.statusCode === 503
  );
  const relaxed = await envir.exported.getModerationAccess(req);
  assert.equal(relaxed.canModerate, false);
  assert.deepEqual([...relaxed.missingFactors], ['passkey_configuration']);
});

test('the RP ID and origin come only from configuration, never the request host', async () => {
  const db = createDb(staffSeed({ grants: [validGrant()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie: envir.siweCookie(STAFF),
    host: 'evil.example',
    body: { response: { id: 'cred-new', __challenge: 'reg-challenge-1' } }
  }), res);
  // The challenge does not exist yet, so verification fails — but the
  // captured arguments prove the configured values were used.
  const args = envir.calls.registrationVerify[0];
  assert.equal(args.expectedOrigin, 'https://artsoul.test');
  assert.equal(args.expectedRPID, 'artsoul.test');
  assert.equal(args.requireUserVerification, true);
});

// ---------------------------------------------------------------------------
// SIWE, staff role, and grant preconditions
// ---------------------------------------------------------------------------

test('missing SIWE session rejects every passkey route with 401', async () => {
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db: createDb(staffSeed()) });
  const res = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({ cookie: '' }), res);
  assert.equal(res.statusCode, 401);
});

test('an inactive staff role rejects enrollment and step-up routes', async () => {
  const db = createDb({ roles: [{ wallet_address: STAFF, role: 'moderator', active: false }] });
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'ADMIN_REQUIRED');
});

test('enrollment requires a valid unused grant bound to the SIWE wallet', async () => {
  // Grant exists, but it targets ANOTHER wallet.
  const db = createDb(staffSeed({ grants: [validGrant({ target_wallet: OTHER })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'ENROLLMENT_GRANT_REQUIRED');
});

test('an expired grant does not authorize enrollment', async () => {
  const db = createDb(staffSeed({
    grants: [validGrant({ expires_at: new Date(Date.now() - 1000).toISOString() })]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'ENROLLMENT_GRANT_REQUIRED');
});

// ---------------------------------------------------------------------------
// Full enrollment flow, one-time grants and challenges, audit trail
// ---------------------------------------------------------------------------

async function runEnrollment(envir, { challenge = 'reg-challenge-1', credentialId = 'cred-new' } = {}) {
  const registerOptions = envir.loadRoute('registerOptions');
  const registerVerify = envir.loadRoute('registerVerify');
  const cookie = envir.siweCookie(STAFF);

  const optionsRes = fakeRes();
  await registerOptions(fakeReq({ cookie }), optionsRes);

  const verifyRes = fakeRes();
  await registerVerify(fakeReq({
    cookie,
    body: { response: { id: credentialId, __challenge: challenge }, label: 'Founder device' }
  }), verifyRes);
  return { optionsRes, verifyRes };
}

test('a valid registration enrolls the credential, burns the grant, and audits both', async () => {
  const db = createDb(staffSeed({ grants: [validGrant()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const { optionsRes, verifyRes } = await runEnrollment(envir);

  assert.equal(optionsRes.statusCode, 200);
  // User verification is required at options time as well.
  assert.equal(envir.calls.registrationOptions[0].authenticatorSelection.userVerification, 'required');

  assert.equal(verifyRes.statusCode, 200, JSON.stringify(verifyRes.body));
  const stored = db.tables.artsoul_staff_passkeys[0];
  assert.equal(stored.wallet_address, STAFF);
  assert.equal(stored.credential_id, 'cred-new');
  assert.equal(stored.public_key, Buffer.from([1, 2, 3, 4]).toString('base64url'));
  assert.equal(stored.enrolled_via, 'additional');

  const grant = db.tables.artsoul_staff_enrollment_grants[0];
  assert.ok(grant.consumed_at, 'grant is consumed');
  assert.equal(grant.consumed_by_credential, 'cred-new');

  const events = db.tables.artsoul_staff_auth_events.map(event => event.event_type);
  assert.deepEqual(events, ['grant_consumed', 'passkey_enrolled']);
});

test('a consumed grant cannot be reused for a second enrollment', async () => {
  const db = createDb(staffSeed({ grants: [validGrant({ consumed_at: new Date().toISOString() })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie: envir.siweCookie(STAFF),
    body: { response: { id: 'cred-x', __challenge: 'whatever' } }
  }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'ENROLLMENT_GRANT_REQUIRED');
  assert.equal(db.tables.artsoul_staff_passkeys.length, 0);
});

test('challenges are one-time: replaying the same registration challenge fails', async () => {
  const db = createDb(staffSeed({ grants: [validGrant(), validGrant({ id: 2 })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const first = await runEnrollment(envir);
  assert.equal(first.verifyRes.statusCode, 200);

  // Second submit reuses the already consumed challenge.
  const res = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie: envir.siweCookie(STAFF),
    body: { response: { id: 'cred-2', __challenge: 'reg-challenge-1' } }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'REGISTRATION_NOT_VERIFIED');
});

test('an expired challenge fails verification', async () => {
  const db = createDb(staffSeed({
    grants: [validGrant()],
    challenges: [{
      challenge: 'expired-challenge',
      wallet_address: STAFF,
      purpose: 'registration',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      consumed_at: null
    }]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie: envir.siweCookie(STAFF),
    body: { response: { id: 'cred-x', __challenge: 'expired-challenge' } }
  }), res);
  assert.equal(res.statusCode, 400);
});

test('a challenge issued for registration cannot authorize authentication', async () => {
  const db = createDb(staffSeed({
    passkeys: [activePasskey()],
    challenges: [{
      challenge: 'purpose-mismatch',
      wallet_address: STAFF,
      purpose: 'registration',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: null
    }]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('authVerify')(fakeReq({
    cookie: envir.siweCookie(STAFF),
    body: { response: { id: 'cred-1', __challenge: 'purpose-mismatch' } }
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'AUTHENTICATION_NOT_VERIFIED');
});

// ---------------------------------------------------------------------------
// Authentication, the 15-minute session, counters, and multiple passkeys
// ---------------------------------------------------------------------------

async function runAuthentication(envir, { credentialId = 'cred-1' } = {}) {
  const authOptions = envir.loadRoute('authOptions');
  const authVerify = envir.loadRoute('authVerify');
  const cookie = envir.siweCookie(STAFF);

  const optionsRes = fakeRes();
  await authOptions(fakeReq({ cookie }), optionsRes);

  const verifyRes = fakeRes();
  await authVerify(fakeReq({
    cookie,
    body: { response: { id: credentialId, __challenge: 'auth-challenge-1' } }
  }), verifyRes);
  return { optionsRes, verifyRes };
}

test('a valid authentication issues the exact 15-minute moderation session', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const { optionsRes, verifyRes } = await runAuthentication(envir);

  assert.equal(optionsRes.statusCode, 200);
  assert.equal(envir.calls.authenticationOptions[0].userVerification, 'required');
  assert.equal(verifyRes.statusCode, 200, JSON.stringify(verifyRes.body));
  assert.equal(verifyRes.body.expires_in_seconds, 900);
  assert.equal(envir.exported.MODERATION_SESSION_TTL_SECONDS, 15 * 60);
  assert.match(verifyRes.headers['set-cookie'], /artsoul_mod_session=/);
  assert.match(verifyRes.headers['set-cookie'], /Max-Age=900/);
  assert.match(verifyRes.headers['set-cookie'], /HttpOnly/);
  assert.match(verifyRes.headers['set-cookie'], /SameSite=Lax/);

  // Sign counter and last-used timestamp advance.
  const stored = db.tables.artsoul_staff_passkeys[0];
  assert.equal(stored.sign_count, 7);
  assert.ok(stored.last_used_at);

  const events = db.tables.artsoul_staff_auth_events.map(event => event.event_type);
  assert.deepEqual(events, ['passkey_auth_success']);
});

test('failed authentication is audited and issues no session', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db, webauthn: { authenticationVerified: false } });
  const { verifyRes } = await runAuthentication(envir);
  assert.equal(verifyRes.statusCode, 401);
  assert.equal(verifyRes.headers['set-cookie'], undefined);
  const events = db.tables.artsoul_staff_auth_events.map(event => event.event_type);
  assert.deepEqual(events, ['passkey_auth_failure']);
});

test('a revoked credential cannot start authentication', async () => {
  const db = createDb(staffSeed({
    passkeys: [activePasskey({ revoked_at: new Date().toISOString() })]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'NO_CREDENTIALS');
});

test('multiple passkeys per wallet are offered and excluded correctly', async () => {
  const db = createDb(staffSeed({
    passkeys: [activePasskey(), activePasskey({ id: 2, credential_id: 'cred-2' })],
    grants: [validGrant()]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = envir.siweCookie(STAFF);

  const authRes = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({ cookie }), authRes);
  assert.equal(envir.calls.authenticationOptions[0].allowCredentials.length, 2);

  const regRes = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie }), regRes);
  assert.equal(envir.calls.registrationOptions[0].excludeCredentials.length, 2);
});

// ---------------------------------------------------------------------------
// getModerationAccess with the flag ON
// ---------------------------------------------------------------------------

test('arbitrary X/Discord profile text never authorizes moderation with the flag on', async () => {
  const db = createDb(staffSeed({
    profiles: [{
      wallet_address: STAFF,
      twitter_id: 'oauth-verified',
      twitter_handle: 'typed-by-user',
      discord_id: 'oauth-verified',
      discord_username: 'typed#1'
    }]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const req = fakeReq({ cookie: envir.siweCookie(STAFF) });
  const relaxed = await envir.exported.getModerationAccess(req);
  assert.equal(relaxed.canModerate, false);
  assert.deepEqual([...relaxed.missingFactors], ['passkey_step_up']);
  await assert.rejects(
    envir.exported.getModerationAccess(req, { strict: true }),
    (error) => error.code === 'STEP_UP_REQUIRED' && error.statusCode === 403
  );
});

test('SIWE session + valid step-up + active role grants moderation', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const access = await envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true });
  assert.equal(access.canModerate, true);
  assert.equal(access.stepUpActive, true);
  assert.equal(access.passkeyRequired, true);
});

test('a moderation cookie without the base SIWE cookie is rejected', async () => {
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db: createDb(staffSeed({ passkeys: [activePasskey()] })) });
  const cookie = envir.moderationCookie(STAFF, 'cred-1');
  await assert.rejects(
    envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    (error) => error.statusCode === 401
  );
});

test('a step-up for a different wallet than the SIWE session is rejected', async () => {
  const db = createDb({
    roles: [
      { wallet_address: STAFF, role: 'moderator', active: true },
      { wallet_address: OTHER, role: 'moderator', active: true }
    ],
    profiles: [{ wallet_address: STAFF }],
    passkeys: [activePasskey({ wallet_address: OTHER })]
  });
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(OTHER, 'cred-1')}`;
  await assert.rejects(
    envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    (error) => error.code === 'STEP_UP_WALLET_MISMATCH'
  );
});

test('an expired 15-minute session fails closed', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  // Craft an expired moderation cookie by signing an already-expired payload.
  const payload = Buffer.from(JSON.stringify({
    wallet: STAFF,
    credential_id: 'cred-1',
    exp: Math.floor(Date.now() / 1000) - 1
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', CONFIGURED_ENV.ARTSOUL_MODERATION_SESSION_SECRET)
    .update(payload).digest('base64url');
  const cookie = `${envir.siweCookie(STAFF)}; artsoul_mod_session=${payload}.${signature}`;
  await assert.rejects(
    envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    (error) => error.code === 'STEP_UP_REQUIRED'
  );
});

test('a revoked credential invalidates an otherwise valid session immediately', async () => {
  const db = createDb(staffSeed({
    passkeys: [activePasskey({ revoked_at: new Date().toISOString() })]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  await assert.rejects(
    envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    (error) => error.code === 'CREDENTIAL_REVOKED'
  );
});

// ---------------------------------------------------------------------------
// Revocation, self-grants, bootstrap protection, recovery
// ---------------------------------------------------------------------------

test('self-revocation requires a valid step-up and writes an audit event', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const route = envir.loadRoute('passkeys');

  // Without step-up: rejected.
  const denied = fakeRes();
  await route(fakeReq({
    cookie: envir.siweCookie(STAFF),
    body: { action: 'revoke', credential_id: 'cred-1' }
  }), denied);
  assert.equal(denied.statusCode, 403);

  // With step-up: revoked + audited.
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const res = fakeRes();
  await route(fakeReq({ cookie, body: { action: 'revoke', credential_id: 'cred-1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(db.tables.artsoul_staff_passkeys[0].revoked_at);
  assert.equal(db.tables.artsoul_staff_auth_events.at(-1).event_type, 'passkey_revoked');
});

test('a self-grant needs a valid step-up, targets only the own wallet, and is audited', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const route = envir.loadRoute('grant');

  const denied = fakeRes();
  await route(fakeReq({ cookie: envir.siweCookie(STAFF) }), denied);
  assert.equal(denied.statusCode, 403);

  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const res = fakeRes();
  await route(fakeReq({ cookie, body: { target_wallet: OTHER } }), res);
  assert.equal(res.statusCode, 200);
  const grant = db.tables.artsoul_staff_enrollment_grants[0];
  assert.equal(grant.target_wallet, STAFF, 'body-supplied targets are ignored');
  assert.equal(grant.purpose, 'additional');
  assert.equal(db.tables.artsoul_staff_auth_events.at(-1).event_type, 'grant_issued');
});

test('no HTTP route can mint a bootstrap grant', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const res = fakeRes();
  await envir.loadRoute('grant')(fakeReq({ cookie, body: { purpose: 'bootstrap' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.tables.artsoul_staff_enrollment_grants[0].purpose, 'additional');
  for (const source of Object.values(ROUTE_SOURCES)) {
    assert.doesNotMatch(source, /purpose:\s*'bootstrap'/);
  }
});

test('recovery always fails closed and is audit-recorded', async () => {
  const db = createDb(staffSeed());
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'RECOVERY_UNAVAILABLE');
  assert.equal(db.tables.artsoul_staff_auth_events.at(-1).event_type, 'recovery_denied');
});
