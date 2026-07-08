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

test('production and isolated diagnostics pin every Reown import to 1.8.21', () => {
    for (const source of [appKit, walletTest]) {
        assert.match(source, /@reown\/appkit@1\.8\.21\?bundle/);
        assert.match(source, /@reown\/appkit-adapter-wagmi@1\.8\.21\?bundle/);
        assert.match(source, /@reown\/appkit@1\.8\.21\/networks\?bundle/);
    }
    for (const page of ['index.html', 'gallery.html', 'artwork.html', 'profile.html', 'upload.html', 'docs-protocol.html']) {
        assert.match(read(page), /appkit-init\.js\?v=23/, `${page} must load the new wallet state machine`);
    }
});

test('WalletConnect negotiation accepts common EVM session chains without changing the operational default', () => {
    const override = appKit.match(/universalProviderConfigOverride:\s*\{[\s\S]*?themeMode/)?.[0] || '';
    assert.match(override, /events:/);
    assert.match(override, /rpcMap:/);
    assert.doesNotMatch(override, /chains:/);
    assert.doesNotMatch(override, /defaultChain:/);
    assert.match(appKit, /const networks = \[baseSepolia, base, mainnet\]/);
    assert.match(appKit, /defaultNetwork: baseSepolia/);
    assert.match(appKit, /allowUnsupportedChain: true/);
    assert.match(appKit, /enableNetworkSwitch: false/);
});

test('mobile handoff waits for AppKit, Wagmi and WalletConnect settlement after return', () => {
    assert.match(appKit, /const MOBILE_RETURN_SETTLEMENT_WINDOW = 30000;/);
    assert.match(appKit, /function markMobileWalletHandoff/);
    assert.match(appKit, /manual wallet return observed/);
    assert.match(appKit, /async function reconcileMobileConnectionSources/);
    assert.match(appKit, /source}: AppKit/);
    assert.match(appKit, /source}: Wagmi/);
    assert.match(appKit, /source}: WalletConnect session/);
    assert.match(appKit, /mobile bounded final confirmation/);
    assert.match(appKit, /async function restartWalletConnectTransport/);
    assert.match(appKit, /restartTransport/);
    assert.match(appKit, /transportClose/);
    assert.match(appKit, /transportOpen/);
});

test('mobile post-settlement validation adds then switches to Base Sepolia once per attempt', () => {
    assert.match(appKit, /async function addThenSwitchEthereumChain/);
    assert.match(appKit, /\.then\(\(\) => addThenSwitchEthereumChain\(provider, target\)\)/);
    assert.match(appKit, /if \(attempt\?\.networkSwitchRequested\)/);
    assert.match(appKit, /attempt\.networkSwitchRequested = true/);
    const addThenSwitch = appKit.match(/async function addThenSwitchEthereumChain[\s\S]*?\n}/)?.[0] || '';
    assert.ok(
        addThenSwitch.indexOf("method: 'wallet_addEthereumChain'") < addThenSwitch.indexOf("method: 'wallet_switchEthereumChain'") ||
        addThenSwitch.indexOf('await addEthereumChain(provider, target)') < addThenSwitch.indexOf("method: 'wallet_switchEthereumChain'"),
        'Base Sepolia must be added before the switch request'
    );
});

test('retry clears only incomplete SDK connection state', () => {
    assert.match(appKit, /async function clearIncompleteWalletConnectState/);
    assert.match(appKit, /if \(hasConfirmedWalletAddress\(\)\)/);
    assert.match(appKit, /mobileRetryCleanupRequired/);
    assert.match(appKit, /before mobile retry/);
    const cleanup = appKit.match(/async function clearIncompleteWalletConnectState[\s\S]*?\n}/)?.[0] || '';
    assert.doesNotMatch(cleanup, /artsoul_authenticated_wallet/);
    assert.doesNotMatch(cleanup, /supabase/);
});

test('Rabby iOS fails clearly when WalletGuide has no universal link', () => {
    assert.match(appKit, /RABBY_IOS_UNAVAILABLE/);
    assert.match(appKit, /Rabby could not be opened on this device\./);
    assert.match(appKit, /isIOSDevice\(\) && rabbySelected && !universalLink/);
    assert.match(appKit, /Copy link/);
    assert.match(appKit, /lastWalletConnectUri/);
});

test('wallet debug captures SDK, connector, session, lifecycle and provider truth', () => {
    assert.match(appKit, /component: 'AppKit Networks', version: '1\.8\.21'/);
    assert.match(appKit, /component: 'Wagmi Adapter', version: '1\.8\.21'/);
    assert.match(appKit, /connectorRdns/);
    assert.match(appKit, /sessionCount/);
    assert.match(appKit, /pairingCount/);
    assert.match(appKit, /window\.addEventListener\('blur'/);
    assert.match(appKit, /manual return provider truth/);
    assert.match(appKit, /'eth_accounts'/);
    assert.match(appKit, /'eth_chainId'/);
    assert.match(appKit, /WalletConnect proposal before publish/);
    assert.match(appKit, /WalletConnect relay message/);
    assert.match(appKit, /session_settle/);
    assert.match(appKit, /proposal_expire/);
});

test('isolation page exposes single and compatibility proposal variants', () => {
    assert.match(walletTest, /variant === 'multi' \? \[baseSepolia, base, mainnet\] : \[baseSepolia\]/);
    assert.match(walletTest, /allowUnsupportedChain: true/);
    assert.match(walletTest, /proposal before publish/);
    assert.match(walletTest, /relay inbound/);
    const html = read('wallet-test.html');
    assert.match(html, /variant=single/);
    assert.match(html, /variant=multi/);
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
