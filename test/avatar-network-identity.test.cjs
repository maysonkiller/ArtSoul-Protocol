const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function networkHarness({ chainId = 84532, confirmed = true, provider = null, ...options } = {}) {
    const harness = createAvatarHarness(options);
    const window = harness.context.window;
    window.currentWalletAddress = WALLET;
    window.currentChainId = chainId;
    window.isArtSoulBaseSepoliaConfirmed = () => confirmed;
    window.web3Modal = { getWalletProvider: async () => provider };
    window.getArtSoulProviderChainId = async () => chainId;
    return harness;
}

function menuHtml(harness, networkInfo) {
    return harness.dropdown.renderMenuContent({
        currentPath: '/gallery.html', isOwnProfile: false, networkInfo, connected: true
    });
}

async function readMenu(harness) {
    const network = await harness.dropdown.getCurrentNetworkInfo({ includeBalance: false });
    return { network, html: menuHtml(harness, network) };
}

test('confirmed Base Sepolia uses official local Base and test ETH marks without a duplicate switch', async () => {
    const harness = networkHarness();
    const { html } = await readMenu(harness);
    assert.match(html, /data-network-mark><img[^>]+src="\/brand\/base\.svg"/);
    assert.match(html, /data-network-balance><img[^>]+src="\/brand\/eth\.png"/);
    assert.match(html, /class="network-balance-value">… test ETH<\/span>/);
    assert.match(html, /network-current-row" role="status"/);
    assert.doesNotMatch(html, /selectNetwork\(|avatar-wallet-provider|src="(?:https?:|data:)/);
    for (const mark of html.matchAll(/<img[^>]+>/g)) {
        assert.match(mark[0], /alt="" aria-hidden="true"/);
    }
});

test('unconfirmed Base Sepolia preserves its switch action and does not claim an ETH balance', async () => {
    const harness = networkHarness({ confirmed: false });
    const { html } = await readMenu(harness);
    assert.match(html, /src="\/brand\/base\.svg"/);
    assert.match(html, /Tap to switch/);
    assert.match(html, /onclick="window.AvatarDropdown.handleNetworkRowClick\(event\)"/);
    assert.doesNotMatch(html, /brand\/eth\.png|selectNetwork\(/);
});

for (const [chainId, name, mark, currency] of [
    [8453, 'Base Mainnet', 'base.svg', 'ETH'],
    [1, 'Ethereum Mainnet', 'eth.png', 'ETH'],
    [11155111, 'Ethereum Sepolia', 'eth.png', 'test ETH']
]) {
    test(`${name} remains display-only with Base Sepolia as the sole switch target`, async () => {
        const harness = networkHarness({ chainId, confirmed: false });
        const { html } = await readMenu(harness);
        assert.ok(html.includes(`data-network-name>${name}</span>`));
        assert.ok(html.includes(`src="/brand/${mark}"`));
        assert.ok(html.includes(`0.0000 ${currency}</span>`));
        const balance = html.match(/data-network-balance>(.*?)<\/div>/)?.[1];
        assert.ok(balance);
        assert.equal(balance.includes('/brand/eth.png'), mark !== 'eth.png', 'do not repeat the network glyph in the balance');
        assert.deepEqual([...html.matchAll(/selectNetwork\((\d+), event\)/g)].map(match => Number(match[1])), [84532]);
        assert.match(html, /aria-controls="avatarNetworkOptions"/);
    });
}

for (const [chainId, label] of [[999, 'Unsupported'], [null, 'Connecting...']]) {
    test(`${label} does not fabricate a token or remote mark`, async () => {
        const harness = networkHarness({ chainId, confirmed: false });
        const { html } = await readMenu(harness);
        assert.ok(html.includes(`data-network-name>${label}</span>`));
        assert.match(html, /data-network-mark><\/span>/);
        assert.match(html, /data-network-balance><\/div>/);
        assert.doesNotMatch(html, /brand\/eth\.png|src=""|0\.0000 ETH/);
        assert.deepEqual([...html.matchAll(/selectNetwork\((\d+), event\)/g)].map(match => Number(match[1])), [84532]);
    });
}

test('cached identity derives from chain and discards stored images, HTML, currency and provider claims', () => {
    const attack = '"><img src="https://foreign.test/track" onerror="alert(1)">';
    const harness = networkHarness({ storage: {
        artsoul_header_network_v2: JSON.stringify({
            wallet: WALLET, chainId: 84532, name: attack, icon: attack,
            currency: attack, balance: attack, walletProvider: { name: 'Rabby', mark: 'rabby' }
        })
    } });
    const cached = harness.dropdown.getCachedHeaderNetwork(WALLET);
    assert.equal(cached.name, 'Base Sepolia');
    assert.equal(cached.icon, '/brand/base.svg');
    assert.equal(cached.balance, '…');
    assert.equal(cached.walletProvider, undefined);
    const html = menuHtml(harness, cached);
    assert.doesNotMatch(html, /foreign\.test|onerror|alert\(|Rabby/);
    assert.equal(harness.dropdown.getCachedHeaderNetwork(OTHER_WALLET), null);
});

for (const chainId of [999, '__proto__', '84532<img>', 84532.1, true, [84532]]) {
    test(`unrecognized cached chain ${chainId} cannot supply an identity`, () => {
        const harness = networkHarness({ storage: {
            artsoul_header_network_v2: JSON.stringify({ wallet: WALLET, chainId, name: 'Base Sepolia', icon: '/brand/base.svg' })
        } });
        assert.equal(harness.dropdown.getCachedHeaderNetwork(WALLET), null);
    });
}

test('an actual Rabby provider shows its local mark, without issuing a provider request', async () => {
    const provider = { isRabby: true, request: () => { throw new Error('No new provider request is allowed'); } };
    const harness = networkHarness({ provider });
    const { html } = await readMenu(harness);
    assert.match(html, /class="avatar-wallet-provider"><img[^>]+src="\/brand\/rabby\.png"[^>]*><span>Rabby<\/span>/);
});

test('a compatibility flag or unrelated injected provider cannot label the active wallet as Rabby', async () => {
    const harness = networkHarness({ provider: { isMetaMask: true } });
    harness.context.window.ethereum = { isRabby: true };
    const { html } = await readMenu(harness);
    assert.doesNotMatch(html, /avatar-wallet-provider|Rabby|MetaMask/);
});

test('live WalletConnect peer names are shown, while untrusted remote wallet images are ignored', async () => {
    const harness = networkHarness({ provider: {
        session: { peer: { metadata: { name: 'Coinbase Wallet', icons: ['https://foreign.test/icon.svg'] } } }
    } });
    const { html } = await readMenu(harness);
    assert.match(html, /class="avatar-wallet-provider"><span>Coinbase Wallet<\/span>/);
    assert.doesNotMatch(html, /foreign\.test|brand\/rabby\.png/);
});

test('a live Rabby WalletConnect peer receives the Rabby mark', async () => {
    const harness = networkHarness({ provider: {
        session: { peer: { metadata: { name: 'Rabby Wallet' } } }
    } });
    const { html } = await readMenu(harness);
    assert.match(html, /src="\/brand\/rabby\.png"[^>]*><span>Rabby Wallet<\/span>/);
});

test('wallet and network text cannot inject markup or arbitrary mark URLs', async () => {
    const maliciousName = '"><img src=x onerror=alert(1)> & "Wallet"';
    const harness = networkHarness({ provider: {
        session: { peer: { metadata: { name: maliciousName, icons: ['javascript:alert(1)'] } } }
    } });
    const { network } = await readMenu(harness);
    network.name = '<script>alert(1)</script>';
    network.mark = 'base" onerror="alert(1)';
    const html = menuHtml(harness, network);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;Wallet&quot;/);
    assert.doesNotMatch(html, /<script|<img src=x|javascript:|src="base/);
    assert.equal(harness.dropdown.renderIdentityMark('__proto__'), '');
});

test('no active wallet means no provider identity, even if a provider object remains', () => {
    const harness = networkHarness();
    harness.context.window.currentWalletAddress = null;
    assert.equal(harness.dropdown.getWalletProviderIdentity({ isRabby: true }), null);
});

test('live balance refresh retains token markup and removes an unavailable provider identity', async () => {
    const harness = networkHarness({ provider: { isRabby: true } });
    const { html } = await readMenu(harness);
    harness.menu().innerHTML = html;
    harness.context.window.web3Modal.getWalletProvider = async () => ({ request: async () => null });
    harness.context.window.ArtSoulBaseSepolia = { rpc: async () => '0xde0b6b3a7640000' };
    await harness.dropdown.updateNetworkDisplay();
    const balance = harness.menu().querySelector('[data-network-balance]');
    assert.match(balance.innerHTML, /src="\/brand\/eth\.png"/);
    assert.match(balance.innerHTML, /1\.0000 test ETH/);
    assert.equal(harness.menu().querySelector('[data-wallet-provider]').innerHTML, '');
});

test('a late network refresh cannot apply the previous wallet provider or balance', async () => {
    const harness = networkHarness({ provider: { isRabby: true } });
    const { html } = await readMenu(harness);
    harness.menu().innerHTML = html;
    const balance = harness.menu().querySelector('[data-network-balance]');
    balance.innerHTML = '<span>Current wallet balance</span>';
    let resolveNetwork;
    harness.dropdown.getCurrentNetworkInfo = () => new Promise(resolve => { resolveNetwork = resolve; });
    const update = harness.dropdown.updateNetworkDisplay();
    harness.context.window.currentWalletAddress = OTHER_WALLET;
    resolveNetwork({ chainId: 84532, name: 'Base Sepolia', mark: 'base', balance: '100.0000', walletProvider: { name: 'Rabby', mark: 'rabby' } });
    await update;
    assert.equal(balance.innerHTML, '<span>Current wallet balance</span>');
});

test('production brand assets are byte-identical to the approved study sources', () => {
    for (const file of ['base.svg', 'eth.png', 'rabby.png']) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'design', 'study-assets', file));
        const published = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', file));
        assert.deepEqual(published, source);
    }
});

test('the mobile menu identity shows the current resolved name and full wallet address', async () => {
    const harness = networkHarness({ profiles: {
        [WALLET]: { wallet_address: WALLET, username: 'Current Artist' }
    } });
    await harness.dropdown.sync(WALLET, { confirmed: true });
    await harness.flush();
    assert.match(harness.menuHtml(), /class="avatar-menu-name">Current Artist<\/span>/);
    assert.ok(harness.menuHtml().includes(`class="avatar-menu-address-value">${WALLET}</span>`));
});

test('a profile belonging to another wallet cannot name the menu identity', () => {
    const harness = networkHarness();
    harness.dropdown.identityWallet = WALLET;
    harness.dropdown.resolvedIdentityWallet = WALLET;
    harness.dropdown.profile = { wallet_address: OTHER_WALLET, username: 'Another Artist' };
    const html = harness.dropdown.renderMenuIdentity(WALLET);
    assert.doesNotMatch(html, /Another Artist/);
    assert.match(html, /class="avatar-menu-name">0xaaaa\.\.\.aaaa<\/span>/);
    assert.ok(html.includes(`class="avatar-menu-address-value">${WALLET}</span>`));
});

test('a mismatched profile response cannot redirect header identity, caching or balance reads', async () => {
    const foreignAvatar = 'https://fixture.invalid/foreign-avatar.png';
    const harness = networkHarness({ profiles: {
        [WALLET]: { wallet_address: OTHER_WALLET, username: 'Another Artist', avatar_url: foreignAvatar }
    } });
    const balanceWallets = [];
    harness.context.window.ArtSoulBaseSepolia = { rpc: async (_method, params) => {
        balanceWallets.push(params[0]);
        return '0xde0b6b3a7640000';
    } };
    harness.dropdown.protocolAdminWallet = WALLET;
    harness.dropdown.protocolAdminEligible = true;
    await harness.dropdown.sync(WALLET, { confirmed: true });
    await harness.flush();
    assert.equal(harness.avatarName(), '0xaaaa...aaaa');
    assert.equal(harness.avatarAddress(), '');
    assert.equal(harness.avatarSrc(), '/default-avatar.png');
    assert.equal(harness.imageLoads.includes(foreignAvatar), false);
    assert.doesNotMatch(harness.menuHtml(), /class="avatar-menu-name">Another Artist/);
    assert.ok(harness.menuHtml().includes(`class="avatar-menu-address-value">${WALLET}</span>`));
    assert.equal(harness.dropdown.getCachedHeaderIdentity(WALLET), null);
    assert.equal(harness.dropdown.profileCache.has(WALLET), false);
    assert.equal(harness.dropdown.profile, null);
    assert.equal(harness.dropdown.resolvedIdentityWallet, null);
    assert.ok(balanceWallets.length > 0);
    assert.ok(balanceWallets.every(wallet => wallet === WALLET));
    assert.equal(harness.dropdown.protocolAdminWallet, WALLET);
    assert.equal(harness.dropdown.protocolAdminEligible, true);
    assert.equal(harness.profileCalls.length, 3);
    assert.deepEqual(harness.firedDelays(), [400, 1600]);
    assert.equal(harness.pendingTimerCount(), 0);
    harness.dispatchDbReady();
    harness.triggerMutationObservers();
    await harness.flush();
    assert.equal(harness.profileCalls.length, 3, 'automatic recovery remains bounded');
});

test('a mismatched profile response recovers to the correct profile without showing the foreign identity', async () => {
    const ownAvatar = 'https://fixture.invalid/own-avatar.png';
    const foreignAvatar = 'https://fixture.invalid/foreign-avatar.png';
    const harness = networkHarness({ profiles: {
        [WALLET]: { wallet_address: WALLET, username: 'Current Artist', avatar_url: ownAvatar }
    } });
    harness.setProfileBehaviour((_wallet, attempt) => attempt === 1
        ? { wallet_address: OTHER_WALLET, username: 'Another Artist', avatar_url: foreignAvatar }
        : undefined);
    const visibleNames = [];
    harness.observeCommits(() => visibleNames.push(harness.avatarName()));
    await harness.dropdown.sync(WALLET, { confirmed: true });
    await harness.flush();
    assert.equal(harness.avatarName(), 'Current Artist');
    assert.equal(harness.avatarAddress(), '0xaaaa...aaaa');
    assert.equal(harness.avatarSrc(), ownAvatar);
    assert.equal(visibleNames.includes('Another Artist'), false);
    assert.equal(harness.imageLoads.includes(foreignAvatar), false);
    assert.equal(harness.dropdown.profileCache.get(WALLET).wallet_address, WALLET);
    assert.equal(harness.dropdown.getCachedHeaderIdentity(WALLET).name, 'Current Artist');
    assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET);
    assert.equal(harness.profileCalls.length, 2);
    assert.equal(harness.dropdown.automaticRecoveries, 1);
});

for (const [description, walletAddress] of [['case-insensitive', WALLET.toUpperCase()], ['omitted', undefined]]) {
    test(`${description} profile wallet fields preserve correctly bound profile display`, async () => {
        const profile = { username: 'Current Artist', avatar_url: 'https://fixture.invalid/own-avatar.png' };
        if (walletAddress !== undefined) profile.wallet_address = walletAddress;
        const harness = networkHarness({ profiles: { [WALLET]: profile } });
        await harness.dropdown.sync(WALLET, { confirmed: true });
        await harness.flush();
        assert.equal(harness.avatarName(), 'Current Artist');
        assert.equal(harness.avatarAddress(), '0xaaaa...aaaa');
        assert.equal(harness.avatarSrc(), profile.avatar_url);
        assert.ok(harness.menuHtml().includes(`class="avatar-menu-address-value">${WALLET}</span>`));
        assert.equal(harness.dropdown.profileCache.get(WALLET).username, 'Current Artist');
        assert.equal(harness.profileCalls.length, 1);
        assert.equal(harness.dropdown.automaticRecoveries, 0);
    });
}

for (const explicitWallet of [true, false]) {
    test(`render binds the ${explicitWallet ? 'requested' : 'current'} wallet when an unrelated profile is already present`, async () => {
        const harness = networkHarness();
        harness.dropdown.identityWallet = WALLET;
        harness.dropdown.resolvedIdentityWallet = WALLET;
        harness.dropdown.profile = {
            wallet_address: OTHER_WALLET, username: 'Another Artist', avatar_url: 'https://fixture.invalid/foreign-avatar.png'
        };
        await harness.dropdown.render(explicitWallet ? { walletAddress: WALLET } : {});
        await harness.flush();
        assert.equal(harness.avatarName(), '0xaaaa...aaaa');
        assert.equal(harness.avatarSrc(), '/default-avatar.png');
        assert.ok(harness.menuHtml().includes(`class="avatar-menu-address-value">${WALLET}</span>`));
        assert.equal(harness.imageLoads.includes('https://fixture.invalid/foreign-avatar.png'), false);
    });
}

test('a profile alone cannot create a connected header without an active wallet', async () => {
    const harness = networkHarness();
    harness.context.window.currentWalletAddress = null;
    harness.dropdown.profile = { wallet_address: OTHER_WALLET, username: 'Another Artist' };
    await harness.dropdown.render();
    await harness.flush();
    assert.equal(harness.avatarName(), 'ArtSoul Guest');
    assert.equal(harness.uiState(), 'disconnected');
    assert.match(harness.menuHtml(), /Connect Wallet/);
});

test('a profile from the previous wallet generation cannot name the new wallet', () => {
    const harness = networkHarness();
    harness.dropdown.identityWallet = OTHER_WALLET;
    harness.dropdown.resolvedIdentityWallet = OTHER_WALLET;
    harness.dropdown.profile = { wallet_address: WALLET, username: 'Previous Artist' };
    const html = harness.dropdown.renderMenuIdentity(WALLET);
    assert.doesNotMatch(html, /Previous Artist/);
    assert.match(html, /0xaaaa\.\.\.aaaa/);
});

test('restoring identity uses only the exact wallet-bound preview name', () => {
    const harness = networkHarness({ storage: {
        artsoul_header_identity: JSON.stringify({ wallet: WALLET, name: 'Preview Artist', avatarUrl: '/default-avatar.png' })
    } });
    assert.match(harness.dropdown.renderMenuIdentity(WALLET, true), /Preview Artist/);
    const differentWallet = harness.dropdown.renderMenuIdentity(OTHER_WALLET, true);
    assert.doesNotMatch(differentWallet, /Preview Artist/);
    assert.ok(differentWallet.includes(OTHER_WALLET));
});

test('guest identity is explicit and has no stale wallet address or name', () => {
    const harness = networkHarness();
    harness.dropdown.identityWallet = WALLET;
    harness.dropdown.resolvedIdentityWallet = WALLET;
    harness.dropdown.profile = { wallet_address: WALLET, username: 'Previous Artist' };
    harness.dropdown.renderConnectButton();
    assert.match(harness.menuHtml(), /class="avatar-menu-name">ArtSoul Guest<\/span>/);
    assert.doesNotMatch(harness.menuHtml(), /class="avatar-menu-address"|Previous Artist/);
});

test('menu names are escaped and invalid wallet markup is discarded', () => {
    const harness = networkHarness();
    harness.dropdown.identityWallet = WALLET;
    harness.dropdown.resolvedIdentityWallet = WALLET;
    harness.dropdown.profile = { wallet_address: WALLET, username: '<img src=x onerror=alert(1)>' };
    const html = harness.dropdown.renderMenuIdentity(WALLET);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img src=x/);
    const invalid = harness.dropdown.renderMenuIdentity(`${WALLET}<script>`, true);
    assert.match(invalid, /ArtSoul Guest/);
    assert.doesNotMatch(invalid, /<script|avatar-menu-address/);
});

test('the menu identity refreshes after a same-wallet profile rename', async () => {
    const harness = networkHarness({ profiles: {
        [WALLET]: { wallet_address: WALLET, username: 'Original Artist' }
    } });
    await harness.dropdown.sync(WALLET, { confirmed: true });
    await harness.flush();
    assert.match(harness.menuHtml(), /class="avatar-menu-name">Original Artist<\/span>/);
    harness.setProfile(WALLET, { wallet_address: WALLET, username: 'Renamed Artist' });
    await harness.dropdown.refresh(WALLET);
    await harness.flush();
    assert.match(harness.menuHtml(), /class="avatar-menu-name">Renamed Artist<\/span>/);
    assert.doesNotMatch(harness.menuHtml(), /Original Artist/);
});
