const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const modules = Promise.all([
  import('../src/api/backend.js'),
  import('../scripts/apply-migrations.js')
]).then(([backend, migrations]) => ({ ...backend, ...migrations }));

const REPO_ROOT = path.resolve(__dirname, '..');
const wallet = '0x1111111111111111111111111111111111111111';
const nonce = 'f4db5f69-f286-4ad2-a064-9ed1db742d45';
const now = Date.parse('2026-07-16T10:00:00.000Z');

function siweMessage({
  domain = 'artsoul.example',
  uri = 'https://artsoul.example',
  messageNonce = nonce,
  issuedAt = '2026-07-16T10:00:00.000Z'
} = {}) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    wallet,
    '',
    'Sign in to ArtSoul.',
    '',
    `URI: ${uri}`,
    'Version: 1',
    'Chain ID: 84532',
    `Nonce: ${messageNonce}`,
    `Issued At: ${issuedAt}`
  ].join('\n');
}

const request = {
  headers: {
    host: 'internal.invalid',
    'x-forwarded-host': 'artsoul.example',
    'x-forwarded-proto': 'https'
  }
};

test('SIWE validation binds the signed message to the request origin, wallet, and nonce', async () => {
  const { normalizeWallet, validateSiweMessage } = await modules;
  const result = validateSiweMessage(request, {
    message: siweMessage(),
    wallet: normalizeWallet(wallet),
    nonce,
    now
  });

  assert.equal(result.origin, 'https://artsoul.example');
  assert.equal(result.chainId, 84532);
});

test('SIWE validation rejects a message signed for another domain', async () => {
  const { validateSiweMessage } = await modules;
  assert.throws(
    () => validateSiweMessage(request, {
      message: siweMessage({ domain: 'attacker.example', uri: 'https://attacker.example' }),
      wallet,
      nonce,
      now
    }),
    error => error.code === 'INVALID_SIWE_MESSAGE'
  );
});

test('SIWE validation rejects a nonce mismatch', async () => {
  const { validateSiweMessage } = await modules;
  assert.throws(
    () => validateSiweMessage(request, {
      message: siweMessage({ messageNonce: 'different-nonce' }),
      wallet,
      nonce,
      now
    }),
    error => error.code === 'INVALID_SIWE_MESSAGE'
  );
});

test('SIWE validation rejects a URI outside the request origin', async () => {
  const { validateSiweMessage } = await modules;
  assert.throws(
    () => validateSiweMessage(request, {
      message: siweMessage({ uri: 'https://attacker.example' }),
      wallet,
      nonce,
      now
    }),
    error => error.code === 'INVALID_SIWE_MESSAGE'
  );
});

test('SIWE validation rejects an issued-at time too far in the future', async () => {
  const { validateSiweMessage } = await modules;
  assert.throws(
    () => validateSiweMessage(request, {
      message: siweMessage({ issuedAt: '2026-07-16T10:06:00.000Z' }),
      wallet,
      nonce,
      now
    }),
    error => error.code === 'INVALID_SIWE_MESSAGE'
  );
});

test('both authentication handlers consume SIWE nonces atomically', () => {
  const vercelHandler = fs.readFileSync(
    path.join(REPO_ROOT, 'src/api/routes/auth/verify.js'),
    'utf8'
  );
  const standaloneServer = fs.readFileSync(
    path.join(REPO_ROOT, 'src/api/server.js'),
    'utf8'
  );

  assert.match(vercelHandler, /method:\s*'PATCH'/);
  assert.match(vercelHandler, /Prefer:\s*'return=representation'/);
  assert.match(standaloneServer, /UPDATE siwe_nonces[\s\S]*used = false[\s\S]*RETURNING nonce/);
});

test('the credentialed standalone API uses an exact CORS allowlist', () => {
  const standaloneServer = fs.readFileSync(
    path.join(REPO_ROOT, 'src/api/server.js'),
    'utf8'
  );

  assert.doesNotMatch(standaloneServer, /origin:\s*true/);
  assert.match(standaloneServer, /apiOrigins\.has\(origin\)/);
});

test('the indexer migration runner covers the complete 001 through 013 sequence', async () => {
  const { listIndexerMigrations } = await modules;
  const migrations = listIndexerMigrations();
  assert.deepEqual(
    migrations.map(migration => migration.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
  );

  const setupSql = fs.readFileSync(path.join(REPO_ROOT, 'src/indexer/setup-database.sql'), 'utf8');
  for (const migration of migrations) {
    assert.match(setupSql, new RegExp(migration.name.replace('.', '\\.')));
  }
});

test('Phase 18.7b classifies every table created by tracked SQL', () => {
  const sqlRoots = [
    path.join(REPO_ROOT, 'migrations'),
    path.join(REPO_ROOT, 'sql/migrations'),
    path.join(REPO_ROOT, 'sql/schema'),
    path.join(REPO_ROOT, 'src/indexer/migrations')
  ];
  const createdTables = new Set();

  for (const root of sqlRoots) {
    for (const name of fs.readdirSync(root).filter(candidate => candidate.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(root, name), 'utf8');
      for (const match of sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:public\.)?([a-z0-9_]+)/gi)) {
        createdTables.add(match[1]);
      }
    }
  }

  const hardening = fs.readFileSync(
    path.join(REPO_ROOT, 'sql/migrations/phase18_7b_supabase_security_hardening.sql'),
    'utf8'
  );
  const missing = [...createdTables].filter(table => !hardening.includes(`'${table}'`));
  assert.deepEqual(missing, []);
});
