const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const appKit = read('appkit-init.js');
const coreWallet = read('wallet-core-connect.js');
const avatar = read('avatar-dropdown.js');

test('core session restore distinguishes "no session" from a restore error', () => {
    assert.match(coreWallet, /export async function restoreCoreSessionOutcome/);
    assert.match(coreWallet, /\{ status: 'none', session: null \}/);
    assert.match(coreWallet, /\{ status: 'restored', session: restored \}/);
    assert.match(coreWallet, /\{ status: 'error', session: null, error \}/);
    // The legacy API stays for the isolation page.
    assert.match(coreWallet, /export async function restoreCoreSession\(/);
    assert.match(appKit, /restoreCoreSessionOutcome,/);
});

test('restore race: no page-load timer decides "disconnected" before the core restore settles', () => {
    // The restore starts as early as possible and is retried with a bounded cap.
    assert.match(appKit, /coreSessionRestoreTask = runCoreSessionRestore\(\)/);
    assert.match(appKit, /const CORE_RESTORE_ATTEMPT_TIMEOUT = \d+/);
    assert.match(appKit, /const CORE_RESTORE_MAX_ATTEMPTS = \d+/);
    // The 4s fail-open defers to the in-flight restore on the mobile core path.
    const failOpen = appKit.match(/setTimeout\(\(\) => \{\s*\n\s*if \(window\.artsoulWalletStateSettled === true\) return;[\s\S]*?WALLET_SETTLE_FAILOPEN_TIMEOUT\)/)?.[0] || '';
    assert.match(failOpen, /coreSessionRestoreTask && !coreSessionRestoreSettled/);
    assert.match(failOpen, /fail-open deferred to core session restore/);
    // The 8s hydration timeout waits for the restore instead of wiping the hint.
    const hydrationTimer = appKit.match(/walletHydrationTimer = setTimeout\(\(\) => \{[\s\S]*?WALLET_HYDRATION_TIMEOUT\)/)?.[0] || '';
    assert.match(hydrationTimer, /coreSessionRestoreCompletion && !coreSessionRestoreSettled/);
    // Protected actions await the restore promise, not the momentary state.
    const ensureConnected = appKit.match(/window\.ensureWalletConnected = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(ensureConnected, /await coreSessionRestoreCompletion/);
    assert.match(ensureConnected, /await waitForWalletHydration\(\)/);
});

test('only a clean "no session" clears the stored wallet; a restore error keeps the hint', () => {
    const completion = appKit.match(/coreSessionRestoreCompletion = coreSessionRestoreTask\.then[\s\S]*?coreSessionRestoreSettled = true;\s*\n\s*\}\);/)?.[0] || '';
    assert.ok(completion, 'restore completion handler must exist');
    assert.match(completion, /outcome\.status === 'none'/);
    assert.match(completion, /localStorage\.removeItem\('artsoul_wallet'\)/);
    // The guest dispatch must not run through updateNavButtons(null), which
    // would erase the stored wallet hint even for a transient restore error.
    assert.doesNotMatch(completion, /updateNavButtons\(null\)/);
    // A restored session still binds the disconnect classifier.
    assert.match(completion, /bindCoreProviderDisconnect\(restored\.provider\)/);
    assert.match(completion, /applyConfirmedWalletState/);
});

test('disconnect classification: transient and backgrounded drops never wipe; genuine ends do', () => {
    const handler = appKit.match(/async function handleCoreProviderDisconnect[\s\S]*?\n\}/)?.[0] || '';
    assert.match(handler, /coreSessionStillLive\(provider\)/);
    assert.match(handler, /restartWalletConnectTransport\('core transient disconnect'\)/);
    // Backgrounded disconnects are deferred, never wiped blind.
    assert.match(handler, /document\.visibilityState === 'hidden'/);
    assert.match(handler, /pendingCoreDisconnectProvider = provider/);
    // The deferred drop is re-checked after the relay restarts on return.
    assert.match(appKit, /async function recheckDeferredCoreDisconnect/);
    const recheck = appKit.match(/async function recheckDeferredCoreDisconnect[\s\S]*?\n\}/)?.[0] || '';
    assert.match(recheck, /restartWalletConnectTransport/);
    assert.match(recheck, /coreSessionStillLive\(provider\)/);
    assert.match(recheck, /handleProviderAccountsChanged\(\[\], 'core walletconnect disconnect', provider\)/);
    // Genuine session_delete still wipes.
    assert.match(appKit, /provider\.on\?\.\('session_delete'/);
});

test('returning from background restarts the relay for a restored core session', () => {
    const resume = appKit.match(/async function processWalletResume[\s\S]*?\n\}/)?.[0] || '';
    assert.match(resume, /isCoreSessionActive\(\)/);
    assert.match(resume, /await restartWalletConnectTransport\(source\)/);
    assert.match(resume, /recheckDeferredCoreDisconnect\(source\)/);
});

test('mobile header renders the stored wallet optimistically while the restore runs', () => {
    const initializing = avatar.match(/renderInitializingState\(\) \{[\s\S]*?\n        \}/)?.[0] || '';
    assert.match(initializing, /artsoul_wallet/);
    assert.match(initializing, /isMobileUA/);
    assert.match(initializing, /storedWallet\.slice\(0, 6\)/);
    // Desktop keeps its resolving state — the optimistic branch is mobile-only.
    assert.match(initializing, /wallet-state-resolving/);
});

test('a live core session outranks AppKit/injected empty-account events', () => {
    // The prod navigation bug: on every MPA page load AppKit knows nothing
    // about the core WalletConnect session, so its empty/disconnected account
    // events landing after POST_CONNECT_DISCONNECT_GUARD wiped the restored
    // wallet. Both subscribeAccount wipe paths must defer to the core session.
    assert.match(appKit, /appkit empty account ignored; core session is authoritative/);
    assert.match(appKit, /appkit disconnected status ignored; core session is authoritative/);
    const guards = appKit.match(/isCoreSessionActive\(\) \|\| \(coreSessionRestoreCompletion && !coreSessionRestoreSettled\)/g) || [];
    assert.ok(guards.length >= 2, 'both subscribeAccount wipe paths must cover the live session AND the in-flight restore');
    // accountsChanged []: only the core provider itself may end its session.
    assert.match(appKit, /empty accountsChanged ignored; core session is authoritative/);
    const accountsGuard = appKit.match(/if \(!nextAddress\) \{[\s\S]*?getConnectedCoreProvider\(\);[\s\S]*?provider !== coreProvider/)?.[0] || '';
    assert.ok(accountsGuard, 'handleProviderAccountsChanged must ignore empty accounts from non-core providers');
});

test('hydration-timeout wipe re-confirms from the live core session record', () => {
    const staleClear = appKit.match(/const clearStaleWalletState = async \(\) => \{[\s\S]*?\n        \};/)?.[0] || '';
    assert.ok(staleClear, 'clearStaleWalletState must exist');
    assert.match(staleClear, /getConnectedCoreProvider\(\)/);
    assert.match(staleClear, /applyConfirmedWalletState/);
});

test('X/Discord linking routes through ensureWalletConnected instead of an error toast', () => {
    const profile = read('src/entries/profile.jsx');
    const socialConnect = profile.match(/async function handleSocialConnect[\s\S]*?\n            \}/)?.[0] || '';
    assert.match(socialConnect, /await window\.ensureWalletConnected\?\.\(\)/);
    const socialDisconnect = profile.match(/async function handleSocialDisconnect[\s\S]*?\n            \}/)?.[0] || '';
    assert.match(socialDisconnect, /await window\.ensureWalletConnected\?\.\(\)/);
});

test('explicit disconnect does not resurrect: cache clear runs before restore starts', () => {
    const initSection = appKit.match(/const explicitDisconnectRequested = sessionStorage\.getItem\('artsoul_disconnecting'\);[\s\S]*?coreSessionRestoreTask = runCoreSessionRestore\(\);/)?.[0] || '';
    assert.ok(initSection, 'explicit-disconnect cleanup must precede the restore kick-off');
    assert.match(initSection, /await clearWalletConnectionCache\(\)/);
    // Restore only runs on the mobile external-browser path.
    assert.match(initSection, /isMobile && !isInjectedWalletBrowser\(\)/);
});
