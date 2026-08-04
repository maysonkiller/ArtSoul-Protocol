const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

test('A1 mobile auth and upload-policy production evidence is complete and redacted', () => {
  const acceptance = read('docs/testnet/A1_MOBILE_AUTH_UPLOAD_POLICY_ACCEPTANCE_2026-08-04.md');

  assert.match(acceptance, /^Accepted: 2026-08-04$/m);
  assert.match(acceptance, /A1 SIWE authenticated/);
  assert.match(acceptance, /UNSUPPORTED_FILE_TYPE/);
  assert.match(acceptance, /INVALID_FILE_SIZE/);
  assert.match(acceptance, /signedUploadReturned: false/);
  assert.match(acceptance, /A1 auth smoke passed: SIWE \+ MIME\/size rejection\./);
  assert.match(acceptance, /0x6ec8\.\.\.989b/);
  assert.doesNotMatch(acceptance, /0x6ec8c121043357ac231e36d403edabf90ae6989b/i);
});

test('A1 status is reconciled without falsely accepting the private credential gate', () => {
  const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');
  const durableBacklog = read('docs/BACKLOG.md');
  const handoff = read('docs/HANDOFF.md');
  const priorAcceptance = read('docs/testnet/MOBILE_WALLET_PRODUCTION_ACCEPTANCE_2026-07-30.md');

  assert.match(canonicalBacklog, /^- \[ \] \*\*A1 — Security and migration verification\.\*\*/m);
  assert.match(canonicalBacklog, /A1 remains open only for the private, value-free credential-rotation\/retirement and repository-history remediation attestation/);
  assert.match(durableBacklog, /^\| A-02 \|[^\n]*\| in progress \| A \|/m);
  assert.match(durableBacklog, /Only the private credential and repository-history attestation remains/);
  assert.match(handoff, /A fresh production mobile SIWE signature and both authenticated negative upload-policy probes passed on 2026-08-04/);
  assert.match(priorAcceptance, /The missing runtime evidence was subsequently accepted on 2026-08-04/);
});
