// A-70, reopened 2026-08-23.
//
// The row was closed on the strength of a founder publish that succeeded after
// the endpoint recovered. That is evidence the outage ended, not evidence the
// classification is right, and the stated criterion - a publish confirmed while
// one endpoint is unhealthy - was never met.
//
// What the classifier may and may not claim, in one place, because every defect
// this suite covers was a claim beyond the evidence:
//
//   - `action: 'estimateGas'` or `'call'` proves nothing left the browser.
//     Nothing else does. A send, a receipt wait, or an unlabelled action may
//     already be on the chain.
//   - A transaction hash proves the wallet broadcast something. After that,
//     "nothing was published" and "it failed" are both guesses, and the harmful
//     half of the guess is telling somebody to send it again.
//   - Revert data or a decoded reason proves the node executed something. A
//     revert wrapped in a provider's "internal error" envelope is still a
//     revert.
//   - No route answering supports an outage. One route answering supports
//     nothing: it is one cheap call to one endpoint, possibly seconds later,
//     and never necessarily the endpoint the wallet used.
//   - An HTTP 400 is an answer. Only a status the request never got past is
//     transport evidence.
//
// And every assertion in the original suite was a regular expression over the
// source. Those hold whether or not the failover loop can fall through. The
// tests below drive the real modules on an injected clock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const {
  loadBaseNetwork, result, rpcError, httpError, hang, BASE_SEPOLIA_CHAIN_ID_HEX
} = require('./helpers/base-network-harness.cjs');

const classifierUrl = pathToFileURL(
  path.join(__dirname, '..', 'src', 'features', 'publish', 'publish-error.js')
).href;

const PUBLIC = 'https://sepolia.base.org';
const PUBLICNODE = 'https://base-sepolia-rpc.publicnode.com';
const DRPC = 'https://base-sepolia.drpc.org';

const healthy = () => result(BASE_SEPOLIA_CHAIN_ID_HEX);

// The exact shape ethers 6 hands back when a node returns nothing at all: a
// CALL_EXCEPTION from gas estimation with null data and null reason. It is the
// error the founder saw on 2026-08-21 - and it is also what a reasonless revert
// looks like, which is the whole difficulty.
function reasonlessEstimateGasFailure() {
  return {
    code: 'CALL_EXCEPTION',
    action: 'estimateGas',
    reason: null,
    data: null,
    shortMessage: 'missing revert data',
    message: 'missing revert data (action="estimateGas", data=null, reason=null)'
  };
}

// A transport failure raised while ethers is polling for a receipt. By then the
// wallet has already broadcast, and `action` says nothing useful.
function lostConfirmation() {
  return { code: 'TIMEOUT', action: 'wait', shortMessage: 'timeout waiting for transaction receipt' };
}

// ---------------------------------------------------------------------------
// 1. A route that never answers must not hold the caller, or eat the budget.
// ---------------------------------------------------------------------------

test('a hanging first route times out and the second route answers', async () => {
  const { api, calls, drive } = loadBaseNetwork((url) => (url === PUBLIC ? hang() : result('0x37318')));

  const { value, elapsed } = await drive(api.rpc('eth_estimateGas', [{}]));

  assert.equal(value, '0x37318', 'the second route must supply the answer');
  assert.deepEqual(calls.map((call) => call.url), [PUBLIC, PUBLICNODE]);
  // Without a bound the first attempt never rejects and the loop never reaches
  // the second url, whatever the list contains.
  assert.equal(calls[0].aborted, true, 'the hanging attempt must be aborted');
  assert.equal(calls[1].aborted, false);
  assert.equal(elapsed, api.rpcTimeoutMs, 'the hang cost exactly one bound');
});

test('a hanging first route cannot spend the whole probe budget', async () => {
  // Reproduced on a real clock before this was fixed: ~3010 ms elapsed, only
  // sepolia.base.org fetched, PublicNode and dRPC marked skipped, and
  // reachable=false while the second endpoint was healthy. Handing the first
  // route the entire remaining budget is what did it.
  const { api, calls, drive } = loadBaseNetwork((url) => (url === PUBLIC ? hang() : healthy()));

  const { value: probed, elapsed } = await drive(api.probe());

  assert.equal(probed.reachable, true, 'the healthy second route must be found');
  assert.equal(probed.url, PUBLICNODE);
  assert.deepEqual(calls.map((call) => call.url), [PUBLIC, PUBLICNODE]);
  assert.ok(elapsed < api.probeBudgetMs, `the whole probe stayed inside its budget, took ${elapsed}ms`);
  assert.ok(
    probed.attempts.every((attempt) => attempt.transport !== 'skipped'),
    'no route may be skipped while budget remains'
  );
});

test('every route is still dialled when they all hang, inside one budget', async () => {
  const { api, calls, drive } = loadBaseNetwork(() => hang());

  const { value: probed, elapsed } = await drive(api.probe());

  assert.equal(probed.reachable, false);
  assert.deepEqual(calls.map((call) => call.url), [PUBLIC, PUBLICNODE, DRPC]);
  assert.ok(elapsed <= api.probeBudgetMs, `the budget covers the whole probe, took ${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// 2. An HTTP failure is transport evidence, and the loop moves on.
// ---------------------------------------------------------------------------

test('an HTTP error on the first route falls through to the second', async () => {
  const { api, calls, drive } = loadBaseNetwork((url) => (url === PUBLIC ? httpError(503) : healthy()));

  const { value } = await drive(api.rpc('eth_chainId', []));

  assert.equal(value, BASE_SEPOLIA_CHAIN_ID_HEX);
  assert.deepEqual(calls.map((call) => call.url), [PUBLIC, PUBLICNODE]);
});

test('only a status the request never got past is transport evidence', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);
  const failed = (status) => Object.assign(new Error(`returned ${status}`), {
    transport: 'http', status, action: 'estimateGas'
  });

  for (const status of [0, 408, 429, 500, 503]) {
    const classified = await classifyPublishFailure(failed(status), { stage: 'register' });
    assert.equal(classified.code, 'NETWORK_UNAVAILABLE', `HTTP ${status} is an outage`);
  }

  // A 400 means the server was up, read the request and rejected it. Calling
  // that an outage tells somebody to wait for a recovery that already happened.
  for (const status of [400, 401, 403, 404]) {
    const classified = await classifyPublishFailure(failed(status), { stage: 'register' });
    assert.notEqual(classified.code, 'NETWORK_UNAVAILABLE', `HTTP ${status} is an answer, not an outage`);
    assert.doesNotMatch(classified.message, /did not answer/);
  }
});

// ---------------------------------------------------------------------------
// 3. A JSON-RPC error body is an answer, but not the answer - try the next.
// ---------------------------------------------------------------------------

test('a JSON-RPC error on the first route falls through to the second', async () => {
  const { api, calls, drive } = loadBaseNetwork((url) => (url === PUBLIC ? rpcError(-32603, 'internal error') : result('0x1')));

  const { value } = await drive(api.rpc('eth_blockNumber', []));

  assert.equal(value, '0x1');
  assert.deepEqual(calls.map((call) => call.url), [PUBLIC, PUBLICNODE]);
  assert.equal(calls[0].aborted, false, 'a route that answered was not aborted');
});

test('a revert wrapped in a provider envelope is still a revert', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  // Providers reach for -32603 "internal error" around anything they did not
  // model, execution failures included. The revert data outranks it.
  const wrapped = await classifyPublishFailure({
    code: 'CALL_EXCEPTION',
    action: 'estimateGas',
    reason: 'AuctionNotActive',
    data: '0x1234abcd',
    error: { code: -32603, message: 'internal error' },
    shortMessage: 'execution reverted: AuctionNotActive'
  }, { stage: 'auction' });

  assert.equal(wrapped.code, 'TRANSACTION_REVERTED');
  assert.equal(wrapped.evidence.hasContractEvidence, true);
  assert.doesNotMatch(wrapped.message, /did not answer/);

  // And -32603 on its own decides nothing.
  const bare = await classifyPublishFailure({
    code: 'UNKNOWN_ERROR',
    shortMessage: 'could not coalesce error',
    error: { code: -32603, message: 'internal error' }
  }, { stage: 'register' });
  assert.notEqual(bare.code, 'NETWORK_UNAVAILABLE');
});

// ---------------------------------------------------------------------------
// 4. Every route gone.
// ---------------------------------------------------------------------------

test('when no route answers, the caller is told so and the publish names the network', async () => {
  const { api, calls, drive } = loadBaseNetwork((url) => {
    if (url === PUBLIC) return httpError(503);
    if (url === PUBLICNODE) return hang();
    return rpcError(-32603, 'internal error');
  });

  await assert.rejects(() => drive(api.rpc('eth_estimateGas', [{}])));
  assert.deepEqual(calls.map((call) => call.url), [PUBLIC, PUBLICNODE, DRPC]);

  const { value: probed } = await drive(api.probe());
  assert.equal(probed.reachable, false);

  const { classifyPublishFailure } = await import(classifierUrl);
  // Driven through the harness clock: the classifier's own probe has to survive
  // the hanging route too, and nothing else can advance it.
  const { value: classified } = await drive(classifyPublishFailure(reasonlessEstimateGasFailure(), {
    stage: 'register',
    probeNetwork: () => api.probe()
  }));

  assert.equal(classified.code, 'NETWORK_UNAVAILABLE');
  assert.match(classified.message, /nothing was sent and nothing was published/);
});

// ---------------------------------------------------------------------------
// 5. The correction: a reasonless revert is not an outage - and reachability
//    is not proof of the opposite either.
// ---------------------------------------------------------------------------

test('a reasonless contract revert is not reported as a network outage', async () => {
  const { api, drive } = loadBaseNetwork(() => healthy());
  const { classifyPublishFailure } = await import(classifierUrl);

  const { value: probed } = await drive(api.probe());
  assert.equal(probed.reachable, true, 'the chain is answering in this scenario');

  const { value: classified } = await drive(classifyPublishFailure(reasonlessEstimateGasFailure(), {
    stage: 'register',
    probeNetwork: () => api.probe()
  }));

  assert.notEqual(classified.code, 'NETWORK_UNAVAILABLE');
  assert.doesNotMatch(classified.message, /did not answer/);
  // It must not claim a transaction failed on-chain either: `action` was
  // estimateGas, so nothing was ever sent.
  assert.doesNotMatch(classified.message, /transaction failed/);
});

test('one endpoint answering eth_chainId does not convict the contract', async () => {
  const { api, drive } = loadBaseNetwork(() => healthy());
  const source = fs.readFileSync('src/features/publish/publish-error.js', 'utf8');
  const { classifyPublishFailure } = await import(classifierUrl);

  // It proves one cheap call to one endpoint succeeded, possibly after the
  // wallet's own endpoint failed. That supports no verdict at all.
  const { value: probed } = await drive(api.probe());
  assert.equal(probed.reachable, true);

  const { value: classified } = await drive(classifyPublishFailure(reasonlessEstimateGasFailure(), {
    stage: 'register',
    probeNetwork: () => api.probe()
  }));

  assert.equal(classified.code, 'PUBLISH_UNRESOLVED');
  assert.doesNotMatch(source, /CONTRACT_REFUSED/,
    'reachability must not be able to produce a contract verdict at all');
});

test('with no way to ask the chain, neither verdict is claimed', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  const classified = await classifyPublishFailure(reasonlessEstimateGasFailure(), { stage: 'register' });

  assert.equal(classified.code, 'PUBLISH_UNRESOLVED');
  assert.doesNotMatch(classified.message, /did not answer/);
  assert.doesNotMatch(classified.message, /transaction failed/);
});

test('a revert that carries a reason still says the transaction failed', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  const sent = await classifyPublishFailure({
    code: 'CALL_EXCEPTION',
    action: 'sendTransaction',
    reason: 'ArtworkAlreadyRegistered',
    data: '0x8baa579f',
    shortMessage: 'execution reverted: ArtworkAlreadyRegistered'
  }, { stage: 'register' });

  assert.equal(sent.code, 'TRANSACTION_REVERTED');
  assert.match(sent.message, /The artwork registration transaction failed on Base Sepolia/);
  assert.match(sent.message, /No artwork was published/);
});

// ---------------------------------------------------------------------------
// 6. A route answering for the wrong chain is worse than one not answering.
// ---------------------------------------------------------------------------

test('an endpoint on another chain is never selected', async () => {
  const { api, calls, drive } = loadBaseNetwork((url) => (
    url === PUBLIC ? result('0x1') : healthy()
  ));

  const { value: probed } = await drive(api.probe());

  assert.equal(probed.url, PUBLICNODE, 'the mainnet responder must be rejected');
  assert.equal(probed.chainIdHex, BASE_SEPOLIA_CHAIN_ID_HEX);
  assert.equal(probed.attempts[0].transport, 'wrong-chain');
  assert.deepEqual(calls.map((call) => call.url), [PUBLIC, PUBLICNODE]);
  assert.equal(api.chainId, 84532, 'still one chain');
});

test('an entire list on the wrong chain is unreachable, not reachable', async () => {
  const { api, drive } = loadBaseNetwork(() => result('0x1'));

  const { value: probed } = await drive(api.probe());

  assert.equal(probed.reachable, false);
  assert.equal(probed.url, null);
});

// ---------------------------------------------------------------------------
// 7. The claim that survives submission.
// ---------------------------------------------------------------------------

test('before submission, an outage may say nothing was sent', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  const classified = await classifyPublishFailure(
    Object.assign(new Error('no backend is currently healthy to serve traffic'), {
      transport: 'http', status: 503, action: 'estimateGas'
    }),
    { stage: 'register' }
  );

  assert.equal(classified.code, 'NETWORK_UNAVAILABLE');
  assert.equal(classified.evidence.nothingWasSent, true);
  assert.match(classified.message, /nothing was sent and nothing was published/);
});

test('after onSubmitted during register confirmation, the outcome is uncertain', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  const classified = await classifyPublishFailure(lostConfirmation(), {
    stage: 'register',
    submittedTxHash: '0xc0ffee'
  });

  assert.equal(classified.code, 'CONFIRMATION_UNCERTAIN');
  assert.equal(classified.submittedTxHash, '0xc0ffee');
  // The transaction may be mined. Neither claim may be made, and above all the
  // person must not be told to send it again.
  assert.doesNotMatch(classified.message, /nothing was sent/);
  assert.doesNotMatch(classified.message, /No artwork was published/);
  assert.match(classified.message, /may already be on-chain/);
  assert.match(classified.message, /Do not submit it again/);
});

test('after onSubmitted during auction confirmation, the auction is not called failed', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  const classified = await classifyPublishFailure(lostConfirmation(), {
    stage: 'auction',
    submittedTxHash: '0xfeed'
  });

  assert.equal(classified.code, 'CONFIRMATION_UNCERTAIN');
  assert.match(classified.message, /Do not submit it again/);
  assert.match(classified.message, /The artwork is registered/);
  // Start auction is the recovery path for an auction that provably was not
  // created. This one may exist already.
  assert.doesNotMatch(classified.message, /Start auction/);
});

test('a transport failure after a send is never told it published nothing', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  // Even with no hash recorded, `action` does not prove nothing was sent.
  const classified = await classifyPublishFailure(
    { code: 'NETWORK_ERROR', action: 'sendTransaction', shortMessage: 'could not detect network' },
    { stage: 'register' }
  );

  assert.equal(classified.code, 'NETWORK_UNAVAILABLE');
  assert.equal(classified.evidence.nothingWasSent, false);
  assert.doesNotMatch(classified.message, /nothing was sent/);
  assert.match(classified.message, /unknown/);
});

test('a submitted transaction keeps its pending record', async () => {
  const { keepsPendingTransaction } = await import(classifierUrl);

  assert.equal(keepsPendingTransaction('CONFIRMATION_UNCERTAIN'), true);
  assert.equal(keepsPendingTransaction('AUCTION_CONFIRMATION_PENDING'), true);
  for (const code of ['USER_REJECTED', 'NETWORK_UNAVAILABLE', 'TRANSACTION_REVERTED', 'PUBLISH_UNRESOLVED', '']) {
    assert.equal(keepsPendingTransaction(code), false, `${code || '(none)'} does not preserve a pending record`);
  }

  // And the publish flow decides by that policy rather than by its own list.
  const upload = fs.readFileSync('src/entries/upload.js', 'utf8');
  assert.match(upload, /if \(keepsPendingTransaction\(mapped\.code\)\) \{/);
  assert.match(upload, /if \(keepsPendingTransaction\(mappedAuctionError\.code\) && pendingArtwork\?\.auction_tx_hash\)/);
  assert.doesNotMatch(
    upload.slice(upload.indexOf('if (keepsPendingTransaction(mapped.code))')),
    /^[\s\S]{0,400}removePendingArtwork\(pendingArtwork\.temp_id\);[\s\S]{0,40}\n\s*\}\s*else/,
    'the removal must sit in the else branch, not before it'
  );
});

test('after a hash exists, an unproven outcome never settles the transaction', async () => {
  const { classifyPublishFailure, keepsPendingTransaction } = await import(classifierUrl);

  // Reproduced before this was fixed: the first two returned their own code
  // with keepsPendingTransaction false, so upload.js deleted the pending record
  // of a transaction that may already be on-chain.
  const unproven = [
    ['a chain switch', { code: 'NETWORK_ERROR', event: 'changed', shortMessage: 'network changed: 84532 => 1' }],
    ['an envelope nobody modelled', { code: 'UNKNOWN_ERROR', shortMessage: 'could not coalesce error' }],
    ['a confirmation we could not parse', new Error('Register transaction did not return a confirmed artwork id.')],
    ['a dropped connection', { code: 'TIMEOUT', action: 'wait', shortMessage: 'timeout waiting for transaction receipt' }],
    ['a nonce complaint', new Error('nonce too low')],
    ['nothing recognisable at all', new Error('something went sideways')]
  ];

  for (const [label, error] of unproven) {
    const classified = await classifyPublishFailure(error, { stage: 'register', submittedTxHash: '0xabc' });
    assert.equal(classified.code, 'CONFIRMATION_UNCERTAIN', label + ' must not settle a broadcast transaction');
    assert.equal(keepsPendingTransaction(classified.code), true, label + ' must keep the pending record');
    assert.equal(classified.submittedTxHash, '0xabc');
    // Provider-neutral: nothing here proves the network stopped answering.
    assert.doesNotMatch(classified.message, /Base Sepolia/);
    assert.doesNotMatch(classified.message, /did not answer|stopped answering/);
    assert.match(classified.message, /Do not submit it again/);
  }
});

test('a mined receipt with status 0 is final, not uncertain', async () => {
  const { classifyPublishFailure, keepsPendingTransaction, provesFinalFailure } = await import(classifierUrl);

  // ethers attaches the receipt to a CALL_EXCEPTION that carries no revert data
  // at all, so the generic submitted-transaction branch used to swallow it and
  // report a real, final, on-chain failure as "still finalizing".
  const mined = {
    code: 'CALL_EXCEPTION',
    action: 'sendTransaction',
    data: null,
    reason: null,
    receipt: { status: 0, hash: '0xabc' },
    message: 'transaction execution reverted'
  };

  const classified = await classifyPublishFailure(mined, { stage: 'register', submittedTxHash: '0xabc' });

  assert.equal(classified.code, 'TRANSACTION_REVERTED');
  assert.equal(classified.evidence.receiptProvesFailure, true);
  assert.equal(keepsPendingTransaction(classified.code), false, 'a settled failure is not pending');
  assert.equal(provesFinalFailure(mined), true);

  // A receipt that succeeded is not failure evidence, and neither is silence.
  assert.equal(provesFinalFailure({ code: 'TIMEOUT', receipt: { status: 1 } }), false);
  assert.equal(provesFinalFailure({ code: 'TIMEOUT' }), false);
  assert.equal(provesFinalFailure({ code: 'ACTION_REJECTED', message: 'user rejected' }), true);
  assert.equal(provesFinalFailure({ code: 'CALL_EXCEPTION', reason: 'AuctionExists', data: '0xdeadbeef' }), true);
});

test('an auction rejected before it was sent says the artwork is registered', async () => {
  const { classifyPublishFailure, keepsPendingTransaction } = await import(classifierUrl);

  // No auction hash: nothing was broadcast for the auction. But registration is
  // a separate transaction that already succeeded, so "No artwork was
  // published" contradicts a row the person can see on their own profile.
  const rejected = await classifyPublishFailure(
    { code: 'ACTION_REJECTED', message: 'user rejected action' },
    { stage: 'auction', submittedTxHash: '' }
  );

  assert.equal(rejected.code, 'USER_REJECTED');
  assert.equal(keepsPendingTransaction(rejected.code), false);
  assert.doesNotMatch(rejected.message, /No artwork was published/);
  assert.match(rejected.message, /The artwork is registered/);
  assert.match(rejected.message, /auction was not created/);
  assert.match(rejected.message, /Start auction/);
});

test('no auction-stage message claims nothing was published', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  const failures = [
    { code: 'ACTION_REJECTED', message: 'user rejected action' },
    new Error('insufficient funds for intrinsic transaction cost'),
    new Error('nonce too low'),
    { code: 'NETWORK_ERROR', event: 'changed', shortMessage: 'network changed' },
    Object.assign(new Error('unhealthy'), { transport: 'http', status: 503, action: 'estimateGas' }),
    { code: 'CALL_EXCEPTION', action: 'sendTransaction', reason: 'AuctionExists', data: '0xdeadbeef' },
    reasonlessEstimateGasFailure()
  ];

  for (const error of failures) {
    const classified = await classifyPublishFailure(error, { stage: 'auction' });
    assert.doesNotMatch(classified.message, /No artwork was published/, classified.code);
    assert.doesNotMatch(classified.message, /publish this artwork/, classified.code);
    assert.doesNotMatch(classified.message, /nothing was published/, classified.code);
  }
});

// ---------------------------------------------------------------------------
// 8. The swallowed branch.
// ---------------------------------------------------------------------------

test('a chain change during publishing reaches its own message', async () => {
  const { classifyPublishFailure } = await import(classifierUrl);

  // ethers reports an actual chain change as NETWORK_ERROR with event
  // 'changed'. The A-70 branch tested `code === 'NETWORK_ERROR'` and returned
  // NETWORK_UNAVAILABLE, so the NETWORK_CHANGED branch below it was dead: the
  // person was told to wait for a network that was answering perfectly well.
  const changed = await classifyPublishFailure({
    code: 'NETWORK_ERROR',
    event: 'changed',
    shortMessage: 'network changed: 84532 => 1',
    message: 'network changed: 84532 => 1'
  }, { stage: 'register', probeNetwork: async () => ({ reachable: true }) });

  assert.equal(changed.code, 'NETWORK_CHANGED');
  assert.match(changed.message, /Switch back to Base Sepolia/);

  // The other NETWORK_ERROR events still describe an unreachable node.
  const unreachable = await classifyPublishFailure({
    code: 'NETWORK_ERROR',
    event: 'noNetwork',
    action: 'estimateGas',
    shortMessage: 'could not detect network'
  }, { stage: 'register' });

  assert.equal(unreachable.code, 'NETWORK_UNAVAILABLE');
});

// ---------------------------------------------------------------------------
// 9. The wallet path, and the wait it must not buy back.
// ---------------------------------------------------------------------------

test('the wallet route lookup stays inside the short init budget', async () => {
  // A-63 and A-64 spent real work on the first-load wait. The probe now runs
  // before the provider is built, where nobody is reading an error message -
  // they are waiting for a modal - so that path passes the short budget and it
  // must bound the whole lookup, not each route.
  const { api, calls, drive } = loadBaseNetwork(() => hang());

  const { value: probed, elapsed } = await drive(api.probe({ budgetMs: api.probeInitBudgetMs }));

  assert.equal(probed.reachable, false);
  assert.ok(elapsed <= api.probeInitBudgetMs, `the whole lookup took ${elapsed}ms`);
  assert.ok(api.probeInitBudgetMs < api.probeBudgetMs, 'the init path waits less than the error path');
  assert.equal(calls.length, 3, 'every route is still tried within that budget');

  const core = fs.readFileSync('wallet-core-connect.js', 'utf8');
  assert.match(core, /probe\(\{ budgetMs: network\.probeInitBudgetMs \}\)/);
});

test('the single WalletConnect rpcMap entry is a route that answered', async () => {
  // WalletConnect's rpcMap type is `{ [chainId: string]: string }` - one url
  // per chain, verified against @walletconnect/ethereum-provider 2.23.10's own
  // EthereumProvider.d.ts. The external-mobile path therefore cannot fail over
  // the way the rest of the app does, so it must at least not be handed an
  // address that is already down.
  const core = fs.readFileSync('wallet-core-connect.js', 'utf8');
  const appkit = fs.readFileSync('appkit-init.js', 'utf8');

  assert.match(core, /rpcMap: \{ \[BASE_SEPOLIA_CHAIN_ID\]: await resolveCoreRpcUrl\(\) \}/);
  assert.match(appkit, /rpcMap: \{ \[BASE_SEPOLIA_CAIP_ID\]: await resolveCoreRpcUrl\(\) \}/);
  assert.match(core, /export async function resolveCoreRpcUrl/);
  // The documented public endpoint remains the floor: a wallet that refuses to
  // initialise because nothing answered helps nobody, and the publish
  // classifier is what tells the person the chain is unreachable.
  assert.match(core, /return BASE_SEPOLIA_RPC_URL;/);

  const { api, drive } = loadBaseNetwork((url) => (url === PUBLIC ? httpError(503) : healthy()));
  const { value: probed } = await drive(api.probe({ budgetMs: api.probeInitBudgetMs }));
  assert.equal(probed.url, PUBLICNODE);
  assert.equal(probed.reachable, true);
});

// ---------------------------------------------------------------------------
// Structural guarantees that still hold, plus the one A-70 missed.
// ---------------------------------------------------------------------------

test('one chain, one list, more than one way to reach it', () => {
  const network = fs.readFileSync('base-network.js', 'utf8');
  const appkit = fs.readFileSync('appkit-init.js', 'utf8');
  const dropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');
  const core = fs.readFileSync('wallet-core-connect.js', 'utf8');

  const listed = [...network.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(listed.length >= 3, `at least three routes, saw ${listed.length}`);
  assert.equal(listed[0], PUBLIC, 'the public endpoint stays first');

  assert.match(appkit, /window\.ArtSoulBaseSepolia\?\.rpcUrls\?\.length/);
  assert.match(dropdown, /window\.ArtSoulBaseSepolia\?\.rpc;/);
  assert.match(dropdown, /if \(typeof route !== 'function'\) throw new Error/);

  // Every floor is the same list, not a second opinion. wallet-core-connect.js
  // kept its own single address until A-70 was reopened - and that address is
  // the one the external-mobile provider actually dials.
  for (const [name, source] of [['appkit-init.js', appkit], ['wallet-core-connect.js', core]]) {
    const floor = source.slice(source.indexOf('const BASE_SEPOLIA_RPC_URLS'));
    const fallback = [...floor.slice(0, floor.indexOf('];')).matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(fallback, listed, `${name}: the fallback must match base-network.js exactly`);
  }

  assert.match(appkit, /const BASE_SEPOLIA_CHAIN_ID = 84532;/);
  assert.match(network, /const CHAIN_ID = 84532;/);
  assert.doesNotMatch(network, /solana|polygon|arbitrum/i);
});

test('an outage never erases a balance already known', () => {
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

test('the publish flow asks the chain before it names an outage', () => {
  const upload = fs.readFileSync('src/entries/upload.js', 'utf8');
  assert.match(upload, /import \{ classifyPublishFailure, keepsPendingTransaction, provesFinalFailure \} from '\.\.\/features\/publish\/publish-error\.js';/);
  assert.match(upload, /probeNetwork: probeBaseSepolia/);
  assert.match(upload, /stage: currentPublishStage/);
  assert.match(upload, /submittedTxHash/);
  // A-68: a helper that is merely absent must never read as one that answered.
  assert.match(upload, /if \(typeof probe !== 'function'\) return null;/);
  // Every call site awaits the classification now that it can consult the chain.
  assert.doesNotMatch(upload, /=\s*mapPublishError\(/);
});
