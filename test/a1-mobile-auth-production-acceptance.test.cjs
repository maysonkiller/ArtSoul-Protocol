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

test('A1 status is reconciled after the redacted credential and history acceptance', () => {
  const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');
  const durableBacklog = read('docs/BACKLOG.md');
  const handoff = read('docs/HANDOFF.md');
  const priorAcceptance = read('docs/testnet/MOBILE_WALLET_PRODUCTION_ACCEPTANCE_2026-07-30.md');
  const finalAcceptance = read('docs/testnet/A1_CREDENTIAL_HISTORY_ACCEPTANCE_2026-08-07.md');

  assert.match(canonicalBacklog, /^- \[x\] \*\*A1 [^\n]*Security and migration verification\.\*\*/m);
  assert.match(canonicalBacklog, /A1_CREDENTIAL_HISTORY_ACCEPTANCE_2026-08-07\.md/);
  assert.match(durableBacklog, /^\| A-01 \|[^\n]*\| done \| A \|/m);
  assert.match(durableBacklog, /^\| A-02 \|[^\n]*\| done \| A \|/m);
  assert.match(handoff, /A fresh production mobile SIWE signature and both authenticated negative upload-policy probes passed on 2026-08-04/);
  assert.match(handoff, /A1 security and migration operational acceptance is complete/);
  assert.match(priorAcceptance, /The missing runtime evidence was subsequently accepted on 2026-08-04/);
  assert.match(finalAcceptance, /^Accepted: 2026-08-07$/m);
  assert.match(finalAcceptance, /SECOND_PRIVATE_KEY absent or empty/);
  assert.match(finalAcceptance, /The repository history is retained/);
  assert.doesNotMatch(finalAcceptance, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  assert.doesNotMatch(finalAcceptance, /0x[a-fA-F0-9]{40}/);
});
