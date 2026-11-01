const test = require('node:test');
const assert = require('node:assert/strict');
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');

const WALLET = '0x' + '11'.repeat(20);

function copyHarness() {
    const harness = createAvatarHarness();
    const holder = harness.document.createElement('div');
    holder.innerHTML = harness.dropdown.renderMenuIdentity(WALLET);
    const button = holder.querySelector('.avatar-menu-address');
    const status = button.querySelector('.avatar-menu-copy-status');
    return { harness, button, status, event: { currentTarget: button, preventDefault() {}, stopPropagation() {} } };
}

test('single activation copies the full displayed wallet and confirms only after success', async () => {
    const { harness, button, status, event } = copyHarness();
    assert.equal(button.getAttribute('aria-label'), `Copy wallet address ${WALLET}`);
    let resolve;
    const writes = [];
    harness.context.navigator.clipboard = { writeText(value) { writes.push(value); return new Promise(r => { resolve = r; }); } };
    const pending = harness.dropdown.copyMenuAddress(event);
    assert.equal(button.disabled, true);
    assert.equal(status.textContent, 'Copy address');
    await harness.dropdown.copyMenuAddress(event);
    assert.deepEqual(writes, [WALLET]);
    resolve();
    await pending;
    assert.equal(status.textContent, 'Copied');
    assert.equal(button.disabled, false);
});

test('unavailable or denied clipboard gives a recoverable message and never claims success', async () => {
    for (const clipboard of [undefined, { writeText: async () => { throw new Error('Denied'); } }]) {
        const { harness, button, status, event } = copyHarness();
        harness.context.navigator.clipboard = clipboard;
        await harness.dropdown.copyMenuAddress(event);
        assert.match(status.textContent, /Could not copy/);
        assert.equal(button.disabled, false);
        assert.equal(button.querySelector('.avatar-menu-address-value').textContent, WALLET);
    }
});

test('copy feedback from an older account never changes the new account menu', async () => {
    const { harness, status, event } = copyHarness();
    let resolve;
    harness.context.navigator.clipboard = { writeText: () => new Promise(r => { resolve = r; }) };
    const pending = harness.dropdown.copyMenuAddress(event);
    const next = harness.document.createElement('div');
    const nextWallet = '0x' + '22'.repeat(20);
    next.innerHTML = harness.dropdown.renderMenuIdentity(nextWallet);
    resolve();
    await pending;
    assert.equal(status.textContent, 'Copied');
    assert.equal(next.querySelector('.avatar-menu-copy-status').textContent, 'Copy address');
    assert.equal(next.querySelector('.avatar-menu-address-value').textContent, nextWallet);
});

test('account menu keeps the profile destination without repeating visible primary navigation', () => {
    const harness = createAvatarHarness();
    const nav = harness.document.createElement('nav');
    nav.className = 'site-primary-nav';
    harness.document.body.appendChild(nav);
    const html = harness.dropdown.renderDropdownNavItems({ currentPath: '/gallery', isOwnProfile: false });
    assert.match(html, /href="\/profile"/);
    for (const href of ['/', '/gallery', '/upload', '/docs-protocol']) assert.ok(!html.includes(`href="${href}"`));
});

test('legacy pages without primary navigation retain their existing destinations', () => {
    const harness = createAvatarHarness();
    const html = harness.dropdown.renderDropdownNavItems({ currentPath: '/artwork', isOwnProfile: false });
    for (const href of ['/', '/profile', '/gallery', '/upload', '/docs-protocol']) assert.ok(html.includes(`href="${href}"`));
    assert.doesNotMatch(harness.dropdown.renderMenuIdentity(''), /avatar-menu-address/);
});
