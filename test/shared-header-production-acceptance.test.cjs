const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

test('shared-header production acceptance remains durable and the deferred-header regression is re-accepted', () => {
  const acceptance = read('docs/testnet/SHARED_HEADER_PRODUCTION_ACCEPTANCE_2026-08-04.md');
  const reacceptance = read('docs/testnet/SHARED_HEADER_PRODUCTION_REACCEPTANCE_2026-08-13.md');
  const backlog = read('docs/BACKLOG.md');
  const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');

  assert.match(acceptance, /^Accepted: 2026-08-04$/m);
  assert.match(acceptance, /PR #167/);
  assert.match(acceptance, /PR #168/);
  assert.match(acceptance, /desktop and a\nreal mobile browser/);
  assert.match(acceptance, /one account button, one avatar image, fixed geometry/);
  assert.match(acceptance, /does not\nchange or re-accept SIWE/);

  assert.match(reacceptance, /^Accepted: 2026-08-13$/m);
  assert.match(reacceptance, /PR #194/);
  assert.match(reacceptance, /real\niPhone/);
  assert.match(reacceptance, /explicit reconnect and SIWE completed/);
  assert.match(reacceptance, /tracked as A-48/);

  assert.match(backlog, /^\| A-05 \|[^\n]*\| done \| A \|/m);
  assert.match(backlog, /^\| A-45 \|[^\n]*\| done \| A \|/m);
  assert.match(backlog, /^\| A-46 \|[^\n]*\| done \| A \|/m);
  assert.match(backlog, /^\| A-48 \|[^\n]*\| planned \| A \|/m);
  assert.match(backlog, /SHARED_HEADER_PRODUCTION_ACCEPTANCE_2026-08-04\.md/);
  assert.match(backlog, /SHARED_HEADER_PRODUCTION_REACCEPTANCE_2026-08-13\.md/);

  assert.match(canonicalBacklog, /^- \[x\] \*\*A2 — Mobile wallet acceptance\.\*\*/m);
  assert.match(canonicalBacklog, /^- \[ \] \*\*A8 — Moderation and reporting MVP\.\*\*/m);
  assert.match(canonicalBacklog, /^- \[ \] \*\*A10 — Controlled beta entry\.\*\*/m);
});
