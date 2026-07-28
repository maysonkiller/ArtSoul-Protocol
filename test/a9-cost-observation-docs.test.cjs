const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

test('A9 records seven consecutive provider-dashboard observation days', () => {
  const runbook = read('docs/runbooks/A9_INFRA_COST_MONITORING.md');
  const dates = [
    '2026-07-22',
    '2026-07-23',
    '2026-07-24',
    '2026-07-25',
    '2026-07-26',
    '2026-07-27',
    '2026-07-28',
  ];

  for (const date of dates) {
    assert.match(runbook, new RegExp(`^\\| ${date} \\|`, 'm'));
  }

  assert.doesNotMatch(runbook, /^\| Pending \|/m);
  assert.match(runbook, /Cost-observation acceptance — 2026-07-28/);
  assert.match(runbook, /22\.9M month end/);
  assert.match(runbook, /Spend Cap remained enabled/);
});

test('A9 acceptance is reconciled across the canonical and durable backlogs', () => {
  const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');
  const durableBacklog = read('docs/BACKLOG.md');
  const handoff = read('docs/HANDOFF.md');

  assert.match(canonicalBacklog, /^- \[x\] \*\*A9 — Infrastructure cost and alerting\.\*\*/m);
  assert.match(durableBacklog, /^\| A-13 \|[^]*?\| done \| A \|/m);
  assert.match(handoff, /A9 was accepted on 2026-07-28/);
  assert.doesNotMatch(handoff, /A9 remains open for seven consecutive days/);
});
