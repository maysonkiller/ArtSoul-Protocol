// Lazy Protocol Admin menu discovery (A8c audit fix P2-6).
//
// Executes the real avatar-dropdown.js inside a minimal DOM harness and
// proves the discovery contract: a connected header render performs no
// /api/moderation/access request; the first dropdown opening performs exactly
// one; repeated openings reuse it; a wallet change invalidates the cached
// result; and the admin link is rendered only after a successful server
// response. Authorization itself stays server-side and is covered by
// protocol-admin-review.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAvatarHarness, SOURCE } = require('./helpers/avatar-dropdown-harness.cjs');

const WALLET_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WALLET_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// The shared harness (test/helpers/avatar-dropdown-harness.cjs) runs the real
// avatar-dropdown.js in one minimal DOM for every shared-header suite.
function createHarness() {
  return createAvatarHarness({ readyState: 'loading' });
}

test('connected header render performs no Protocol Admin access request', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 0);
  // The reserved slot keeps header geometry stable while staying empty.
  const menu = harness.context.document.getElementById('avatarDropdownMenu');
  assert.match(menu.innerHTML, /data-protocol-admin-slot/);
  assert.doesNotMatch(menu.innerHTML, /href="\/admin"/);
});

test('first dropdown opening performs exactly one access request; reopening reuses it', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);
  await harness.flush();

  assert.equal(harness.dropdown.toggle(), true);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);

  assert.equal(harness.dropdown.toggle(), false);
  assert.equal(harness.dropdown.toggle(), true);
  assert.equal(harness.dropdown.toggle(), false);
  assert.equal(harness.dropdown.toggle(), true);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);
});

test('the admin link appears only after a successful eligible server response', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);

  harness.setAccessResponse(() => ({
    ok: true,
    json: async () => ({ success: true, enabled: true, authenticated: true, eligible: false, access: null })
  }));
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.dropdown.protocolAdminEligible, false);
  assert.doesNotMatch(harness.dropdown.renderProtocolAdminSlot('/'), /href="\/admin"/);

  // A later wallet (fresh discovery) that the server confirms is eligible.
  harness.dropdown.toggle();
  harness.context.window.currentWalletAddress = WALLET_B;
  harness.dropdown.syncProtocolAdminWallet(WALLET_B);
  harness.setAccessResponse(() => ({
    ok: true,
    json: async () => ({
      success: true,
      enabled: true,
      authenticated: true,
      eligible: true,
      access: { role: 'moderator', stepUpActive: false, passkeyRequired: true }
    })
  }));
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.dropdown.protocolAdminEligible, true);
  assert.match(harness.dropdown.renderProtocolAdminSlot('/'), /href="\/admin"/);
  // The slot never renders the link on the admin page itself.
  assert.doesNotMatch(harness.dropdown.renderProtocolAdminSlot('/admin'), /href="\/admin"/);
});

test('a wallet change invalidates the cached discovery result', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);
  assert.equal(harness.dropdown.protocolAdminWallet, WALLET_A);
  assert.equal(harness.dropdown.protocolAdminEligible, true);
  harness.dropdown.toggle();

  // The next connected render for a different wallet clears the cached
  // result without issuing a request of its own.
  harness.context.window.currentWalletAddress = WALLET_B;
  await harness.dropdown.renderWalletInfo(WALLET_B);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);
  assert.equal(harness.dropdown.protocolAdminWallet, null);
  assert.equal(harness.dropdown.protocolAdminEligible, false);

  // Opening the menu for the new wallet performs one fresh request.
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.accessCalls.length, 2);
  assert.equal(harness.dropdown.protocolAdminWallet, WALLET_B);

  // A disconnect clears the cached result entirely.
  harness.context.window.currentWalletAddress = null;
  harness.dropdown.renderConnectButton();
  assert.equal(harness.dropdown.protocolAdminWallet, null);
  assert.equal(harness.dropdown.protocolAdminEligible, false);
});

test('guest and disconnected menu openings never request Protocol Admin access', async () => {
  const harness = createHarness();
  harness.dropdown.renderConnectButton();
  harness.dropdown.toggle();
  harness.dropdown.toggle();
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.accessCalls.length, 0);
});

test('render paths call only the non-fetching wallet sync', () => {
  // Static lock: fetch-based discovery lives only in the lazy open-path
  // method, and every render path uses the bookkeeping sync instead.
  const renderCalls = SOURCE.match(/this\.syncProtocolAdminWallet\(walletAddress\);/g) || [];
  assert.equal(renderCalls.length, 2);
  assert.doesNotMatch(SOURCE, /refreshProtocolAdminAccess/);
  const openCall = SOURCE.match(/void this\.requestProtocolAdminAccessOnce\(\);/g) || [];
  assert.equal(openCall.length, 1);
  // Discovery stays on the menu-open path only.
  assert.match(SOURCE, /if \(this\.isOpen\) \{\s*\n\s*void this\.requestProtocolAdminAccessOnce\(\);/);
});
