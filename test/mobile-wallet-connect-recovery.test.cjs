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
    assert.match(source, /options\.mobile\s*\? waitForConfirmedMobileWallet\(timeoutMs, options\.attempt\)\s*:\s*waitForConfirmedDesktopWallet\(timeoutMs\)/);
});

test('focus and visibility return wake confirmation and reconcile the approved AppKit session', () => {
    assert.match(source, /window\.addEventListener\('focus', \(\) => notifyWalletResume\('window focus'\)\)/);
    assert.match(source, /notifyWalletResume\('visibility return'\)/);
    assert.match(source, /await reconcileMobileAppKitSession\('mobile connect confirmation', attempt\)/);
    assert.match(source, /await reconcileMobileAppKitSession\('mobile connect final confirmation', attempt\)/);
    assert.match(source, /await acceptMobileAppKitWalletState\([\s\S]*?'AppKit account update'/);
    assert.match(source, /readAppKitAccountSnapshot\(\)/);
    assert.match(source, /appKitAccountRevision > mobileConnectStartRevision/);
    assert.match(source, /accountKey !== mobileConnectInitialAccountKey/);
    assert.match(source, /activeMobileConnect \|\| Date\.now\(\) < connectModalIntentUntil/);
});

test('external mobile connect finalizes the approved session before a non-blocking Base switch and defers SIWE', () => {
    const mobileWaiter = source.match(/async function waitForConfirmedMobileWallet[\s\S]*?\n}/)?.[0] || '';
    assert.match(mobileWaiter, /reconcileMobileAppKitSession/);
    assert.doesNotMatch(mobileWaiter, /reconcileActiveWalletFromProviders/);
    assert.match(source, /ensureExternalMobileBaseSepolia/);
    assert.match(source, /requestMobileBaseSepoliaAfterConnect/);
    assert.match(source, /const BASE_SEPOLIA_CHAIN_ID = 84532;/);
    assert.match(source, /switchEthereumChain\(provider, target\)/);
    assert.match(source, /mobile wallet accepted before network finalization/);
    assert.match(source, /mobile network finalized after connected UI/);
    const acceptSession = source.match(/async function acceptMobileAppKitWalletState[\s\S]*?return mobileSessionFinalizePromise;\n}/)?.[0] || '';
    assert.ok(acceptSession.indexOf('dispatchWalletStateChanged') < acceptSession.indexOf('requestMobileBaseSepoliaAfterConnect'));
    assert.doesNotMatch(source, /attempt\.failure = new Error\('Switch to Base Sepolia/);
    assert.match(source, /connectedDuringThisRequest \|\| deferMobileAuthenticationThisTurn/);
    assert.match(source, /setTimeout\(\(\) => \{\s*deferMobileAuthenticationThisTurn = false;/);
    assert.match(source, /SIWE deferred after external mobile wallet connect/);
});

test('AppKit CAIP chain IDs are parsed before injected or cached fallbacks', () => {
    assert.match(source, /trimmed\.match\(\/\^eip155:\(\\d\+\)\(\?:\:\|\$\)\/i\)/);
    assert.match(source, /state\.caipAddress/);
    assert.match(source, /getStateChainId\(account\)/);
    assert.match(source, /setCurrentChainId\(chainId\)/);
});

test('wallet diagnostics are gated and external mobile connect remains retryable', () => {
    assert.match(source, /\['walletdebug', 'walletDebug'\]/);
    assert.match(source, /if \(!walletDebugEnabled\(\)\) return;/);
    assert.match(source, /connect button handler entered/);
    assert.match(source, /visibility changed/);
    assert.match(source, /getWalletDebugSnapshot/);
    assert.match(source, /activeConnectAttempt\.cancelled = true/);
    assert.match(source, /setConnectButtonPending\(true, \{ retryable: externalMobileConnect \}\)/);
});

test('mobile injected providers use the same resumable confirmation window', () => {
    assert.match(source, /async function requestInjectedMobileAccounts\(\)/);
    assert.match(source, /const accounts = await requestInjectedMobileAccounts\(\);/);
    assert.doesNotMatch(source, /sleep\(20000\).*Injected wallet connection timed out/s);
});

test('WalletConnect metadata uses the live HTTPS origin without an empty native redirect', () => {
    assert.match(source, /url: appOrigin,/);
    assert.match(source, /icons: \[`\$\{appOrigin\}\/ARTSOULlogo-clean\.png`\]/);
    assert.match(source, /const appReturnUrl =/);
    assert.match(source, /redirect:\s*\{\s*universal: appReturnUrl\s*\}/);
    assert.doesNotMatch(source, /native:\s*''/);
});
