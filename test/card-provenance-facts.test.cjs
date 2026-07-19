// Phase A6 (issue #121): shared NFT cards must render compact Creator /
// First Collector / Owner facts from already-loaded indexer projection
// fields only — never fabricated, never inferred from bidders, pending
// winners, connected wallets, or browser storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'artwork-card.js'), 'utf8');

const context = vm.createContext({ window: { addEventListener: () => {} } });
vm.runInContext(source, context, { filename: 'src/ui/components/artwork-card.js' });
const { provenanceRoles } = context.window.ArtSoulArtworkCard;

const CREATOR = '0x1111111111111111111111111111111111111111';
const COLLECTOR = '0x2222222222222222222222222222222222222222';
const RESALE_BUYER = '0x3333333333333333333333333333333333333333';
const BIDDER = '0x4444444444444444444444444444444444444444';
const ZERO = '0x0000000000000000000000000000000000000000';

const short = value => `${value.slice(0, 8)}...${value.slice(-6)}`;

test('pre-mint card shows Creator only — no First Collector, no Owner', () => {
  const roles = provenanceRoles({ creator: CREATOR, status: 'registered' });
  assert.equal(roles.creator, short(CREATOR));
  assert.equal(roles.firstCollector, '');
  assert.equal(roles.owner, '');
});

test('minted primary settlement shows all three roles from the projection', () => {
  const roles = provenanceRoles({
    creator: CREATOR,
    minted: true,
    token_id: '7',
    auction_winner_address: COLLECTOR,
    current_owner_address: COLLECTOR
  });
  assert.equal(roles.creator, short(CREATOR));
  assert.equal(roles.firstCollector, short(COLLECTOR));
  assert.equal(roles.owner, short(COLLECTOR));
});

test('completed resale keeps First Collector and moves Owner to the buyer', () => {
  const roles = provenanceRoles({
    creator: CREATOR,
    minted: true,
    token_id: '7',
    auction_winner_address: COLLECTOR,
    current_owner_address: RESALE_BUYER
  });
  assert.equal(roles.firstCollector, short(COLLECTOR));
  assert.equal(roles.owner, short(RESALE_BUYER));
});

test('creator buyback keeps all three roles distinct and correctly valued', () => {
  const roles = provenanceRoles({
    creator: CREATOR,
    minted: true,
    token_id: '7',
    auction_winner_address: COLLECTOR,
    current_owner_address: CREATOR
  });
  assert.equal(roles.creator, short(CREATOR));
  assert.equal(roles.firstCollector, short(COLLECTOR));
  assert.equal(roles.owner, short(CREATOR));
});

test('pending settlement never surfaces the highest bidder as a role', () => {
  const roles = provenanceRoles({
    creator: CREATOR,
    status: 'settlement_pending',
    winner: BIDDER,
    current_bidder: BIDDER,
    highest_bidder: BIDDER,
    current_bid: '1'
  });
  assert.equal(roles.firstCollector, '');
  assert.equal(roles.owner, '');
});

test('minted card ignores auction winner/bidder fields that are not projections', () => {
  const roles = provenanceRoles({
    creator: CREATOR,
    minted: true,
    token_id: '7',
    winner: BIDDER,
    current_bidder: BIDDER,
    highest_bidder: BIDDER
  });
  assert.equal(roles.firstCollector, '');
  assert.equal(roles.owner, '');
});

test('missing or zero projection data renders nothing — no fallback of any kind', () => {
  const roles = provenanceRoles({
    creator: CREATOR,
    minted: true,
    token_id: '7',
    auction_winner_address: ZERO,
    current_owner_address: null
  });
  assert.equal(roles.firstCollector, '');
  assert.equal(roles.owner, '');
});

test('the card component never reaches for wallet, storage, or network data', () => {
  assert.doesNotMatch(source, /connectedWallet|localStorage|sessionStorage|ArtSoulDB|fetch\(|XMLHttpRequest/);
  const fn = source.slice(
    source.indexOf('function provenanceRoles'),
    source.indexOf('function provenanceLines')
  );
  assert.match(fn, /auction_winner_address/);
  assert.match(fn, /current_owner_address/);
  assert.doesNotMatch(fn, /highest_bidder|current_bidder|\bwinner\b/);
});

test('DOM cards render the exact canonical labels in provenance rows', () => {
  const lines = source.slice(
    source.indexOf('function provenanceLines'),
    source.indexOf('function identityKeys')
  );
  assert.match(lines, /label: 'Creator'/);
  assert.match(lines, /label: 'First Collector'/);
  assert.match(lines, /label: 'Owner'/);
  assert.doesNotMatch(lines, /Highest Bidder|Winner|Auctioner/);
});

test('homepage, gallery, and profile keep consuming the one shared card surface', () => {
  const homepage = fs.readFileSync(path.join(root, 'src', 'entries', 'index.js'), 'utf8');
  const gallery = fs.readFileSync(path.join(root, 'src', 'entries', 'gallery.jsx'), 'utf8');
  const profile = fs.readFileSync(path.join(root, 'src', 'entries', 'profile.jsx'), 'utf8');
  assert.match(homepage, /ArtSoulArtworkCard\.createCardElement\(/);
  assert.match(gallery, /ArtSoulArtworkCard\?\.ReactCard/);
  assert.match(profile, /ReactProvenance/);
  // Profile cards reuse the shared provenance renderer instead of a new
  // per-card data request.
  assert.match(profile, /SharedProvenance && <SharedProvenance artwork=\{artwork\} \/>/);
});
