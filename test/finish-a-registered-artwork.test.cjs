const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const upload = fs.readFileSync('src/entries/upload.js', 'utf8');
const uploadHtml = fs.readFileSync('upload.html', 'utf8');
const cards = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');

test('an artwork whose auction failed can still be given one', () => {
  // Publishing is two transactions. The first is permanent the moment it
  // confirms, so a second one that fails leaves a real artwork on chain with no
  // auction. The failure message sent people to their profile for a retry that
  // did not exist: handleCreateAuction was declared and never called, and the
  // card was only a link. Confirmed on artwork 31, status "registered",
  // creator_value "0", no auction id.
  // Owner controls live on artwork detail; the preview menu is Donate/Report.
  assert.match(profile, /const href = getProfileArtworkHref\(artwork\);/);
  assert.match(profile, /href=\{href\}/);
  assert.match(artwork, /onClick=\{openNewAuctionModal\}/);
  assert.match(artwork, /get\('action'\) !== 'create-auction'/);
  assert.match(artwork, /void openNewAuctionModal\(\)/);
});

test('the retry is offered only where it can work', () => {
  // A-77 widened this. The original condition covered only the failed second
  // transaction - status `registered`, no auction id. An auction that ran and
  // ended with no bids leaves the artwork in the same position the contract
  // cares about (unminted, `activeAuctionId == 0`), but its status is
  // `defaulted`, so the retry was refused in the one state it was most needed.
  // The lifecycle now decides; the auction id no longer does, because that is
  // the field the projection had wrong.
  assert.doesNotMatch(cards, /label: 'Start auction'|label: 'Manage artwork'/);
  assert.match(artwork, /const canCreateNewAuction = artworkWriteEnabled &&/);
  assert.match(artwork, /canCreateNewAuctionForWallet\(artwork, connectedWalletAddress\)/);
  // Which lifecycle states qualify, per wallet role, is proven behaviorally in
  // profile-lifecycle-action-gating.test.cjs rather than by matching source.
});

test('the auction takes its price and duration from the person, not from a record that has none', () => {
  // creator_value is 0 for exactly these artworks: the price only ever reaches
  // the chain through the auction call that failed.
  assert.match(artwork, /parseUserEthAmount\(newAuctionPrice\)/);
  assert.match(artwork, /createAuction\(\s*artwork\.blockchain_id,\s*startingPrice\.eth,\s*Number\(newAuctionDuration\)/);
  assert.doesNotMatch(profile, /artwork\.creator_value\.toString\(\)/);
  // Canon rule 3: 24 / 36 / 48 only, and a starting price above zero.
  assert.match(artwork, /!\[24, 36, 48\]\.includes\(Number\(newAuctionDuration\)\)/);
  assert.doesNotMatch(profile.slice(profile.indexOf('async function handleStartAuction('), profile.indexOf('async function handleDeleteArtwork(')), /prompt\(|parseFloat/);
});

test('the reason a publish was refused appears where the click was', () => {
  // It was written into publishBlockedNote beside the AI panel near the top of
  // the form while the page scrolled to the offending field, so someone at the
  // Publish button saw a highlight and no explanation anywhere near them.
  assert.match(upload, /const hint = document\.getElementById\('publishReadinessHint'\);[\s\S]{0,120}hint\.dataset\.blocked = 'true';/);
  assert.match(upload, /if \(hint\) delete hint\.dataset\.blocked;/);
  // And it reads as a statement rather than as fine print.
  assert.match(uploadHtml, /\.publish-readiness-hint\[data-blocked="true"\] \{/);
  const styled = uploadHtml.slice(uploadHtml.indexOf('.publish-readiness-hint[data-blocked="true"]'));
  assert.match(styled.slice(0, 400), /font-size: 0\.9rem;/);
  assert.doesNotMatch(styled.slice(0, 400), /#[0-9a-fA-F]{3,8}\b/, 'canon 16: no theme hex outside the variables');
});

test('the failure message names a control that exists', () => {
  // It used to say "Retry the auction from your profile" while nothing in the
  // profile could do that.
  assert.doesNotMatch(upload, /Retry the auction from your profile/);
  assert.match(upload, /Open the artwork from your profile, then select Create New Auction on its page/);
  assert.match(artwork, /auctionCreationChecking \? 'Checking auction eligibility…' : 'Create New Auction'/);
});
