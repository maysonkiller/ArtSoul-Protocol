const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let compiled;
test.before(async () => {
    const { transformWithOxc } = await import('vite');
    const source = fs.readFileSync('src/ui/context-help.jsx', 'utf8')
        .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
    compiled = (await transformWithOxc(source, 'context-help.jsx', { jsx: { runtime: 'classic' } })).code;
});
function harness(topic) {
    let cleanup, ref = 0;
    const focus = [];
    const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
    const trigger = { isConnected: true, focus: options => focus.push(options.preventScroll) };
    const scope = { React, document: { body: {} }, createPortal: child => child, useId: () => 'help-id',
        useRef: () => ({ current: ref++ ? trigger : modal }), useEffect: fn => { cleanup = fn(); } };
    vm.runInNewContext(compiled + '\nthis.Component = ContextHelp;', scope);
    const view = scope.Component({ topic });
    return { view, modal, trigger, focus, cleanup, button: view?.props.children[0], dialog: view?.props.children[1] };
}
test('help opens a named native dialog without triggering a form or financial action', () => {
    const h = harness('auction');
    assert.equal(h.button.props.type, 'button');
    assert.equal(h.button.props['aria-haspopup'], 'dialog');
    assert.equal(h.button.props['aria-controls'], h.dialog.props.id);
    h.button.props.onClick();
    assert.equal(h.modal.open, true);
    assert.equal(h.dialog.props['aria-labelledby'], 'help-id-title');
    assert.equal(h.dialog.props['aria-describedby'], 'help-id-description');
    const close = h.dialog.props.children[0].props.children[1];
    assert.equal(close.props.autoFocus, true);
    assert.equal(close.props.type, 'button');
    close.props.onClick();
    assert.equal(h.modal.open, false);
});
test('Escape remains native and close restores the help trigger without scrolling', () => {
    const h = harness('trust'); let stopped = 0;
    const event = { stopPropagation() { stopped++; }, preventDefault() { throw new Error('Escape must close natively'); } };
    h.dialog.props.onCancel(event);
    h.dialog.props.onClose(event);
    assert.equal(stopped, 2);
    assert.deepEqual(h.focus, [true]);
    h.trigger.isConnected = false;
    h.dialog.props.onClose(event);
    assert.equal(h.focus.length, 1);
    h.button.props.onClick(); h.cleanup();
    assert.equal(h.modal.open, false, 'unmount closes the top layer');
});
test('dialog content and padding stay open; only a backdrop click dismisses', () => {
    const h = harness('reactions');
    const target = { getBoundingClientRect: () => ({ left: 20, right: 300, top: 20, bottom: 500 }) };
    h.button.props.onClick();
    h.dialog.props.onClick({ target: {}, currentTarget: target, clientX: 0, clientY: 0 });
    assert.equal(h.modal.open, true);
    h.dialog.props.onClick({ target, currentTarget: target, clientX: 30, clientY: 30 });
    assert.equal(h.modal.open, true);
    h.dialog.props.onClick({ target, currentTarget: target, clientX: 10, clientY: 30 });
    assert.equal(h.modal.open, false);
});
test('guidance preserves signal, ownership and settlement boundaries with real documentation links', () => {
    const reactions = renderToStaticMarkup(harness('reactions').view);
    assert.match(reactions, /does not place a bid or make a purchase/);
    assert.match(reactions, /separate from your private Saved list/);
    assert.match(reactions, /does not itself promise a reminder/);
    const trust = renderToStaticMarkup(harness('trust').view);
    assert.match(trust, /discovery ordering only/);
    assert.match(trust, /does not change price, floor, ownership, settlement or fees/);
    for (const markup of [reactions, trust]) assert.match(markup, /href="\/docs-protocol#trust-community"/);
    const auction = renderToStaticMarkup(harness('auction').view);
    assert.match(auction, /highest bid alone does not create an NFT/);
    assert.match(auction, /excess becomes withdrawable credit/);
    assert.match(auction, /href="\/docs-protocol#settlement"/);
    assert.match(auction, /href="\/docs-protocol#deposits"/);
});
test('unknown guidance renders no empty control', () => {
    assert.equal(harness('unknown').view, null);
});
