// Publishing is two transactions, and the first one is permanent.
//
// registerArtwork reports the transaction hash through onSubmitted and only
// then awaits the receipt. So on either side of that line the same ethers
// errors - TIMEOUT, NETWORK_ERROR, SERVER_ERROR - mean opposite things. Before
// the broadcast nothing exists. After it the registration is on its way and
// will be permanent once mined.
//
// The classifier answered both with "nothing was sent and nothing was
// published", and the handler then deleted the pending record - the only trace
// that a transaction was in flight. Someone reading that message publishes the
// same artwork again, and gets two of them on chain.
//
// Found while deciding what to keep from the stale A-70 branch, PR #232.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'entries', 'upload.js'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'contracts-integration.js'), 'utf8');

function extractFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let depth = 0;
  let index = text.indexOf('{', text.indexOf(')', start));
  for (; index < text.length; index++) {
    if (text[index] === '{') depth++;
    else if (text[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return text.slice(start, index + 1);
}

// Runs the real mapPublishError with the two pieces of outer state it reads.
function classify(error, { stage = 'register', submittedHash = '' } = {}) {
  const sandbox = vm.createContext({ exported: {}, String, Number, Boolean });
  vm.runInContext([
    `let currentPublishStage = ${JSON.stringify(stage)};`,
    `let submittedRegisterTxHash = ${JSON.stringify(submittedHash)};`,
    extractFunction(source, 'mapPublishError'),
    'exported.map = mapPublishError;'
  ].join('\n'), sandbox, { filename: 'upload.js (extracted)' });
  return sandbox.exported.map(error);
}

const HASH = '0x' + 'a'.repeat(64);

test('a node that never took the transaction still says nothing was sent', () => {
  // A-70, unchanged. This is the 2026-08-21 case: estimateGas against an
  // endpoint answering "no backend is currently healthy".
  for (const error of [
    { message: 'missing revert data', code: 'CALL_EXCEPTION' },
    { code: 'TIMEOUT', message: 'timeout' },
    { code: 'SERVER_ERROR', message: 'no backend is currently healthy to serve traffic' }
  ]) {
    const mapped = classify(error, { submittedHash: '' });
    assert.equal(mapped.code, 'NETWORK_UNAVAILABLE', JSON.stringify(error));
    assert.match(mapped.message, /nothing was sent and nothing was published/);
  }
});

test('a broadcast transaction that went quiet does not claim nothing was sent', () => {
  for (const error of [
    { code: 'TIMEOUT', message: 'timeout waiting for transaction' },
    { code: 'NETWORK_ERROR', message: 'network error' },
    { code: 'SERVER_ERROR', message: 'no backend is currently healthy to serve traffic' }
  ]) {
    const mapped = classify(error, { submittedHash: HASH });
    assert.equal(mapped.code, 'REGISTRATION_UNCONFIRMED', JSON.stringify(error));
    assert.doesNotMatch(mapped.message, /nothing was sent/);
    assert.doesNotMatch(mapped.message, /nothing was published/);
    assert.match(mapped.message, /may still complete/i);
    assert.match(mapped.message, /check for this artwork before publishing it again/i);
  }
});

test('a rejection in the wallet is still a rejection, broadcast or not', () => {
  // The new branch must not swallow causes that are already correct.
  const mapped = classify({ code: 'ACTION_REJECTED', message: 'user rejected' }, { submittedHash: HASH });
  assert.equal(mapped.code, 'USER_REJECTED');
});

test('a genuine revert is still a revert', () => {
  const mapped = classify({ code: 'CALL_EXCEPTION', message: 'execution reverted: paused' }, { submittedHash: HASH });
  assert.equal(mapped.code, 'TRANSACTION_REVERTED');
});

test('the hash is recorded where it first exists and cleared when publishing ends', () => {
  assert.match(contracts, /await options\.onSubmitted\?\.\(tx\.hash\)/, 'the hash must still be reported before the wait');
  assert.match(source, /submittedRegisterTxHash = registerTxHash \|\| '';/);
  assert.match(source, /currentPublishStage = 'idle';\s*\n\s*submittedRegisterTxHash = '';/);
});

test('the pending record survives exactly the case it exists for', () => {
  // A submitted register with no artwork id yet is what the record is for: the
  // indexer projects the real artwork once the transaction mines, and until
  // then the profile has nothing else to show.
  const start = source.indexOf("if (pendingArtwork?.register_tx_hash");
  assert.notEqual(start, -1);
  const block = source.slice(start, start + 260);
  assert.match(block, /mapped\.code !== 'REGISTRATION_UNCONFIRMED'/);
});
