const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function normalize(text) {
  return text.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

test('Phase A summaries are derived from the durable backlog state', () => {
  const backlog = read('docs/BACKLOG.md');
  const handoff = normalize(read('docs/HANDOFF.md'));
  const projectState = normalize(read('docs/PROJECT_STATE.md'));
  const rows = [...backlog.matchAll(/^\| (A-(\d{2})) \|[^\n]*\| (done|in progress|planned|blocked-on-founder) \| A \|/gm)];

  assert.ok(rows.length > 0, 'Phase A backlog rows must be discoverable');

  const counts = rows.reduce((result, row) => {
    result[row[3]] = (result[row[3]] || 0) + 1;
    return result;
  }, {});
  const lastId = Math.max(...rows.map(row => Number(row[2]))).toString().padStart(2, '0');
  const summary = `${counts.done || 0} done, ${counts['in progress'] || 0} in progress, ${counts.planned || 0} planned`;
  const range = `across A-01 to A-${lastId}`;

  assert.ok(handoff.includes(`Phase A stands at ${summary} ${range}`));
  assert.ok(projectState.includes(`current position is ${summary} ${range}`));
});
