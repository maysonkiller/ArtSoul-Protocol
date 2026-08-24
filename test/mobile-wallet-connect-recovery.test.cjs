const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Normalize line endings: these are structural assertions over source text and
// must read identically on a CRLF checkout (Windows CI) and an LF one.
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const appKit = read('appkit-init.js');
const contracts = read('contracts-integration.js');
const artwork = read(path.join('src', 'entries', 'artwork.jsx'));
const auctionServiceV3 = read(path.join('src', 'features', 'auction', 'auction-service-v3.js'));
const walletTest = read('wallet-test.js');
const walletRuntimeLoader = read('wallet-runtime-loader.js');
const coreWallet = read('wallet-core-connect.js');
const profile = read(path.join('src', 'entries', 'profile.jsx'));
const upload = read(path.join('src', 'entries', 'upload.js'));
const packageJson = JSON.parse(read('package.json'));

test('production and isolated diagnostics pin every Reown import to 1.8.21', () => {
    for (const source of [appKit, walletTest]) {
        assert.match(source, /from '@reown\/appkit'/);
        assert.match(source, /from '@reown\/appkit-adapter-wagmi'/);
        assert.match(source, /from '@reown\/appkit\/networks'/);
    }
    assert.equal(packageJson.dependencies['@reown/appkit'], '1.8.21');
    assert.equal(packageJson.dependencies['@reown/appkit-adapter-wagmi'], '1.8.21');
    for (const page of ['index.html', 'gallery.html', 'artwork.html', 'profile.html', 'upload.html', 'docs-protocol.html', 'admin.html']) {
        assert.match(read(page), /wallet-runtime-loader\.js/, `${page} must load the standard wallet boundary`);
        assert.doesNotMatch(read(page), /src="\/appkit-init\.js\?v=54"/, `${page} must not preload the wallet runtime`);
    }
    assert.match(walletRuntimeLoader, /import\('\.\/appkit-init\.js\?v=54'\)/);
    assert.match(appKit, /wallet-core-connect\.js\?v=18/);
    assert.match(walletTest, /wallet-core-connect\.js\?v=18/);
    assert.match(walletTest, /appkit-init\.js\?v=54/);
});

test('the on-screen wallet debug overlay is fully removed', () => {
    // The debug overlay was temporary; with the wallet flow green it is gone.
    // walletDebugLog keeps only a console + in-memory buffer, no DOM panel.
    assert.doesNotMatch(appKit, /artsoul-wallet-debug/);
    assert.doesNotMatch(appKit, /screenshot this panel/);
    assert.doesNotMatch(appKit, /document\.documentElement\.appendChild\(panel\)/);
    // The standalone overlay file and its per-page loader are gone.
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'wallet-debug-overlay.js')), false);
    for (const page of ['index.html', 'gallery.html', 'artwork.html', 'profile.html', 'upload.html', 'docs-protocol.html']) {
        assert.doesNotMatch(read(page), /wallet-debug-overlay/, `${page} must not load the debug overlay`);
    }
});

test('mobile external browsers use the standard flow: pinned provider + official WC modal', () => {
    assert.match(coreWallet, /WC_ETHEREUM_PROVIDER_VERSION = '2\.23\.10'/);
    assert.match(coreWallet, /esm\.sh\/@walletconnect\/ethereum-provider@\$\{WC_ETHEREUM_PROVIDER_VERSION\}/);
    assert.match(coreWallet, /const REQUIRED_CHAIN_IDS = \[BASE_SEPOLIA_CHAIN_ID\]/);
    assert.match(coreWallet, /const OPTIONAL_CHAIN_IDS = \[8453, 1\]/);
    assert.match(coreWallet, /const REQUIRED_METHODS = \['personal_sign', 'eth_sendTransaction'\]/);
    assert.match(coreWallet, /CORE_STORAGE_PREFIX = 'artsoul-mobile-core-v4'/);
    assert.match(coreWallet, /customStoragePrefix: CORE_STORAGE_PREFIX/);
    assert.doesNotMatch(coreWallet, /customStoragePrefix:\s*(?:crypto|Date|Math)\./);
    assert.match(coreWallet, /chains: REQUIRED_CHAIN_IDS/);
    assert.match(coreWallet, /optionalChains: OPTIONAL_CHAIN_IDS/);
    assert.match(coreWallet, /methods: REQUIRED_METHODS/);
    // The OFFICIAL WalletConnect modal drives wallet choice, deep links, QR —
    // statically imported and pinned by US (showQrModal: false). The
    // provider's built-in runtime modal load silently failed on prod:
    // connect() pended forever with no modal and no error.
    assert.match(coreWallet, /showQrModal: false/);
    assert.doesNotMatch(coreWallet, /showQrModal: true/);
    assert.match(coreWallet, /import \{ WalletConnectModal \} from '@walletconnect\/modal'/);
    assert.equal(packageJson.dependencies['@walletconnect/modal'], '2.7.0');
    assert.match(coreWallet, /WC_MODAL_VERSION = '2\.7\.0'/);
    // The modal instance is a singleton with the z-index ceiling so no
    // ArtSoul overlay can cover it.
    assert.match(coreWallet, /'--wcm-z-index': '2147483647'/);
    assert.match(coreWallet, /if \(modalInstance\) return modalInstance;/);
    assert.match(coreWallet, /no matching key/i);
    // The custom wallet sheet is gone: no wallet list, no hand-rolled deep
    // links, no QR module of our own.
    assert.doesNotMatch(coreWallet, /showCoreWalletSheet/);
    assert.doesNotMatch(coreWallet, /CORE_WALLETS/);
    assert.doesNotMatch(coreWallet, /wc\?uri=/);
    assert.doesNotMatch(coreWallet, /qrcode/i);
    // appkit-init routes mobile external connects through the standard path.
    assert.match(appKit, /async function connectExternalMobileStandard/);
    assert.match(appKit, /return connectExternalMobileStandard\(\);/);
});

test('the one-time compatibility migration resets local hints before isolated core restore', () => {
    assert.match(appKit, /WALLET_STORAGE_VERSION = 'appkit-1\.8\.21-isolated-core-session-v4'/);
    const migration = appKit.match(/async function migrateWalletStorageOnce\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(migration, 'wallet storage migration must exist');
    assert.match(migration, /sdkFragments = \['walletconnect', 'wc@', 'reown', 'appkit', 'wagmi'/);
    assert.match(migration, /localStorage\.setItem\(WALLET_STORAGE_VERSION_KEY, WALLET_STORAGE_VERSION\)/);

    const initialization = appKit.match(
        /async function initializeAppKit\(\) \{[\s\S]*?coreSessionRestoreTask = restoreCoreSessionOutcome\(\);/
    )?.[0] || '';
    assert.ok(initialization, 'AppKit initialization must start the core restore');
    assert.ok(
        initialization.indexOf('await migrateWalletStorageOnce()') <
        initialization.indexOf('restoreCoreSessionOutcome()'),
        'incompatible session storage must be migrated before provider restore'
    );
});

test('core wallet methods use the approved route and the correct SDK transport', () => {
    const resolver = coreWallet.match(/export function resolveCoreRequestChainId[\s\S]*?\n\}/)?.[0] || '';
    const request = coreWallet.match(/export async function requestCoreWalletMethod[\s\S]*?\n\}/)?.[0] || '';
    assert.match(resolver, /getCoreSessionChainIds\(instance\)/);
    assert.match(resolver, /approvedChainIds\.includes\(chainId\)/);
    assert.match(request, /directSignClient\.request\(\{\s*topic: instance\.session\.topic,\s*chainId: `eip155:\$\{routeChainId\}`/);
    assert.match(request, /instance\.signer\.request\(request, `eip155:\$\{routeChainId\}`\)/);
    assert.match(request, /CORE_METHOD_NOT_APPROVED/);
    assert.match(request, /CORE_SIGN_CLIENT_UNAVAILABLE/);
    assert.doesNotMatch(request, /instance\.request\(/);
    assert.match(coreWallet, /non-fatal WalletConnect SDK provider-route rejection suppressed/);
});

test('a cached session topic must still exist in the SignClient store before connected state is published', () => {
    assert.match(coreWallet, /function getCoreSessionLiveness/);
    assert.match(coreWallet, /store\.getAll\(\)/);
    assert.match(coreWallet, /session-topic-missing/);
    assert.match(coreWallet, /session-expired/);
    assert.match(coreWallet, /session-topic-tombstoned/);
    assert.match(coreWallet, /async function discardInvalidCoreSession/);
    assert.match(coreWallet, /await cleanup\.call\(instance\.signer\)/);
    assert.match(coreWallet, /instance\.reset\?\.\(\)/);
    assert.match(coreWallet, /CORE_SESSION_NOT_LIVE/);

    // Readiness is decided by ONE authoritative read of the SignClient
    // session, and that read runs before any connected result is returned.
    const attempt = coreWallet.match(/async function runCoreConnectAttempt[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(attempt, 'runCoreConnectAttempt must exist');
    assert.match(attempt, /const settled = readAuthoritativeCoreSession\(instance\);/);
    assert.match(attempt, /if \(!settled\.ready\) \{/);
    assert.ok(
        attempt.indexOf('if (!settled.ready)') < attempt.lastIndexOf('return {\n            provider: instance,'),
        'the readiness gate must run before the connection result is returned'
    );
    const readiness = coreWallet.match(/function readAuthoritativeCoreSession[\s\S]*?\n\}/)?.[0] || '';
    assert.match(readiness, /getCoreSessionLiveness\(instance/);
    assert.match(readiness, /session-address-missing/);
    assert.match(readiness, /session-chain-missing/);
    assert.match(readiness, /session-method-not-approved/);
    // SIWE capability is part of readiness; the write chain is not.
    assert.match(coreWallet, /const READINESS_METHODS = \['personal_sign'\];/);
});

test('the official modal lifecycle is deterministic: open on display_uri, close on every settle', () => {
    const attempt = coreWallet.match(/async function runCoreConnectAttempt[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(attempt, 'runCoreConnectAttempt must exist');
    // display_uri -> openModal({ uri }); an open failure rejects the attempt
    // instead of pending silently.
    assert.match(attempt, /instance\.on\('display_uri', handleDisplayUri\)/);
    assert.match(attempt, /modal\.openModal\(\{ uri \}\)/);
    assert.match(attempt, /rejectAttempt\(error\)/);
    // Manual close without a session settles the attempt as a user rejection
    // (4001) — the button is reusable at once.
    assert.match(attempt, /modal\.subscribeModal/);
    assert.match(attempt, /rejectAttempt\(createModalClosedError\(\)\)/);
    assert.match(coreWallet, /error\.code = 4001;/);
    // closeModal fires on EVERY settle signal — the awaited connect()
    // resolution, the provider 'connect' event, accountsChanged with an
    // address — whichever lands first, and every close is logged.
    assert.match(attempt, /markAttemptSettled\('connect\(\) resolved'\)/);
    assert.match(attempt, /instance\.on\('connect', handleConnectSettleSignal\)/);
    assert.match(attempt, /instance\.on\('accountsChanged', handleAccountsSettleSignal\)/);
    assert.match(attempt, /markAttemptSettled\('provider connect event'\)/);
    assert.match(attempt, /markAttemptSettled\('accountsChanged with address'\)/);
    assert.match(attempt, /coreLog\(`wc modal closed \(\${reason}\)`/);
    assert.match(attempt, /wc modal close failed/);
    // A late openModal resolution can never resurrect the Connecting view.
    assert.match(attempt, /settle landed during modal open/);
    // Every attempt end tears down: listeners off, modal subscription off,
    // final close.
    assert.match(attempt, /removeListener\?\.\('display_uri', handleDisplayUri\)/);
    assert.match(attempt, /removeListener\?\.\('connect', handleConnectSettleSignal\)/);
    assert.match(attempt, /removeListener\?\.\('accountsChanged', handleAccountsSettleSignal\)/);
    assert.match(attempt, /unsubscribeModal\?\.\(\)/);
    assert.match(attempt, /modal\.closeModal\(\)/);
    assert.match(attempt, /closeAttemptModal\('attempt finalized'\)/);
    // A connect failure is always surfaced in the production handler.
    assert.match(appKit, /walletDebugLog\('standard connect rejected'/);
    assert.match(appKit, /alert\(`Wallet connection failed: \${error\?\.message \|\| error}`\)/);
});

test('modal close is never destructive: closed after settle keeps the session; closed mid-flight only cancels the attempt', () => {
    const attempt = coreWallet.match(/async function runCoreConnectAttempt[\s\S]*?\n\}/)?.[0] || '';
    const closeHandler = attempt.match(/const unsubscribeModal = modal\.subscribeModal\(\(state\) => \{[\s\S]*?\n\s{4}\}\);/)?.[0] || '';
    assert.ok(closeHandler, 'the modal close handler must exist');
    // The handler re-reads the LIVE session state at close time — never a
    // captured snapshot — and a close after settle does nothing.
    assert.match(closeHandler, /if \(instance\.session \|\| attemptSettled\) \{/);
    assert.match(closeHandler, /wc modal closed with a live session; no action/);
    // Mid-flight close does exactly two things: mark the attempt cancelled and
    // settle it (4001). The SDK pairing cannot be cancelled
    // (abortPairingAttempt is a no-op in 2.23.10), so its outcome is adopted or
    // torn down by finalizeLateCoreSdkConnect — never abandoned, never a
    // session deletion from here.
    assert.match(closeHandler, /attempt\.cancelled = true;/);
    assert.match(closeHandler, /rejectAttempt\(createModalClosedError\(\)\)/);
    assert.doesNotMatch(closeHandler, /\.disconnect\(/);
    assert.doesNotMatch(closeHandler, /removeItem|localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(attempt, /instance\.disconnect\(\)/);
    assert.doesNotMatch(coreWallet, /localStorage|sessionStorage|indexedDB/);
    assert.match(coreWallet, /async function finalizeLateCoreSdkConnect/);
    assert.match(coreWallet, /late WalletConnect session adopted after a cancelled attempt/);
    // A cancelled attempt releases the in-flight slot for the next tap.
    assert.match(coreWallet, /if \(activeAttempt === attempt\) activeAttempt = null;/);
});

test('single-teardown invariant: session teardown stays on explicit, user-driven paths', () => {
    // provider.disconnect() exists in exactly ONE place in the core module —
    // inside the disconnect implementation.
    const coreDisconnectCalls = coreWallet.match(/instance\.disconnect\(\)/g) || [];
    assert.equal(coreDisconnectCalls.length, 1, 'provider.disconnect() must live only in runCoreDisconnect');
    const disconnectFn = coreWallet.match(/async function runCoreDisconnect[\s\S]*?\n\}/)?.[0] || '';
    assert.match(disconnectFn, /await instance\.disconnect\(\);/);
    // The PUBLIC SignClient disconnect that clears leftover stored sessions is
    // confined to the same implementation.
    const clientDisconnectCalls = coreWallet.match(/client\.disconnect\(\{/g) || [];
    assert.equal(clientDisconnectCalls.length, 1, 'SignClient.disconnect() must live only in runCoreDisconnect');
    assert.match(disconnectFn, /await client\.disconnect\(\{\s*\n\s*topic: leftoverTopic,/);
    // Every internal teardown goes through that same single implementation and
    // is user-driven: the late settle after a Disconnect, replacing a live
    // session that cannot sign, and reconciling either a duplicated store or
    // raw tombstoned leftovers on an explicit Connect. Passive boot never
    // calls it.
    const teardownCallers = coreWallet.match(/disconnectCoreWalletOutcome\(\{/g) || [];
    assert.equal(teardownCallers.length, 4, 'only the four explicit, user-driven paths call the teardown internally');
    assert.match(coreWallet, /late WalletConnect session settled after Disconnect; tearing it down/);
    assert.match(coreWallet, /live WalletConnect session cannot sign; replacing it on user request/);
    assert.match(coreWallet, /duplicate ArtSoul WalletConnect sessions reconciled on Connect/);
    assert.match(coreWallet, /orphaned ArtSoul WalletConnect sessions reconciled on Connect/);
    // Passive boot restore fails closed instead of deleting anything.
    const restore = coreWallet.match(/export async function restoreCoreSessionOutcome[\s\S]*?\n\}/)?.[0] || '';
    assert.match(restore, /status: 'conflict'/);
    assert.doesNotMatch(restore, /disconnectCoreWalletOutcome/);
    // appkit-init calls disconnectCoreWallet exactly once — inside the
    // explicit user Disconnect (resetWalletConnection).
    const appKitDisconnectCalls = appKit.match(/disconnectCoreWallet\(\)/g) || [];
    assert.equal(appKitDisconnectCalls.length, 1, 'disconnectCoreWallet must only run inside resetWalletConnection');
    const reset = appKit.match(/window\.resetWalletConnection = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(reset, /disconnectCoreWallet\(\)/);
    // Storage-clearing helpers are guarded: with a live core session and no
    // explicit-disconnect flag they refuse to run.
    const cacheClear = appKit.match(/async function clearWalletConnectionCache[\s\S]*?\n\}/)?.[0] || '';
    assert.match(cacheClear, /isCoreSessionActive\(\) && !sessionStorage\.getItem\('artsoul_disconnecting'\)/);
    assert.match(cacheClear, /wallet cache clear skipped; live core session without explicit disconnect/);
    const incompleteClear = appKit.match(/async function clearIncompleteWalletConnectState[\s\S]*?\n\}/)?.[0] || '';
    assert.match(incompleteClear, /hasConfirmedWalletAddress\(\) \|\| isCoreSessionActive\(\)/);
    // ...and the incomplete-state cleanup structurally excludes the core
    // provider from its disconnect/session-delete list.
    assert.match(incompleteClear, /\.filter\(\(provider\) => provider !== coreProviderInstance\)/);
});

test('the standard mobile connect settles without forcing an operational network', () => {
    const standard = appKit.match(/async function connectExternalMobileStandard[\s\S]*?\n\}/)?.[0] || '';
    const apply = appKit.match(/function applyCoreConnectedSession[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(standard, 'connectExternalMobileStandard must exist');
    assert.ok(apply, 'applyCoreConnectedSession must exist');
    // Connect establishes wallet identity only. The current chain is display
    // state until an explicit on-chain write invokes the shared write guard.
    assert.match(standard, /await connectCoreWallet\(\)/);
    assert.match(apply, /applyConfirmedWalletState\(/);
    for (const source of [standard, apply]) {
        assert.doesNotMatch(source, /scheduleMobileOperationalNetworkPrompt/);
        assert.doesNotMatch(source, /ensureExternalMobileBaseSepolia/);
        assert.doesNotMatch(source, /wallet_addEthereumChain/);
        assert.doesNotMatch(source, /wallet_switchEthereumChain/);
        assert.doesNotMatch(source, /BASE_SEPOLIA_CHAIN_ID/);
        // NO settle windows, custom deadlines, or reconciliation loops.
        assert.doesNotMatch(source, /waitForWalletChainSettle/);
        assert.doesNotMatch(source, /createForegroundDeadline/);
        assert.doesNotMatch(source, /WALLET_CONNECT_TIMEOUT/);
        // NO storage cleanup on any outcome of this path (the sessionStorage
        // disconnect-flag reset is not cleanup; it re-enables connecting).
        assert.doesNotMatch(source, /clearWalletConnectionCache/);
        assert.doesNotMatch(source, /clearIncompleteWalletConnectState/);
        assert.doesNotMatch(source, /localStorage\.removeItem/);
    }
    // The provider module never requests a chain switch either.
    assert.doesNotMatch(coreWallet, /wallet_switchEthereumChain/);
    assert.doesNotMatch(coreWallet, /wallet_addEthereumChain/);
});

test('one provider instance, one pairing: an in-flight connect is reused, never replaced', () => {
    // Singleton provider init.
    assert.match(coreWallet, /if \(providerInstance\) return providerInstance;/);
    // A second tap reuses the SAME attempt promise (and pairing). The
    // dispatcher is intentionally not async so the promise identity holds.
    const connect = coreWallet.match(/export function connectCoreWallet\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(connect, 'connectCoreWallet must be a plain function');
    assert.match(connect, /if \(activeAttempt\) \{/);
    assert.match(connect, /return activeAttempt\.promise;/);
    assert.match(connect, /reusing the active attempt/);
    // And exactly one SDK connect task exists per page: later attempts join it
    // instead of publishing a second proposal.
    const sdk = coreWallet.match(/function startCoreSdkConnect[\s\S]*?\n\}/)?.[0] || '';
    assert.match(sdk, /if \(sdkConnectTask\) \{/);
    assert.match(sdk, /return sdkConnectTask;/);
    assert.match(sdk, /joining the in-flight WalletConnect pairing/);
    const instanceConnectCalls = coreWallet.match(/instance\.connect\(\)/g) || [];
    assert.equal(instanceConnectCalls.length, 1, 'EthereumProvider.connect() has exactly one call site');
    // No proposal/pairing/session deletion anywhere in the module.
    assert.doesNotMatch(coreWallet, /pairing\.delete|session\.delete\(/);
});

test('no failure or cleanup path clears WalletConnect storage with a live session', () => {
    // The declined/pending cache wipe in the desktop/injected failure handler
    // keeps its confirmed-address guard.
    assert.match(appKit, /&& !hasConfirmedWalletAddress\(\)\) \{\s*\n\s*await clearWalletConnectionCache\(\);/);
    const cleanup = appKit.match(/async function clearIncompleteWalletConnectState[\s\S]*?\n\}/)?.[0] || '';
    assert.match(cleanup, /if \(hasConfirmedWalletAddress\(\) \|\| isCoreSessionActive\(\)\)/);
    // disconnectCoreWallet stays confined to the explicit user disconnect.
    const disconnectCalls = appKit.match(/disconnectCoreWallet\(\)/g) || [];
    assert.equal(disconnectCalls.length, 1, 'disconnectCoreWallet must only run inside resetWalletConnection');
    const reset = appKit.match(/window\.resetWalletConnection = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(reset, /disconnectCoreWallet\(\)/);
});

test('the site never reloads or redirects itself in the wallet flow', () => {
    assert.doesNotMatch(appKit, /location\.reload/);
    assert.doesNotMatch(coreWallet, /location\.reload/);
    assert.doesNotMatch(coreWallet, /location\.href/);
    const reset = appKit.match(/window\.resetWalletConnection = async[\s\S]*?\n\};/)?.[0] || '';
    assert.ok(reset, 'resetWalletConnection must exist');
    assert.doesNotMatch(reset, /location\.href/);
    assert.doesNotMatch(reset, /location\.reload/);
});

test('AppKit account and provider events are fully inert on the mobile external path', () => {
    assert.match(appKit, /appkit account event ignored \(standard mobile external path\)/);
    const subscribeAccount = appKit.match(/modal\.subscribeAccount\(async \(account\) => \{[\s\S]*?\n\s{8}\}\);/)?.[0] || '';
    assert.ok(subscribeAccount, 'subscribeAccount handler must exist');
    const guardIndex = subscribeAccount.indexOf('isMobileDevice() && !isInjectedWalletBrowser()');
    const firstStateTouch = subscribeAccount.indexOf('latestAppKitAccountSnapshot');
    assert.ok(guardIndex !== -1, 'subscribeAccount must guard the mobile external path');
    assert.ok(guardIndex < firstStateTouch, 'the guard must run before any state is touched');
    // subscribeProvider carries the same guard so AppKit cannot override the
    // core provider.
    const subscribeProvider = appKit.match(/modal\.subscribeProvider\(\(providerState\) => \{[\s\S]*?isMobileDevice\(\) && !isInjectedWalletBrowser\(\)\) return;/)?.[0] || '';
    assert.ok(subscribeProvider, 'subscribeProvider must be inert on the mobile external path');
});

test('the two survival mechanisms remain: relay restart on return + provider bridge', () => {
    // 1) relayer.restartTransport() on visibility return while a session
    // exists OR a connect() is in flight (the user approves in the wallet and
    // switches back manually — the approval must land in THIS tab).
    const resume = appKit.match(/async function processWalletResume[\s\S]*?\n\}/)?.[0] || '';
    assert.match(resume, /isCoreSessionActive\(\) \|\| isCoreConnectInFlight\(\)/);
    assert.match(resume, /await restartWalletConnectTransport\(source\)/);
    assert.match(appKit, /notifyWalletResume\('visibility return'\)/);
    assert.match(appKit, /restartTransport/);
    // The restart guard admits the in-flight case and reads the provider
    // session-independently (no session exists yet mid-connect).
    const restart = appKit.match(/async function restartWalletConnectTransport[\s\S]*?\n\}/)?.[0] || '';
    assert.match(restart, /!isCoreSessionActive\(\) && !isCoreConnectInFlight\(\)/);
    assert.match(restart, /getCoreProviderInstance\(\)/);
    assert.match(coreWallet, /export function isCoreConnectInFlight/);
    assert.match(coreWallet, /export function getCoreProviderInstance/);
    // No timeouts and no failure marking ride along the restart: the pending
    // connect just settles when the approval arrives.
    assert.doesNotMatch(resume, /abortPairingAttempt|rejectAttempt|createModalClosedError|WALLET_CONNECT_TIMEOUT/);
    // 2) the getWalletProvider bridge: contracts/auth read the core provider.
    assert.match(appKit, /if \(coreProvider\) return coreProvider;/);
    // Protected actions await the boot init through one entry point.
    assert.match(appKit, /window\.ensureWalletConnected = async/);
    const ensureConnected = appKit.match(/window\.ensureWalletConnected = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(ensureConnected, /await coreSessionRestoreCompletion/);
});

test('desktop and injected connects accept the wallet current chain without switching', () => {
    assert.match(appKit, /async function requestInjectedMobileAccounts/);
    const injected = appKit.match(/if \(injectedMobileConnect\) \{\s*\n\s*walletDebugLog\('mobile injected connect start[\s\S]*?return validated\.address;/)?.[0] || '';
    assert.ok(injected, 'injected mobile connect flow must remain');
    assert.match(injected, /requestProviderChainId\(window\.ethereum\)/);
    assert.match(injected, /notifyForeignChainAccepted\(validated\.chainId\)/);
    assert.doesNotMatch(injected, /wallet_switchEthereumChain|ensureExternalMobileBaseSepolia/);

    const desktop = appKit.match(/if \(window\.web3Modal\) \{[\s\S]*?return confirmed\.address;/)?.[0] || '';
    assert.ok(desktop, 'desktop AppKit connect flow must remain');
    assert.match(desktop, /notifyForeignChainAccepted\(confirmed\.chainId\)/);
    assert.doesNotMatch(desktop, /wallet_switchEthereumChain|ensureExternalMobileBaseSepolia/);
    assert.doesNotMatch(
        appKit,
        /MOBILE_CONNECT_SWITCH_TIMEOUT|ensureExternalMobileBaseSepolia|waitForMobileBaseSepolia|addThenSwitchEthereumChain/
    );
});

test('all contract write methods share the Base Sepolia guard', () => {
    assert.match(appKit, /window\.ensureArtSoulWriteNetwork = async/);
    assert.match(appKit, /This action requires Base Sepolia\./);
    assert.match(appKit, /currentChainId !== BASE_SEPOLIA_CHAIN_ID \|\| requiresCoreConfirmation/);
    assert.match(appKit, /confirmCoreBaseSepolia\(provider, 'write guard'\)/);
    const guardedMethods = [
        'registerArtwork',
        'createAuction',
        'placeBid',
        'endAuction',
        'completeSettlement',
        'claimSettlementDefault',
        'withdraw',
        'listResale',
        'buyResale'
    ];
    for (const method of guardedMethods) {
        const body = contracts.match(new RegExp(`async ${method}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`))?.[0] || '';
        assert.match(body, /await this\.ensureBaseSepoliaWrite\(\)/, `${method} must be guarded`);
    }
    for (const method of ['createAuction', 'placeBid', 'endAuction', 'settleAuction', 'withdraw']) {
        const body = auctionServiceV3.match(new RegExp(`async ${method}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`))?.[0] || '';
        assert.match(body, /await this\._ensureBaseSepoliaWrite\(\)/, `AuctionServiceV3.${method} must be guarded`);
    }
});

test('contract transactions foreground the wallet on the mobile core path', () => {
    // ethers dispatches eth_sendTransaction on the raw provider, which bypasses
    // the deep-link handoff. Without a switch to carry the user into the wallet
    // (already on Base Sepolia), auction actions used to hang: the wallet never
    // opened and the button stayed disabled. init() wraps the provider so only
    // approval/signature methods route through requestArtSoulWalletProvider.
    assert.match(contracts, /const WALLET_APPROVAL_METHODS = new Set\(\[[\s\S]*?'eth_sendtransaction'[\s\S]*?\]\);/);
    assert.match(contracts, /function wrapProviderForWalletApprovals\(rawProvider\)/);
    assert.match(contracts, /window\.requestArtSoulWalletProvider\(target, args\)/);
    // Reads stay on the raw provider (no gas/nonce/chain routing change).
    assert.match(contracts, /return target\.request\(args\);/);
    // The signer is built from the wrapped provider.
    assert.match(contracts, /new ethers\.BrowserProvider\(wrapProviderForWalletApprovals\(provider\)\)/);
});

test('legacy Ethereum Sepolia artwork writes are blocked without a switch prompt', () => {
    assert.match(artwork, /On-chain actions require Base Sepolia\. This artwork record is readable, but write actions are disabled for it\./);
    assert.doesNotMatch(artwork, /Switch to \$\{networkNames\[artworkNetwork\]/);
    assert.doesNotMatch(artwork, /'sepolia': 11155111,\s*'baseSepolia': 84532/);
});

test('protected actions open the wallet flow via a single hydration-aware entry point', () => {
    assert.match(appKit, /window\.ensureWalletConnected = async/);
    assert.match(appKit, /function waitForWalletHydration/);
    assert.match(appKit, /await waitForWalletHydration\(\)/);
    for (const [label, source] of [['artwork', artwork], ['profile', profile], ['upload', upload]]) {
        assert.match(source, /window\.ensureWalletConnected\?\.\(\)/, `${label} must route protected actions through ensureWalletConnected`);
    }
    assert.doesNotMatch(artwork, /alert\('Please connect your wallet'\)/);
    assert.doesNotMatch(profile, /alert\('Please connect your wallet'\)/);
});

test('wallet buttons are exempt from the global double-click guard that swallowed mobile taps', () => {
    const avatar = read('avatar-dropdown.js');
    assert.match(avatar, /id="connectBtn" data-allow-rapid/);
    assert.match(avatar, /resetWalletConnection\(\)" data-allow-rapid/);
    const perf = read(path.join('src', 'core', 'utils', 'performance-utils.js'));
    assert.match(perf, /dataset\.allowRapid/);
});

test('mobile external metadata carries NO redirect: the user returns to the SAME tab', () => {
    // On iOS a universal-link redirect cannot re-enter the existing tab — it
    // opens a NEW tab (possibly another browser) with separate storage and no
    // session, stranding the user on a guest page while the real session
    // lives in the original tab. The core path therefore sets no redirect:
    // the wallet shows its own "Return to browser" hint and the pending
    // connect() resolves in the tab the user manually switches back to.
    const coreMetadata = appKit.match(/const coreWalletMetadata = \{[\s\S]*?\n\};/)?.[0] || '';
    assert.ok(coreMetadata, 'coreWalletMetadata must exist');
    assert.doesNotMatch(coreMetadata, /redirect/);
    for (const field of ['name', 'description', 'url', 'icons']) {
        assert.match(coreMetadata, new RegExp(`${field}: metadata\\.${field}`), `core metadata must keep ${field}`);
    }
    const coreConfig = appKit.match(/configureCoreWallet\(\{[\s\S]*?\}\);/)?.[0] || '';
    assert.match(coreConfig, /metadata: coreWalletMetadata/);
    // The core CONNECT metadata never injects a redirect. A live session may
    // use peer metadata only to open the wallet for network approval.
    assert.match(coreWallet, /getCoreWalletApprovalUrl/);
    assert.match(appKit, /openCoreWalletForApproval/);
    assert.match(appKit, /requestCoreNetworkMethod/);
    // The isolated diagnostic core layer mirrors production: no redirect.
    const walletTestCore = walletTest.match(/async function initializeCoreLayer[\s\S]*?updateCoreStatus\(null, null\);/)?.[0] || '';
    assert.ok(walletTestCore, 'wallet-test core layer must exist');
    assert.doesNotMatch(walletTestCore, /redirect\s*:/);
    // Desktop AppKit metadata is untouched (redirect is harmless off-mobile).
    assert.match(appKit, /redirect:\s*\{\s*\n\s*universal: appReturnUrl/);
});

test('core signatures and transactions foreground the wallet like a network switch', () => {
    // A like/would-buy/watching/Edit-Profile action signs SIWE with no network
    // switch. On the external-mobile core path that request must reach the
    // wallet the same way a switch does — through the deep-link handoff — or it
    // hangs on the relay and the tab looks frozen ("nothing happens").
    const approvalSet = appKit.match(/const CORE_WALLET_APPROVAL_METHODS = new Set\(\[[\s\S]*?\]\);/)?.[0] || '';
    assert.ok(approvalSet, 'CORE_WALLET_APPROVAL_METHODS must exist');
    for (const method of ['personal_sign', 'eth_signtypeddata_v4', 'eth_sendtransaction', 'wallet_switchethereumchain']) {
        assert.match(approvalSet, new RegExp(`'${method}'`), `approval set must include ${method}`);
    }
    // requestArtSoulWalletProvider routes those approval methods through the
    // handoff wrapper (requestCoreNetworkMethod), not the raw router.
    const providerRouter = appKit.match(/window\.requestArtSoulWalletProvider = async[\s\S]*?\n\};/)?.[0] || '';
    assert.ok(providerRouter, 'requestArtSoulWalletProvider must exist');
    assert.match(providerRouter, /CORE_WALLET_APPROVAL_METHODS\.has\(String\(request\.method\)\.toLowerCase\(\)\)/);
    assert.match(providerRouter, /return requestCoreNetworkMethod\(coreProvider, request\);/);
    // Read-only methods still bypass the handoff.
    assert.match(providerRouter, /request\.method === 'eth_accounts'/);
    assert.match(providerRouter, /request\.method === 'eth_chainId'/);
});

test('a non-blocking waiting hint shows while a mobile approval is in flight', () => {
    // The deep-link round trip can feel like nothing happened. The hint tells the
    // user to approve in their wallet and offers a one-tap re-open.
    assert.match(appKit, /function showWalletApprovalPrompt\(provider, method\)/);
    assert.match(appKit, /function hideWalletApprovalPrompt\(\)/);
    // Mobile-only: never renders on desktop / injected in-app browsers.
    assert.match(appKit, /if \(!isMobileDevice\(\) \|\| isInjectedWalletBrowser\(\)\) return false;/);
    // requestCoreNetworkMethod shows on the same grace timer as the handoff and
    // always hides in the finally, but only if it actually showed (balanced).
    const handoff = appKit.match(/async function requestCoreNetworkMethod\(provider, request\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(handoff, 'requestCoreNetworkMethod must exist');
    assert.match(handoff, /promptShown = showWalletApprovalPrompt\(provider, request\.method\) \|\| promptShown;/);
    assert.match(handoff, /if \(promptShown\) hideWalletApprovalPrompt\(\);/);
    // The Open button re-triggers the wallet handoff.
    assert.match(appKit, /walletApprovalReopenHandler = \(\) => openCoreWalletForApproval\(provider, method\);/);
    // Canon: colors via theme variables, and no animation on the mobile hint.
    const promptBuilder = appKit.match(/function buildWalletApprovalPrompt\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(promptBuilder, 'buildWalletApprovalPrompt must exist');
    assert.match(promptBuilder, /var\(--c-surface\)/);
    assert.match(promptBuilder, /var\(--c-accent\)/);
    assert.doesNotMatch(promptBuilder, /@keyframes|animation:|transition:/);
    assert.doesNotMatch(promptBuilder, /#[0-9a-fA-F]{3,6}\b/);
});
