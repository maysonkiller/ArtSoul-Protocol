const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'appkit-init.js'), 'utf8');

test('mobile wallet confirmation uses a foreground-only four minute timeout', () => {
    assert.match(source, /const WALLET_CONNECT_TIMEOUT_MOBILE = 240000;/);
    assert.match(source, /function createForegroundDeadline\(timeoutMs\)/);
    assert.match(source, /if \(document\.visibilityState !== 'visible'\) return false;/);
    assert.match(source, /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/);
});

test('desktop wallet timeout and modal-close behavior stay unchanged', () => {
    assert.match(source, /const WALLET_CONNECT_TIMEOUT_DESKTOP = 45000;/);
    assert.match(source, /async function waitForConfirmedDesktopWallet\(timeoutMs\)/);
    assert.match(source, /Date\.now\(\) - modalClosedAt > 5000/);
    assert.match(source, /options\.mobile\s*\? waitForConfirmedMobileWallet\(timeoutMs\)\s*:\s*waitForConfirmedDesktopWallet\(timeoutMs\)/);
});

test('focus and visibility return wake confirmation and reconcile provider truth', () => {
    assert.match(source, /window\.addEventListener\('focus', \(\) => notifyWalletResume\('window focus'\)\)/);
    assert.match(source, /notifyWalletResume\('visibility return'\)/);
    assert.match(source, /reconcileActiveWalletFromProviders\('mobile connect confirmation'\)/);
    assert.match(source, /reconcileActiveWalletFromProviders\('mobile connect final confirmation'\)/);
    assert.match(source, /activeMobileConnect \|\| Date\.now\(\) < connectModalIntentUntil/);
});

test('mobile injected providers use the same resumable confirmation window', () => {
    assert.match(source, /async function requestInjectedMobileAccounts\(\)/);
    assert.match(source, /const accounts = await requestInjectedMobileAccounts\(\);/);
    assert.doesNotMatch(source, /sleep\(20000\).*Injected wallet connection timed out/s);
});

test('WalletConnect metadata uses the live HTTPS origin without an empty native redirect', () => {
    assert.match(source, /url: appOrigin,/);
    assert.match(source, /icons: \[`\$\{appOrigin\}\/ARTSOULlogo-clean\.png`\]/);
    assert.match(source, /redirect:\s*\{\s*universal: appOrigin\s*\}/);
    assert.doesNotMatch(source, /native:\s*''/);
});
