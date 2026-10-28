const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('modal-system.js', 'utf8');

function harness() {
  const nodes = new Map();
  const document = {
    createElement() {
      const el = {style: {}, children: [], appendChild(child) {this.children.push(child); if (child.id) nodes.set(child.id, child);}};
      Object.defineProperty(el, 'innerHTML', {set() {this.children = [];}});
      return el;
    },
    getElementById: id => nodes.get(id)
  };
  document.body = document.createElement(); document.head = document.createElement();
  const window = {};
  vm.runInNewContext(source, {window, document, localStorage: {getItem: () => 'classic'}, console: {log() {}}});
  return {window, container: () => nodes.get('modal-container'),
    buttons: () => nodes.get('modal-container').children[1].children[2].children};
}

test('only the explicit confirm button resolves true; cancel, backdrop and close resolve false', async () => {
  for (const action of ['accept', 'cancel', 'backdrop', 'close']) {
    const h = harness(), decision = h.window.confirm('Review this action');
    if (action === 'accept') h.buttons()[1].onclick();
    if (action === 'cancel') h.buttons()[0].onclick();
    if (action === 'backdrop') h.container().children[0].onclick();
    if (action === 'close') h.window.ArtSoulModal.close();
    assert.equal(await decision, action === 'accept', action);
    assert.equal(h.container().style.display, 'none');
  }
});

test('replacing a confirmation with an alert releases the waiting caller as declined', async () => {
  const h = harness(), decision = h.window.confirm('Microphone disclosure');
  const alert = h.window.alert('Another page action finished');
  assert.equal(await decision, false);
  assert.equal(h.container().style.display, 'flex');
  h.buttons()[0].onclick(); await alert;
  const retry = h.window.confirm('Try again');
  h.buttons()[1].onclick(); assert.equal(await retry, true);
});

test('replacing a confirmation never applies the new approval to the previous request', async () => {
  const h = harness(), first = h.window.confirm('First action'), second = h.window.confirm('Second action');
  h.buttons()[1].onclick();
  assert.equal(await first, false); assert.equal(await second, true);
  h.window.ArtSoulModal.close(); h.window.ArtSoulModal.close();
});

test('replacing an alert settles it and leaves the new confirmation open', async () => {
  const h = harness(), first = h.window.alert('Notice'), second = h.window.confirm('Review');
  assert.equal(await first, undefined); assert.equal(h.container().style.display, 'flex');
  h.window.ArtSoulModal.close(); assert.equal(await second, false);
});
