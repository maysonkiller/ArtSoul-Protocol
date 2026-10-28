const test = require('node:test');
const assert = require('node:assert/strict');
const {createAvatarHarness} = require('./helpers/avatar-dropdown-harness.cjs');

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const cached = () => ({artsoul_wallet: A, artsoul_header_ui_state: 'connected',
  artsoul_header_identity: JSON.stringify({wallet: A, name: 'Artist', avatarUrl: '/default-avatar.png'})});

function paint(storage, userAgent = 'desktop') {
  const h = createAvatarHarness({prepaint: true, settled: false, readyState: 'loading', storage, userAgent});
  const host = h.document.createElement('div'); host.id = 'header-notifications'; host.hidden = true;
  h.document.body.appendChild(host);
  h.context.ArtSoulHeaderPrepaint.hydrate(h.navButtons);
  return {h, host, hint: h.context.ArtSoulHeaderPrepaint.boot.notificationWallet};
}

test('prepaint restores only a generic bell for the matching previously connected identity', () => {
  for (const agent of ['desktop', 'iPhone']) {
    const {h, host, hint} = paint(cached(), agent);
    assert.equal(host.hidden, false); assert.equal(hint, A); assert.equal(host.dataset.notificationWallet, A);
    assert.equal(h.context.currentWalletAddress, undefined);
    assert.equal(h.context.artsoulWalletStateSettled, false);
    assert.equal(h.accessCalls.length, 0);
    assert.equal(h.dropdown.protocolAdminEligible, false);
  }
});

test('guests, explicit desktop disconnect and mismatched cache retain the generic bell without a wallet hint', () => {
  for (const storage of [{}, {...cached(), '@appkit/connection_status': 'disconnected'},
    {...cached(), artsoul_header_ui_state: 'disconnected'}, {...cached(), artsoul_wallet: B},
    {...cached(), artsoul_header_identity: '{malformed'}, {...cached(), artsoul_wallet: 'not-a-wallet'}]) {
    const {h, host, hint} = paint(storage);
    assert.equal(host.hidden, false); assert.equal(hint, ''); assert.equal(host.dataset.notificationWallet, '');
    assert.equal(h.accessCalls.length, 0);
    assert.equal(h.context.currentWalletAddress, undefined);
    assert.equal(h.context.artsoulWalletStateSettled, false);
    assert.equal(h.dropdown.protocolAdminEligible, false);
  }
});
