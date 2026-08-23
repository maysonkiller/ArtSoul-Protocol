const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

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

// The classifier owns what counts as positive final failure evidence. The
// waiter takes it as an injected dependency so this suite drives the same rule
// the publish flow does, rather than a second copy of it.
async function loadFinality() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'src', 'features', 'publish', 'publish-error.js')
  ).href;
  const { provesFinalFailure } = await import(moduleUrl);
  return provesFinalFailure;
}

// A wallet rejection carrying the chain's own verdict: mined, and it failed.
function minedFailure() {
  return Object.assign(new Error('transaction execution reverted'), {
    code: 'CALL_EXCEPTION',
    action: 'sendTransaction',
    data: null,
    reason: null,
    receipt: { status: 0, hash: '0xsubmitted' }
  });
}

test('indexer proof still wins over a provider rejection that looks final', async () => {
  // The race is the point: the wallet can give up on a transaction the chain
  // accepted, and the projection is the authority. Surfacing provider failures
  // must not cost that.
  const { waitForAuctionConfirmation } = loadWaiter();
  const isFinalFailure = await loadFinality();

  const hash = await waitForAuctionConfirmation({
    transactionPromise: Promise.reject(minedFailure()),
    chainId: 84532,
    artworkId: '7',
    txHash: '0xsubmitted',
    timeoutMs: 50,
    pollIntervalMs: 10,
    readProjection: async () => ({ artwork_id: '7', auction_id: '4' }),
    now: () => 0,
    sleep: async () => {},
    isFinalFailure
  });

  assert.equal(hash, '0xsubmitted');
});

test('a proven receipt failure survives the deadline instead of becoming pending', async () => {
  // Reproduced before this was fixed: the provider error was kept on
  // pendingError.cause and never read, so a mined status-0 receipt was reported
  // as AUCTION_CONFIRMATION_PENDING - a card telling somebody to wait for
  // something that had already ended.
  const { waitForAuctionConfirmation } = loadWaiter();
  const isFinalFailure = await loadFinality();
  let clock = 0;

  await assert.rejects(
    waitForAuctionConfirmation({
      transactionPromise: Promise.reject(minedFailure()),
      chainId: 84532,
      artworkId: '7',
      txHash: '0xsubmitted',
      timeoutMs: 30,
      pollIntervalMs: 10,
      readProjection: async () => null,
      now: () => clock,
      sleep: async ms => { clock += ms; },
      isFinalFailure
    }),
    error => error.code === 'CALL_EXCEPTION'
      && error.receipt?.status === 0
      && error.code !== 'AUCTION_CONFIRMATION_PENDING'
  );
  assert.equal(clock, 30, 'the indexer still got its full window first');
});

test('an ambiguous provider rejection stays pending after the deadline', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  const isFinalFailure = await loadFinality();
  let clock = 0;

  await assert.rejects(
    waitForAuctionConfirmation({
      transactionPromise: Promise.reject(new Error('provider transport closed')),
      chainId: 84532,
      artworkId: '7',
      txHash: '0xsubmitted',
      timeoutMs: 30,
      pollIntervalMs: 10,
      readProjection: async () => null,
      now: () => clock,
      sleep: async ms => { clock += ms; },
      isFinalFailure
    }),
    error => error.code === 'AUCTION_CONFIRMATION_PENDING'
      && error.txHash === '0xsubmitted'
      && error.cause?.message === 'provider transport closed'
  );
});

test('the publish flow hands the waiter the shared finality rule', () => {
  assert.match(source, /import \{ classifyPublishFailure, keepsPendingTransaction, provesFinalFailure \}/);
  assert.match(source, /isFinalFailure: provesFinalFailure/);
  // Absent, it must assume nothing is final: that is the only safe default for
  // a transaction the wallet already broadcast.
  assert.match(source, /isFinalFailure = \(\) => false/);
});

test('publish submits one auction transaction and never prompts a duplicate on timeout', () => {
  const uploadHandler = extractFunction('handleUpload');
  assert.equal((uploadHandler.match(/ArtSoulContracts\.createAuction\(/g) || []).length, 1);
  assert.match(uploadHandler, /Promise\.race\(\[/);
  assert.match(uploadHandler, /waitForAuctionConfirmation\(\{/);
  // A-70, reopened: the branch that used to name AUCTION_CONFIRMATION_PENDING
  // by hand now asks the shared policy, so a confirmation lost to an unhealthy
  // endpoint is protected by the same guard rather than falling through to
  // "auction failed - you can retry".
  const guard = 'keepsPendingTransaction(mappedAuctionError.code)';
  assert.ok(uploadHandler.includes(guard), 'the duplicate guard must consult the shared policy');
  assert.match(uploadHandler, /stage: 'auction_submitted'/);
  assert.match(uploadHandler, /Do not submit the auction again while it is finalizing/);

  const pendingBranch = uploadHandler.slice(
    uploadHandler.indexOf(guard),
    uploadHandler.indexOf('pendingArtwork = savePendingArtwork({', uploadHandler.indexOf(guard) + 100)
  );
  assert.doesNotMatch(pendingBranch, /auction_failed|createAuction\(/);
});

test('internal redirects release the native beforeunload guard first', () => {
  const navigate = extractFunction('navigateAfterPublish');
  assert.ok(
    navigate.indexOf('publishNavigationLocked = false') < navigate.indexOf('window.location.assign('),
    'the navigation lock must clear before an internal redirect'
  );
  assert.match(source, /window\.addEventListener\('beforeunload'/);
  // The destination is built by the shared helper now, but it must still go
  // through navigateAfterPublish so the unload guard is released first.
  assert.match(source, /navigateAfterPublish\(window\.ArtSoulArtworkUrl\.artworkPath\(/);
  // It also marks the destination, which is the only way the artwork page can
  // tell a publish from an ordinary visit and name the wait it is showing.
  assert.match(navigate, /published=1/);
});

test('Publish stays clickable and explains what is blocking it', () => {
  // A disabled submit swallows the click, so the person gets no answer at all.
  assert.match(source, /button\.disabled = uploading;/);
  assert.doesNotMatch(source, /button\.disabled = !ready;/);
  assert.match(source, /setAttribute\('aria-disabled'/);

  const reveal = extractFunction('revealBlockingStep');
  assert.match(reveal, /scrollIntoView/);
  assert.match(reveal, /\.focus\(/);
  // Requesting AI guidance costs a wallet signature: never trigger it for them.
  assert.doesNotMatch(reveal, /\.click\(\)/);

  const handler = extractFunction('handleUpload');
  assert.match(handler, /revealBlockingStep\(validationError\)/);
  // Only the form steps are covered: a wrong network is an environment problem,
  // not a control on this page, and keeps its own modal warning.
  const formSteps = handler.slice(0, handler.indexOf('const walletAddress ='));
  assert.doesNotMatch(formSteps, /alert\(/);
});

test('the artwork description has a bounded length', () => {
  assert.match(source, /const MAX_ARTWORK_DESCRIPTION_LENGTH = 1000;/);
  assert.match(source, /Keep the description under \$\{MAX_ARTWORK_DESCRIPTION_LENGTH\} characters/);

  const html = fs.readFileSync(path.join(__dirname, '..', 'upload.html'), 'utf8');
  assert.match(html, /id="artDescription"[^>]*maxlength="1000"/);
  assert.match(html, /id="artDescriptionCount"/);
  assert.match(html, /id="publishBlockedNote"[^>]*role="alert"/);
});
