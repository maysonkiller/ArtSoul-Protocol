const test = require('node:test');
const assert = require('node:assert/strict');
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');

const WALLET = '0x' + '11'.repeat(20);

function copyHarness(options = {}) {
    const harness = createAvatarHarness(options);
    const structure = harness.dropdown.getStableStructure();
    harness.context.window.currentWalletAddress = WALLET;
    const button = structure.dropdown.querySelector('[data-avatar-address]');
    button.hidden = false;
    button.textContent = '0x1111...1111';
    harness.dropdown.syncHeaderCopyControls(structure, { previewWallet: WALLET, name: 'Artist' });
    const status = structure.dropdown.querySelector('[data-avatar-copy-status]');
    return { harness, button, status, event: { currentTarget: button, preventDefault() {}, stopPropagation() {} } };
}

test('single activation copies the full displayed wallet and confirms only after success', async () => {
    const { harness, button, status, event } = copyHarness();
    assert.equal(button.getAttribute('aria-label'), `Copy wallet address: ${WALLET}`);
    let resolve;
    const writes = [];
    harness.context.navigator.clipboard = { writeText(value) { writes.push(value); return new Promise(r => { resolve = r; }); } };
    const pending = harness.dropdown.copyHeaderIdentity(event);
    assert.equal(button.disabled, true);
    assert.equal(status.textContent, '');
    await harness.dropdown.copyHeaderIdentity(event);
    assert.deepEqual(writes, [WALLET]);
    resolve();
    await pending;
    assert.equal(status.textContent, 'Address copied');
    assert.equal(button.disabled, false);
});

test('unavailable or denied clipboard gives a recoverable message and never claims success', async () => {
    for (const clipboard of [undefined, { writeText: async () => { throw new Error('Denied'); } }]) {
        const { harness, button, status, event } = copyHarness();
        harness.context.navigator.clipboard = clipboard;
        await harness.dropdown.copyHeaderIdentity(event);
        assert.match(status.textContent, /Could not copy/);
        assert.equal(button.disabled, false);
        assert.equal(button.textContent, '0x1111...1111');
        assert.equal(button.dataset.walletAddress, WALLET);
    }
});

test('refreshing the same identity during a pending copy restores its controls without stale feedback', async () => {
    const { harness, button, status, event } = copyHarness();
    let resolve;
    harness.context.navigator.clipboard = { writeText: () => new Promise(r => { resolve = r; }) };
    const pending = harness.dropdown.copyHeaderIdentity(event);
    harness.dropdown.identityCommitToken++;
    harness.dropdown.syncHeaderCopyControls(harness.dropdown.getStableStructure(), { previewWallet: WALLET, name: 'Artist' });
    assert.equal(button.disabled, false);
    resolve();
    await pending;
    assert.equal(button.disabled, false);
    assert.equal(status.textContent, '');
});

test('copy feedback from an older account never changes the new account menu', async () => {
    const { harness, status, event } = copyHarness();
    let resolve;
    harness.context.navigator.clipboard = { writeText: () => new Promise(r => { resolve = r; }) };
    const pending = harness.dropdown.copyHeaderIdentity(event);
    const nextWallet = '0x' + '22'.repeat(20);
    harness.context.window.currentWalletAddress = nextWallet;
    harness.dropdown.syncHeaderCopyControls(harness.dropdown.getStableStructure(), { previewWallet: nextWallet, name: 'Next artist' });
    resolve();
    await pending;
    assert.equal(status.textContent, '');
    assert.equal(event.currentTarget.dataset.walletAddress, nextWallet);
    assert.equal(event.currentTarget.disabled, false);
});

test('account menu never duplicates the fifth Profile link in shared navigation', () => {
    const harness = createAvatarHarness();
    const nav = harness.document.createElement('nav');
    nav.className = 'site-primary-nav';
    harness.document.body.appendChild(nav);
    const html = harness.dropdown.renderDropdownNavItems({ currentPath: '/gallery', isOwnProfile: false });
    assert.doesNotMatch(html, /href="\/profile"/);
    for (const href of ['/', '/gallery', '/upload', '/docs-protocol']) assert.ok(!html.includes(`href="${href}"`));
});

test('legacy pages without primary navigation retain their existing destinations', () => {
    const harness = createAvatarHarness();
    const html = harness.dropdown.renderDropdownNavItems({ currentPath: '/artwork', isOwnProfile: false });
    for (const href of ['/', '/gallery', '/upload', '/docs-protocol']) assert.ok(html.includes(`href="${href}"`));
    assert.doesNotMatch(html, /href="\/profile"/, 'Profile is now a global primary destination');
    assert.equal(harness.dropdown.getMenuIdentity('').wallet, '');
});

test('compact account menu keeps network and disconnect without duplicate navigation or identity', () => {
    const harness = createAvatarHarness();
    const nav = harness.document.createElement('nav');
    nav.className = 'site-primary-nav';
    harness.document.body.appendChild(nav);
    harness.dropdown.protocolAdminEligible = true;
    const html = harness.dropdown.renderMenuContent({
        currentPath: '/gallery', connected: true, walletAddress: WALLET,
        networkInfo: { chainId: 84532, name: 'Base Sepolia', mark: 'base', balance: '0.23', walletProvider: { name: 'Rabby', mark: 'rabby' } }
    });
    assert.ok(html.indexOf('avatar-wallet-section') < html.indexOf('avatar-account-action'));
    assert.doesNotMatch(html, /avatar-menu-identity|avatar-theme-section|href="\/profile"|href="\/admin"/);
    assert.doesNotMatch(html, /data-wallet-provider/, 'connector is on the plaque, not a repeated menu row');
    assert.match(html, /network-switcher-btn network-current-row/);
    assert.match(html, /aria-controls="avatarNetworkOptions"/);
    assert.match(html, /window\.resetWalletConnection\(\)/);
    harness.dropdown.protocolAdminEligible = false;
    assert.doesNotMatch(harness.dropdown.renderMenuContent({ currentPath: '/gallery' }), /href="\/admin"/);
});

test('copy controls are siblings of the menu button and keep separate payloads', async () => {
    const { harness, button } = copyHarness();
    const structure = harness.dropdown.getStableStructure();
    const name = structure.dropdown.querySelector('[data-avatar-name]');
    assert.equal(name.dataset.copyValue, 'Artist');
    assert.equal(button.dataset.copyValue, WALLET);
    assert.notEqual(button.parentNode, structure.button);
    assert.equal(button.parentNode.parentNode, structure.plaque);
    const writes = [];
    harness.context.navigator.clipboard = { writeText: async value => writes.push(value) };
    await harness.dropdown.copyHeaderIdentity({ currentTarget: name });
    assert.deepEqual(writes, ['Artist']);
    assert.equal(name.dataset.copyState, 'copied');
    assert.equal(structure.button.getAttribute('aria-expanded'), 'false');
});

test('unconfirmed preview and guest identities cannot copy a wallet', () => {
    const { harness, button } = copyHarness();
    harness.context.window.currentWalletAddress = null;
    harness.dropdown.syncHeaderCopyControls(harness.dropdown.getStableStructure(), { previewWallet: WALLET, name: 'Artist' });
    assert.equal(button.disabled, true);
    assert.equal(button.dataset.copyValue, '');
});

test('iOS embedded browser copies through the synchronous selection fallback when Clipboard API is absent', async () => {
    const { harness, button, status, event } = copyHarness({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    harness.context.navigator.clipboard = undefined;
    const original = harness.document.createElement.bind(harness.document);
    let selected = '', copied = 0, removed = false;
    harness.document.createElement = tag => {
        const field = original(tag);
        if (tag === 'textarea') {
            field.focus = () => {};
            field.select = () => {
                assert.equal(field.readOnly, false, 'iOS needs a selectable, non-readonly textarea');
                selected = field.value;
            };
            field.setSelectionRange = () => {};
            field.remove = () => { removed = true; };
        }
        return field;
    };
    harness.document.execCommand = command => {
        assert.equal(command, 'copy');
        assert.equal(selected, WALLET);
        copied++;
        return true;
    };
    assert.equal(await harness.dropdown.copyHeaderIdentity(event), true);
    assert.equal(copied, 1);
    assert.equal(removed, true, 'temporary textarea must always be removed');
    assert.equal(status.textContent, 'Address copied');
    assert.equal(button.dataset.copyState, 'copied');
    assert.equal(button.disabled, false);
});

test('a rejected browser Clipboard API can recover using legacy copy without faking success', async () => {
    const { harness, button, status, event } = copyHarness();
    harness.context.navigator.clipboard = { writeText: async () => { throw new Error('NotAllowedError'); } };
    const original = harness.document.createElement.bind(harness.document);
    let selected = '';
    harness.document.createElement = tag => {
        const field = original(tag);
        if (tag === 'textarea') {
            field.focus = () => {};
            field.select = () => { selected = field.value; };
            field.remove = () => {};
        }
        return field;
    };
    harness.document.execCommand = command => command === 'copy' && selected === WALLET;
    assert.equal(await harness.dropdown.copyHeaderIdentity(event), true);
    assert.equal(status.textContent, 'Address copied');
    assert.equal(button.dataset.copyState, 'copied');
});

test('when both copy mechanisms fail, the user sees an honest failure and can manually select full address', async () => {
    const { harness, button, status, event } = copyHarness({ userAgent: 'iPhone' });
    harness.context.navigator.clipboard = { writeText: async () => { throw new Error('Denied'); } };
    const prompts = [];
    harness.context.window.prompt = (label, address) => prompts.push({ label, address });
    const original = harness.document.createElement.bind(harness.document);
    harness.document.createElement = tag => {
        const field = original(tag);
        if (tag === 'textarea') {
            field.focus = () => {};
            field.select = () => {};
            field.remove = () => {};
        }
        return field;
    };
    harness.document.execCommand = () => false;
    assert.equal(await harness.dropdown.copyHeaderIdentity(event), false);
    assert.equal(button.dataset.copyState, 'unavailable');
    assert.match(status.textContent, /Could not copy/);
    assert.deepEqual(prompts, [{ label: 'Copy wallet address:', address: WALLET }]);
});
