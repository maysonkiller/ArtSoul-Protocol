const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const upload = fs.readFileSync('src/entries/upload.js', 'utf8');
const uploadHtml = fs.readFileSync('upload.html', 'utf8');

test('an artwork whose auction failed can still be given one', () => {
  // Publishing is two transactions. The first is permanent the moment it
  // confirms, so a second one that fails leaves a real artwork on chain with no
  // auction. The failure message sent people to their profile for a retry that
  // did not exist: handleCreateAuction was declared and never called, and the
  // card was only a link. Confirmed on artwork 31, status "registered",
  // creator_value "0", no auction id.
  assert.match(profile, /const canStartAuction = isOwnProfile/);
  assert.match(profile, /handleStartAuction\(artwork\)/);
  assert.match(profile, /async function handleStartAuction\(artwork\)/);
  assert.ok(
    (profile.match(/handleCreateAuction/g) || []).length >= 2,
    'handleCreateAuction must actually be called, not only declared'
  );
});

test('the retry is offered only where it can work', () => {
  const start = profile.indexOf('const canStartAuction');
  const block = profile.slice(start, profile.indexOf(';', profile.indexOf('auction_id', start)) + 1);
  assert.match(block, /isOwnProfile/, 'only on your own profile');
  assert.match(block, /isBaseSepoliaArtwork\(artwork\)/, 'only on the active testnet');
  assert.match(block, /=== 'registered'/, 'only before an auction exists');
  assert.match(block, /active_auction_id \?\? artwork\.auction_id/, 'and only with no auction id');
});

test('the auction takes its price and duration from the person, not from a record that has none', () => {
  // creator_value is 0 for exactly these artworks: the price only ever reaches
  // the chain through the auction call that failed.
  assert.match(profile, /async function handleCreateAuction\(artwork, \{ startingPrice, durationHours \} = \{\}\)/);
  assert.match(profile, /createAuction\(\s*artwork\.blockchain_id,\s*String\(startingPrice\),\s*Number\(durationHours\)/);
  assert.doesNotMatch(profile, /artwork\.creator_value\.toString\(\)/);
  // Canon rule 3: 24 / 36 / 48 only, and a starting price above zero.
  assert.match(profile, /!\[24, 36, 48\]\.includes\(Number\(durationHours\)\)/);
  assert.match(profile, /!\(parseFloat\(startingPrice\) > 0\)/);
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
  assert.match(upload, /use Start auction on this artwork to finish it/);
  assert.match(profile, />\s*Start auction\s*</);
});
