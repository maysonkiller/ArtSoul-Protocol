const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SESSION_SECRET = 'test-session-secret';

const repoRoot = path.resolve(__dirname, '..');

function readFile(...segments) {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

// Canonical v41_resale_listings columns derived from the tracked migrations:
// 010 creates the table, 013 adds chain_id and re-keys to (chain_id, token_id).
// Migrations 011, 012 and 014 do not alter its columns.
function canonicalResaleListingColumns() {
  const migration010 = readFile('src', 'indexer', 'migrations', '010_v4_1_event_lifecycle.sql');
  const createMatch = migration010.match(
    /CREATE TABLE IF NOT EXISTS v41_resale_listings \(([\s\S]*?)\);/
  );
  assert.ok(createMatch, 'migration 010 creates v41_resale_listings');

  const columns = new Set(
    createMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !/^CONSTRAINT/i.test(line))
      .map(line => line.split(/\s+/)[0])
  );

  const migration013 = readFile('src', 'indexer', 'migrations', '013_chain_scoped_v41_projections.sql');
  assert.match(
    migration013,
    /ALTER TABLE v41_resale_listings ADD COLUMN IF NOT EXISTS chain_id/,
    'migration 013 adds chain_id to v41_resale_listings'
  );
  assert.match(
    migration013,
    /ALTER TABLE v41_resale_listings ADD CONSTRAINT v41_resale_listings_pkey PRIMARY KEY \(chain_id, token_id\)/,
    'migration 013 keys v41_resale_listings by (chain_id, token_id)'
  );
  columns.add('chain_id');

  return columns;
}

function extractResaleListingQueries(source) {
  const queries = [];
  const pattern = /v41_resale_listings'?,?\s*[?`]?\s*`?select=([a-z0-9_,]+)(&[^`'"\s]*)?/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const selected = match[1].split(',').filter(Boolean);
    const params = match[2] || '';
    const orderMatch = params.match(/order=([a-z0-9_]+)\./i);
    const filterColumns = [...params.matchAll(/[&?]([a-z0-9_]+)=(?:in\.|eq\.|neq\.|is\.)/gi)]
      .map(filter => filter[1]);
    queries.push({
      columns: [...selected, ...(orderMatch ? [orderMatch[1]] : []), ...filterColumns]
    });
  }
  return queries;
}

test('canonical schema never contained listing_id and is keyed by (chain_id, token_id)', () => {
  const columns = canonicalResaleListingColumns();
  assert.ok(columns.has('chain_id'));
  assert.ok(columns.has('token_id'));
  assert.ok(!columns.has('listing_id'), 'listing_id must not exist in the migration schema');
});

test('every API query against v41_resale_listings only references migration columns', () => {
  const schema = canonicalResaleListingColumns();
  const apiSources = [
    ['src', 'api', 'routes', 'public', 'indexer-status.js'],
    ['src', 'api', 'routes', 'public', 'artworks.js'],
    ['src', 'api', 'routes', 'public', 'artwork-provenance.js']
  ];

  for (const segments of apiSources) {
    const source = readFile(...segments);
    const queries = extractResaleListingQueries(source);
    assert.ok(queries.length > 0, `${segments.join('/')} queries v41_resale_listings`);

    for (const query of queries) {
      for (const column of query.columns) {
        assert.ok(
          schema.has(column),
          `${segments.join('/')} references nonexistent column v41_resale_listings.${column} (42703)`
        );
      }
    }
  }
});

test('indexer-status reports resale listings without schema warnings', async () => {
  const schema = canonicalResaleListingColumns();
  const { default: indexerStatusHandler } = await import('../src/api/routes/public/indexer-status.js');

  const resaleRow = {
    chain_id: 84532,
    token_id: '3',
    block_number: 4242,
    transaction_hash: `0x${'ab'.repeat(32)}`,
    indexed_at: '2026-07-19T00:00:00Z'
  };
  const stateRow = {
    chain_id: 84532,
    contract_address: '0x1111111111111111111111111111111111111111',
    last_indexed_block: 4242,
    last_confirmed_block: 4239,
    confirmation_depth: 3,
    total_events_indexed: 10,
    last_indexed_at: '2026-07-19T00:00:00Z',
    status: 'active'
  };

  function jsonResponse(body, status = 200) {
    return {
      ok: status < 400,
      status,
      async text() {
        return JSON.stringify(body);
      }
    };
  }

  const originalFetch = global.fetch;
  global.fetch = async url => {
    const parsed = new URL(url);
    const table = (parsed.pathname.split('/rest/v1/')[1] || '').split('?')[0];

    if (table === 'v41_resale_listings') {
      // Emulate PostgREST: any column outside the migration schema fails with 42703.
      const requested = [
        ...(parsed.searchParams.get('select') || '').split(',').filter(Boolean),
        ...(parsed.searchParams.get('order') ? [parsed.searchParams.get('order').split('.')[0]] : [])
      ];
      const unknown = requested.find(column => !schema.has(column));
      if (unknown) {
        return jsonResponse(
          { code: '42703', message: `column v41_resale_listings.${unknown} does not exist` },
          400
        );
      }
      return jsonResponse([resaleRow]);
    }
    if (table === 'indexer_state') return jsonResponse([stateRow]);
    return jsonResponse([]);
  };

  try {
    const response = {
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
      json(value) {
        this.body = value;
        return this;
      },
      end() {
        return this;
      }
    };

    await indexerStatusHandler({ method: 'GET', query: {}, headers: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.body.warnings,
      [],
      'a 42703 on v41_resale_listings would surface here as a query warning'
    );

    const baseChain = response.body.chains.find(chain => chain.chain_id === 84532);
    assert.ok(baseChain, 'Base Sepolia chain entry present');
    assert.equal(baseChain.rows.v41_resale_listings, 1);
    assert.equal(baseChain.latest.v41_resale_listings.block_number, 4242);
    assert.equal(baseChain.latest.v41_resale_listings.transaction_hash, resaleRow.transaction_hash);
  } finally {
    global.fetch = originalFetch;
  }
});
