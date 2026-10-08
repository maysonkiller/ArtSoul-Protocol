// A8a moderation passkey foundation: behavioral coverage of the feature
// flag, fail-closed configuration, one-time bearer-token enrollment grants,
// challenge/grant binding, the 15-minute step-up session, last-key
// protection, revocation, audit events, and the rule that X/Discord text
// never authorizes moderation. The REAL backend/session/passkey/access/route
// sources run inside vm with an in-memory Supabase mock that also implements
// the four atomic RPCs; only the @simplewebauthn/server boundary is mocked.
//
// ATOMICITY of the real PostgreSQL RPCs (rollback on failed audit, concurrent
// single-consume, bootstrap semantics, counter rules) is proven separately
// against a disposable PostgreSQL 17 database in
// test/a8a-passkey-rpc-integration.test.cjs.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parse } = require('acorn');
const { Interface, hashMessage, isAddress, isHexString } = require('ethers');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const backendSource = read(path.join('src', 'api', 'backend.js'));
const passkeySource = read(path.join('src', 'api', 'moderation-passkey.js'));
const safeRecoverySource = read(path.join('src', 'api', 'moderation-safe-recovery.js'));
const accessSource = read(path.join('src', 'api', 'moderation-access.js'));
const artworkVisibilitySource = read(path.join('src', 'api', 'routes', 'moderation', 'artwork-visibility.js'));

const ROUTE_SOURCES = {
  registerOptions: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-register-options.js')),
  registerVerify: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-register-verify.js')),
  authOptions: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-auth-options.js')),
  authVerify: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-auth-verify.js')),
  passkeys: read(path.join('src', 'api', 'routes', 'moderation', 'passkeys.js')),
  grant: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-grant.js')),
  recovery: read(path.join('src', 'api', 'routes', 'moderation', 'passkey-recovery.js')),
  artworkVisibility: artworkVisibilitySource
};

test('passkey server modules parse before the VM harness removes module syntax', () => {
  for (const source of [passkeySource, ...Object.values(ROUTE_SOURCES)]) {
    assert.doesNotThrow(() => parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  }
});

const STAFF = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const SAFE = '0x3333333333333333333333333333333333333333';

const CONFIGURED_ENV = {
  SESSION_SECRET: 'test-siwe-secret',
  ARTSOUL_MODERATION_PASSKEY_ENABLED: 'true',
  ARTSOUL_WEBAUTHN_RP_ID: 'artsoul.test',
  ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN: 'https://artsoul.test',
  ARTSOUL_WEBAUTHN_RP_NAME: 'ArtSoul Staff',
  ARTSOUL_MODERATION_SESSION_SECRET: 'test-moderation-secret'
};

const RECOVERY_ENV = {
  ...CONFIGURED_ENV,
  ARTSOUL_MODERATION_SAFE_RECOVERY_ADDRESS: SAFE,
  ARTSOUL_MODERATION_SAFE_RECOVERY_CHAIN_ID: '84532',
  ARTSOUL_MODERATION_SAFE_RECOVERY_RPC_URLS: 'https://rpc-a.test,https://rpc-b.test'
};

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function stripModule(source) {
  return source
    .replace(/^import[\s\S]*?from '[^']+';\s*\n/gm, '')
    .replace(/^export default /gm, '')
    .replace(/^export /gm, '');
}

// In-memory PostgREST covering the query shapes the moderation modules use
// plus the four atomic RPCs (JS mirror of the SQL logic; the SQL itself is
// integration-tested in Docker). Logs every request for zero-query proofs.
function createDb(seed = {}) {
  const tables = {
    artsoul_staff_roles: seed.roles || [],
    profiles: seed.profiles || [],
    artsoul_staff_passkeys: seed.passkeys || [],
    artsoul_webauthn_challenges: seed.challenges || [],
    artsoul_staff_enrollment_grants: seed.grants || [],
    artsoul_staff_auth_events: seed.events || [],
    artsoul_staff_recovery_requests: seed.recoveryRequests || []
  };
  const log = [];
  let nextId = 1000;

  function matches(row, params) {
    for (const [key, raw] of params) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(key)) continue;
      const [column, jsonKey] = key.split('->>');
      const value = jsonKey ? row[column]?.[jsonKey] : row[column];
      if (raw === 'is.null') {
        if (value !== null && value !== undefined) return false;
      } else if (raw === 'not.is.null') {
        if (value === null || value === undefined) return false;
      } else if (raw.startsWith('eq.')) {
        if (String(value) !== raw.slice(3)) return false;
      } else if (raw.startsWith('gt.')) {
        if (!(new Date(value) > new Date(raw.slice(3)))) return false;
      } else {
        throw new Error(`Unsupported filter ${key}=${raw}`);
      }
    }
    return true;
  }

  function insert(table, body) {
    const inserted = (Array.isArray(body) ? body : [body])
      .map(row => ({ id: nextId++, ...row }));
    tables[table].push(...inserted);
    return inserted.map(row => ({ ...row }));
  }

  function audit(wallet, eventType, credentialId, details) {
    insert('artsoul_staff_auth_events', {
      wallet_address: wallet || null, event_type: eventType, credential_id: credentialId || null, details: details || null
    });
  }

  const rpc = {
    a8a_issue_enrollment_grant(b) {
      const wallet = String(b.p_target_wallet).toLowerCase();
      if (b.p_purpose === 'bootstrap') {
        const consumedBootstrap = tables.artsoul_staff_enrollment_grants.some(g => g.purpose === 'bootstrap' && g.consumed_at);
        const bootstrapCred = tables.artsoul_staff_passkeys.some(c => c.enrolled_via === 'bootstrap' && !c.revoked_at);
        if (consumedBootstrap || bootstrapCred) throw rpcError('A8A_BOOTSTRAP_ALREADY_ESTABLISHED');
        const active = tables.artsoul_staff_enrollment_grants.find(g => g.purpose === 'bootstrap' && !g.consumed_at && !g.revoked_at);
        if (active) {
          if (new Date(active.expires_at) > new Date()) throw rpcError('A8A_ACTIVE_BOOTSTRAP_EXISTS');
          active.revoked_at = new Date().toISOString();
          audit(wallet, 'grant_superseded', null, { superseded_grant_id: active.id });
        }
      }
      const grant = insert('artsoul_staff_enrollment_grants', {
        target_wallet: wallet, purpose: b.p_purpose, token_hash: b.p_token_hash,
        issued_by: String(b.p_issued_by).toLowerCase(), issued_at: new Date().toISOString(),
        expires_at: b.p_expires_at, consumed_at: null, revoked_at: null
      })[0];
      audit(wallet, 'grant_issued', null, { grant_id: grant.id, purpose: b.p_purpose });
      return grant.id;
    },
    a8a_complete_registration(b) {
      const wallet = String(b.p_wallet).toLowerCase();
      const grant = tables.artsoul_staff_enrollment_grants.find(g => g.id === b.p_grant_id);
      if (!grant || grant.target_wallet !== wallet || grant.purpose !== b.p_purpose ||
          grant.token_hash !== b.p_token_hash || grant.consumed_at || grant.revoked_at ||
          new Date(grant.expires_at) <= new Date()) return 'GRANT_INVALID';
      const challenge = tables.artsoul_webauthn_challenges.find(c => c.challenge === b.p_challenge);
      if (!challenge || challenge.wallet_address !== wallet || challenge.purpose !== 'registration' ||
          challenge.grant_id !== b.p_grant_id || challenge.consumed_at ||
          new Date(challenge.expires_at) <= new Date()) return 'CHALLENGE_INVALID';
      if (b.p_purpose === 'bootstrap') {
        const consumedOther = tables.artsoul_staff_enrollment_grants.some(g => g.purpose === 'bootstrap' && g.consumed_at && g.id !== b.p_grant_id);
        const bootstrapCred = tables.artsoul_staff_passkeys.some(c => c.enrolled_via === 'bootstrap' && !c.revoked_at);
        if (consumedOther || bootstrapCred) return 'BOOTSTRAP_ALREADY_ESTABLISHED';
      }
      challenge.consumed_at = new Date().toISOString();
      grant.consumed_at = new Date().toISOString();
      grant.consumed_by_credential = b.p_credential_id;
      insert('artsoul_staff_passkeys', {
        wallet_address: wallet, credential_id: b.p_credential_id, public_key: b.p_public_key,
        sign_count: b.p_sign_count || 0, transports: b.p_transports, aaguid: b.p_aaguid,
        label: b.p_label, enrolled_via: b.p_purpose, created_at: new Date().toISOString(),
        last_used_at: null, revoked_at: null
      });
      audit(wallet, 'grant_consumed', b.p_credential_id, { grant_id: b.p_grant_id, purpose: b.p_purpose });
      audit(wallet, 'passkey_enrolled', b.p_credential_id, { enrolled_via: b.p_purpose });
      return 'OK';
    },
    a8a_revoke_credential(b) {
      const wallet = String(b.p_wallet).toLowerCase();
      const target = tables.artsoul_staff_passkeys.find(c => c.wallet_address === wallet && c.credential_id === b.p_credential_id && !c.revoked_at);
      if (!target) return 'CREDENTIAL_NOT_FOUND';
      const activeCount = tables.artsoul_staff_passkeys.filter(c => c.wallet_address === wallet && !c.revoked_at).length;
      if (activeCount <= 1) {
        audit(wallet, 'passkey_revoke_denied', b.p_credential_id, { reason: 'last_active_credential' });
        return 'LAST_ACTIVE_CREDENTIAL';
      }
      target.revoked_at = new Date().toISOString();
      target.revoked_by = wallet;
      audit(wallet, 'passkey_revoked', b.p_credential_id, { revoked_by: wallet });
      return 'OK';
    },
    a8a_complete_authentication(b) {
      const wallet = String(b.p_wallet).toLowerCase();
      const cred = tables.artsoul_staff_passkeys.find(c => c.wallet_address === wallet && c.credential_id === b.p_credential_id && !c.revoked_at);
      if (!cred) return 'CREDENTIAL_NOT_FOUND';
      const stored = Number(cred.sign_count) || 0;
      const next = Number(b.p_new_counter) || 0;
      if (!(next > stored || (next === 0 && stored === 0))) return 'STALE_COUNTER';
      cred.sign_count = next;
      cred.last_used_at = new Date().toISOString();
      audit(wallet, 'passkey_auth_success', b.p_credential_id, null);
      return 'OK';
    },
    a8d_complete_safe_recovery(b) {
      const wallet = String(b.p_target_wallet).toLowerCase();
      const safe = String(b.p_safe_address).toLowerCase();
      const request = tables.artsoul_staff_recovery_requests.find(row => row.request_id === b.p_request_id);
      if (!request || request.target_wallet !== wallet || request.safe_address !== safe ||
          Number(request.chain_id) !== Number(b.p_chain_id) || request.message_hash !== String(b.p_message_hash).toLowerCase() ||
          request.consumed_at || new Date(request.expires_at) <= new Date()) return 'RECOVERY_REQUEST_INVALID';
      if (!/^[0-9a-f]{64}$/.test(String(b.p_signature_hash)) ||
          !/^[0-9a-f]{64}$/.test(String(b.p_token_hash)) ||
          new Date(b.p_grant_expires_at) <= new Date() ||
          new Date(b.p_grant_expires_at) > new Date(Date.now() + (15 * 60 * 1000))) return 'RECOVERY_COMMIT_INVALID';
      request.consumed_at = new Date().toISOString();
      const grant = insert('artsoul_staff_enrollment_grants', {
        target_wallet: wallet, purpose: 'additional', token_hash: String(b.p_token_hash).toLowerCase(),
        issued_by: safe, issued_at: new Date().toISOString(), expires_at: b.p_grant_expires_at,
        consumed_at: null, revoked_at: null
      })[0];
      audit(wallet, 'recovery_authorized', null, {
        request_id: request.request_id, safe_address: safe, chain_id: Number(b.p_chain_id),
        message_hash: String(b.p_message_hash).toLowerCase(), signature_hash: String(b.p_signature_hash).toLowerCase(),
        grant_id: grant.id
      });
      audit(wallet, 'grant_issued', null, {
        grant_id: grant.id, purpose: 'additional', issued_by: safe, source: 'safe_recovery'
      });
      return 'OK';
    }
  };

  function rpcError(code) {
    const error = new Error(code);
    error.statusCode = 500;
    error.code = code;
    return error;
  }

  async function supabaseRest(pathValue, options = {}) {
    const method = options.method || 'GET';
    log.push({ path: pathValue, method });

    if (pathValue.startsWith('rpc/')) {
      const fn = pathValue.slice(4);
      if (!rpc[fn]) throw new Error(`Unknown rpc ${fn}`);
      return rpc[fn](options.body || {});
    }

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
      return insert(table, options.body);
    }
    throw new Error(`Unsupported method ${method}`);
  }

  return { tables, log, supabaseRest };
}

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; }
  };
}

function fakeReq({ method = 'POST', cookie = '', body = {}, host = 'artsoul.test', query = {} } = {}) {
  return { method, url: '/api/test', headers: { cookie, host }, body, query };
}

function cookieValueFromHeader(header) {
  return String(header || '').split(';')[0];
}

function loadEnvironment({ env = {}, db = createDb(), webauthn = {}, recoveryRpc = {} } = {}) {
  const calls = { registrationOptions: [], registrationVerify: [], authenticationOptions: [], authenticationVerify: [] };
  const control = { registrationVerified: true, authenticationVerified: true, newCounter: 7, ...webauthn };

  const recoveryControl = {
    'https://rpc-a.test': { valid: true },
    'https://rpc-b.test': { valid: true },
    ...recoveryRpc
  };
  class MockJsonRpcProvider {
    constructor(url, chainId) { this.url = url.url || url; this.chainId = chainId; }
    async send(method) {
      assert.equal(method, 'eth_chainId');
      const item = recoveryControl[this.url] || {};
      if (item.networkError) throw new Error('network unavailable');
      return '0x' + BigInt(item.chainId ?? this.chainId).toString(16);
    }
    async getCode() {
      const item = recoveryControl[this.url] || {};
      if (item.codeError) throw new Error('code unavailable');
      return item.code ?? '0x6000';
    }
    async call() {
      const item = recoveryControl[this.url] || {};
      if (item.callError) throw new Error('EIP-1271 call failed');
      const magic = item.valid === false ? 'ffffffff' : '1626ba7e';
      return `0x${magic}${'0'.repeat(56)}`;
    }
  }
  class MockFetchRequest {
    constructor(url) { this.url = url; this.timeout = 0; }
  }

  const context = vm.createContext({
    process: { env: { NODE_ENV: 'test', ...env } },
    console: { log() {}, warn() {}, error() {} },
    crypto, Buffer, URL, URLSearchParams, FetchRequest: MockFetchRequest, Interface, JsonRpcProvider: MockJsonRpcProvider,
    hashMessage, isAddress, isHexString, exported: {},
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
          credential: { id: options.response.id, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] }
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
  context.exported.__mockSupabase = db.supabaseRest;
  vm.runInContext('supabaseRest = exported.__mockSupabase;', context);
  vm.runInContext(stripModule(passkeySource), context, { filename: 'moderation-passkey.js (stripped)' });
  vm.runInContext(stripModule(read('src/api/moderation-factor-setup.js')), context, { filename: 'moderation-factor-setup.js (stripped)' });
  vm.runInContext(stripModule(safeRecoverySource), context, { filename: 'moderation-safe-recovery.js (stripped)' });
  vm.runInContext(stripModule(accessSource), context, { filename: 'moderation-access.js (stripped)' });
  vm.runInContext([
    'exported.getModerationAccess = getModerationAccess;',
    'exported.setWalletSession = setWalletSession;',
    'exported.setModerationSession = setModerationSession;',
    'exported.MODERATION_SESSION_TTL_SECONDS = MODERATION_SESSION_TTL_SECONDS;',
    'exported.hashGrantToken = hashGrantToken;',
    'exported.hashSafeRecoverySignature = hashSafeRecoverySignature;'
  ].join('\n'), context);

  const routeCache = new Map();
  function loadRoute(name) {
    if (routeCache.has(name)) return routeCache.get(name);
    const source = ROUTE_SOURCES[name]
      .replace('export default async function handler', `exported.route_${name} = async function handler`);
    vm.runInContext(stripModule(source), context, { filename: `${name} (stripped route)` });
    const handler = context.exported[`route_${name}`];
    routeCache.set(name, handler);
    return handler;
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

  return { context, db, calls, control, recoveryControl, loadRoute, siweCookie, moderationCookie, exported: context.exported };
}

function staffSeed(extra = {}) {
  return { roles: [{ wallet_address: STAFF, role: 'moderator', active: true }], profiles: [{ wallet_address: STAFF }], ...extra };
}

const RAW_TOKEN = 'test-one-time-token-0123456789abcdef';

function grantRow(overrides = {}) {
  return {
    id: 1, target_wallet: STAFF, purpose: 'additional', token_hash: hashToken(RAW_TOKEN),
    issued_by: STAFF, issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null, revoked_at: null, ...overrides
  };
}

function activePasskey(overrides = {}) {
  return {
    id: 1, wallet_address: STAFF, credential_id: 'cred-1', public_key: Buffer.from([9, 9, 9]).toString('base64url'),
    sign_count: 3, transports: '["internal"]', label: 'Test key', enrolled_via: 'bootstrap',
    created_at: new Date().toISOString(), last_used_at: null, revoked_at: null, ...overrides
  };
}

// ---------------------------------------------------------------------------
// Flag OFF: exact legacy behavior
// ---------------------------------------------------------------------------

test('flag off: legacy access path is byte-compatible and queries no passkey table', async () => {
  const db = createDb(staffSeed({ profiles: [{ wallet_address: STAFF, twitter_id: 't', discord_id: 'd' }] }));
  const envir = loadEnvironment({ env: { SESSION_SECRET: 'test-siwe-secret' }, db });
  const access = await envir.exported.getModerationAccess(fakeReq({ cookie: envir.siweCookie(STAFF) }), { strict: true });
  assert.equal(access.canModerate, true);
  assert.equal(access.role, 'moderator');
  assert.equal('passkeyRequired' in access, false);
  assert.equal(envir.db.log.some(e => e.path.includes('artsoul_staff_passkeys')), false);
});

test('flag off: every passkey route answers 404 and needs no WebAuthn env', async () => {
  const envir = loadEnvironment({ env: { SESSION_SECRET: 'test-siwe-secret' }, db: createDb(staffSeed()) });
  for (const name of Object.keys(ROUTE_SOURCES)) {
    if (name === 'artworkVisibility') continue;
    const res = fakeRes();
    await envir.loadRoute(name)(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
    assert.equal(res.statusCode, 404, `${name} must be absent while disabled`);
    assert.equal(res.body.error, 'PASSKEY_DISABLED');
  }
});

// ---------------------------------------------------------------------------
// Flag ON, misconfiguration and config-only RP ID
// ---------------------------------------------------------------------------

test('flag on without full configuration denies moderation instead of falling back', async () => {
  const db = createDb(staffSeed({ profiles: [{ wallet_address: STAFF, twitter_id: 't', discord_id: 'd' }] }));
  const envir = loadEnvironment({ env: { SESSION_SECRET: 'test-siwe-secret', ARTSOUL_MODERATION_PASSKEY_ENABLED: 'true' }, db });
  const req = fakeReq({ cookie: envir.siweCookie(STAFF) });
  await assert.rejects(envir.exported.getModerationAccess(req, { strict: true }),
    (e) => e.code === 'MODERATION_PASSKEY_MISCONFIGURED' && e.statusCode === 503);
  const relaxed = await envir.exported.getModerationAccess(req);
  assert.equal(relaxed.canModerate, false);
  assert.deepEqual([...relaxed.missingFactors], ['passkey_configuration']);
});

test('flag on: getModerationAccess performs ZERO profile queries', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const access = await envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true });
  assert.equal(access.canModerate, true);
  assert.equal(envir.db.log.some(e => e.path.startsWith('profiles')), false, 'profiles must never be queried in flag-on mode');
});

test('flag on: a profiles outage cannot deny a valid passkey-protected moderator', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  // Any profiles query throws — but the flag-on path must not issue one.
  const original = db.supabaseRest;
  db.supabaseRest = async (p, o) => { if (p.startsWith('profiles')) throw new Error('profiles down'); return original(p, o); };
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const access = await envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true });
  assert.equal(access.canModerate, true);
});

test('the RP ID and origin come only from configuration, never the request host', async () => {
  const db = createDb(staffSeed({ grants: [grantRow()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie: envir.siweCookie(STAFF), host: 'evil.example',
    body: { token: RAW_TOKEN, response: { id: 'cred-new', __challenge: 'reg-challenge-1' } }
  }), res);
  const args = envir.calls.registrationVerify[0];
  assert.equal(args.expectedOrigin, 'https://artsoul.test');
  assert.equal(args.expectedRPID, 'artsoul.test');
  assert.equal(args.requireUserVerification, true);
});

// ---------------------------------------------------------------------------
// Grant token possession
// ---------------------------------------------------------------------------

test('enrollment requires the one-time token: wallet-only access fails', async () => {
  const db = createDb(staffSeed({ grants: [grantRow()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  // Correct SIWE wallet, active grant exists, but NO token presented.
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF), body: {} }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'ENROLLMENT_GRANT_REQUIRED');
});

function approvedBootstrapSeed(overrides = {}) {
  return staffSeed({
    grants: [grantRow({ purpose: 'bootstrap' })],
    events: [{ id: 1, wallet_address: STAFF, event_type: 'grant_issued', details: { grant_id: 1, purpose: 'bootstrap' } }],
    ...overrides
  });
}

async function approvedOptions(envir, body = { mode: 'approved-bootstrap' }, wallet = STAFF) {
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: wallet ? envir.siweCookie(wallet) : '', body }), res);
  return res;
}

async function approvedVerify(envir, response = { id: 'first-key', __challenge: 'reg-challenge-1' }) {
  const res = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({ cookie: envir.siweCookie(STAFF), body: { mode: 'approved-bootstrap', response } }), res);
  return res;
}

test('approved first enrollment uses an existing audited bootstrap without returning a token or issuing authority', async () => {
  const db = createDb(approvedBootstrapSeed());
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const options = await approvedOptions(envir);
  assert.equal(options.statusCode, 200);
  assert.equal(db.tables.artsoul_webauthn_challenges[0].grant_id, 1);
  const result = await approvedVerify(envir);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(db.tables.artsoul_staff_passkeys[0].enrolled_via, 'bootstrap');
  assert.ok(db.tables.artsoul_staff_enrollment_grants[0].consumed_at);
  assert.equal(db.tables.artsoul_staff_enrollment_grants.length, 1);
  assert.equal(db.tables.artsoul_staff_roles.length, 1);
  assert.equal(db.log.some(call => call.path === 'rpc/a8a_issue_enrollment_grant'), false);
  assert.deepEqual(db.tables.artsoul_staff_auth_events.map(row => row.event_type), ['grant_issued', 'grant_consumed', 'passkey_enrolled']);
  for (const res of [options, result]) {
    assert.doesNotMatch(JSON.stringify(res.body), /token|grant_id|expires_at/);
    assert.equal(res.headers['set-cookie'], undefined, 'registration does not create a moderation session');
    assert.ok(!JSON.stringify(res.body).includes(hashToken(RAW_TOKEN)));
  }
  assert.equal(envir.calls.registrationOptions[0].authenticatorSelection.userVerification, 'required');
  assert.equal(envir.calls.registrationVerify[0].expectedOrigin, CONFIGURED_ENV.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN);
  assert.equal(envir.calls.registrationVerify[0].requireUserVerification, true);
  assert.equal((await approvedVerify(envir)).statusCode, 403, 'completed setup cannot be replayed');
});

test('approved first enrollment denies absent, stale, foreign, additional, ambiguous or unaudited grants', async () => {
  const cases = [
    { grants: [] }, { events: [] },
    { grants: [grantRow()] },
    { grants: [grantRow({ purpose: 'bootstrap', target_wallet: OTHER })] },
    { grants: [grantRow({ purpose: 'bootstrap', expires_at: new Date(Date.now() - 1000).toISOString() })] },
    { grants: [grantRow({ purpose: 'bootstrap', revoked_at: new Date().toISOString() })] },
    { grants: [grantRow({ purpose: 'bootstrap', consumed_at: new Date().toISOString() })] },
    { grants: [grantRow({ purpose: 'bootstrap' }), grantRow({ id: 2, purpose: 'bootstrap' })] },
    { events: [{ id: 1, wallet_address: OTHER, event_type: 'grant_issued', details: { grant_id: 1, purpose: 'bootstrap' } }] },
    { events: [{ id: 1, wallet_address: STAFF, event_type: 'grant_issued', details: { grant_id: 9, purpose: 'bootstrap' } }] },
    { grants: [grantRow({ purpose: 'bootstrap', token_hash: 'invalid' })] }
  ];
  for (const seed of cases) {
    const db = createDb(approvedBootstrapSeed(seed));
    const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
    const result = await approvedOptions(envir);
    assert.equal(result.statusCode, 403, JSON.stringify(seed));
    assert.equal(result.body.error, 'FIRST_ENROLLMENT_UNAVAILABLE');
    assert.equal(db.tables.artsoul_webauthn_challenges.length, 0);
    assert.equal(db.tables.artsoul_staff_passkeys.length, 0);
    assert.equal(db.log.some(call => call.method !== 'GET'), false, 'denial cannot renew or mutate a grant');
  }
});

test('approved first enrollment is unavailable after any own key or established bootstrap, including revoked history', async () => {
  for (const seed of [
    { passkeys: [activePasskey({ enrolled_via: 'additional' })] },
    { passkeys: [activePasskey({ enrolled_via: 'additional', revoked_at: new Date().toISOString() })] },
    { passkeys: [activePasskey({ wallet_address: OTHER, revoked_at: new Date().toISOString() })] },
    { grants: [grantRow({ purpose: 'bootstrap' }), grantRow({ id: 2, target_wallet: OTHER, purpose: 'bootstrap', consumed_at: new Date().toISOString() })] }
  ]) {
    const envir = loadEnvironment({ env: CONFIGURED_ENV, db: createDb(approvedBootstrapSeed(seed)) });
    assert.equal((await approvedOptions(envir)).statusCode, 403);
    assert.equal(envir.calls.registrationOptions.length, 0);
  }
});

test('approved first enrollment still requires an authenticated active staff wallet', async () => {
  for (const [roles, wallet, status] of [
    [[], STAFF, 403], [[{ wallet_address: STAFF, role: 'admin', active: false }], STAFF, 403],
    [[{ wallet_address: STAFF, role: 'owner', active: true }], STAFF, 403],
    [[{ wallet_address: STAFF, role: 'admin', active: true }], OTHER, 403],
    [[{ wallet_address: STAFF, role: 'admin', active: true }], '', 401]
  ]) {
    const envir = loadEnvironment({ env: CONFIGURED_ENV, db: createDb(approvedBootstrapSeed({ roles })) });
    assert.equal((await approvedOptions(envir, undefined, wallet)).statusCode, status);
    assert.equal(envir.calls.registrationOptions.length, 0);
  }
});

test('registration modes reject ambiguous input and never fall back from a bad supplied token', async () => {
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db: createDb(approvedBootstrapSeed()) });
  for (const body of [{ mode: null }, { mode: 'unknown' }, { mode: {} }, { mode: 'approved-bootstrap', token: '' }, { mode: 'approved-bootstrap', token: RAW_TOKEN }]) {
    assert.equal((await approvedOptions(envir, body)).statusCode, 400, `Rejected mode: ${String(body.mode)}`);
  }
  assert.equal((await approvedOptions(envir, { token: 'wrong-token' })).statusCode, 403);
  assert.equal((await approvedOptions(envir, {})).statusCode, 403);
  assert.equal(envir.calls.registrationOptions.length, 0);
});

test('approved bootstrap verification rechecks expiration, revocation, credentials and role after options', async () => {
  for (const mutate of [
    db => { db.tables.artsoul_staff_enrollment_grants[0].expires_at = new Date(Date.now() - 1000).toISOString(); },
    db => { db.tables.artsoul_staff_enrollment_grants[0].revoked_at = new Date().toISOString(); },
    db => { db.tables.artsoul_staff_roles[0].active = false; },
    db => { db.tables.artsoul_staff_passkeys.push(activePasskey({ enrolled_via: 'additional' })); }
  ]) {
    const db = createDb(approvedBootstrapSeed()), envir = loadEnvironment({ env: CONFIGURED_ENV, db });
    assert.equal((await approvedOptions(envir)).statusCode, 200);
    mutate(db);
    assert.equal((await approvedVerify(envir)).statusCode, 403);
    assert.equal(envir.calls.registrationVerify.length, 0);
    assert.equal(db.tables.artsoul_staff_enrollment_grants[0].consumed_at, null);
  }
});

test('a superseding approved bootstrap cannot consume the earlier grant challenge', async () => {
  const db = createDb(approvedBootstrapSeed()), envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  assert.equal((await approvedOptions(envir)).statusCode, 200);
  db.tables.artsoul_staff_enrollment_grants[0].revoked_at = new Date().toISOString();
  db.tables.artsoul_staff_enrollment_grants.push(grantRow({ id: 2, purpose: 'bootstrap' }));
  db.tables.artsoul_staff_auth_events.push({ id: 2, wallet_address: STAFF, event_type: 'grant_issued', details: { grant_id: 2, purpose: 'bootstrap' } });
  assert.equal((await approvedVerify(envir)).statusCode, 400);
  assert.equal(db.tables.artsoul_staff_passkeys.length, 0);
  assert.equal(db.tables.artsoul_staff_enrollment_grants[1].consumed_at, null);
});

test('approved bootstrap cannot enroll with an absent, expired, foreign or consumed challenge', async () => {
  for (const mutate of [
    db => { db.tables.artsoul_webauthn_challenges.length = 0; },
    db => { db.tables.artsoul_webauthn_challenges[0].expires_at = new Date(Date.now() - 1000).toISOString(); },
    db => { db.tables.artsoul_webauthn_challenges[0].wallet_address = OTHER; },
    db => { db.tables.artsoul_webauthn_challenges[0].consumed_at = new Date().toISOString(); }
  ]) {
    const db = createDb(approvedBootstrapSeed()), envir = loadEnvironment({ env: CONFIGURED_ENV, db });
    assert.equal((await approvedOptions(envir)).statusCode, 200);
    mutate(db);
    assert.equal((await approvedVerify(envir)).statusCode, 400);
    assert.equal(db.tables.artsoul_staff_passkeys.length, 0);
    assert.equal(db.tables.artsoul_staff_enrollment_grants[0].consumed_at, null);
  }
});

test('a wrong token does not resolve any grant', async () => {
  const db = createDb(staffSeed({ grants: [grantRow()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF), body: { token: 'wrong-token' } }), res);
  assert.equal(res.statusCode, 403);
});

test('an expired or revoked token grant does not authorize enrollment', async () => {
  for (const override of [{ expires_at: new Date(Date.now() - 1000).toISOString() }, { revoked_at: new Date().toISOString() }]) {
    const db = createDb(staffSeed({ grants: [grantRow(override)] }));
    const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
    const res = fakeRes();
    await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF), body: { token: RAW_TOKEN } }), res);
    assert.equal(res.statusCode, 403);
  }
});

test('a token for one wallet cannot enroll a different SIWE wallet', async () => {
  const db = createDb({
    roles: [{ wallet_address: OTHER, role: 'moderator', active: true }],
    grants: [grantRow({ target_wallet: STAFF })]
  });
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(OTHER), body: { token: RAW_TOKEN } }), res);
  assert.equal(res.statusCode, 403);
});

test('the raw grant token is never persisted anywhere in the grant row', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const res = fakeRes();
  await envir.loadRoute('grant')(fakeReq({ cookie }), res);
  assert.equal(res.statusCode, 200);
  const rawToken = res.body.token;
  assert.ok(rawToken && rawToken.length >= 40, 'a raw token is returned once');
  const grant = db.tables.artsoul_staff_enrollment_grants[0];
  assert.equal(grant.token_hash, hashToken(rawToken));
  // No stored column equals the raw token.
  for (const value of Object.values(grant)) {
    assert.notEqual(value, rawToken, 'the raw token must never be stored');
  }
});

// ---------------------------------------------------------------------------
// SIWE / role preconditions
// ---------------------------------------------------------------------------

test('missing SIWE session rejects every passkey route with 401', async () => {
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db: createDb(staffSeed()) });
  const res = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({ cookie: '' }), res);
  assert.equal(res.statusCode, 401);
});

test('an inactive staff role rejects enrollment routes', async () => {
  const db = createDb({ roles: [{ wallet_address: STAFF, role: 'moderator', active: false }], grants: [grantRow()] });
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF), body: { token: RAW_TOKEN } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'ADMIN_REQUIRED');
});

// ---------------------------------------------------------------------------
// Full enrollment flow with token + challenge/grant binding
// ---------------------------------------------------------------------------

async function runEnrollment(envir, { credentialId = 'cred-new', token = RAW_TOKEN } = {}) {
  const cookie = envir.siweCookie(STAFF);
  const optionsRes = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie, body: { token } }), optionsRes);
  const verifyRes = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie, body: { token, response: { id: credentialId, __challenge: 'reg-challenge-1' }, label: 'Founder device' }
  }), verifyRes);
  return { optionsRes, verifyRes };
}

test('a valid token registration enrolls the credential, burns the grant, and audits both', async () => {
  const db = createDb(staffSeed({ grants: [grantRow()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const { optionsRes, verifyRes } = await runEnrollment(envir);

  assert.equal(optionsRes.statusCode, 200);
  assert.equal(envir.calls.registrationOptions[0].authenticatorSelection.userVerification, 'required');
  assert.equal(verifyRes.statusCode, 200, JSON.stringify(verifyRes.body));

  const stored = db.tables.artsoul_staff_passkeys[0];
  assert.equal(stored.credential_id, 'cred-new');
  assert.equal(stored.enrolled_via, 'additional');
  const grant = db.tables.artsoul_staff_enrollment_grants[0];
  assert.ok(grant.consumed_at);
  assert.equal(grant.consumed_by_credential, 'cred-new');
  const events = db.tables.artsoul_staff_auth_events.map(e => e.event_type);
  assert.deepEqual(events, ['grant_consumed', 'passkey_enrolled']);
});

test('the registration challenge is bound to the exact grant id (no substitution)', async () => {
  // Two active grants for the same wallet; options is requested with token A,
  // but verify is attempted with token B — the challenge is bound to A.
  const tokenB = 'second-grant-token-abcdef0123456789';
  const db = createDb(staffSeed({ grants: [grantRow({ id: 1 }), grantRow({ id: 2, token_hash: hashToken(tokenB) })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = envir.siweCookie(STAFF);
  const optionsRes = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie, body: { token: RAW_TOKEN } }), optionsRes);
  // Challenge stored bound to grant 1. Verify with token B (grant 2).
  const verifyRes = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie, body: { token: tokenB, response: { id: 'cred-x', __challenge: 'reg-challenge-1' } }
  }), verifyRes);
  assert.equal(verifyRes.statusCode, 400);
  assert.equal(verifyRes.body.error, 'REGISTRATION_NOT_VERIFIED');
  assert.equal(db.tables.artsoul_staff_passkeys.length, 0);
});

test('a consumed grant cannot be reused for a second enrollment', async () => {
  const db = createDb(staffSeed({ grants: [grantRow({ consumed_at: new Date().toISOString() })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie: envir.siweCookie(STAFF), body: { token: RAW_TOKEN } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(db.tables.artsoul_staff_passkeys.length, 0);
});

test('replaying a consumed registration challenge cannot create a second credential', async () => {
  const db = createDb(staffSeed({ grants: [grantRow(), grantRow({ id: 2 })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const first = await runEnrollment(envir);
  assert.equal(first.verifyRes.statusCode, 200);
  // The challenge row is now consumed; a replay fails the read-only validator.
  const res = fakeRes();
  await envir.loadRoute('registerVerify')(fakeReq({
    cookie: envir.siweCookie(STAFF), body: { token: RAW_TOKEN, response: { id: 'cred-2', __challenge: 'reg-challenge-1' } }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.tables.artsoul_staff_passkeys.length, 1);
});

// ---------------------------------------------------------------------------
// Authentication, session, counter, multiple passkeys
// ---------------------------------------------------------------------------

async function runAuthentication(envir, { credentialId = 'cred-1' } = {}) {
  const cookie = envir.siweCookie(STAFF);
  const optionsRes = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({ cookie }), optionsRes);
  const verifyRes = fakeRes();
  await envir.loadRoute('authVerify')(fakeReq({
    cookie, body: { response: { id: credentialId, __challenge: 'auth-challenge-1' } }
  }), verifyRes);
  return { optionsRes, verifyRes };
}

test('a passkey challenge issued before role regrant cannot create a fresh session', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  db.tables.artsoul_staff_roles[0].authorization_version = 41;
  db.tables.artsoul_staff_passkeys[0].authorization_version = 41;
  const envir = loadEnvironment({ env: {...CONFIGURED_ENV, ARTSOUL_MODERATION_DUAL_WALLET_ENABLED:'true'}, db });
  const cookie = envir.siweCookie(STAFF), options = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({cookie}), options);
  assert.equal(options.statusCode, 200);
  // The same wallet returns with a previously signed browser response after
  // a new role grant. Request-entry version checks alone cannot distinguish it.
  db.tables.artsoul_staff_roles[0].authorization_version = 43;
  // A newly approved credential still cannot consume the old challenge.
  db.tables.artsoul_staff_passkeys[0].authorization_version = 43;
  const response = fakeRes();
  await envir.loadRoute('authVerify')(fakeReq({cookie,
    body:{response:{id:'cred-1',__challenge:'auth-challenge-1'}}}), response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, 'AUTHENTICATION_NOT_VERIFIED');
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(db.log.some(entry => entry.path === 'rpc/a8a_complete_authentication'), false);
});

test('role-bound authentication consumes a current challenge only once', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  db.tables.artsoul_staff_roles[0].authorization_version = 41;
  db.tables.artsoul_staff_passkeys[0].authorization_version = 41;
  const envir = loadEnvironment({ env: { ...CONFIGURED_ENV, ARTSOUL_MODERATION_DUAL_WALLET_ENABLED: 'true' }, db });
  const { optionsRes, verifyRes } = await runAuthentication(envir);
  assert.equal(optionsRes.statusCode, 200);
  assert.equal(verifyRes.statusCode, 200);
  const stored = db.tables.artsoul_webauthn_challenges[0];
  assert.equal(stored.authorization_version, 41);
  assert.ok(stored.consumed_at);
  const replay = fakeRes();
  await envir.loadRoute('authVerify')(fakeReq({ cookie: envir.siweCookie(STAFF),
    body: { response: { id: 'cred-1', __challenge: stored.challenge } } }), replay);
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.headers['set-cookie'], undefined);
  assert.equal(db.log.filter(entry => entry.path === 'rpc/a8a_complete_authentication').length, 1);
});

test('role-bound authentication rejects legacy, foreign, expired and registration challenges', async t => {
  for (const [name, patch] of [
    ['legacy', { authorization_version: null }],
    ['foreign role version', { authorization_version: 42 }],
    ['foreign wallet', { wallet_address: '0x' + 'aa'.repeat(20) }],
    ['expired', { expires_at: new Date(Date.now() - 60_000).toISOString() }],
    ['registration', { purpose: 'registration' }]
  ]) await t.test(name, async () => {
    const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
    db.tables.artsoul_staff_roles[0].authorization_version = 41;
  db.tables.artsoul_staff_passkeys[0].authorization_version = 41;
    const envir = loadEnvironment({ env: { ...CONFIGURED_ENV, ARTSOUL_MODERATION_DUAL_WALLET_ENABLED: 'true' }, db });
    const cookie = envir.siweCookie(STAFF), options = fakeRes();
    await envir.loadRoute('authOptions')(fakeReq({ cookie }), options);
    assert.equal(options.statusCode, 200);
    Object.assign(db.tables.artsoul_webauthn_challenges[0], patch);
    const result = fakeRes();
    await envir.loadRoute('authVerify')(fakeReq({ cookie,
      body: { response: { id: 'cred-1', __challenge: 'auth-challenge-1' } } }), result);
    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'AUTHENTICATION_NOT_VERIFIED');
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(db.log.some(entry => entry.path === 'rpc/a8a_complete_authentication'), false);
    assert.ok(!db.tables.artsoul_webauthn_challenges[0].consumed_at);
  });
});

test('a valid authentication issues the exact 15-minute moderation session and advances the counter', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const { verifyRes } = await runAuthentication(envir);
  assert.equal(verifyRes.statusCode, 200, JSON.stringify(verifyRes.body));
  assert.equal(verifyRes.body.expires_in_seconds, 900);
  assert.equal(envir.exported.MODERATION_SESSION_TTL_SECONDS, 900);
  assert.match(verifyRes.headers['set-cookie'], /artsoul_mod_session=/);
  assert.match(verifyRes.headers['set-cookie'], /Max-Age=900/);
  assert.match(verifyRes.headers['set-cookie'], /HttpOnly/);
  const stored = db.tables.artsoul_staff_passkeys[0];
  assert.equal(stored.sign_count, 7);
  assert.ok(stored.last_used_at);
  assert.deepEqual(db.tables.artsoul_staff_auth_events.map(e => e.event_type), ['passkey_auth_success']);
});

test('a stale counter is rejected at the atomic commit and issues no session', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey({ sign_count: 9 })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db, webauthn: { newCounter: 5 } });
  const { verifyRes } = await runAuthentication(envir);
  assert.equal(verifyRes.statusCode, 401);
  assert.equal(verifyRes.body.error, 'STALE_COUNTER');
  assert.equal(verifyRes.headers['set-cookie'], undefined);
});

test('a zero-counter authenticator is supported (0 stored, 0 new)', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey({ sign_count: 0 })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db, webauthn: { newCounter: 0 } });
  const { verifyRes } = await runAuthentication(envir);
  assert.equal(verifyRes.statusCode, 200, JSON.stringify(verifyRes.body));
});

test('a revoked credential cannot start authentication', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey({ revoked_at: new Date().toISOString() })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'NO_CREDENTIALS');
});

test('multiple passkeys per wallet are offered and excluded correctly', async () => {
  const db = createDb(staffSeed({
    passkeys: [activePasskey(), activePasskey({ id: 2, credential_id: 'cred-2' })], grants: [grantRow()]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = envir.siweCookie(STAFF);
  const authRes = fakeRes();
  await envir.loadRoute('authOptions')(fakeReq({ cookie }), authRes);
  assert.equal(envir.calls.authenticationOptions[0].allowCredentials.length, 2);
  const regRes = fakeRes();
  await envir.loadRoute('registerOptions')(fakeReq({ cookie, body: { token: RAW_TOKEN } }), regRes);
  assert.equal(envir.calls.registrationOptions[0].excludeCredentials.length, 2);
});

// ---------------------------------------------------------------------------
// getModerationAccess flag-on decision
// ---------------------------------------------------------------------------

test('arbitrary X/Discord profile text never authorizes moderation with the flag on', async () => {
  const db = createDb(staffSeed({
    profiles: [{ wallet_address: STAFF, twitter_id: 'x', twitter_handle: 'typed', discord_id: 'x', discord_username: 'typed#1' }]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const req = fakeReq({ cookie: envir.siweCookie(STAFF) });
  const relaxed = await envir.exported.getModerationAccess(req);
  assert.equal(relaxed.canModerate, false);
  assert.deepEqual([...relaxed.missingFactors], ['passkey_step_up']);
  await assert.rejects(envir.exported.getModerationAccess(req, { strict: true }),
    (e) => e.code === 'STEP_UP_REQUIRED' && e.statusCode === 403);
});

test('SIWE + valid step-up + active role grants moderation', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const access = await envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true });
  assert.equal(access.canModerate, true);
  assert.equal(access.stepUpActive, true);
});

test('a moderation cookie without the base SIWE cookie is rejected', async () => {
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db: createDb(staffSeed({ passkeys: [activePasskey()] })) });
  await assert.rejects(
    envir.exported.getModerationAccess(fakeReq({ cookie: envir.moderationCookie(STAFF, 'cred-1') }), { strict: true }),
    (e) => e.statusCode === 401);
});

test('a step-up for a different wallet than the SIWE session is rejected', async () => {
  const db = createDb({
    roles: [{ wallet_address: STAFF, role: 'moderator', active: true }, { wallet_address: OTHER, role: 'moderator', active: true }],
    passkeys: [activePasskey({ wallet_address: OTHER })]
  });
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(OTHER, 'cred-1')}`;
  await assert.rejects(envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    (e) => e.code === 'STEP_UP_WALLET_MISMATCH');
});

test('an expired 15-minute session fails closed', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const payload = Buffer.from(JSON.stringify({ wallet: STAFF, credential_id: 'cred-1', exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url');
  const signature = crypto.createHmac('sha256', CONFIGURED_ENV.ARTSOUL_MODERATION_SESSION_SECRET).update(payload).digest('base64url');
  const cookie = `${envir.siweCookie(STAFF)}; artsoul_mod_session=${payload}.${signature}`;
  await assert.rejects(envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    (e) => e.code === 'STEP_UP_REQUIRED');
});

test('dual-wallet role regrant must not revive the previous moderation session', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  db.tables.artsoul_staff_roles[0].authorization_version = 101;
  db.tables.artsoul_staff_passkeys[0].authorization_version = 101;
  const envir = loadEnvironment({ env: { ...CONFIGURED_ENV, ARTSOUL_MODERATION_DUAL_WALLET_ENABLED: 'true' }, db });
  const { verifyRes } = await runAuthentication(envir);
  assert.equal(verifyRes.statusCode, 200, JSON.stringify(verifyRes.body));
  const cookie = `${envir.siweCookie(STAFF)}; ${cookieValueFromHeader(verifyRes.headers['set-cookie'])}`;
  assert.equal((await envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true })).canModerate, true);
  Object.assign(db.tables.artsoul_staff_roles[0], { active: false, authorization_version: 102 });
  await assert.rejects(envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    e => e.code === 'ADMIN_REQUIRED');
  Object.assign(db.tables.artsoul_staff_roles[0], { active: true, authorization_version: 103 });
  await assert.rejects(envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    e => e.code === 'STEP_UP_REQUIRED');
  envir.control.newCounter = 8;
  const obsolete = await runAuthentication(envir);
  assert.equal(obsolete.verifyRes.statusCode, 403);
  assert.equal(obsolete.verifyRes.body.error, 'CREDENTIAL_NOT_ELIGIBLE');
  // Simulate separately approved replacement enrollment, not key revival.
  db.tables.artsoul_staff_passkeys[0] = activePasskey({authorization_version: 103});
  const fresh = await runAuthentication(envir);
  assert.equal(fresh.verifyRes.statusCode, 200);
  const freshCookie = cookieValueFromHeader(fresh.verifyRes.headers['set-cookie']);
  const payload = JSON.parse(Buffer.from(freshCookie.split('=')[1].split('.')[0], 'base64url').toString());
  assert.equal(payload.authorization_version, 103);
  assert.equal((await envir.exported.getModerationAccess(fakeReq({ cookie: `${envir.siweCookie(STAFF)}; ${freshCookie}` }), { strict: true })).canModerate, true);
});

test('dual-wallet role replacement and promotion invalidate an existing session', async t => {
  for (const replacement of [
    { wallet_address: STAFF, role: 'moderator', active: true, authorization_version: 201 },
    { wallet_address: STAFF, role: 'admin', active: true, authorization_version: 202 }
  ]) {
    await t.test(`new ${replacement.role} authorization`, async () => {
      const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
      db.tables.artsoul_staff_roles[0].authorization_version = '101';
  db.tables.artsoul_staff_passkeys[0].authorization_version = '101';
      const envir = loadEnvironment({ env: { ...CONFIGURED_ENV, ARTSOUL_MODERATION_DUAL_WALLET_ENABLED: 'true' }, db });
      const { verifyRes } = await runAuthentication(envir);
      assert.equal(verifyRes.statusCode, 200);
      db.tables.artsoul_staff_roles.splice(0, 1, replacement);
      const req = fakeReq({ cookie: `${envir.siweCookie(STAFF)}; ${cookieValueFromHeader(verifyRes.headers['set-cookie'])}` });
      await assert.rejects(envir.exported.getModerationAccess(req, { strict: true }), e => e.code === 'STEP_UP_REQUIRED');
      const access = await envir.exported.getModerationAccess(req);
      assert.equal(access.canModerate, false);
      assert.equal(access.stepUpActive, false);
    });
  }
});

test('dual-wallet activation rejects legacy unbound cookies and missing issuance versions', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  db.tables.artsoul_staff_roles[0].authorization_version = 101;
  db.tables.artsoul_staff_passkeys[0].authorization_version = 101;
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  envir.context.process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED = 'true';
  await assert.rejects(envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }), e => e.code === 'STEP_UP_REQUIRED');
  assert.throws(() => envir.exported.setModerationSession(fakeRes(), STAFF, 'cred-1'), e => e.code === 'MODERATION_PASSKEY_MISCONFIGURED');
});

test('dual-wallet login fails closed until the role-version schema is ready', async t => {
  for (const version of [undefined, null, 0, -1, true, 1.1, '01', '1e2', Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(`invalid version ${String(version)}`, async () => {
      const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
      db.tables.artsoul_staff_roles[0].authorization_version = version;
      const envir = loadEnvironment({ env: { ...CONFIGURED_ENV, ARTSOUL_MODERATION_DUAL_WALLET_ENABLED: 'true' }, db });
      const { optionsRes, verifyRes } = await runAuthentication(envir);
      assert.equal(optionsRes.statusCode, 503);
      assert.equal(verifyRes.statusCode, 503);
      assert.equal(verifyRes.body.error, 'MODERATION_PASSKEY_MISCONFIGURED');
      assert.equal(verifyRes.headers['set-cookie'], undefined);
      assert.equal(db.log.some(row => row.path.startsWith('rpc/')), false);
    });
  }
});

test('dual-wallet role changes during authentication never issue a session for the new grant', async t => {
  for (const replacement of [null,
    { wallet_address: STAFF, role: 'moderator', active: false, authorization_version: 102 },
    { wallet_address: STAFF, role: 'admin', active: true, authorization_version: 103 }
  ]) {
    await t.test(replacement ? `${replacement.role} active ${replacement.active}` : 'removed role', async () => {
      const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
      db.tables.artsoul_staff_roles[0].authorization_version = 101;
  db.tables.artsoul_staff_passkeys[0].authorization_version = 101;
      const original = db.supabaseRest;
      db.supabaseRest = async (route, options) => {
        const result = await original(route, options);
        if (route === 'rpc/a8a_complete_authentication') {
          db.tables.artsoul_staff_roles.splice(0, 1, ...(replacement ? [replacement] : []));
        }
        return result;
      };
      const envir = loadEnvironment({ env: { ...CONFIGURED_ENV, ARTSOUL_MODERATION_DUAL_WALLET_ENABLED: 'true' }, db });
      const { verifyRes } = await runAuthentication(envir);
      assert.equal(verifyRes.statusCode, 403);
      assert.equal(verifyRes.body.error, 'STEP_UP_REQUIRED');
      assert.equal(verifyRes.headers['set-cookie'], undefined);
      assert.equal(db.tables.artsoul_staff_auth_events.at(-1).details.reason, 'staff authorization changed');
    });
  }
});

test('dual-wallet authority cannot fall back to social-profile access when factor enforcement is off', async () => {
  const db = createDb(staffSeed({ profiles: [{ wallet_address: STAFF, twitter_id: 'x', discord_id: 'd' }] }));
  const envir = loadEnvironment({ env: { SESSION_SECRET: 'test-siwe-secret', ARTSOUL_MODERATION_DUAL_WALLET_ENABLED: 'true' }, db });
  const req = fakeReq({ cookie: envir.siweCookie(STAFF) });
  await assert.rejects(envir.exported.getModerationAccess(req, { strict: true }), e => e.code === 'MODERATION_PASSKEY_MISCONFIGURED' && e.statusCode === 503);
  assert.equal((await envir.exported.getModerationAccess(req)).canModerate, false);
  assert.equal(db.log.length, 0);
});

test('a revoked credential invalidates an otherwise valid session immediately', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey({ revoked_at: new Date().toISOString() })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  await assert.rejects(envir.exported.getModerationAccess(fakeReq({ cookie }), { strict: true }),
    (e) => e.code === 'CREDENTIAL_REVOKED');
});

// ---------------------------------------------------------------------------
// The quiet read probe exposes staff step-up state without protected data
// ---------------------------------------------------------------------------

test('the moderation-visibility read exposes step-up state but no visibility data for stepped-down staff', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('artworkVisibility')(fakeReq({
    method: 'GET', cookie: envir.siweCookie(STAFF), query: { chain_id: '84532', artwork_id: '7' }
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.access.role, 'moderator');
  assert.equal(res.body.access.canModerate, false);
  assert.equal(res.body.access.passkeyRequired, true);
  assert.equal(res.body.access.stepUpActive, false);
  assert.equal(res.body.data, null);
});

test('artwork keeps no enrollment surface and admin owns passkey controls', () => {
  const client = read(path.join('src', 'entries', 'artwork.jsx'));
  // Error codes remain a defensive fallback for rejected protected requests.
  assert.match(client, /\[['"]STEP_UP_REQUIRED['"], ['"]STEP_UP_WALLET_MISMATCH['"], ['"]CREDENTIAL_REVOKED['"]\]\.includes\(result\.error\)/);
  assert.doesNotMatch(client, /includes\(result\.code\)/);
  assert.doesNotMatch(client, /Staff passkey|passkeyAccess|passkeyCredentials|loadWebAuthnBrowser|AdditionalPasskeyGrant/);
  const admin = read(path.join('src', 'features', 'admin', 'staff-passkeys.jsx'));
  assert.match(admin, /onClick=\{\(\) => perform\('verify'\)\}/);
  assert.match(admin, /onClick=\{\(\) => perform\('enroll'\)\}/);
  assert.match(admin, /htmlFor="adminEnrollmentCode"/);
  assert.doesNotMatch(admin, /window\.prompt/);
});

// ---------------------------------------------------------------------------
// Last-key protection and self-grant
// ---------------------------------------------------------------------------

test('the last active passkey cannot be revoked; a denial is audited without state change', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const res = fakeRes();
  await envir.loadRoute('passkeys')(fakeReq({ cookie, body: { action: 'revoke', credential_id: 'cred-1' } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'LAST_ACTIVE_CREDENTIAL');
  assert.equal(db.tables.artsoul_staff_passkeys[0].revoked_at, null);
  assert.equal(db.tables.artsoul_staff_auth_events.at(-1).event_type, 'passkey_revoke_denied');
});

test('a two-passkey wallet may revoke one after a valid step-up', async () => {
  const db = createDb(staffSeed({
    passkeys: [activePasskey(), activePasskey({ id: 2, credential_id: 'cred-2' })]
  }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const res = fakeRes();
  await envir.loadRoute('passkeys')(fakeReq({ cookie, body: { action: 'revoke', credential_id: 'cred-2' } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(db.tables.artsoul_staff_passkeys.find(c => c.credential_id === 'cred-2').revoked_at);
  assert.equal(db.tables.artsoul_staff_auth_events.at(-1).event_type, 'passkey_revoked');
});

test('self-revocation requires a valid step-up', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey(), activePasskey({ id: 2, credential_id: 'cred-2' })] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('passkeys')(fakeReq({ cookie: envir.siweCookie(STAFF), body: { action: 'revoke', credential_id: 'cred-2' } }), res);
  assert.equal(res.statusCode, 403);
});

test('a self-grant needs a valid step-up, returns a raw token once, and targets only the own wallet', async () => {
  const db = createDb(staffSeed({ passkeys: [activePasskey()] }));
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const denied = fakeRes();
  await envir.loadRoute('grant')(fakeReq({ cookie: envir.siweCookie(STAFF) }), denied);
  assert.equal(denied.statusCode, 403);

  const cookie = `${envir.siweCookie(STAFF)}; ${envir.moderationCookie(STAFF, 'cred-1')}`;
  const res = fakeRes();
  await envir.loadRoute('grant')(fakeReq({ cookie, body: { target_wallet: OTHER } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.token);
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
  for (const [name, source] of Object.entries(ROUTE_SOURCES)) {
    if (name === 'artworkVisibility') continue;
    assert.doesNotMatch(source, /purpose:\s*'bootstrap'|'bootstrap'/, `${name} must not reference bootstrap issuance`);
  }
});

test('recovery fails closed when the Safe configuration is absent', async () => {
  const db = createDb(staffSeed());
  const envir = loadEnvironment({ env: CONFIGURED_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({ cookie: envir.siweCookie(STAFF) }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'MODERATION_SAFE_RECOVERY_MISCONFIGURED');
  assert.equal(db.tables.artsoul_staff_auth_events.at(-1).event_type, 'recovery_denied');
});

test('Safe recovery request binds the authenticated staff wallet and exact production identity', async () => {
  const db = createDb(staffSeed());
  const envir = loadEnvironment({ env: RECOVERY_ENV, db });
  const res = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({
    cookie: envir.siweCookie(STAFF),
    host: 'evil.example',
    body: { action: 'request', target_wallet: OTHER, safe_address: OTHER }
  }), res);
  assert.equal(res.statusCode, 200);
  const row = db.tables.artsoul_staff_recovery_requests[0];
  assert.equal(row.target_wallet, STAFF, 'request body cannot select the recovered wallet');
  assert.equal(row.safe_address, SAFE, 'request body cannot select the authorizing Safe');
  assert.equal(row.rp_id, CONFIGURED_ENV.ARTSOUL_WEBAUTHN_RP_ID);
  assert.equal(row.origin, CONFIGURED_ENV.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN);
  assert.match(row.message, new RegExp(`Target wallet: ${STAFF}`));
  assert.match(row.message, new RegExp(`Authorizing Safe: ${SAFE}`));
  assert.doesNotMatch(row.message, /evil\.example/);
  assert.equal(row.message_hash, hashMessage(row.message));
});

test('Safe recovery audit hashes canonical signature bytes rather than hex spelling', () => {
  const envir = loadEnvironment({ env: RECOVERY_ENV });
  assert.equal(
    envir.exported.hashSafeRecoverySignature('0xAABBcc'),
    envir.exported.hashSafeRecoverySignature('0xaabbCC')
  );
});

test('one invalid or unavailable RPC makes Safe recovery fail closed without issuing a grant', async () => {
  const db = createDb(staffSeed());
  const envir = loadEnvironment({
    env: RECOVERY_ENV,
    db,
    recoveryRpc: { 'https://rpc-b.test': { valid: false } }
  });
  const cookie = envir.siweCookie(STAFF);
  const requested = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({ cookie, body: { action: 'request' } }), requested);
  const completed = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({
    cookie,
    body: { action: 'complete', request_id: requested.body.request.request_id, signature: '0x1234' }
  }), completed);
  assert.equal(completed.statusCode, 403);
  assert.equal(db.tables.artsoul_staff_enrollment_grants.length, 0);
  assert.equal(db.tables.artsoul_staff_recovery_requests[0].consumed_at, undefined);
  assert.equal(db.tables.artsoul_staff_auth_events.at(-1).event_type, 'recovery_denied');
});

test('threshold-valid Safe recovery issues one additional-device grant and rejects replay', async () => {
  const db = createDb(staffSeed());
  const envir = loadEnvironment({ env: RECOVERY_ENV, db });
  const cookie = envir.siweCookie(STAFF);
  const requested = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({ cookie, body: { action: 'request' } }), requested);
  const payload = {
    action: 'complete', request_id: requested.body.request.request_id, signature: '0x1234',
    target_wallet: OTHER, safe_address: OTHER
  };
  const completed = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({ cookie, body: payload }), completed);
  assert.equal(completed.statusCode, 200);
  assert.match(completed.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(db.tables.artsoul_staff_recovery_requests[0].consumed_at);
  assert.equal(db.tables.artsoul_staff_enrollment_grants.length, 1);
  assert.equal(db.tables.artsoul_staff_enrollment_grants[0].target_wallet, STAFF);
  assert.equal(db.tables.artsoul_staff_enrollment_grants[0].issued_by, SAFE);
  assert.equal(db.tables.artsoul_staff_enrollment_grants[0].purpose, 'additional');
  assert.equal(db.tables.artsoul_staff_enrollment_grants[0].token_hash, hashToken(completed.body.token));
  assert.deepEqual(
    db.tables.artsoul_staff_auth_events.slice(-2).map(event => event.event_type),
    ['recovery_authorized', 'grant_issued']
  );

  const replay = fakeRes();
  await envir.loadRoute('recovery')(fakeReq({ cookie, body: payload }), replay);
  assert.equal(replay.statusCode, 403);
  assert.equal(db.tables.artsoul_staff_enrollment_grants.length, 1, 'replay must not issue a second grant');
});

// ---------------------------------------------------------------------------
// Bundle hygiene and historical-migration immutability (source assertions)
// ---------------------------------------------------------------------------

test('the WebAuthn browser library is lazy-loaded, never a top-level import', () => {
  const client = read(path.join('src', 'features', 'admin', 'staff-passkeys.jsx'));
  assert.doesNotMatch(read(path.join('src', 'entries', 'artwork.jsx')), /@simplewebauthn|loadWebAuthnBrowser/);
  assert.doesNotMatch(client, /^import[^\n]*@simplewebauthn\/browser/m, 'no eager top-level import');
  assert.match(client, /import\(['"]@simplewebauthn\/browser['"]\)/, 'must dynamically import the browser helper');
  assert.match(client, /await loadWebAuthnBrowser\(\)/);
});

test('the applied phase18_7b migration is byte-immutable (pinned normalized hash)', () => {
  // Repository-contained immutability proof: no remote ref is consulted, so
  // this works in a shallow GitHub Actions PR-merge checkout (no origin/main),
  // on Windows and Ubuntu, and on local branches. CRLF is normalized to LF so
  // the hash is line-ending independent.
  const rel = 'sql/migrations/phase18_7b_supabase_security_hardening.sql';
  const normalized = fs.readFileSync(path.join(root, rel)).toString('utf8').replace(/\r\n/g, '\n');
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  assert.equal(
    digest,
    '172340ffdf9ac7b7b93c3b9b4c05e93a379ef9e035eb7e54aeb2047a6bfbc4d1',
    'phase18_7b must remain immutable (normalized SHA-256 pinned)'
  );
});
