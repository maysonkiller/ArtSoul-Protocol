import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    isWalletStateSettled,
    resolveProfileOwnership
} from '../src/features/profile/profile-ownership.js';

const OWNER = '0x6EC8C121043357aC231E36D403EdAbf90AE6989B';
const OTHER = '0x1111111111111111111111111111111111111111';

test('an address in the URL is not evidence that the wallet settled', () => {
    // A-50. Reaching your own profile from an artwork navigates to
    // /profile?address=<own wallet>. The presence of that parameter used to open
    // the settlement guard immediately, so ownership was decided against an empty
    // wallet address and Edit Profile disappeared.
    assert.equal(isWalletStateSettled({ settledFlag: false, walletEvent: null }), false);
    assert.equal(isWalletStateSettled({ settledFlag: false, walletEvent: {} }), false);
    assert.equal(isWalletStateSettled({ settledFlag: true }), true);
    // A finalized guest state is settlement too: isConnected false is an answer.
    assert.equal(isWalletStateSettled({ walletEvent: { isConnected: false } }), true);
    assert.equal(isWalletStateSettled({ walletEvent: { isConnected: true, address: OWNER } }), true);
});

test('ownership stays undecided until the wallet settles', () => {
    // null is "not decided yet", distinct from false. Committing false here is
    // what survived until a later wallet event that may never fire, because the
    // state can settle before the profile page mounts.
    assert.equal(resolveProfileOwnership({
        walletSettled: false,
        viewedAddress: OWNER,
        confirmedAddress: ''
    }), null);
    assert.equal(resolveProfileOwnership({
        walletSettled: false,
        viewedAddress: OWNER,
        confirmedAddress: OWNER
    }), null);
});

test('own profile opened with an explicit address resolves to the owner', () => {
    assert.equal(resolveProfileOwnership({
        walletSettled: true,
        viewedAddress: OWNER,
        confirmedAddress: OWNER
    }), true);
    // Checksum casing differs between the URL and the provider; compare normalized.
    assert.equal(resolveProfileOwnership({
        walletSettled: true,
        viewedAddress: OWNER.toLowerCase(),
        confirmedAddress: OWNER.toUpperCase().replace('0X', '0x')
    }), true);
});

test('another wallet profile and disconnected viewers are never owners', () => {
    assert.equal(resolveProfileOwnership({
        walletSettled: true,
        viewedAddress: OTHER,
        confirmedAddress: OWNER
    }), false);
    // Settled guest: no connected wallet, so no owner-only action anywhere.
    assert.equal(resolveProfileOwnership({
        walletSettled: true,
        viewedAddress: OWNER,
        confirmedAddress: ''
    }), false);
});

test('the profile entry fails closed and no longer conflates the two signals', () => {
    const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
    // Never render an owner-only affordance that has not been verified.
    assert.match(source, /const \[isOwnProfile, setIsOwnProfile\] = useState\(false\);/);
    // The retired conflation must not come back in either form.
    assert.doesNotMatch(source, /stateIsSettled\s*=\s*Boolean\(viewAddress\)/);
    assert.doesNotMatch(source, /Boolean\(viewAddress\)\s*\|\|\s*window\.artsoulWalletStateSettled/);
    // Both decision sites go through the shared helpers.
    assert.match(source, /import \{ isWalletStateSettled, resolveProfileOwnership \}/);
    assert.equal(source.match(/resolveProfileOwnership\(\{/g).length, 2);
    // Undecided is never committed as ownership.
    assert.match(source, /if \(ownership !== null\) \{/);
    assert.match(source, /if \(isOwn !== null\) \{/);
});

test('profile restoration may prefetch public data but cannot grant ownership', () => {
    const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
    const restoreBranch = source.match(/else if \(hasInitialWalletHint\) \{[\s\S]*?loadProfile\(restoringAddress, \{ walletSettled: false \}\);[\s\S]*?\n\s*\}/)?.[0] || '';

    assert.match(restoreBranch, /initialWalletHint\.toLowerCase\(\)/);
    assert.match(restoreBranch, /loadProfile\(restoringAddress, \{ walletSettled: false \}\)/);
    assert.doesNotMatch(restoreBranch, /setIsOwnProfile\(true\)/);
    assert.match(source, /!connectedWalletAddress && !profile\?\.wallet_address/);
});
