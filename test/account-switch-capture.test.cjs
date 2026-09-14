// A-59: switching account inside the wallet is not noticed.
//
// The handler that would act on it is correct - it compares against
// lastProcessedAddress and signs out a mismatched session - so the open
// question is whether the signal ever arrives. A WalletConnect session's
// approved account list is fixed at approval time and changes only through
// `session_update`. That event is bound, but it was summarised as
// topic/code/message, so the accounts it carries were dropped before anyone
// could read them, and the diagnostic log could not answer the row's question.
//
// This is capture, not repair. Whether to reconcile or to document a wallet
// limitation is decided from a device run, per the row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'wallet-core-connect.js'), 'utf8');
const appkitSource = fs.readFileSync(path.join(root, 'appkit-init.js'), 'utf8');

function extractFunction(source, name) {
  const plain = source.indexOf(`function ${name}(`);
  assert.notEqual(plain, -1, `Missing function ${name}`);
  const exported = source.lastIndexOf('export ', plain);
  const start = exported === plain - 7 ? exported : plain;
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
  return source.slice(start, index + 1).replace(/^export /, '');
}

const ALICE = '0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa';
const BOB = '0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb';

function loadSummarizer(heldAccounts) {
  const sandbox = vm.createContext({ exported: {}, Number, String, Object, Array, Boolean, RegExp });
  vm.runInContext([
    'let providerInstance = null;',
    'function parseCoreChainId(value) { return Number(value) || null; }',
    extractFunction(coreSource, 'readCoreSessionAccounts'),
    extractFunction(coreSource, 'maskCoreAddress'),
    extractFunction(coreSource, 'summarizeSessionAccounts'),
    extractFunction(coreSource, 'summarizeEventPayload'),
    `providerInstance = ${JSON.stringify({ session: { namespaces: { eip155: { accounts: heldAccounts } } } })};`,
    'exported.summarize = summarizeEventPayload;'
  ].join('\n'), sandbox, { filename: 'wallet-core-connect.js (extracted)' });
  return sandbox.exported.summarize;
}

test('a session_update that changes the account is recorded as a change', () => {
  const summarize = loadSummarizer([`eip155:84532:${ALICE}`]);
  const detail = summarize('session_update', {
    topic: 'abc123',
    params: { namespaces: { eip155: { accounts: [`eip155:84532:${BOB}`] } } }
  });

  assert.equal(detail.differs, true, 'a different account must read as different');
  assert.equal(detail.updated.count, 1);
  assert.equal(detail.held.count, 1);
  assert.notDeepEqual(detail.updated.accounts, detail.held.accounts);
});

test('a session_update that changes nothing is recorded as no change', () => {
  // Wallets re-announce namespaces for reasons that are not account switches.
  // A capture that called every update a switch would answer the row wrongly.
  const summarize = loadSummarizer([`eip155:84532:${ALICE}`]);
  const detail = summarize('session_update', {
    params: { namespaces: { eip155: { accounts: [`eip155:84532:${ALICE}`] } } }
  });

  assert.equal(detail.differs, false);
});

test('no full address reaches the log', () => {
  // RG-04. The log is read by people and pasted into acceptance notes.
  const summarize = loadSummarizer([`eip155:84532:${ALICE}`]);
  const detail = summarize('session_update', {
    params: { namespaces: { eip155: { accounts: [`eip155:84532:${BOB}`] } } }
  });

  const text = JSON.stringify(detail);
  assert.doesNotMatch(text, /0x[a-fA-F0-9]{40}/, 'addresses must be masked');
  assert.match(text, /0xBBBB\.\.\./, 'but enough must survive to tell two accounts apart');
});

test('accountsChanged keeps its count and gains its accounts', () => {
  // The other path the row names. It already logged a count, which cannot say
  // which account arrived.
  const summarize = loadSummarizer([]);
  const detail = summarize('accountsChanged', [BOB]);
  assert.equal(detail.count, 1);
  assert.deepEqual(detail.accounts, ['0xBBBB...bbbb']);
});

test('an empty or malformed payload does not throw into the SDK emitter', () => {
  // These run inside a WalletConnect event handler. Throwing there is worse
  // than learning nothing.
  const summarize = loadSummarizer([]);
  for (const payload of [null, {}, { params: {} }, { params: { namespaces: { eip155: { accounts: ['nonsense'] } } } }]) {
    const detail = summarize('session_update', payload);
    assert.equal(detail.updated.count, 0, JSON.stringify(payload));
  }
});

test('the return from the wallet records what the hidden branch records', () => {
  // The row asks for the provider address on visibility return. The hidden
  // branch already snapshots it; without the matching one there is nothing to
  // compare an in-wallet switch against.
  const bind = appkitSource.slice(appkitSource.indexOf('function bindWalletResumeListeners'));
  const block = bind.slice(0, bind.indexOf('async function'));
  assert.equal(
    (block.match(/snapshot: getWalletDebugSnapshot\(\)/g) || []).length,
    2,
    'both visibility directions must snapshot'
  );
  assert.match(block, /notifyWalletResume\('visibility return'\)/, 'resume behaviour must be unchanged');
});

test('this row changed capture only', () => {
  // A-59 says not to decide from the dapp side without evidence, and not to
  // reopen A-03, A-05 or A-45. No handler was rewired.
  assert.doesNotMatch(coreSource, /session_update'[\s\S]{0,400}handleProviderAccountsChanged/);
  assert.match(coreSource, /instance\.on\('session_delete'/, 'the one handler that does act stays');
});
