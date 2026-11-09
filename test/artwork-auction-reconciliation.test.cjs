const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CREATOR = `0x${'ab'.repeat(20)}`;
const BIDDER = `0x${'cd'.repeat(20)}`;
const quiet = { log() {}, warn() {}, error() {} };
const plain = value => JSON.parse(JSON.stringify(value));

// Evaluate the actual page functions without JSX or a duplicate state reducer.
// Function declarations end at their matching outer indentation in this file.
function pageFunction(name) {
  const start = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(start, `Shipped function ${name} exists`);
  const tail = source.slice(start.index);
  const end = new RegExp(`^${start[1]}}`, 'm').exec(tail);
  assert.ok(end, `Shipped function ${name} has an outer closing brace`);
  return tail.slice(0, end.index + end[0].length);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function projection(overrides = {}) {
  return {
    id: 'v41:84532:28', chain_id: 84532, artwork_id: '28',
    auction_id: '63', active_auction_id: '63', status: 'auction',
    creator: CREATOR, title: 'Current artwork', start_price: '0.001',
    current_bid: '0', highest_bid: '0', current_bidder: null,
    auction_end_time: 1790000000, bids: [], ...overrides
  };
}

const functionNames = [
  'normalizeTimestampMs', 'firstPositiveTimestamp', 'firstDefined', 'parseEthToWei',
  'formatWeiToEth', 'getAuctionHighestBidWei', 'getAuctionStartingBidWei', 'calculateMinimumBidDetails',
  'projectedAuctionFromArtwork', 'mergeProjectedAuction',
  'bidIdentity', 'advanceBidCursor', 'applyLiveAuctionProjection', 'refreshLiveBidActivity',
  'getAuctionActionId', 'isZeroAddress', 'isSameAddress', 'hasProtocolId', 'loadArtwork', 'startResaleProjectionRefresh'
];

function page({ getArtwork, getLiveAuctionActivity, getProfile, getArtworkProvenance, hydrateBidderProfiles } = {}) {
  const state = { bidActivity: [], newAuctionPrice: '', resolvedProfileAddresses: new Set(), provenanceState: {} };
  const writes = [];
  const context = vm.createContext({
    console: quiet, ZERO_ADDRESS, WEI_PER_ETH: 10n ** 18n,
    artworkId: 'v41:84532:28', isV41CompositeId: true, v41CompositeId: {chainId: 84532, artworkId: '28'},
    artwork: projection(), auction: null,
    artworkLoadSequenceRef: { current: 0 }, liveAuctionIdentityRef: { current: '' }, loadedArtworkIdRef: { current: null },
    artworkSnapshotRef: { current: null }, provenanceSnapshotRef: { current: null },
    bidCursorRef: { current: null }, bidPollInFlightRef: { current: false },
    hydrateBidderProfiles: hydrateBidderProfiles || (async () => {}),
    loadModerationVisibility() {}, readAIValuation: value => value,
    window: { location: { href: 'https://artsoul.example/artwork?id=v41:84532:28' },
      ArtSoulDB: { getArtwork, getLiveAuctionActivity, getProfile, getArtworkProvenance } },
    document: { title: '', getElementById: () => ({ setAttribute() {} }) }
  });
  for (const key of ['artwork', 'auction', 'bidActivity', 'error', 'projectionRetryCount', 'newAuctionPrice',
    'creatorProfile', 'auctionWinnerProfile', 'currentOwnerProfile', 'socialSignals', 'aiGuidance',
    'loading', 'refreshError', 'resolvedProfileAddresses', 'votes', 'userVote', 'interactionState', 'provenanceState']) {
    const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
    context[setter] = value => {
      state[key] = typeof value === 'function' ? value(state[key]) : value;
      writes.push(key);
      if (key === 'artwork' || key === 'auction') context[key] = state[key];
      if (key === 'artwork') context.artworkSnapshotRef.current = state[key];
      if (key === 'provenanceState') context.provenanceSnapshotRef.current = state[key];
    };
  }
  const minimumBidConstants = ['MIN_ABSOLUTE_BID_INCREMENT_WEI', 'BID_INCREMENT_BPS', 'BPS_DENOMINATOR']
    .map(name => {
      const declaration = source.match(new RegExp(`const ${name} = [^;]+;`))?.[0];
      assert.ok(declaration, `Shipped constant ${name} exists`);
      return declaration;
    });
  vm.runInContext([...minimumBidConstants, ...functionNames.map(pageFunction)].join('\n'), context, { filename: 'shipped-artwork-functions.js' });
  return { page: context, state, writes };
}

function receiptBridge(api, record, resale = false) {
  const storage = new Map();
  const window = { localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value)
  }, addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync('supabase-client.js', 'utf8'), {
    window, document: {}, console: quiet, URL, URLSearchParams,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } }
  });
  if (resale) window.ArtSoulDB.recordConfirmedResale({ chain_id: 84532, artwork_id: '28', token_id: '7',
    seller: CREATOR, active: false, price: '0', transaction_hash: `0x${'12'.repeat(32)}`,
    block_number: 100, transaction_index: 0, ...record });
  else window.ArtSoulDB.recordConfirmedAuction({ chain_id: 84532, artwork_id: '28', auction_id: '63',
    transaction_hash: `0x${'12'.repeat(32)}`, block_number: 100, kind: 'defaulted', patch: {}, ...record });
  api.window.ArtSoulDB.applyConfirmedAuctionUpdate = window.ArtSoulDB.applyConfirmedAuctionUpdate;
  return window.ArtSoulDB;
}

function refreshFromReceipt(api) {
  const listener = source.match(/const refresh = \(\) => \{([\s\S]*?)\n {16}\};/);
  assert.ok(listener, 'the shared receipt listener exists');
  vm.runInContext(listener[1], api);
  // Commit the effect keyed to the updated artwork without waiting for the
  // refresh or profile hydration; React runs it after that state update.
  const effect = source.match(/useEffect\(\(\) => \{\s*if \(!artwork\?\.pending_auction_sync\) return;[\s\S]*?\}, \[artwork\]\);/);
  assert.ok(effect, 'receipt state synchronizes the auction');
  api.useEffect = effect => effect();
  vm.runInContext(effect[0], api);
}

function mountReceiptRefresh(api) {
  const timers = new Map(), listeners = new Map(), visibility = new Set();
  let nextTimer = 0, cleanup;
  api.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
  api.clearTimeout = id => timers.delete(id);
  api.window.addEventListener = (name, listener) => listeners.set(name, listener);
  api.window.removeEventListener = name => listeners.delete(name);
  api.document.visibilityState = 'visible';
  api.document.addEventListener = (_, listener) => visibility.add(listener);
  api.document.removeEventListener = (_, listener) => visibility.delete(listener);
  api.useEffect = effect => { cleanup = effect(); };
  const marker = source.indexOf('let stopResaleRefresh = () => {};');
  const start = source.lastIndexOf('useEffect(() => {', marker);
  const end = source.indexOf('}, [artworkId]);', marker) + '}, [artworkId]);'.length;
  assert.ok(start >= 0 && end > start, 'mount the shipped receipt listener effect');
  vm.runInContext(source.slice(start, end), api);
  return {
    timers, visibility, cleanup,
    receipt: () => listeners.get('artsoul:resale-confirmed')(),
    setVisible: visible => {
      api.document.visibilityState = visible ? 'visible' : 'hidden';
      [...visibility].forEach(listener => listener());
    },
    tick: async () => {
      const [id, timer] = timers.entries().next().value || [];
      assert.ok(timer, 'a bounded retry is scheduled');
      timers.delete(id);
      await timer.callback();
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}

async function resalePage(record = {}) {
  const original = projection({ status: 'for_sale', minted: true, token_id: '7',
    current_owner_address: CREATOR, auction_winner_address: CREATOR, canonical_floor: '0.001',
    sale_price: '0.001', resale_seller: CREATOR, resale_updated_block: 20 });
  const feed = { row: original, events: [{ type: 'resale_listed', block_number: 20 }], reads: 0, historyReads: 0 };
  let bridge;
  const fixture = page({
    getArtwork: () => {
      feed.reads++;
      if (feed.error) throw feed.error;
      if (feed.pending) return feed.pending;
      return bridge ? bridge.applyConfirmedAuctionUpdate(feed.row) : feed.row;
    },
    getArtworkProvenance: () => { feed.historyReads++; return { events: [...feed.events], complete: true }; }
  });
  await fixture.page.loadArtwork();
  bridge = receiptBridge(fixture.page, record, true);
  return { ...fixture, feed, clock: mountReceiptRefresh(fixture.page) };
}

test('a resale receipt refreshes indexed ownership and separately delayed history without restoring Buy', async () => {
  const { state, feed, clock } = await resalePage();
  clock.receipt();
  assert.equal(state.artwork.status, 'sold');
  assert.equal(state.artwork.sale_price, '0');
  assert.equal(state.artwork.current_owner_address, CREATOR, 'the receipt cannot infer ownership');
  await clock.tick();
  assert.equal(state.artwork.pending_resale_sync, true);
  feed.row = { ...feed.row, status: 'sold', sale_price: '0', current_owner_address: BIDDER, resale_updated_block: 100 };
  await clock.tick();
  assert.equal(state.artwork.current_owner_address, BIDDER);
  assert.equal(state.artwork.pending_resale_sync, undefined);
  assert.equal(state.provenanceState.events.length, 1);
  assert.equal(clock.timers.size, 1, 'history still needs to catch up after ownership does');
  feed.events.push({ type: 'resale_completed', block_number: 100, transaction_hash: `0x${'12'.repeat(32)}` });
  await clock.tick();
  assert.equal(state.artwork.status, 'sold');
  assert.equal(state.artwork.auction_winner_address, CREATOR);
  assert.equal(state.artwork.canonical_floor, '0.001');
  assert.equal(state.provenanceState.events.length, 2);
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.visibility.size, 0);
  assert.equal(feed.reads, 4);
  assert.equal(feed.historyReads, 4);
  clock.cleanup();
});

test('a temporary resale refresh failure preserves the receipt and recovers on a later indexed read', async () => {
  const { state, feed, clock } = await resalePage();
  feed.error = Object.assign(new Error('Offline'), { code: 'ARTWORK_READ_UNAVAILABLE' });
  clock.receipt();
  await clock.tick();
  assert.equal(state.artwork.status, 'sold');
  assert.equal(state.artwork.current_owner_address, CREATOR);
  assert.match(state.refreshError, /could not be refreshed/);
  feed.error = null;
  feed.row = { ...feed.row, status: 'sold', sale_price: '0', current_owner_address: BIDDER, resale_updated_block: 100 };
  feed.events.push({ type: 'resale_completed', block_number: 100 });
  await clock.tick();
  assert.equal(state.artwork.current_owner_address, BIDDER);
  assert.equal(state.refreshError, '');
  assert.equal(clock.timers.size, 0);
  clock.cleanup();
});

test('resale reconciliation has a finite read budget even when the projection never catches up', async () => {
  const { state, feed, clock } = await resalePage();
  clock.receipt();
  for (let attempt = 0; attempt < 7; attempt++) await clock.tick();
  assert.equal(feed.reads, 8, 'one initial page read and seven bounded receipt reads');
  assert.equal(feed.historyReads, 8);
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.visibility.size, 0);
  assert.equal(state.artwork.current_owner_address, CREATOR);
  assert.equal(state.artwork.status, 'sold');
  clock.cleanup();
});

test('resale refresh pauses while hidden and cleanup prevents late reads from changing the page', async () => {
  const { state, writes, feed, clock } = await resalePage();
  clock.setVisible(false);
  clock.receipt();
  assert.equal(clock.timers.size, 0);
  assert.equal(feed.reads, 1);
  clock.setVisible(true);
  await clock.tick();
  clock.setVisible(false);
  await clock.tick();
  assert.equal(feed.reads, 2, 'a scheduled timer cannot fetch after the page becomes hidden');
  clock.setVisible(true);
  const delayed = deferred();
  feed.pending = delayed.promise;
  const read = clock.tick();
  const writesBeforeCleanup = writes.length;
  clock.cleanup();
  delayed.resolve({ ...feed.row, status: 'sold', current_owner_address: BIDDER, resale_updated_block: 100 });
  await read;
  assert.equal(writes.length, writesBeforeCleanup, 'unmounted or changed artwork rejects the late response');
  assert.equal(state.artwork.current_owner_address, CREATOR);
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.visibility.size, 0);
});

test('unrelated or already-indexed resale receipts do not start a reconciliation loop', async () => {
  for (const record of [{ artwork_id: '29' }, { token_id: '8' }, { chain_id: 11155111 },
    { seller: BIDDER }, { block_number: 20 }]) {
    const { state, clock } = await resalePage(record);
    clock.receipt();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(clock.timers.size, 0);
    assert.equal(state.artwork.status, 'for_sale');
    assert.equal(state.artwork.current_owner_address, CREATOR);
    clock.cleanup();
  }
});

for (const { kind, originalStatus, expectedState, patch } of [
  { kind: 'defaulted', originalStatus: 'settlement_pending', expectedState: 'DEFAULTED', patch: {} },
  { kind: 'ended', originalStatus: 'auction', expectedState: 'ENDED_NO_BIDS', patch: { has_winner: false } },
  { kind: 'ended', originalStatus: 'auction', expectedState: 'WAITING_PAYMENT',
    patch: { has_winner: true, settlement_deadline: Math.floor(Date.now() / 1000) + 86400 } }
]) {
  test(`a confirmed ${expectedState} retires the previous action while refresh stalls or fails`, async () => {
    const refresh = deferred(), stalePoll = deferred(), profiles = deferred();
    let refreshing = false, hydratingPoll = false, profileReads = 0;
    const original = projection({ status: originalStatus, settlement_deadline: 1790000000,
      current_owner_address: CREATOR, canonical_floor: '0', minted: false });
    const { page: api, state } = page({
      getArtwork: () => refreshing ? refresh.promise : original,
      getLiveAuctionActivity: () => stalePoll.promise,
      hydrateBidderProfiles: () => { profileReads++; return hydratingPoll ? profiles.promise : Promise.resolve(); }
    });
    await api.loadArtwork();
    hydratingPoll = true;
    const poll = api.refreshLiveBidActivity();
    stalePoll.resolve({ auction: original, bids: [{ bidder: BIDDER, block_number: 99, log_index: 0 }] });
    await new Promise(resolve => setImmediate(resolve));
    const readsBeforeReceipt = profileReads;
    receiptBridge(api, { kind, patch });
    refreshing = true;
    refreshFromReceipt(api);
    assert.equal(state.auction.state, expectedState);
    assert.equal(state.auction.ended, true);
    assert.equal(state.artwork.current_owner_address, CREATOR);
    assert.equal(state.artwork.canonical_floor, '0');
    assert.equal(state.artwork.minted, false);
    assert.equal(profileReads, readsBeforeReceipt, 'receipt synchronization does not repeat profile hydration');
    if (kind === 'defaulted') {
      const waiting = source.match(/const awaitingPayment = ([^;]+);/)[1];
      assert.equal(vm.runInContext(waiting, api), false, 'Close Expired Settlement is no longer offered');
    } else {
      vm.runInContext([pageFunction('normalizeAuctionTimestamp'), pageFunction('isAuctionEndActionAvailable')].join('\n'), api);
      api.getAuctionHelper = () => null;
      assert.equal(api.isAuctionEndActionAvailable(state.auction), false, 'End Expired Auction is no longer offered');
    }
    profiles.resolve();
    await poll;
    assert.equal(state.auction.state, expectedState, 'an earlier live poll cannot restore the previous action');
    refresh.reject(Object.assign(new Error('Offline'), { code: 'ARTWORK_READ_UNAVAILABLE' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.auction.state, expectedState);
    assert.match(state.refreshError, /could not be refreshed/);
  });
}

test('unrelated or older auction receipts cannot close the displayed round', async () => {
  for (const record of [{ artwork_id: '29' }, { chain_id: 11155111 }, { auction_id: '62' }]) {
    const refresh = deferred();
    let refreshing = false;
    const original = projection({ status: 'settlement_pending', settlement_deadline: 1790000000 });
    const { page: api, state } = page({ getArtwork: () => refreshing ? refresh.promise : original });
    await api.loadArtwork();
    const auction = state.auction;
    receiptBridge(api, record);
    refreshing = true;
    refreshFromReceipt(api);
    assert.equal(state.artwork, original);
    assert.equal(state.auction, auction);
    assert.equal(state.auction.state, 'WAITING_PAYMENT');
    refresh.reject(Object.assign(new Error('Offline'), { code: 'ARTWORK_READ_UNAVAILABLE' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.auction, auction);
  }
});

test('artwork replaces all auction-round fields when artwork 28 advances from auction 35 to 63', () => {
  const { page: api } = page();
  const old = api.projectedAuctionFromArtwork(projection({ auction_id: '35', start_price: '1',
    current_bid: '2', highest_bid: '2', current_bidder: BIDDER, auction_end_time: 1780000000 }));
  old.depositAmount = '0.2';
  const current = api.mergeProjectedAuction(old, projection());
  assert.equal(current.auctionId, '63');
  assert.equal(current.artworkId, '28');
  assert.equal(current.chainId, 84532);
  assert.equal(current.startPrice, '0.001');
  assert.equal(current.startingPrice, '0.001');
  assert.equal(current.currentBid, '0');
  assert.equal(current.highestBid, '0');
  assert.equal(current.highestBidder, ZERO_ADDRESS);
  assert.equal(current.current_bidder, ZERO_ADDRESS);
  assert.equal(current.endTime, 1790000000);
  assert.equal(current.depositAmount, 0);
  assert.equal(current.status, 'active');
});

test('artwork ignores an older auction even if its final bid is larger', () => {
  const { page: api } = page();
  const current = api.projectedAuctionFromArtwork(projection());
  const result = api.mergeProjectedAuction(current, projection({ auction_id: '35', current_bid: '50', highest_bid: '50' }));
  assert.equal(result, current);
});

test('a stale active projection cannot reopen any terminal state of the same auction', () => {
  const { page: api } = page();
  for (const status of ['ended_no_bids', 'settlement_pending', 'defaulted', 'sold']) {
    const terminal = api.projectedAuctionFromArtwork(projection({ status }));
    assert.equal(api.mergeProjectedAuction(terminal, projection()), terminal, status);
  }
});

test('bid monotonicity is retained within one round but not shared between chains or artworks', () => {
  const { page: api } = page();
  const current = api.projectedAuctionFromArtwork(projection({ current_bid: '0.2', highest_bid: '0.2', current_bidder: BIDDER }));
  assert.equal(api.mergeProjectedAuction(current, projection()).highestBid, '0.2');
  for (const identity of [{ chain_id: 11155111 }, { artwork_id: '29' }]) {
    const result = api.mergeProjectedAuction(current, projection(identity));
    assert.equal(result.highestBid, '0');
    assert.equal(result.highestBidder, ZERO_ADDRESS);
  }
});

test('live first-bid polling advances the displayed minimum and prefill beyond the initial RPC quote', async () => {
  const initial = projection({ artwork_id: '14', auction_id: '75', active_auction_id: '75' });
  let live = {
    bids: [{ bidder: BIDDER, bid_amount: '0.001', block_number: 56674116, log_index: 1 }],
    auction: { ...initial, current_bid: '0.001', highest_bid: '0.001', current_bidder: BIDDER }
  };
  const { page: api, state } = page({ getLiveAuctionActivity: async () => live });
  await api.applyLiveAuctionProjection(initial);
  api.setAuction(current => ({ ...current, minimumBid: '0.001', requiredNextBid: '0.001', minimum_bid: '0.001' }));
  assert.equal(api.calculateMinimumBidDetails(state.auction).eth, '0.001');

  await api.refreshLiveBidActivity();
  assert.equal(state.auction.highestBid, '0.001');
  assert.equal(state.bidActivity.length, 1);
  assert.equal(api.calculateMinimumBidDetails(state.auction).wei, 11000000000000000n);
  assert.equal(api.calculateMinimumBidDetails(state.auction).eth, '0.011');

  let bidAmount = '0.001';
  api.setBidAmount = update => { bidAmount = update(bidAmount); };
  api.isAuctionClosedForBidding = () => false;
  api.useEffect = effect => effect();
  const prefillEffect = source.match(/useEffect\(\(\) => \{\s*if \(!auction \|\| isAuctionClosedForBidding\(auction\)\) return;\s*const minimumBidDetails = calculateMinimumBidDetails\(auction\);[\s\S]*?\}, \[auction\]\);/);
  assert.ok(prefillEffect, 'the shipped auction-change effect updates the bid prefill');
  vm.runInContext(prefillEffect[0], api);
  assert.equal(bidAmount, '0.011');
  bidAmount = '0.02';
  vm.runInContext(prefillEffect[0], api);
  assert.equal(bidAmount, '0.02', 'a valid higher user amount is retained');

  live = { bids: [], auction: initial };
  await api.refreshLiveBidActivity();
  assert.equal(state.auction.highestBid, '0.001', 'an older indexer response cannot lower the bid');
  assert.equal(api.calculateMinimumBidDetails(state.auction).eth, '0.011');
});

test('minimum quotes remain valid for unchanged bids and reset with newer bids or auction rounds', () => {
  const { page: api } = page();
  const current = {
    ...api.projectedAuctionFromArtwork(projection({ current_bid: '0.4', highest_bid: '0.4' })),
    minimumBid: '0.410000000000000002', requiredNextBid: '0.410000000000000002'
  };
  for (const highestBid of ['0.4', '0.1']) {
    const unchanged = api.mergeProjectedAuction(current, projection({ current_bid: highestBid, highest_bid: highestBid }));
    assert.equal(api.calculateMinimumBidDetails(unchanged).eth, '0.410000000000000002',
      'keep a contract quote ahead of an unchanged or lagging projection');
  }
  const quoteAhead = { ...current, minimumBid: '0.512500000000000002', requiredNextBid: '0.512500000000000002' };
  const partlyCaughtUp = api.mergeProjectedAuction(quoteAhead,
    projection({ current_bid: '0.400000000000000001', highest_bid: '0.400000000000000001' }));
  assert.equal(api.calculateMinimumBidDetails(partlyCaughtUp).eth, '0.512500000000000002',
    'a partial indexer catch-up cannot lower a newer contract quote');
  const advanced = api.mergeProjectedAuction(current,
    projection({ current_bid: '1.000000000000000001', highest_bid: '1.000000000000000001' }));
  assert.equal(api.calculateMinimumBidDetails(advanced).eth, '1.025000000000000002',
    'the new bid uses the exact contract ceiling rule');
  const nextRound = api.mergeProjectedAuction(advanced, projection({ auction_id: '64', start_price: '0.002' }));
  assert.equal(api.calculateMinimumBidDetails(nextRound).eth, '0.002', 'a new round does not inherit the previous minimum');
});

test('two artwork loads finishing in reverse order retain the latest artwork, auction, and page title', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { page: api, state } = page({ getArtwork: () => ++calls === 1 ? first.promise : second.promise });
  const oldLoad = api.loadArtwork();
  const newLoad = api.loadArtwork();
  second.resolve(projection({ title: 'Latest round' }));
  assert.equal(await newLoad, true);
  first.resolve(projection({ auction_id: '35', title: 'Stale round' }));
  assert.equal(await oldLoad, false);
  assert.equal(state.artwork.auction_id, '63');
  assert.equal(state.auction.auctionId, '63');
  assert.equal(state.error, null);
  assert.equal(state.loading, false);
  assert.equal(api.document.title, 'Latest round - ArtSoul');
});

test('provenance starts alongside the artwork but cannot reveal a failed or still-pending artwork', async () => {
  for (const fail of [false, true]) {
    const artwork = deferred(), history = deferred(); let reads = 0;
    const {page: api, state} = page({getArtwork: () => artwork.promise,
      getArtworkProvenance: ({chain_id, artwork_id}) => {
        assert.equal(chain_id, 84532); assert.equal(artwork_id, '28'); reads++; return history.promise;
      }});
    const work = api.loadArtwork();
    await new Promise(resolve => setImmediate(resolve));
    const startedWhileArtworkPending = reads;
    history.resolve({events: [{kind:'indexed'}], complete:true});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.provenanceState.status, undefined, 'history is not revealed before the canonical artwork');
    if (fail) artwork.reject(new Error('Artwork unavailable')); else artwork.resolve(projection());
    await work;
    assert.equal(startedWhileArtworkPending, 1, 'independent history request must not wait for artwork metadata');
    assert.equal(reads, 1, 'the parallel response is reused');
    assert.equal(state.provenanceState.status, fail ? undefined : 'ready');
  }
});

test('a failed parallel provenance read does not fail the primary artwork', async () => {
  const {page: api, state} = page({getArtwork: async () => projection(),
    getArtworkProvenance: async () => {throw new Error('History temporarily unavailable');}});
  assert.equal(await api.loadArtwork(), true);
  assert.equal(state.loading, false);
  assert.equal(state.provenanceState.status, 'unavailable');
});

test('an obsolete failed artwork read cannot replace a newer successful page with an error', async () => {
  const first = deferred();
  let calls = 0;
  const { page: api, state } = page({ getArtwork: () => ++calls === 1 ? first.promise : Promise.resolve(projection()) });
  const oldLoad = api.loadArtwork();
  assert.equal(await api.loadArtwork(), true);
  first.reject(new Error('Old request failed'));
  assert.equal(await oldLoad, false);
  assert.equal(state.error, null);
  assert.equal(state.artwork.auction_id, '63');
});

test('late profile and provenance hydration from an older load cannot overwrite the new load', async () => {
  const oldProfile = deferred();
  const oldProvenance = deferred();
  const profileRequested = deferred();
  let profileCalls = 0;
  let provenanceCalls = 0;
  const { page: api, state } = page({
    getArtwork: async () => projection({ creator_id: CREATOR }),
    getProfile: () => {
      profileRequested.resolve();
      return ++profileCalls === 1 ? oldProfile.promise : Promise.resolve({ username: 'Current identity' });
    },
    getArtworkProvenance: () => ++provenanceCalls === 1 ? oldProvenance.promise : Promise.resolve({ events: [{ kind: 'current' }], complete: true })
  });
  const oldLoad = api.loadArtwork();
  // Wait until the first load has entered its independent enrichment requests.
  await Promise.race([profileRequested.promise, oldLoad.then(() => assert.fail('The profile request was not issued'))]);
  assert.equal(profileCalls, 1);
  assert.equal(await api.loadArtwork(), true);
  oldProfile.resolve({ username: 'Stale identity' });
  oldProvenance.resolve({ events: [{ kind: 'stale' }], complete: true });
  await oldLoad;
  assert.equal(state.creatorProfile.username, 'Current identity');
  assert.deepEqual(plain(state.provenanceState.events), [{ kind: 'current' }]);
});

test('a same-artwork refresh retains the hydrated creator while the next profile read is pending', async () => {
  const pending = deferred(); let reads = 0;
  const profile = {wallet_address: CREATOR, username: 'Artist', avatar_url: '/artist.png'};
  const {page: api, state} = page({getArtwork: async () => projection({creator_id: CREATOR}),
    getProfile: async () => ++reads === 1 ? profile : pending.promise});
  await api.loadArtwork();
  assert.equal(state.creatorProfile, profile);
  const refresh = api.loadArtwork(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.creatorProfile, profile, 'a sparse projection does not replace the resolved avatar');
  pending.resolve(profile); await refresh;
});

test('exact role identities seed before content and confirmed missing profiles do not trigger another lookup', async () => {
  const OWNER = `0x${'ef'.repeat(20)}`;
  const identities = {
    [CREATOR]: {wallet_address: CREATOR, username: 'Artist', avatar_url: '/artist.png'},
    [BIDDER]: {wallet_address: BIDDER, username: 'Collector', avatar_url: '/collector.png'},
    [OWNER]: null
  };
  let reads = 0;
  const {page: api, state, writes} = page({
    getArtwork: async () => projection({creator_id: CREATOR, auction_winner_address: BIDDER,
      current_owner_address: OWNER, ownership_profiles: identities}),
    getProfile: async () => {reads++; throw new Error('Covered identity must not be requested again');}
  });
  await api.loadArtwork();
  assert.equal(reads, 0);
  assert.equal(state.creatorProfile.username, 'Artist');
  assert.equal(state.auctionWinnerProfile.username, 'Collector');
  assert.equal(state.currentOwnerProfile.wallet_address, OWNER);
  assert.equal(state.currentOwnerProfile.username, '');
  for (const setter of ['creatorProfile', 'auctionWinnerProfile', 'currentOwnerProfile', 'resolvedProfileAddresses']) {
    assert(writes.indexOf(setter) < writes.indexOf('loading'), setter + ' is committed before content');
  }
  assert.deepEqual([...state.resolvedProfileAddresses].sort(), Object.keys(identities).sort());
});

test('an uncovered role profile resolves independently while another profile remains slow', async () => {
  const slow = deferred(), started = deferred();
  const {page: api, state} = page({
    getArtwork: async () => projection({creator_id: CREATOR, auction_winner_address: BIDDER}),
    getProfile: address => address === CREATOR ? slow.promise : (started.resolve(), Promise.resolve({wallet_address: BIDDER, username: 'Collector'}))
  });
  const work = api.loadArtwork();
  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.auctionWinnerProfile.username, 'Collector');
  assert.equal(state.resolvedProfileAddresses.has(BIDDER), true);
  assert.equal(state.resolvedProfileAddresses.has(CREATOR), false);
  slow.resolve({wallet_address: CREATOR, username: 'Artist'});
  await work;
  assert.equal(state.creatorProfile.username, 'Artist');
});

test('bid history reuses exact role profiles, including confirmed absence', async () => {
  let reads = 0, rendered;
  const hydrate = vm.runInNewContext(`(${pageFunction('hydrateBidderProfiles')})`, {
    bidderProfileCacheRef: {current: new Map()}, console: quiet,
    window: {ArtSoulDB: {getProfile: async () => {reads++;}}},
    setBidderProfiles: update => {rendered = update({});}
  });
  await hydrate([{bidder: BIDDER}, {bidder: CREATOR}], {
    [BIDDER]: {wallet_address: BIDDER, username: 'Collector'}, [CREATOR]: null
  });
  assert.equal(reads, 0);
  assert.equal(rendered[BIDDER].username, 'Collector');
  assert.equal(rendered[CREATOR], null);
});

test('a new auction resets its bid cursor and ignores a late live response from the previous auction', async () => {
  const delayed = deferred();
  const requests = [];
  const { page: api, state } = page({ getLiveAuctionActivity: options => { requests.push(options); return delayed.promise; } });
  await api.applyLiveAuctionProjection(projection({ auction_id: '35', bids: [{ bidder: BIDDER, block_number: 12, log_index: 1 }] }));
  const poll = api.refreshLiveBidActivity();
  assert.equal(requests[0].auction_id, '35');
  assert.equal(requests[0].after_block, 12);
  await api.applyLiveAuctionProjection(projection());
  assert.equal(api.bidCursorRef.current, null);
  delayed.resolve({ bids: [{ bidder: BIDDER, block_number: 13, log_index: 1 }], auction: projection({ auction_id: '35', current_bid: '100' }) });
  await poll;
  assert.equal(state.auction.auctionId, '63');
  assert.equal(state.auction.currentBid, '0');
  assert.equal(state.bidActivity.length, 0);
  assert.equal(api.bidCursorRef.current, null);
  assert.equal(api.bidPollInFlightRef.current, false);
});

test('starting another artwork load invalidates an in-flight poll even before the auction identity changes', async () => {
  const delayed = deferred();
  const { page: api, state } = page({ getLiveAuctionActivity: () => delayed.promise });
  await api.applyLiveAuctionProjection(projection());
  const poll = api.refreshLiveBidActivity();
  api.artworkLoadSequenceRef.current += 1;
  delayed.resolve({ bids: [{ bidder: BIDDER, block_number: 10, log_index: 0 }], auction: projection({ current_bid: '99' }) });
  await poll;
  assert.equal(state.bidActivity.length, 0);
  assert.equal(state.auction.currentBid, '0');
  assert.equal(api.bidPollInFlightRef.current, false);
});

test('a temporary refresh outage retains a loaded terminal page and retry clears the warning', async () => {
  let fail = false;
  const { page: api, state } = page({ getArtwork: async () => {
    if (fail) throw Object.assign(new Error('Offline'), { code: 'ARTWORK_READ_UNAVAILABLE' });
    return projection({ status: 'ended_no_bids', pending_auction_sync: true });
  } });
  await api.loadArtwork();
  const loaded = state.artwork;
  fail = true;
  assert.equal(await api.loadArtwork(), false);
  assert.equal(state.artwork, loaded);
  assert.equal(state.auction.ended, true);
  assert.equal(state.error, null);
  assert.match(state.refreshError, /could not be refreshed/);
  fail = false;
  await api.loadArtwork();
  assert.equal(state.refreshError, '');
});

test('initial read failures and a successful unavailable projection never pretend to be a retained page', async () => {
  let unavailable = Object.assign(new Error('Offline'), { code: 'ARTWORK_READ_UNAVAILABLE' });
  const { page: api, state } = page({ getArtwork: async () => {
    if (unavailable) throw unavailable;
    return projection();
  } });
  await api.loadArtwork();
  assert.equal(state.error, 'Offline');
  unavailable = null;
  await api.loadArtwork();
  unavailable = Object.assign(new Error('No visible projection'), { code: 'V41_ARTWORK_NOT_INDEXED' });
  await api.loadArtwork();
  assert.equal(state.error.code, 'V41_ARTWORK_NOT_INDEXED');
  assert.equal(state.refreshError, '');
});

test('a suppressed artwork exits the pending loader and renders neutral unavailable actions', async () => {
  let available = true;
  const { page: api, state } = page({ getArtwork: async () => {
    if (available) return projection();
    throw Object.assign(new Error('This artwork is currently unavailable.'), { code: 'ARTWORK_UNAVAILABLE' });
  } });
  await api.loadArtwork();
  assert(state.artwork && state.auction, 'start with an already visible auction');
  available = false;
  assert.equal(await api.loadArtwork(), false);
  assert.equal(state.loading, false);
  assert.equal(state.error.code, 'ARTWORK_UNAVAILABLE');
  assert.equal(state.artwork, null);
  assert.equal(state.auction, null, 'hidden artwork stops the live auction poll');
  assert.equal(api.loadedArtworkIdRef.current, null);

  const retryGuard = source.indexOf("if (error?.code !== 'V41_ARTWORK_NOT_INDEXED'");
  const retryStart = source.lastIndexOf('useEffect(() => {', retryGuard);
  const retryEnd = source.indexOf('}, [artworkId, error?.code, isV41CompositeId, projectionRetryCount]);', retryStart);
  assert(retryStart >= 0 && retryEnd > retryStart);
  const timers = [];
  vm.runInNewContext(source.slice(retryStart, retryEnd + '}, [artworkId, error?.code, isV41CompositeId, projectionRetryCount]);'.length), {
    useEffect: effect => effect(), error: state.error, artworkId: api.artworkId, isV41CompositeId: true,
    projectionRetryCount: 0, PROJECTION_RETRY_DELAYS_MS: [400], setTimeout: (...args) => timers.push(args),
    document: { visibilityState: 'visible' }
  });
  assert.equal(timers.length, 0, 'unavailable artwork schedules no indexer retry');

  const start = source.indexOf("            if (loading || error?.code === 'V41_ARTWORK_NOT_INDEXED') {");
  const end = source.indexOf('            if (!artwork) {', start);
  const { transformWithOxc } = await import('vite');
  const compiled = await transformWithOxc(`function view() {${source.slice(start, end)}}`, 'unavailable-view.jsx', { jsx: { runtime: 'classic' } });
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const context = vm.createContext({ React, loading: state.loading, error: state.error });
  vm.runInContext(compiled.code, context);
  const markup = renderToStaticMarkup(React.createElement(context.view));
  assert.match(markup, /Artwork unavailable/);
  assert.match(markup, /This artwork is currently unavailable\./);
  assert.match(markup, /href="\/gallery"/);
  assert.match(markup, /Retry/);
  assert.doesNotMatch(markup, /Loading artwork|indexer|projection|hidden|moderation|aria-busy/);
  available = true;
  assert.equal(await api.loadArtwork(), true);
  assert.equal(state.error, null);
  assert.equal(state.artwork.id, 'v41:84532:28');
});
