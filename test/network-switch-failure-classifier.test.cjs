// A-57: one message covered at least four unrelated causes.
//
// Selecting Base Sepolia in a wallet that does not offer it produced "Could not
// switch to Base Sepolia. Reconnect the wallet and try again." Reconnecting
// repairs exactly one of the causes that reached that string, so the other
// three sent people around a loop that could not end. The classifier already
// had `isUnknownChainError` and never consulted it.
//
// These tests run the real classifier rather than matching its source, because
// what matters is which message each error produces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'appkit-init.js'), 'utf8');

// Balanced-brace extraction, the repo pattern from
// profile-lifecycle-action-gating.test.cjs.
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let depth = 0;
  let index = source.indexOf('{', source.indexOf(')', start));
  for (; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, index + 1);
}

const sandbox = vm.createContext({ exported: {} });
vm.runInContext([
  extractFunction('getWalletErrorCode'),
  extractFunction('isUnknownChainError'),
  extractFunction('isPendingRequestError'),
  extractFunction('isUserRejectedError'),
  extractFunction('isChainUnsupportedByWalletError'),
  extractFunction('isUnconfirmedNetworkError'),
  extractFunction('describeNetworkSwitchFailure'),
  'exported.describe = describeNetworkSwitchFailure;'
].join('\n'), sandbox, { filename: 'appkit-init.js (extracted)' });

const describe = sandbox.exported.describe;
const TARGET = { chainName: 'Base Sepolia' };
const RECONNECT = /reconnect the wallet and try again/i;

const say = (error) => describe(error, TARGET);

test('a wallet that cannot add a network is not told to reconnect', () => {
  // EIP-1193 4200: the provider does not implement the requested method. A
  // wallet with a fixed network list answers wallet_addEthereumChain this way,
  // and no number of reconnects gives it the method.
  for (const error of [
    { code: 4200, message: 'The Provider does not support the requested method' },
    { code: '4200', message: 'Unsupported method' },
    { message: 'Method not supported by this wallet' }
  ]) {
    const message = say(error);
    assert.doesNotMatch(message, RECONNECT, JSON.stringify(error));
    assert.match(message, /custom networks/i);
  }
});

test('a session that never approved the chain is not told to reconnect', () => {
  // WalletConnect 5100-5102: the chain, method or event is outside what the
  // session approved. The session is alive; it simply does not carry Base
  // Sepolia, and reconnecting reproposes the same namespaces.
  for (const code of [5100, 5101, 5102, '5100']) {
    const message = say({ code, message: 'Unsupported chains' });
    assert.doesNotMatch(message, RECONNECT, `code ${code}`);
  }
});

test('an unknown chain names the repair that exists', () => {
  // 4902 reaches this function only after the add attempt has already run and
  // the chain is still unknown, so the remaining repair is in the wallet.
  const message = say({ code: 4902, message: 'Unrecognized chain ID' });
  assert.doesNotMatch(message, RECONNECT);
  assert.match(message, /add Base Sepolia in the wallet/i);
});

test('an accepted but unconfirmed switch is not reported as a dead session', () => {
  // confirmCoreBaseSepolia throws BASE_SEPOLIA_REQUIRED on a confirmation
  // timeout. The request may still be waiting in the wallet, so telling
  // someone their session expired is both wrong and destructive.
  const message = say({ code: 'BASE_SEPOLIA_REQUIRED', message: 'The wallet did not confirm Base Sepolia.' });
  assert.doesNotMatch(message, RECONNECT);
  assert.doesNotMatch(message, /expired/i);
  assert.match(message, /has not confirmed Base Sepolia yet/i);
});

test('the causes that reconnecting does repair keep saying so', () => {
  for (const error of [
    { code: 'CORE_SESSION_NOT_LIVE', message: 'The core session did not establish a live session.' },
    { code: 'WALLET_SESSION_REQUIRED', message: 'A live wallet session is required to switch networks.' }
  ]) {
    assert.match(say(error), /session expired\. Reconnect the wallet/i, JSON.stringify(error));
  }
});

test('a declined switch reads as declined on either path', () => {
  assert.match(say({ code: 4001, message: 'User rejected the request' }), /declined/i);
  // The write guard raises its own code for the same act.
  assert.match(say({ code: 'BASE_SEPOLIA_SWITCH_REJECTED', message: 'Network switch was declined.' }), /declined/i);
});

test('a waiting request still points at the wallet', () => {
  assert.match(say({ code: -32002, message: 'Request of type wallet_switchEthereumChain already pending' }), /already waiting in your wallet/i);
});

test('an unclassified failure keeps the catch-all rather than guessing', () => {
  // The catch-all is correct for what it is: an error nobody has classified.
  // It just must not be the answer for four causes that have one.
  assert.match(say({ message: 'socket hang up' }), RECONNECT);
});

test('one attempt asks the wallet to add the chain once, not twice', () => {
  // switchEthereumChain already runs switch -> add -> switch. The selector
  // repeated that sequence on unknown-chain, so an unfamiliar wallet was asked
  // to add the chain twice and to switch up to four times in one attempt.
  const start = source.indexOf('activeNetworkSwitchChainId = target.chainId;');
  assert.notEqual(start, -1);
  const selector = source.slice(start, source.indexOf('activeNetworkSwitchChainId = null;', start));

  assert.doesNotMatch(selector, /await addEthereumChain\(/, 'the selector must not run its own add cycle');
  assert.equal(
    (selector.match(/await switchEthereumChain\(/g) || []).length,
    1,
    'the selector must call the switch helper once'
  );
});

test('the write guard is untouched by this row', () => {
  // A-57 says not to weaken ensureArtSoulWriteNetwork, and the bid error
  // classifier keys on the codes it throws. Both stay as they were.
  const guard = source.slice(source.indexOf('window.ensureArtSoulWriteNetwork = async () => {'));
  assert.match(guard.slice(0, 3000), /'BASE_SEPOLIA_SWITCH_REJECTED'/);
  assert.match(guard.slice(0, 3000), /'BASE_SEPOLIA_REQUIRED'/);

  const bidError = fs.readFileSync(path.join(root, 'src', 'features', 'auction', 'bid-error.js'), 'utf8');
  assert.match(bidError, /rpcCode === 'BASE_SEPOLIA_REQUIRED'/);
});
