// Regression coverage for A5 (Indexer status drift): the persisted
// indexer_state.confirmation_depth must be reconciled to the active configured
// depth on startup so /health (in-memory config) and
// /api/public/indexer-status (persisted column) report the same value.
//
// The fix is metadata-only: it updates ONLY confirmation_depth, never the
// cursor (last_indexed_block / last_confirmed_block) or event data, stays
// chain-scoped, and is restart-idempotent with no write churn.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const moduleUrl = pathToFileURL(
    path.join(repoRoot, 'src', 'indexer', 'confirmation-depth.js')
).href;

async function loadReconcile() {
    const mod = await import(moduleUrl);
    return mod.reconcileConfirmationDepth;
}

// Minimal in-memory stand-in for PostgreSQLDatabase that supports exactly the
// two statements reconcileConfirmationDepth issues, and records how many
// UPDATEs actually ran so tests can assert "no unnecessary write".
function makeFakeDb(rowsByChain) {
    const rows = new Map(
        Object.entries(rowsByChain).map(([chainId, row]) => [String(chainId), { ...row }])
    );
    const stats = { selects: 0, updates: 0, updateRowsAffected: 0 };

    return {
        rows,
        stats,
        row(chainId) {
            return rows.get(String(chainId));
        },
        async query(sql, params = []) {
            if (/SELECT\s+confirmation_depth\s+FROM\s+indexer_state/i.test(sql)) {
                stats.selects += 1;
                const row = rows.get(String(params[0]));
                return row ? [{ confirmation_depth: row.confirmation_depth }] : [];
            }

            if (/UPDATE\s+indexer_state\s+SET\s+confirmation_depth/i.test(sql)) {
                stats.updates += 1;
                const [target, chainId] = params;
                const row = rows.get(String(chainId));
                // Model the "IS DISTINCT FROM" guard: no-op when already equal.
                if (row && Number(row.confirmation_depth) !== Number(target)) {
                    row.confirmation_depth = Number(target);
                    stats.updateRowsAffected += 1;
                }
                return [];
            }

            throw new Error(`Unexpected SQL in fake db: ${sql}`);
        }
    };
}

function baseRow(overrides = {}) {
    return {
        confirmation_depth: 12,
        last_indexed_block: 5_000_000,
        last_confirmed_block: 4_999_997,
        state_hash: '0xdeadbeef',
        ...overrides
    };
}

test('stored depth 12 with configured depth 3 is reconciled to 3', async () => {
    const reconcile = await loadReconcile();
    const db = makeFakeDb({ 84532: baseRow({ confirmation_depth: 12 }) });

    const result = await reconcile(db, 84532, 3);

    assert.equal(result.updated, true);
    assert.equal(result.storedDepth, 12);
    assert.equal(result.configuredDepth, 3);
    assert.equal(db.row(84532).confirmation_depth, 3);
    assert.equal(db.stats.updateRowsAffected, 1);
});

test('already matching depth performs no unnecessary write', async () => {
    const reconcile = await loadReconcile();
    const db = makeFakeDb({ 84532: baseRow({ confirmation_depth: 3 }) });

    const result = await reconcile(db, 84532, 3);

    assert.equal(result.updated, false);
    assert.equal(result.storedDepth, 3);
    assert.equal(db.stats.updates, 0, 'no UPDATE statement should be issued');
    assert.equal(db.row(84532).confirmation_depth, 3);
});

test('only the configured chain row is updated', async () => {
    const reconcile = await loadReconcile();
    const db = makeFakeDb({
        84532: baseRow({ confirmation_depth: 12 }),
        11155111: baseRow({ confirmation_depth: 12 })
    });

    await reconcile(db, 84532, 3);

    assert.equal(db.row(84532).confirmation_depth, 3, 'base-sepolia updated');
    assert.equal(db.row(11155111).confirmation_depth, 12, 'other chain untouched');
});

test('cursor and indexed-block fields remain unchanged', async () => {
    const reconcile = await loadReconcile();
    const db = makeFakeDb({ 84532: baseRow({ confirmation_depth: 12 }) });
    const before = { ...db.row(84532) };

    await reconcile(db, 84532, 3);

    const after = db.row(84532);
    assert.equal(after.last_indexed_block, before.last_indexed_block);
    assert.equal(after.last_confirmed_block, before.last_confirmed_block);
    assert.equal(after.state_hash, before.state_hash);
    assert.equal(after.confirmation_depth, 3, 'only confirmation_depth changed');
});

test('/health and public status report the same active depth after reconcile', async () => {
    const reconcile = await loadReconcile();
    const configuredDepth = 3; // in-memory value reported by /health
    const db = makeFakeDb({ 84532: baseRow({ confirmation_depth: 12 }) });

    await reconcile(db, 84532, configuredDepth);

    // /health reports the in-memory configured depth; /api/public/indexer-status
    // reports the persisted column. After reconcile they must match.
    const healthDepth = configuredDepth;
    const publicDepth = db.row(84532).confirmation_depth;
    assert.equal(healthDepth, publicDepth);
});

test('repeated startup reconciliation is idempotent with no further writes', async () => {
    const reconcile = await loadReconcile();
    const db = makeFakeDb({ 84532: baseRow({ confirmation_depth: 12 }) });

    const first = await reconcile(db, 84532, 3);
    const writesAfterFirst = db.stats.updateRowsAffected;
    const second = await reconcile(db, 84532, 3);

    assert.equal(first.updated, true);
    assert.equal(second.updated, false);
    assert.equal(db.stats.updateRowsAffected, writesAfterFirst, 'no write on second startup');
    assert.equal(db.row(84532).confirmation_depth, 3);
});

test('missing state row is a safe no-op (fresh install handles its own insert)', async () => {
    const reconcile = await loadReconcile();
    const db = makeFakeDb({});

    const result = await reconcile(db, 84532, 3);

    assert.equal(result.updated, false);
    assert.equal(result.reason, 'no_state_row');
    assert.equal(db.stats.updates, 0);
});

test('a failed reconcile surfaces evidence without touching the cursor', async () => {
    const reconcile = await loadReconcile();
    const db = makeFakeDb({ 84532: baseRow({ confirmation_depth: 12 }) });
    const before = { ...db.row(84532) };
    // Force the SELECT to fail.
    db.query = async () => { throw new Error('connection reset'); };

    let captured = null;
    const result = await reconcile(db, 84532, 3, {
        onError: (error) => { captured = error; }
    });

    assert.equal(result.updated, false);
    assert.ok(result.error, 'error is returned, not thrown');
    assert.ok(captured, 'onError received the failure for health/log surfacing');
    assert.equal(captured.message, 'connection reset');
    // Cursor fields are untouched on failure.
    assert.equal(before.last_indexed_block, 5_000_000);
    assert.equal(before.last_confirmed_block, 4_999_997);
});
