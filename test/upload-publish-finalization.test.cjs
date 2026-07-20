const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'upload.js'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let signatureDepth = 0;
  let signatureEnd = source.indexOf('(', start);
  for (; signatureEnd < source.length; signatureEnd++) {
    if (source[signatureEnd] === '(') signatureDepth++;
    if (source[signatureEnd] === ')') {
      signatureDepth--;
      if (signatureDepth === 0) break;
    }
  }
  let index = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const prefix = source.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return prefix + source.slice(start, index + 1);
}

function loadWaiter() {
  const sandbox = vm.createContext({
    console: { warn: () => {} },
    window: {},
    exported: {}
  });
  vm.runInContext([
    extractFunction('createUploadError'),
    extractFunction('isProjectedAuctionReady'),
    extractFunction('waitForAuctionConfirmation'),
    'exported.waitForAuctionConfirmation = waitForAuctionConfirmation;',
    'exported.isProjectedAuctionReady = isProjectedAuctionReady;'
  ].join('\n'), sandbox, { filename: 'upload.js (extracted finalization helpers)' });
  return sandbox.exported;
}

test('auction projection proof is exact and requires an auction id', () => {
  const { isProjectedAuctionReady } = loadWaiter();
  assert.equal(isProjectedAuctionReady({ artwork_id: '7', active_auction_id: '4' }, '7'), true);
  assert.equal(isProjectedAuctionReady({ blockchain_id: '7', auction_id: '4' }, '7'), true);
  assert.equal(isProjectedAuctionReady({ artwork_id: '8', active_auction_id: '4' }, '7'), false);
  assert.equal(isProjectedAuctionReady({ artwork_id: '7', active_auction_id: '' }, '7'), false);
  assert.equal(isProjectedAuctionReady(null, '7'), false);
});

test('normal wallet receipt resolution finishes without waiting for the indexer', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  const hash = await waitForAuctionConfirmation({
    transactionPromise: Promise.resolve('0xconfirmed'),
    chainId: 84532,
    artworkId: '7',
    txHash: '0xsubmitted',
    timeoutMs: 50,
    pollIntervalMs: 10,
    readProjection: async () => null,
    now: () => 0,
    sleep: async () => {}
  });
  assert.equal(hash, '0xconfirmed');
});

test('an indexed auction completes the flow when the wallet receipt promise stays frozen', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  let clock = 0;
  let reads = 0;
  const hash = await waitForAuctionConfirmation({
    transactionPromise: new Promise(() => {}),
    chainId: 84532,
    artworkId: '7',
    txHash: '0xsubmitted',
    timeoutMs: 50,
    pollIntervalMs: 10,
    readProjection: async () => (++reads >= 2 ? { artwork_id: '7', active_auction_id: '4' } : null),
    now: () => clock,
    sleep: async ms => { clock += ms; }
  });
  assert.equal(hash, '0xsubmitted');
  assert.equal(reads, 2);
});

test('indexer proof wins over a wallet-provider wait rejection after submission', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  const hash = await waitForAuctionConfirmation({
    transactionPromise: Promise.reject(new Error('provider transport closed')),
    chainId: 84532,
    artworkId: '7',
    txHash: '0xsubmitted',
    timeoutMs: 50,
    pollIntervalMs: 10,
    readProjection: async () => ({ artwork_id: '7', auction_id: '4' }),
    now: () => 0,
    sleep: async () => {}
  });
  assert.equal(hash, '0xsubmitted');
});

test('bounded settlement ends with a non-destructive pending result', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  let clock = 0;
  await assert.rejects(
    waitForAuctionConfirmation({
      transactionPromise: new Promise(() => {}),
      chainId: 84532,
      artworkId: '7',
      txHash: '0xsubmitted',
      timeoutMs: 30,
      pollIntervalMs: 10,
      readProjection: async () => null,
      now: () => clock,
      sleep: async ms => { clock += ms; }
    }),
    error => error.code === 'AUCTION_CONFIRMATION_PENDING' && error.txHash === '0xsubmitted'
  );
  assert.equal(clock, 30);
});

test('publish submits one auction transaction and never prompts a duplicate on timeout', () => {
  const uploadHandler = extractFunction('handleUpload');
  assert.equal((uploadHandler.match(/ArtSoulContracts\.createAuction\(/g) || []).length, 1);
  assert.match(uploadHandler, /Promise\.race\(\[/);
  assert.match(uploadHandler, /waitForAuctionConfirmation\(\{/);
  assert.match(uploadHandler, /mappedAuctionError\.code === 'AUCTION_CONFIRMATION_PENDING'/);
  assert.match(uploadHandler, /stage: 'auction_submitted'/);
  assert.match(uploadHandler, /Do not submit the auction again while it is finalizing/);

  const pendingBranch = uploadHandler.slice(
    uploadHandler.indexOf("mappedAuctionError.code === 'AUCTION_CONFIRMATION_PENDING'"),
    uploadHandler.indexOf('pendingArtwork = savePendingArtwork({', uploadHandler.indexOf("mappedAuctionError.code === 'AUCTION_CONFIRMATION_PENDING'") + 100)
  );
  assert.doesNotMatch(pendingBranch, /auction_failed|createAuction\(/);
});

test('internal redirects release the native beforeunload guard first', () => {
  const navigate = extractFunction('navigateAfterPublish');
  assert.ok(
    navigate.indexOf('publishNavigationLocked = false') < navigate.indexOf('window.location.assign(path)'),
    'the navigation lock must clear before an internal redirect'
  );
  assert.match(source, /window\.addEventListener\('beforeunload'/);
  assert.match(source, /navigateAfterPublish\(`artwork\.html\?id=v41:/);
});
