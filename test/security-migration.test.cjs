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

const STORAGE_HARDENING_PATH = 'sql/migrations/phase18_7c_supabase_storage_hardening.sql';

function readStorageHardening() {
  return fs.readFileSync(path.join(REPO_ROOT, STORAGE_HARDENING_PATH), 'utf8');
}

test('Phase 18.7c drops every observed artworks storage policy by name', () => {
  const storage = readStorageHardening();
  const observedPolicies = [
    'Anyone can view artworks',
    'Public Access for artworks',
    'Public can view',
    'Authenticated can upload to artworks',
    'Authenticated users can upload',
    'Authenticated users can upload to artworks',
    'Users can update own files in artworks',
    'Users can delete own files in artworks'
  ];
  for (const policy of observedPolicies) {
    assert.match(
      storage,
      new RegExp(`DROP POLICY IF EXISTS "${policy}" ON storage\\.objects`),
      `expected 18.7c to drop "${policy}"`
    );
  }
});

test('Phase 18.7c retains exactly one artworks SELECT policy and creates no write policy', () => {
  const storage = readStorageHardening();

  // Exactly one CREATE POLICY, and it is a SELECT policy for the artworks bucket.
  const createPolicies = storage.match(/CREATE POLICY/g) || [];
  assert.equal(createPolicies.length, 1);
  assert.match(storage, /artsoul_artworks_public_read/);
  assert.match(storage, /FOR SELECT TO public USING \(bucket_id = %L\)/);

  // No client-facing write policy is (re)created.
  assert.doesNotMatch(storage, /CREATE POLICY[\s\S]*FOR INSERT/i);
  assert.doesNotMatch(storage, /FOR UPDATE/i);
  assert.doesNotMatch(storage, /FOR DELETE/i);
});

test('Phase 18.7c does not modify storage buckets or object data', () => {
  const storage = readStorageHardening();
  // It may mention storage.buckets in comments, but must never mutate it or object rows.
  assert.doesNotMatch(storage, /ALTER\s+TABLE\s+storage\.buckets/i);
  assert.doesNotMatch(storage, /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+storage\.buckets/i);
  assert.doesNotMatch(storage, /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+storage\.objects/i);
});

test('the signed server-side upload flow is preserved', () => {
  const uploadRoute = fs.readFileSync(
    path.join(REPO_ROOT, 'src/api/routes/upload/file.js'),
    'utf8'
  );
  const backend = fs.readFileSync(path.join(REPO_ROOT, 'src/api/backend.js'), 'utf8');

  // Uploads still go through a server-created signed upload URL.
  assert.match(uploadRoute, /object\/upload\/sign\//);
  assert.match(uploadRoute, /assertServiceRoleKey\(\)/);
  // The signing request is made with the Supabase service role key server-side.
  assert.match(backend, /supabaseStorageRest/);
  assert.match(backend, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('the storage verification asserts the post-hardening artworks policy counts', () => {
  const verification = fs.readFileSync(
    path.join(REPO_ROOT, 'sql/verification/phase_a_security_verification.sql'),
    'utf8'
  );
  assert.match(verification, /write_policies/);
  assert.match(verification, /select_policies/);
  assert.match(verification, /schemaname = 'storage'/);
  assert.match(verification, /tablename = 'objects'/);
});
