const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

test('A11 production acceptance is reconciled across the runbook and backlogs', () => {
  const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');
  const durableBacklog = read('docs/BACKLOG.md');
  const handoff = read('docs/HANDOFF.md');
  const runbook = read('docs/runbooks/A11_PUBLIC_METRICS_ROLLOUT.md');

  assert.match(canonicalBacklog, /^- \[x\] \*\*A11 — Base product commitments\.\*\*/m);

  for (const id of ['A-24', 'A-25', 'A-26', 'A-27']) {
    assert.match(durableBacklog, new RegExp(`^\\| ${id} \\|[^\\n]*\\| done \\| A \\|`, 'm'));
  }

  assert.match(handoff, /A11, A12, and backlog A-24 through A-28 were accepted on production on 2026-07-28/);
  assert.match(runbook, /^## Production acceptance evidence — 2026-07-28$/m);
  assert.match(runbook, /8f7a9d232d86a4f5d50f595aecba88e684f5d6c3/);
  assert.match(runbook, /fc5f2157bce250679ea5bf69213a6e7caa110326e05406bd56a7359b0730c5a8/);
  assert.match(runbook, /The indexed cursor advanced from block `44746178` to `44746185`/);
  assert.match(runbook, /This evidence closes canonical A11 and durable backlog A-24 through A-27/);
});

test('A11 evidence remains scoped while current backlogs preserve unresolved operational work', () => {
  const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');
  const durableBacklog = read('docs/BACKLOG.md');
  const runbook = read('docs/runbooks/A11_PUBLIC_METRICS_ROLLOUT.md');

  assert.match(canonicalBacklog, /^- \[ \] \*\*A10 — Controlled beta entry\.\*\*/m);
  assert.match(canonicalBacklog, /^- \[x\] \*\*A12 — Remove stale network copy\.\*\*/m);
  const dependencies = durableBacklog.match(/^\| A-38 \|[^\n]*/m)?.[0];
  assert.ok(dependencies, 'dependency follow-up must not disappear behind the older A11 acceptance');
  assert.match(dependencies, /audits\/DEPENDENCY_TRIAGE_[\d-]+\.md/);
  assert.match(dependencies, /residual.*documented/i,
    'current exposure and remaining work belong to the dated dependency review, not a frozen July count');
  assert.match(runbook, /No partial or invented migration-ledger\s+entry was created/);
  assert.match(runbook, /does not close A10 controlled-beta entry or A12 stale network copy/);
});
