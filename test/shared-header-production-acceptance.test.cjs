const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

test('shared-header production acceptance closes only A-05 and A-45', () => {
  const acceptance = read('docs/testnet/SHARED_HEADER_PRODUCTION_ACCEPTANCE_2026-08-04.md');
  const backlog = read('docs/BACKLOG.md');
  const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');

  assert.match(acceptance, /^Accepted: 2026-08-04$/m);
  assert.match(acceptance, /PR #167/);
  assert.match(acceptance, /PR #168/);
  assert.match(acceptance, /desktop and a\nreal mobile browser/);
  assert.match(acceptance, /one account button, one avatar image, fixed geometry/);
  assert.match(acceptance, /does not\nchange or re-accept SIWE/);

  assert.match(backlog, /^\| A-05 \|[^\n]*\| done \| A \|/m);
  assert.match(backlog, /^\| A-45 \|[^\n]*\| done \| A \|/m);
  assert.match(backlog, /SHARED_HEADER_PRODUCTION_ACCEPTANCE_2026-08-04\.md/);

  assert.match(canonicalBacklog, /^- \[x\] \*\*A2 — Mobile wallet acceptance\.\*\*/m);
  assert.match(canonicalBacklog, /^- \[ \] \*\*A8 — Moderation and reporting MVP\.\*\*/m);
  assert.match(canonicalBacklog, /^- \[ \] \*\*A10 — Controlled beta entry\.\*\*/m);
});
