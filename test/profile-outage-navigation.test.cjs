const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const start = source.indexOf('if (profileLoadError && !profile) {');
const end = source.indexOf('if (!viewAddress && !connectedWalletAddress && !profile?.wallet_address) {');
const outage = start >= 0 && end > start ? source.slice(start, end) : '';

test('B33: a failed initial profile read keeps retry and public navigation', () => {
    assert.ok(outage, 'expected initial-load failure branch');
    assert.match(outage, /role="alert"/);
    assert.match(outage, /onClick=\{retryProfile\}/);
    assert.match(outage, /href="\/gallery"/);
    assert.match(outage, /href="\/"/);
    assert.match(outage, /This does not mean your artworks were deleted\./);
});

test('B33: inaccessible profile data cannot display owner-only affordances', () => {
    assert.match(outage, /Editing and ownership-dependent actions remain unavailable/);
    assert.doesNotMatch(outage, /onClick=\{(?:saveProfile|handleDeleteArtwork|handleListForResale|handleStartAuction)\}/);
    assert.doesNotMatch(outage, /setIsOwnProfile\(true\)|setProfile\(/);
    assert.match(source, /const \[isOwnProfile, setIsOwnProfile\] = useState\(false\);/);
});

test('B33: retry stays user initiated and forces a fresh profile read', () => {
    const retry = source.match(/function retryProfile\(\) \{[\s\S]*?\n\s*\}/)?.[0] || '';
    assert.match(retry, /getViewAddress\(\) \|\| getActiveWalletAddress\(\)/);
    assert.match(retry, /loadProfile\(walletAddress, \{ force: true \}\)/);
    assert.doesNotMatch(outage, /setTimeout\(|setInterval\(|useEffect\(/);
});

test('B33: source failures are still reported, not replaced with fake profile data', () => {
    assert.match(source, /if \(profileResult\.status === 'rejected'\) throw profileResult\.reason;/);
    assert.match(source, /setProfileLoadError\('Your profile could not be loaded\. Please retry\.'\)/);
});
