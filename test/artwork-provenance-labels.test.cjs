// Phase A6: the artwork page must render canonical provenance labels
// (Creator / First Collector / Owner) from indexer-backed projection fields
// only. These assertions are scoped to the exact JSX blocks that render
// provenance, mirroring the repo's entry-source test pattern.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const artwork = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'artwork.jsx'), 'utf8');

function between(start, end) {
  const from = artwork.indexOf(start);
  const to = artwork.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `Missing ${start}`);
  assert.notEqual(to, -1, `Missing ${end}`);
  return artwork.slice(from, to);
}

test('ownership panel uses the exact canonical labels', () => {
  const panel = between('{/* Ownership Info - Three Roles */}', 'artwork-ownership-actions');
  assert.match(panel, /label: 'Creator'/);
  assert.match(panel, /label: 'First Collector'/);
  assert.match(panel, /label: 'Owner'/);
  // The pre-settlement role is a bidder, never a collector.
  assert.match(panel, /label: 'Highest Bidder'/);
  assert.doesNotMatch(panel, /label: '(Winner|Auctioner)'/);
});

test('First Collector renders only after mint and only from the settlement projection', () => {
  const panel = between('{/* Ownership Info - Three Roles */}', 'artwork-ownership-actions');
  assert.match(
    panel,
    /mintedArtwork && renderOwnershipRole\(\{\s*label: 'First Collector',\s*address: artwork\.auction_winner_address/,
    'First Collector must be gated on mint and bound to auction_winner_address'
  );
  // The Highest Bidder row is confined to the open settlement window.
  assert.match(panel, /awaitingPayment && !isSameAddress\(creatorAddress, winnerAddress\) && renderOwnershipRole/);
});

test('resale modal Owner comes from the projection, never the connected wallet', () => {
  const modal = between('isResaleModalOpen && (() => {', '<label className="resale-field-label"');
  assert.match(modal, /const resaleOwnerAddress = artwork\.current_owner_address \|\| ''/);
  assert.doesNotMatch(
    modal,
    /resaleOwnerAddress = [^;]*connectedWalletAddress/,
    'Owner display must not fall back to the connected wallet'
  );
});

test('page-level owner facts derive from current_owner_address, not wallet state', () => {
  const derivation = between('const winnerAddress =', 'const resaleEligibility =');
  assert.match(derivation, /const ownerAddress = artwork\.current_owner_address;/);
  assert.doesNotMatch(derivation, /ownerAddress = [^;]*connectedWalletAddress/);
});
