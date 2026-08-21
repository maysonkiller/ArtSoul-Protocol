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

test('one chain, more than one way to reach it', () => {
  // A single public endpoint meant one outage stopped every write. These are
  // additional routes to the same chain, not another network: Base only.
  assert.match(appkit, /const BASE_SEPOLIA_RPC_URLS = \[/);
  const list = appkit.slice(appkit.indexOf('const BASE_SEPOLIA_RPC_URLS = ['));
  const block = list.slice(0, list.indexOf('];'));
  const entries = block.split(String.fromCharCode(10)).slice(1)
    .map((l) => l.trim().replace(/,$/, "")).filter(Boolean);
  assert.ok(entries.length >= 3, `at least three routes, saw ${entries.length}`);
  assert.equal(entries[0], 'BASE_SEPOLIA_RPC_URL', 'the public endpoint stays first');
  assert.match(appkit, /rpcUrls: BASE_SEPOLIA_RPC_URLS,/);
  assert.match(appkit, /BASE_SEPOLIA_RPC_URLS\.map\(url => \(\{ url \}\)\)/);
  // Still one chain id, and mainnet stays negotiation-only.
  assert.match(appkit, /const BASE_SEPOLIA_CHAIN_ID = 84532;/);
  assert.doesNotMatch(block, /solana|polygon|arbitrum|optimism\.io/i);
});
