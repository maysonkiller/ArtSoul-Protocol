const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const menu = fs.readFileSync('avatar-dropdown.js', 'utf8');
const css = fs.readFileSync('unified-styles.css', 'utf8');

test('Admin access shortcut is in the own Profile, never in the account popover', () => {
    assert.match(profile, /function ProfileAdminShortcut\(\{ walletAddress \}\)/);
    assert.match(profile, /\{isOwnProfile && \([\s\S]*?<ProfileAdminShortcut walletAddress=\{connectedWalletAddress\}/);
    assert.match(profile, /href="\/admin" className="profile-admin-shortcut"/);
    assert.doesNotMatch(menu, /<a href="\/admin"/);
    assert.match(menu, /data-protocol-admin-slot hidden/);
    assert.match(css, /\.profile-admin-shortcut \{[\s\S]*?min-height: 44px/);
});

test('Profile Admin confirmation uses existing server-owned decision and fail-closed account identity', () => {
    const segment = profile.slice(profile.indexOf('function ProfileAdminShortcut'), profile.indexOf('function ProfilePage'));
    assert.match(segment, /AvatarDropdown\?\.requestProtocolAdminAccessOnce\?\.\(\)/);
    assert.match(segment, /AvatarDropdown\?\.protocolAdminEligible === true/);
    assert.match(segment, /getAuthenticatedWallet\?\.\(\)/);
    assert.match(segment, /artsoulWalletStateSettled === true/);
    assert.match(segment, /artsoulSettledWalletState\?\.isConnected === true/);
    assert.match(segment, /authorizedWallet !== expected \|\| live !== expected \|\| signedIn !== expected/);
    assert.match(segment, /generation\+\+/);
    assert.match(segment, /window\.addEventListener\('artsoul:wallet-state-changed', refresh\)/);
    assert.match(segment, /window\.addEventListener\('artsoul:auth-state-changed', refresh\)/);
    assert.match(segment, /window\.addEventListener\('storage', onStorage\)/);
    assert.doesNotMatch(segment, /localStorage|adminWallets|hardcodedAddresses|role === 'admin'/);
});

test('tap-to-copy wallet popover is concise and retains the full source address', () => {
    assert.match(menu, /this\.shortWalletAddress\(identity\.wallet\)/);
    assert.match(menu, /data-wallet-address="\$\{escapeMenuText\(identity\.wallet\)\}"/);
    assert.match(menu, /aria-label="Copy wallet address /);
    assert.doesNotMatch(menu, />Copy address<|>Admin panel</);
    assert.match(css, /\.avatar-menu-copy-status \{[\s\S]*?position: absolute !important/);
    assert.match(css, /width: min\(252px, calc\(100vw - 24px\)\)/);
});
