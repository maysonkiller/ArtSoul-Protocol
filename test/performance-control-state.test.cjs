const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');

function runtime() {
    const listeners = new Map();
    const timers = new Map();
    let nextTimer = 0;
    const context = {
        console: { log() {} },
        document: {
            readyState: 'loading', querySelectorAll: () => [],
            body: { classList: { add() {} } },
            addEventListener: (event, listener) => listeners.set(event, listener)
        },
        window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
        navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
        IntersectionObserver: class { observe() {} },
        setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: id => timers.delete(id)
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/core/utils/performance-utils.js'), 'utf8')
        .replace(/export\s*\{[^}]*\};/, '');
    vm.runInNewContext(source, context);
    listeners.get('DOMContentLoaded')();
    return {
        capture(button) { listeners.get('click')?.({ target: { closest: () => button } }); },
        finishTimers() {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach(callback => callback());
        },
        timers
    };
}

for (const kind of ['empty rapid attribute', 'valued rapid attribute', 'toggle', 'ordinary', 'already disabled']) {
    test(`shared startup preserves ${kind} control state and styling`, () => {
        const h = runtime();
        const button = {
            disabled: kind === 'already disabled',
            style: { opacity: '0.85', cursor: 'default' },
            dataset: kind === 'empty rapid attribute' ? { allowRapid: '' }
                : kind === 'valued rapid attribute' ? { allowRapid: 'true' } : {},
            classList: { contains: value => kind === 'toggle' && value === 'toggle' }
        };
        h.capture(button);
        h.capture(button);
        h.finishTimers();
        assert.equal(button.disabled, kind === 'already disabled');
        assert.deepEqual(button.style, { opacity: '0.85', cursor: 'default' });
        assert.equal(h.timers.size, 0);
    });
}

test('the real async copy handler runs once and remains disabled until its own completion', async () => {
    const runtimeHarness = runtime();
    const avatar = createAvatarHarness();
    const wallet = `0x${'ab'.repeat(20)}`;
    const structure = avatar.dropdown.getStableStructure();
    avatar.context.window.currentWalletAddress = wallet;
    const button = structure.dropdown.querySelector('[data-avatar-address]');
    button.hidden = false;
    avatar.dropdown.syncHeaderCopyControls(structure, { previewWallet: wallet, name: 'Artist' });
    let resolve;
    const writes = [];
    avatar.context.navigator.clipboard = {
        writeText(address) { writes.push(address); return new Promise(done => { resolve = done; }); }
    };
    const event = { currentTarget: button, preventDefault() {}, stopPropagation() {} };
    runtimeHarness.capture(button);
    const pending = avatar.dropdown.copyHeaderIdentity(event);
    assert.deepEqual(writes, [wallet], 'the first activation reaches its real handler');
    assert.equal(button.disabled, true);
    runtimeHarness.finishTimers();
    assert.equal(button.disabled, true, 'shared timers cannot finish the clipboard operation');
    runtimeHarness.capture(button);
    await avatar.dropdown.copyHeaderIdentity(event);
    assert.equal(writes.length, 1);
    resolve();
    await pending;
    assert.equal(button.disabled, false);
    assert.equal(structure.dropdown.querySelector('[data-avatar-copy-status]').textContent, 'Address copied');
});
