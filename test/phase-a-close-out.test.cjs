const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const closeOut = fs.readFileSync('docs/PHASE_A_CLOSE_OUT.md', 'utf8');
const backlog = fs.readFileSync('docs/BACKLOG.md', 'utf8').replace(/\r\n/g, '\n');

function phaseARows() {
  return [...backlog.matchAll(/^\| (A-(\d{2})) \|[^\n]*\| (done|in progress|planned|blocked-on-founder) \| A \|/gm)];
}

test('the close-out counts what the backlog actually says', () => {
  // It is a view of the backlog, never a second opinion.
  const rows = phaseARows();
  const counts = rows.reduce((acc, row) => {
    acc[row[3]] = (acc[row[3]] || 0) + 1;
    return acc;
  }, {});
  const last = Math.max(...rows.map((row) => Number(row[2]))).toString().padStart(2, '0');
  const summary = `**${counts.done || 0} done, ${counts['in progress'] || 0} in progress, ${counts.planned || 0} planned** across A-01 to A-${last}`;
  assert.ok(closeOut.includes(summary), `close-out must say: ${summary}`);
});

test('every row it lists as remaining is actually open', () => {
  const rows = phaseARows();
  const open = new Set(rows.filter((row) => row[3] !== 'done').map((row) => row[1]));
  const listed = [...closeOut.matchAll(/\*\*(A-\d{2})\*\*/g)].map((m) => m[1]);
  assert.ok(listed.length >= 9, `expected the remaining rows to be listed, saw ${listed.length}`);
  for (const id of listed) {
    assert.ok(open.has(id), `${id} is listed as remaining but the backlog says it is done`);
  }
});

test('no open row is left out of the close-out', () => {
  const rows = phaseARows();
  const open = rows.filter((row) => row[3] !== 'done').map((row) => row[1]);
  for (const id of open) {
    assert.ok(closeOut.includes(id), `${id} is open and must appear in the close-out`);
  }
});

test('the founder gates are named as gates, not as engineering', () => {
  // The moderation chain is built and merged; what remains is a ceremony that
  // needs credentials and a multisig, which no code change can supply.
  for (const gate of ['RG-01', 'RG-02', 'RG-03', 'A8d']) {
    assert.ok(closeOut.includes(gate), `${gate} must be named`);
  }
  assert.match(closeOut, /A-21, A-22 and A-23 close behind A-39/);
  assert.match(closeOut, /canon rule 12 forbids a single operator deciding it/);
});

test('it repeats what Phase A does not need', () => {
  // Canon rules 4, 5 and 10, and the grant-material discipline.
  assert.match(closeOut, /does not need a mainnet deployment/);
  assert.match(closeOut, /a token, verified user metrics, or Genesis/);
});
