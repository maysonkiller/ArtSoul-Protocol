// Phase A6 (issue #121): Profile > Owned NFTs must include every minted
// artwork whose indexed current_owner_address equals the viewed profile —
// including a creator who legitimately bought their own mint back through
// a completed resale. Pending settlement and wallet state never qualify.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const profile = fs.readFileSync(path.join(root, 'src', 'entries', 'profile.jsx'), 'utf8');

// Extracts a named function's full source by balanced-brace scanning so the
// real profile logic runs behaviorally instead of being re-implemented here.
function extractFunction(name) {
  const start = profile.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let depth = 0;
  // Skip default-parameter braces: the body starts after the parameter list.
  let index = profile.indexOf('{', profile.indexOf(')', start));
  for (; index < profile.length; index++) {
    if (profile[index] === '{') depth++;
    else if (profile[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return profile.slice(start, index + 1);
}

const sandbox = vm.createContext({ window: {}, exported: {} });
vm.runInContext([
  extractFunction('normalizeAddress'),
  extractFunction('isZeroProtocolId'),
  extractFunction('isMintedArtwork'),
  extractFunction('hasActiveAuction'),
  extractFunction('isSoldOrSettledArtwork'),
  extractFunction('isLiveAuctionArtwork'),
  extractFunction('isCollectedArtwork'),
  extractFunction('filterCanonicalProfileArtworks'),
  'exported.isCollectedArtwork = isCollectedArtwork;',
  'exported.filterCanonicalProfileArtworks = filterCanonicalProfileArtworks;'
].join('\n'), sandbox, { filename: 'profile.jsx (extracted)' });

const { isCollectedArtwork, filterCanonicalProfileArtworks } = sandbox.exported;

const CREATOR = '0x1111111111111111111111111111111111111111';
const COLLECTOR = '0x2222222222222222222222222222222222222222';
const BIDDER = '0x4444444444444444444444444444444444444444';

function projected(overrides = {}) {
  return {
    source: 'v41_projection',
    creator: CREATOR,
    creator_id: CREATOR,
    ...overrides
  };
}

test('a normal collector-owned mint is Owned', () => {
  assert.equal(
    isCollectedArtwork(projected({ minted: true, token_id: '7', current_owner_address: COLLECTOR }), COLLECTOR),
    true
  );
});

test('a creator buyback via completed resale is Owned', () => {
  assert.equal(
    isCollectedArtwork(projected({ minted: true, token_id: '7', current_owner_address: CREATOR }), CREATOR),
    true
  );
});

test('a creator buyback appears in BOTH Created and Owned tabs', () => {
  const buyback = projected({
    id: 'v41:84532:7',
    minted: true,
    token_id: '7',
    auction_winner_address: COLLECTOR,
    current_owner_address: CREATOR
  });
  const created = filterCanonicalProfileArtworks([buyback], CREATOR, 'created');
  const owned = filterCanonicalProfileArtworks([buyback], CREATOR, 'collected');
  assert.equal(created.length, 1, 'Created Artworks must keep the buyback');
  assert.equal(owned.length, 1, 'Owned NFTs must include the buyback');
});

test('pending settlement never qualifies as Owned, even for the highest bidder', () => {
  const pending = projected({
    status: 'settlement_pending',
    winner: BIDDER,
    current_bidder: BIDDER,
    current_bid: '1',
    current_owner_address: null
  });
  assert.equal(isCollectedArtwork(pending, BIDDER), false);
  assert.equal(filterCanonicalProfileArtworks([pending], BIDDER, 'collected').length, 0);
});

test('a missing indexed owner is never replaced by the viewed or connected wallet', () => {
  const unindexed = projected({ minted: true, token_id: '7', current_owner_address: null });
  assert.equal(isCollectedArtwork(unindexed, COLLECTOR), false);
  // An empty profile address must not match an empty projection field.
  assert.equal(isCollectedArtwork(unindexed, ''), false);
});

test('the Owned filter reads only the indexed current_owner_address', () => {
  const fn = extractFunction('isCollectedArtwork');
  assert.match(fn, /current_owner_address/);
  assert.doesNotMatch(fn, /connectedWallet|localStorage|winner|bidder/);
});
