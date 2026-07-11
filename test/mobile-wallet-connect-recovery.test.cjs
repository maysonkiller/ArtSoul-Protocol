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
        assert.match(read(page), /appkit-init\.js\?v=28/, `${page} must load the standard wallet flow`);
    }
    assert.match(appKit, /wallet-core-connect\.js\?v=4/);
    assert.match(walletTest, /wallet-core-connect\.js\?v=4/);
    assert.match(walletTest, /appkit-init\.js\?v=28/);
});

test('mobile external browsers use the standard flow: pinned provider + official WC modal', () => {
    assert.match(coreWallet, /WC_ETHEREUM_PROVIDER_VERSION = '2\.23\.10'/);
    assert.match(coreWallet, /esm\.sh\/@walletconnect\/ethereum-provider@\$\{WC_ETHEREUM_PROVIDER_VERSION\}/);
    assert.match(coreWallet, /chains: \[BASE_SEPOLIA_CHAIN_ID\]/);
    assert.match(coreWallet, /const OPTIONAL_CHAIN_IDS = \[8453, 1\]/);
    // The OFFICIAL WalletConnect modal drives wallet choice, deep links, QR.
    assert.match(coreWallet, /showQrModal: true/);
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

test('the standard mobile connect never switches chains, cleans storage, or times out', () => {
    const standard = appKit.match(/async function connectExternalMobileStandard[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(standard, 'connectExternalMobileStandard must exist');
    // Connect click = await provider.connect(). Chain is applied AS-IS.
    assert.match(standard, /await connectCoreWallet\(\)/);
    assert.match(standard, /applyConfirmedWalletState\(/);
    // NO add/switch cycle at connect — the write guard is the only place
    // that ever requests Base Sepolia on this path.
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
    assert.match(cleanup, /if \(hasConfirmedWalletAddress\(\)\)/);
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
    // 1) relayer.restartTransport() on visibility return while a session exists.
    const resume = appKit.match(/async function processWalletResume[\s\S]*?\n\}/)?.[0] || '';
    assert.match(resume, /isCoreSessionActive\(\)/);
    assert.match(resume, /await restartWalletConnectTransport\(source\)/);
    assert.match(appKit, /notifyWalletResume\('visibility return'\)/);
    assert.match(appKit, /restartTransport/);
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

test('wallet return deep link preserves the current page, not the homepage', () => {
    assert.match(appKit, /redirect:\s*\{\s*\n\s*universal: appReturnUrl/);
    assert.match(appKit, /returnUrl\.hash = ''/);
    // The core module receives the exact production metadata (incl. redirect).
    assert.match(coreWallet, /metadata: settings\.metadata/);
});
