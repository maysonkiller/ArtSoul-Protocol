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
  'getAuctionHighestBidWei', 'projectedAuctionFromArtwork', 'mergeProjectedAuction',
  'bidIdentity', 'advanceBidCursor', 'applyLiveAuctionProjection', 'refreshLiveBidActivity',
  'getAuctionActionId', 'isZeroAddress', 'isSameAddress', 'hasProtocolId', 'loadArtwork'
];

function page({ getArtwork, getLiveAuctionActivity, getProfile, getArtworkProvenance, hydrateBidderProfiles } = {}) {
  const state = { bidActivity: [], newAuctionPrice: '', resolvedProfileAddresses: new Set(), provenanceState: {} };
  const writes = [];
  const context = vm.createContext({
    console: quiet, ZERO_ADDRESS, WEI_PER_ETH: 10n ** 18n,
    artworkId: 'v41:84532:28', isV41CompositeId: true,
    artwork: projection(), auction: null,
    artworkLoadSequenceRef: { current: 0 }, liveAuctionIdentityRef: { current: '' }, loadedArtworkIdRef: { current: null },
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
    };
  }
  vm.runInContext(functionNames.map(pageFunction).join('\n'), context, { filename: 'shipped-artwork-functions.js' });
  return { page: context, state, writes };
}

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
