const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
let compiled;
test.before(async () => {
    const {transformWithOxc} = await import('vite');
    const source = fs.readFileSync('src/ui/explained-action.jsx', 'utf8')
        .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
    compiled = (await transformWithOxc(source, 'explained-action.jsx', {jsx: {runtime: 'classic'}})).code;
});
function harness() {
    const modal = {open: false, showModal() {this.open = true;}, close() {this.open = false;}};
    let previous = null, effect;
    const scope = {React, document: {body: {}}, createPortal: child => child, useId: () => 'action-id', useRef: () => ({current: modal}),
        useEffect: (fn, deps) => { if (!previous || deps.some((d,i) => d !== previous[i])) effect = fn; previous = deps; }};
    vm.runInNewContext(compiled + '\nthis.Component = ExplainedAction;', scope);
    return {modal, render(props) {effect = null; const view = scope.Component(props); effect?.();
        return {view, button: view.props.children[0], dialog: view.props.children[1]};}};
}
function event() {return {prevented: false, stopped: false, preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}};}
test('restricted activation explains without invoking the action or bubbling navigation', () => {
    const h = harness(); let calls = 0;
    const {button} = h.render({reason: 'You created this artwork.', children: 'Bid', onClick: () => calls++});
    const e = event(); button.props.onClick(e);
    assert.equal(h.modal.open, true); assert.equal(calls, 0);
    assert.equal(e.prevented, true); assert.equal(e.stopped, true);
    assert.equal(button.props.disabled, false); assert.equal(button.props['aria-disabled'], true);
});
test('permitted action and submit behavior are preserved', () => {
    const h = harness(); let calls = 0;
    const {button} = h.render({type: 'submit', children: 'Continue', onClick: () => calls++});
    const e = event(); button.props.onClick(e);
    assert.equal(calls, 1); assert.equal(e.prevented, false); assert.equal(h.modal.open, false);
    assert.equal(button.props.type, 'submit'); assert.equal(button.props['aria-disabled'], undefined);
});
test('pending operations cannot be activated even when a reason is present', () => {
    const h = harness(); let calls = 0;
    const {button} = h.render({disabled: true, reason: 'Unavailable', onClick: () => calls++});
    button.props.onClick(event());
    assert.equal(calls, 0); assert.equal(h.modal.open, false);
    assert.equal(button.props.disabled, true);
});
test('changing wallet context or restriction closes the explanation', () => {
    const h = harness();
    h.render({reason: 'Already leading', contextKey: 'wallet-a'}).button.props.onClick(event());
    assert.equal(h.modal.open, true);
    h.render({reason: 'Already leading', contextKey: 'wallet-b'});
    assert.equal(h.modal.open, false);
    h.render({reason: 'Already leading', contextKey: 'wallet-b'}).button.props.onClick(event());
    h.render({reason: '', contextKey: 'wallet-b'});
    assert.equal(h.modal.open, false);
});
test('dialog has a named explanation and an explicit non-submit close control', () => {
    const h = harness();
    const {view, dialog} = h.render({reason: '<script>no HTML</script>', explanationTitle: 'You are the creator'});
    assert.equal(dialog.props['aria-labelledby'], 'action-id-title');
    assert.equal(dialog.props['aria-describedby'], 'action-id-reason');
    const close = dialog.props.children[2];
    assert.equal(close.props.type, 'button');
    h.modal.open = true; close.props.onClick();
    assert.equal(h.modal.open, false);
    const markup = renderToStaticMarkup(view);
    assert.match(markup, /&lt;script&gt;no HTML&lt;\/script&gt;/);
    assert.doesNotMatch(markup, /<script>/);
});

test('nested explanations do not cancel or close their parent form dialog', () => {
    const {dialog} = harness().render({reason: 'Review this before continuing.'});
    for (const handler of [dialog.props.onCancel, dialog.props.onClose]) {
        const e = event(); handler(e);
        assert.equal(e.stopped, true);
        assert.equal(e.prevented, false, 'Escape must still close the explanation itself');
    }
});

