const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const appKit = read('appkit-init.js');
const contracts = read('contracts-integration.js');
const artwork = read(path.join('src', 'entries', 'artwork.jsx'));
const auctionServiceV3 = read(path.join('src', 'features', 'auction', 'auction-service-v3.js'));
const walletTest = read('wallet-test.js');
const coreWallet = read('wallet-core-connect.js');
const profile = read(path.join('src', 'entries', 'profile.jsx'));
const upload = read(path.join('src', 'entries', 'upload.js'));

test('production and isolated diagnostics pin every Reown import to 1.8.21', () => {
    for (const source of [appKit, walletTest]) {
        assert.match(source, /@reown\/appkit@1\.8\.21\?bundle/);
        assert.match(source, /@reown\/appkit-adapter-wagmi@1\.8\.21\?bundle/);
        assert.match(source, /@reown\/appkit@1\.8\.21\/networks\?bundle/);
    }
    for (const page of ['index.html', 'gallery.html', 'artwork.html', 'profile.html', 'upload.html', 'docs-protocol.html']) {
        assert.match(read(page), /appkit-init\.js\?v=37/, `${page} must load the standard wallet flow`);
    }
    assert.match(appKit, /wallet-core-connect\.js\?v=12/);
    assert.match(walletTest, /wallet-core-connect\.js\?v=12/);
    assert.match(walletTest, /appkit-init\.js\?v=37/);
});

test('mobile external browsers use the standard flow: pinned provider + official WC modal', () => {
    assert.match(coreWallet, /WC_ETHEREUM_PROVIDER_VERSION = '2\.23\.10'/);
    assert.match(coreWallet, /esm\.sh\/@walletconnect\/ethereum-provider@\$\{WC_ETHEREUM_PROVIDER_VERSION\}/);
    assert.doesNotMatch(coreWallet, /chains: \[BASE_SEPOLIA_CHAIN_ID\]/);
    assert.match(coreWallet, /const OPTIONAL_CHAIN_IDS = \[BASE_SEPOLIA_CHAIN_ID, 8453, 1\]/);
    // The OFFICIAL WalletConnect modal drives wallet choice, deep links, QR —
    // statically imported and pinned by US (showQrModal: false). The
    // provider's built-in runtime modal load silently failed on prod:
    // connect() pended forever with no modal and no error.
    assert.match(coreWallet, /showQrModal: false/);
    assert.doesNotMatch(coreWallet, /showQrModal: true/);
    assert.match(coreWallet, /import \{ WalletConnectModal \} from 'https:\/\/esm\.sh\/@walletconnect\/modal@2\.7\.0\?bundle'/);
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

test('core network methods route through a chain the wallet actually approved', () => {
    const resolver = coreWallet.match(/export function resolveCoreRequestChainId[\s\S]*?\n\}/)?.[0] || '';
    const request = coreWallet.match(/export async function requestCoreWalletMethod[\s\S]*?\n\}/)?.[0] || '';
    assert.match(resolver, /getCoreSessionChainIds\(instance\)/);
    assert.match(resolver, /approvedChainIds\.includes\(chainId\)/);
    assert.match(request, /instance\.signer\.request\(request, `eip155:\$\{routeChainId\}`\)/);
    assert.doesNotMatch(request, /instance\.request\(/);
    assert.match(coreWallet, /non-fatal WalletConnect SDK provider-route rejection suppressed/);
});

test('the official modal lifecycle is deterministic: open on display_uri, close on every settle', () => {
    const connect = coreWallet.match(/export async function connectCoreWallet[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(connect, 'connectCoreWallet must exist');
    // display_uri -> openModal({ uri }); an open failure rejects the attempt
    // instead of pending silently.
    assert.match(connect, /instance\.on\('display_uri', handleDisplayUri\)/);
    assert.match(connect, /modal\.openModal\(\{ uri \}\)/);
    assert.match(connect, /rejectAttempt\(error\)/);
    // Manual close without a session aborts the pairing and settles the
    // attempt as a user rejection (4001) — the button is reusable at once.
    assert.match(connect, /modal\.subscribeModal/);
    assert.match(connect, /abortPairingAttempt/);
    assert.match(connect, /rejectAttempt\(createModalClosedError\(\)\)/);
    assert.match(coreWallet, /error\.code = 4001;/);
    // closeModal fires on EVERY settle signal — the awaited connect()
    // resolution, the provider 'connect' event, accountsChanged with an
    // address — whichever lands first, and every close is logged.
    assert.match(connect, /markAttemptSettled\('connect\(\) resolved'\)/);
    assert.match(connect, /instance\.on\('connect', handleConnectSettleSignal\)/);
    assert.match(connect, /instance\.on\('accountsChanged', handleAccountsSettleSignal\)/);
    assert.match(connect, /markAttemptSettled\('provider connect event'\)/);
    assert.match(connect, /markAttemptSettled\('accountsChanged with address'\)/);
    assert.match(connect, /coreLog\(`wc modal closed \(\$\{reason\}\)`/);
    assert.match(connect, /wc modal close failed/);
    // A late openModal resolution can never resurrect the Connecting view.
    assert.match(connect, /settle landed during modal open/);
    // Every attempt end tears down: listeners off, modal subscription off,
    // final close.
    assert.match(connect, /removeListener\?\.\('display_uri', handleDisplayUri\)/);
    assert.match(connect, /removeListener\?\.\('connect', handleConnectSettleSignal\)/);
    assert.match(connect, /removeListener\?\.\('accountsChanged', handleAccountsSettleSignal\)/);
    assert.match(connect, /unsubscribeModal\?\.\(\)/);
    assert.match(connect, /modal\.closeModal\(\)/);
    assert.match(connect, /closeAttemptModal\('attempt finalized'\)/);
    // A connect failure is always surfaced in the production handler.
    assert.match(appKit, /walletDebugLog\('standard connect rejected'/);
    assert.match(appKit, /alert\(`Wallet connection failed: \$\{error\?\.message \|\| error\}`\)/);
});

test('modal close is never destructive: closed after settle keeps the session; closed mid-flight only cancels the attempt', () => {
    const connect = coreWallet.match(/export async function connectCoreWallet[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(connect, 'connectCoreWallet must exist');
    const closeHandler = connect.match(/const unsubscribeModal = modal\.subscribeModal\(\(state\) => \{[\s\S]*?\n\s{8}\}\);/)?.[0] || '';
    assert.ok(closeHandler, 'the modal close handler must exist');
    // The handler re-reads the LIVE session state at close time — never a
    // captured snapshot — and a close after settle does nothing.
    assert.match(closeHandler, /if \(instance\.session \|\| attemptSettled\) \{/);
    assert.match(closeHandler, /wc modal closed with a live session; no action/);
    // Mid-flight close does exactly one thing: cancel the attempt (4001) so
    // the button is reusable. abortPairingAttempt only flags the signer's
    // pairing loop — it cannot delete a settled session.
    assert.match(closeHandler, /rejectAttempt\(createModalClosedError\(\)\)/);
    // The handler (and the whole module outside disconnectCoreWallet) never
    // disconnects the provider or touches WalletConnect storage or hints.
    assert.doesNotMatch(closeHandler, /\.disconnect\(/);
    assert.doesNotMatch(closeHandler, /removeItem|localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(connect, /\.disconnect\(/);
    assert.doesNotMatch(coreWallet, /localStorage|sessionStorage|indexedDB/);
    // A cancelled attempt releases the in-flight slot for the next tap.
    assert.match(coreWallet, /\.finally\(\(\) => \{\s*\n\s*connectPromise = null;/);
});

test('single-teardown invariant: explicit Disconnect is the only production caller of core teardown', () => {
    // provider.disconnect() exists in exactly ONE place in the core module —
    // inside disconnectCoreWallet.
    const coreDisconnectCalls = coreWallet.match(/providerInstance\.disconnect\(\)/g) || [];
    assert.equal(coreDisconnectCalls.length, 1, 'provider.disconnect() must live only in disconnectCoreWallet');
    const disconnectFn = coreWallet.match(/export async function disconnectCoreWallet[\s\S]*?\n\}/)?.[0] || '';
    assert.match(disconnectFn, /providerInstance\.disconnect\(\)/);
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

test('the standard mobile connect settles before one separate network-confirmation prompt', () => {
    const standard = appKit.match(/async function connectExternalMobileStandard[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(standard, 'connectExternalMobileStandard must exist');
    // Connect click = await provider.connect(). The address settles first.
    assert.match(standard, /await connectCoreWallet\(\)/);
    assert.match(standard, /applyConfirmedWalletState\(/);
    assert.match(standard, /scheduleMobileOperationalNetworkPrompt\(coreProvider, 'standard mobile connect'\)/);
    // The connect function itself never performs an add/switch cycle. The
    // separately scheduled prompt owns the single user-confirmed request.
    assert.doesNotMatch(standard, /ensureExternalMobileBaseSepolia/);
    assert.doesNotMatch(standard, /wallet_addEthereumChain/);
    assert.doesNotMatch(standard, /wallet_switchEthereumChain/);
    assert.doesNotMatch(standard, /BASE_SEPOLIA_CHAIN_ID/);
    // NO settle windows, custom deadlines, or reconciliation loops.
    assert.doesNotMatch(standard, /waitForWalletChainSettle/);
    assert.doesNotMatch(standard, /createForegroundDeadline/);
    assert.doesNotMatch(standard, /WALLET_CONNECT_TIMEOUT/);
    // NO storage cleanup on any outcome of this path (the sessionStorage
    // disconnect-flag reset is not cleanup; it re-enables connecting).
    assert.doesNotMatch(standard, /clearWalletConnectionCache/);
    assert.doesNotMatch(standard, /clearIncompleteWalletConnectState/);
    assert.doesNotMatch(standard, /localStorage\.removeItem/);
    // The provider module never requests a chain switch either.
    assert.doesNotMatch(coreWallet, /wallet_switchEthereumChain/);
    assert.doesNotMatch(coreWallet, /wallet_addEthereumChain/);
});

test('one provider instance, one pairing: an in-flight connect is reused, never replaced', () => {
    // Singleton provider init.
    assert.match(coreWallet, /if \(providerInstance\) return providerInstance;/);
    // A second tap reuses the SAME connect promise (and pairing).
    const connect = coreWallet.match(/export async function connectCoreWallet[\s\S]*?\n\}/)?.[0] || '';
    assert.match(connect, /if \(connectPromise\) \{/);
    assert.match(connect, /return connectPromise;/);
    assert.match(connect, /reusing the active pairing/);
    // No proposal/pairing/session deletion anywhere in the module.
    assert.doesNotMatch(coreWallet, /pairing\.delete|session\.delete|cleanupPendingPairings/);
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

test('injected in-app browsers keep their existing connect flow (out of scope)', () => {
    assert.match(appKit, /async function requestInjectedMobileAccounts/);
    const ensure = appKit.match(/async function ensureExternalMobileBaseSepolia[\s\S]*?\n\}/)?.[0] || '';
    assert.match(ensure, /acceptForeignChain/);
    const injected = appKit.match(/if \(injectedMobileConnect\) \{\s*\n\s*walletDebugLog\('mobile injected connect start[\s\S]*?return validated\.address;/)?.[0] || '';
    assert.ok(injected, 'injected mobile connect flow must remain');
    assert.match(injected, /acceptForeignChain: true/);
    assert.match(injected, /switchTimeout: MOBILE_CONNECT_SWITCH_TIMEOUT/);
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

test('legacy Ethereum Sepolia artwork writes are blocked without a switch prompt', () => {
    assert.match(artwork, /This artwork is on a legacy network\. On-chain actions are disabled for now\./);
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
