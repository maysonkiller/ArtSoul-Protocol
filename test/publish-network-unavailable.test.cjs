const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const upload = fs.readFileSync('src/entries/upload.js', 'utf8');
const appkit = fs.readFileSync('appkit-init.js', 'utf8');

test('an unanswering node is not reported as a rejected artwork', () => {
  // Reported 2026-08-21: publishing failed with "The artwork registration
  // transaction failed on Base Sepolia. No artwork was published." The
  // transaction had never been sent. The public endpoint was returning "no
  // backend is currently healthy to serve traffic", and ethers reports that as
  // `missing revert data` with a null reason and null data on estimateGas. The
  // identical call estimated at 0x37318 against another endpoint at the same
  // moment, from the same address, with the contract unpaused and the wallet
  // holding 0.33 ETH.
  //
  // A revert carries a reason. This one carries none.
  assert.match(upload, /lower\.includes\('missing revert data'\)/);
  assert.match(upload, /code: 'NETWORK_UNAVAILABLE'/);
  assert.match(upload, /nothing was sent and nothing was published/);
  // It must be classified BEFORE the revert branch, which would otherwise
  // swallow it: a missing-revert-data error also carries code CALL_EXCEPTION.
  assert.ok(
    upload.indexOf("code: 'NETWORK_UNAVAILABLE'") < upload.indexOf("code: 'TRANSACTION_REVERTED'"),
    'an unanswering node must be classified before a genuine revert'
  );
});

test('a real revert still says the transaction failed', () => {
  // The distinction only matters if the other branch survives intact.
  assert.match(upload, /code: 'TRANSACTION_REVERTED'/);
  assert.match(upload, /The artwork registration transaction failed on Base Sepolia/);
});

test('one chain, one list, more than one way to reach it', () => {
  // There were two lists. appkit-init.js configures the wallet's chain; the
  // account menu reads the balance with its own fetch, from a classic script
  // that cannot import a module, and still had a single address - so one
  // endpoint going quiet left the balance showing a bare ellipsis while
  // everything else had somewhere else to go.
  const network = fs.readFileSync('base-network.js', 'utf8');
  const dropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');

  const listed = [...network.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(listed.length >= 3, `at least three routes, saw ${listed.length}`);
  assert.equal(listed[0], 'https://sepolia.base.org', 'the public endpoint stays first');

  // Both consumers take that list rather than keeping their own.
  assert.match(appkit, /window\.ArtSoulBaseSepolia\?\.rpcUrls\?\.length/);
  assert.match(dropdown, /window\.ArtSoulBaseSepolia\?\.rpc;/);
  // Guarded: a helper that is merely absent must not read as one that answered.
  assert.match(dropdown, /if \(typeof route !== 'function'\) throw new Error/);

  // The floor in appkit-init is the same list, not a second opinion.
  const floor = appkit.slice(appkit.indexOf('const BASE_SEPOLIA_RPC_URLS'));
  const fallback = [...floor.slice(0, floor.indexOf('];')).matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(fallback, listed, 'the fallback must match base-network.js exactly');

  // Still one chain, and mainnet stays negotiation-only.
  assert.match(appkit, /const BASE_SEPOLIA_CHAIN_ID = 84532;/);
  assert.match(network, /chainId: 84532,/);
  assert.doesNotMatch(network, /solana|polygon|arbitrum/i);
});

test('every route is tried before the caller is told nothing came back', () => {
  const network = fs.readFileSync('base-network.js', 'utf8');
  assert.match(network, /for \(const url of RPC_URLS\)/);
  assert.match(network, /return payload\.result;/);
  assert.match(network, /throw lastError \|\| new Error/);
});

test('an outage never erases a balance already known', () => {
  // The initial value used to be an ellipsis regardless, so a failed read
  // replaced a number the menu had shown a moment earlier.
  const dropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');
  assert.match(dropdown, /let balance = cachedNetwork\?\.chainId === chainId && cachedNetwork\.balance/);
});

test('the list loads before both consumers', () => {
  for (const page of ['index.html', 'gallery.html', 'artwork.html', 'profile.html',
                      'upload.html', 'docs-protocol.html', 'admin.html']) {
    const html = fs.readFileSync(page, 'utf8');
    const list = html.indexOf('base-network.js');
    assert.ok(list > -1, `${page} must load the route list`);
    for (const consumer of ['avatar-dropdown.js', 'appkit-init.js']) {
      const at = html.indexOf(consumer);
      if (at === -1) continue;
      assert.ok(list < at, `${page}: the route list must load before ${consumer}`);
    }
  }
});
