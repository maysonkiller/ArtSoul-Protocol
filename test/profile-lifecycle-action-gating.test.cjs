// Phase A7 / A-19: profile lifecycle and action gating. The matrix below
// proves, per wallet role and lifecycle state, that (1) presentation-level
// predicates and (2) click/submit handlers both enforce eligibility, that
// every write passes the shared Base Sepolia guard, and that legacy
// Ethereum Sepolia artworks stay readable without exposing writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const profileSource = fs.readFileSync(path.join(root, 'src', 'entries', 'profile.jsx'), 'utf8');
const artworkSource = fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');
const contractsSource = fs.readFileSync(path.join(root, 'contracts-integration.js'), 'utf8');
const eligibilitySource = fs.readFileSync(path.join(root, 'src', 'features', 'marketplace', 'resale-eligibility.js'), 'utf8');
const moderationAccessSource = fs.readFileSync(path.join(root, 'src', 'api', 'moderation-access.js'), 'utf8');
const moderationRouteSource = fs.readFileSync(path.join(root, 'src', 'api', 'routes', 'moderation', 'artwork-visibility.js'), 'utf8');

const CREATOR = '0x1111111111111111111111111111111111111111';
const COLLECTOR = '0x2222222222222222222222222222222222222222';
const BIDDER = '0x4444444444444444444444444444444444444444';
const STRANGER = '0x5555555555555555555555555555555555555555';

// Extracts a named function by balanced-brace scanning so the real page
// logic runs behaviorally (repo pattern from profile-owned-buyback tests).
// Preserves an `async ` prefix so extracted async handlers stay valid.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let depth = 0;
  let index = source.indexOf('{', source.indexOf(')', start));
  for (; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const prefix = source.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return prefix + source.slice(start, index + 1);
}

// ---------------------------------------------------------------------------
// Profile predicates (behavioral)
// ---------------------------------------------------------------------------

const profileSandbox = vm.createContext({ window: {}, exported: {} });
vm.runInContext([
  extractFunction(profileSource, 'normalizeAddress'),
  extractFunction(profileSource, 'isZeroProtocolId'),
  extractFunction(profileSource, 'isMintedArtwork'),
  extractFunction(profileSource, 'hasActiveAuction'),
  extractFunction(profileSource, 'resolvePendingArtworkChainId'),
  extractFunction(profileSource, 'isBaseSepoliaArtwork'),
  extractFunction(profileSource, 'canCreateNewAuction'),
  extractFunction(profileSource, 'canListForResale'),
  'exported.canCreateNewAuction = canCreateNewAuction;',
  'exported.canListForResale = canListForResale;'
].join('\n'), profileSandbox, { filename: 'profile.jsx (extracted)' });
const profilePredicates = profileSandbox.exported;

test('guest (no wallet) qualifies for no profile action in any lifecycle state', () => {
  const unminted = { chain_id: 84532, creator_id: CREATOR, status: 'registered' };
  const minted = { chain_id: 84532, creator_id: CREATOR, minted: true, token_id: '7', current_owner_address: COLLECTOR };
  assert.equal(profilePredicates.canCreateNewAuction(unminted, ''), false);
  assert.equal(profilePredicates.canListForResale(minted, ''), false);
});

test('unrelated connected wallet gets no create-auction or resale action', () => {
  const unminted = { chain_id: 84532, creator_id: CREATOR, status: 'registered' };
  const minted = { chain_id: 84532, creator_id: CREATOR, minted: true, token_id: '7', current_owner_address: COLLECTOR };
  assert.equal(profilePredicates.canCreateNewAuction(unminted, STRANGER), false);
  assert.equal(profilePredicates.canListForResale(minted, STRANGER), false);
});

test('creator before any auction can start a primary auction on Base only', () => {
  const unminted = { chain_id: 84532, creator_id: CREATOR, status: 'registered' };
  assert.equal(profilePredicates.canCreateNewAuction(unminted, CREATOR), true);
  assert.equal(profilePredicates.canCreateNewAuction({ ...unminted, chain_id: 11155111 }, CREATOR), false);
});

test('creator during an active auction cannot start another auction', () => {
  const live = { chain_id: 84532, creator_id: CREATOR, status: 'auction', active_auction_id: '30' };
  const pendingSettlement = { chain_id: 84532, creator_id: CREATOR, status: 'settlement_pending' };
  assert.equal(profilePredicates.canCreateNewAuction(live, CREATOR), false);
  assert.equal(profilePredicates.canCreateNewAuction(pendingSettlement, CREATOR), false);
});

test('creator after a successful mint gets neither re-auction nor resale unless owner', () => {
  const mintedSold = { chain_id: 84532, creator_id: CREATOR, minted: true, token_id: '7', current_owner_address: COLLECTOR };
  assert.equal(profilePredicates.canCreateNewAuction(mintedSold, CREATOR), false);
  assert.equal(profilePredicates.canListForResale(mintedSold, CREATOR), false);
});

test('indexed current owner and creator-buyback owner can list for resale', () => {
  const collectorOwned = { chain_id: 84532, creator_id: CREATOR, minted: true, token_id: '7', current_owner_address: COLLECTOR };
  const creatorBuyback = { chain_id: 84532, creator_id: CREATOR, minted: true, token_id: '7', current_owner_address: CREATOR };
  assert.equal(profilePredicates.canListForResale(collectorOwned, COLLECTOR), true);
  assert.equal(profilePredicates.canListForResale(creatorBuyback, CREATOR), true);
  // Buyback never re-opens the primary-auction path for a minted work.
  assert.equal(profilePredicates.canCreateNewAuction(creatorBuyback, CREATOR), false);
});

test('highest bidder before settlement is not owner, collector, or lister', () => {
  const pending = { chain_id: 84532, creator_id: CREATOR, status: 'settlement_pending', winner: BIDDER, current_owner_address: null };
  assert.equal(profilePredicates.canListForResale(pending, BIDDER), false);
  assert.equal(profilePredicates.canCreateNewAuction(pending, BIDDER), false);
});

test('legacy Ethereum Sepolia artwork exposes no profile write action to anyone', () => {
  const legacyUnminted = { chain_id: 11155111, creator_id: CREATOR, status: 'registered' };
  const legacyMinted = { chain_id: 11155111, creator_id: CREATOR, minted: true, token_id: '400', current_owner_address: COLLECTOR };
  assert.equal(profilePredicates.canCreateNewAuction(legacyUnminted, CREATOR), false);
  assert.equal(profilePredicates.canListForResale(legacyMinted, COLLECTOR), false);
});

// ---------------------------------------------------------------------------
// Artwork page: legacy write-chain predicate (behavioral)
// ---------------------------------------------------------------------------

function loadArtworkChainPredicate(artwork, v41CompositeId = null) {
  const sandbox = vm.createContext({ artwork, v41CompositeId, exported: {} });
  vm.runInContext([
    extractFunction(artworkSource, 'getArtworkWriteChainId'),
    extractFunction(artworkSource, 'isArtworkWriteChainSupported'),
    'exported.isArtworkWriteChainSupported = isArtworkWriteChainSupported;'
  ].join('\n'), sandbox, { filename: 'artwork.jsx (extracted)' });
  return sandbox.exported.isArtworkWriteChainSupported;
}

test('artwork page write predicate: ONLY exact Base Sepolia 84532 qualifies', () => {
  assert.equal(loadArtworkChainPredicate({ chain_id: 84532 })(), true);
  assert.equal(loadArtworkChainPredicate({ network: 'baseSepolia' })(), true);
  // Legacy testnet, both mainnets, arbitrary and missing chains fail closed.
  assert.equal(loadArtworkChainPredicate({ chain_id: 11155111 })(), false);
  assert.equal(loadArtworkChainPredicate({ network: 'sepolia' })(), false);
  assert.equal(loadArtworkChainPredicate({ chain_id: 1 })(), false);
  assert.equal(loadArtworkChainPredicate({ chain_id: 8453 })(), false);
  assert.equal(loadArtworkChainPredicate({ chain_id: 999999 })(), false);
  assert.equal(loadArtworkChainPredicate({})(), false);
  // An explicit non-Base chain id overrides a conflicting network label.
  assert.equal(loadArtworkChainPredicate({ chain_id: 8453, network: 'baseSepolia' })(), false);
  assert.equal(loadArtworkChainPredicate({ chain_id: 1, network: 'baseSepolia' })(), false);
});

test('profile write predicates enforce the same strict fail-closed chain matrix', () => {
  const asCreatorAuction = (artwork) => profilePredicates.canCreateNewAuction(
    { creator_id: CREATOR, status: 'registered', ...artwork },
    CREATOR
  );
  const asOwnerResale = (artwork) => profilePredicates.canListForResale(
    { creator_id: CREATOR, minted: true, token_id: '7', current_owner_address: COLLECTOR, ...artwork },
    COLLECTOR
  );

  assert.equal(asCreatorAuction({ chain_id: 84532 }), true);
  assert.equal(asOwnerResale({ chain_id: 84532 }), true);
  // Locally-created pending drafts (chain_id 84532 + network baseSepolia) stay eligible.
  assert.equal(asCreatorAuction({ chain_id: 84532, network: 'baseSepolia', source: 'pending_indexer' }), true);
  // Network metadata qualifies only without a conflicting explicit chain id.
  assert.equal(asCreatorAuction({ network: 'baseSepolia' }), true);
  assert.equal(asCreatorAuction({ chain_id: 8453, network: 'baseSepolia' }), false);
  assert.equal(asOwnerResale({ chain_id: 8453, network: 'baseSepolia' }), false);
  // Mainnets, legacy, arbitrary, and missing chain evidence never authorize.
  for (const blocked of [{ chain_id: 1 }, { chain_id: 8453 }, { chain_id: 11155111 }, { chain_id: 424242 }, {}]) {
    assert.equal(asCreatorAuction(blocked), false, `create-auction must be blocked for ${JSON.stringify(blocked)}`);
    assert.equal(asOwnerResale(blocked), false, `resale must be blocked for ${JSON.stringify(blocked)}`);
  }
});

// ---------------------------------------------------------------------------
// Artwork page: presentation gating and handler-level protection (source locks)
// ---------------------------------------------------------------------------

test('every artwork write-action section is gated on the Base write predicate', () => {
  assert.match(artworkSource, /const artworkWriteEnabled = isArtworkWriteChainSupported\(\);/);
  assert.match(artworkSource, /const canEndAuction = artworkWriteEnabled && auction/);
  assert.match(artworkSource, /const canCreateNewAuction = artworkWriteEnabled &&/);
  assert.match(artworkSource, /\{liveAuction && artworkWriteEnabled && \(/);
  assert.match(artworkSource, /\{artworkWriteEnabled && \(showWithdrawableDeposit \|\| withdrawalState\.message\) && \(/);
  assert.match(artworkSource, /\{artworkWriteEnabled && walletRenderState\.settled && awaitingPayment && isSameAddress\(connectedWalletAddress, winnerAddress\) && \(/);
  assert.match(artworkSource, /\{artworkWriteEnabled && resaleEligibility\.showOwnerAction && \(/);
  assert.match(artworkSource, /\{listedForResale && !connectedWalletOwnsArtwork && artworkWriteEnabled && \(/);
});

test('every artwork write handler re-checks the legacy guard at execution time', () => {
  for (const handler of [
    'placeBidOnce',
    'endAuctionOnce',
    'settleAuctionOnce',
    'purchaseResaleOnce',
    'openResaleListingModal',
    'confirmResaleListing',
    'handleConfirmNewAuction',
    'handleWithdrawDeposit'
  ]) {
    assert.match(
      extractFunction(artworkSource, handler),
      /ensureArtworkWriteEnabled\(\)/,
      `${handler} must call ensureArtworkWriteEnabled`
    );
  }
});

test('settlement is winner-only at both the button and the handler', () => {
  assert.match(
    artworkSource,
    /awaitingPayment && isSameAddress\(connectedWalletAddress, winnerAddress\) && \(/
  );
  const settle = extractFunction(artworkSource, 'settleAuctionOnce');
  assert.match(settle, /isSameAddress\(walletAddress, auctionWinner\)/);
  assert.match(settle, /Only the auction winner can complete settlement/);
});

test('re-auction stays creator-only, unminted-only, and lifecycle-restricted', () => {
  const predicate = extractFunction(artworkSource, 'canCreateNewAuctionForWallet');
  assert.match(predicate, /isSameAddress\(creatorAddress, walletAddress\)/);
  assert.match(predicate, /!isArtworkMinted\(artworkData\)/);
  assert.match(predicate, /active_auction_id/);
  const handler = extractFunction(artworkSource, 'handleConfirmNewAuction');
  assert.match(handler, /canCreateNewAuctionForWallet\(artwork, walletAddress\)/);
  // The handler re-verifies creator/minted/active state against the chain.
  assert.match(handler, /isSameAddress\(blockchainArtwork\.creator, walletAddress\)/);
  assert.match(handler, /blockchainArtwork\.minted \|\| hasProtocolId\(blockchainArtwork\.tokenId\)/);
});

test('resale submit re-checks owner and chain; buyer can never self-purchase', () => {
  const confirm = extractFunction(artworkSource, 'confirmResaleListing');
  assert.match(confirm, /ensureArtworkWriteEnabled\(\)/);
  assert.match(confirm, /await getLiveProviderAccount\(\)/);
  assert.match(confirm, /isSameAddress\(submitWalletAddress, artwork\.current_owner_address\)/);
  // The stale rendered/window account snapshot never authorizes the submit.
  assert.doesNotMatch(confirm, /connectedWalletAddress|window\.currentWalletAddress|getCurrentWalletAddress/);
  const purchase = extractFunction(artworkSource, 'purchaseResaleOnce');
  assert.match(purchase, /await getLiveProviderAccount\(\)/);
  assert.match(purchase, /isSameAddress\(walletAddress, artwork\.current_owner_address\)/);
  assert.doesNotMatch(purchase, /window\.currentWalletAddress|getCurrentWalletAddress/);
});

// ---------------------------------------------------------------------------
// Live provider account at submit time (behavioral)
// ---------------------------------------------------------------------------

function liveAccountProvider(accounts) {
  return {
    getWalletProvider: async () => ({
      request: async ({ method }) => (method === 'eth_accounts' ? accounts : [])
    })
  };
}

async function runConfirmResaleListing({ liveAccounts, owner, staleAccount }) {
  const calls = { errors: [], began: [] };
  const sandbox = vm.createContext({
    window: { web3Modal: liveAccountProvider(liveAccounts) },
    artwork: { current_owner_address: owner, token_id: '7', minted: true },
    connectedWalletAddress: staleAccount,
    resaleFloorPrice: '1',
    resaleModalPrice: '2',
    setResaleModalError: (message) => calls.errors.push(message),
    setResaleModalStepLabel: () => {},
    // Stop after the authorization phase: begin returning false proves the
    // checks passed without executing the contract path.
    beginTransactionAction: (action) => { calls.began.push(action); return false; },
    finishTransactionAction: () => {},
    ensureArtworkWriteEnabled: () => true,
    exported: {}
  });
  vm.runInContext([
    extractFunction(artworkSource, 'isSameAddress'),
    extractFunction(artworkSource, 'getLiveProviderAccount'),
    extractFunction(artworkSource, 'normalizeResalePriceInput'),
    extractFunction(artworkSource, 'validateResaleModalPrice'),
    extractFunction(artworkSource, 'confirmResaleListing'),
    'exported.confirmResaleListing = confirmResaleListing;'
  ].join('\n'), sandbox, { filename: 'artwork.jsx confirmResaleListing (extracted)' });
  await sandbox.exported.confirmResaleListing();
  return calls;
}

test('stale rendered owner cannot list when the live provider account differs', async () => {
  // UI still shows owner A (stale render), but the wallet switched to B.
  const calls = await runConfirmResaleListing({
    liveAccounts: [BIDDER],
    owner: COLLECTOR,
    staleAccount: COLLECTOR
  });
  assert.deepEqual(calls.began, [], 'transaction phase must not start');
  assert.match(calls.errors.join(' '), /Only the current NFT owner/);
});

test('the live owner account authorizes the listing even when the render is stale', async () => {
  const calls = await runConfirmResaleListing({
    liveAccounts: [COLLECTOR],
    owner: COLLECTOR,
    staleAccount: STRANGER
  });
  assert.deepEqual(calls.errors, []);
  assert.deepEqual(calls.began, ['resale-list'], 'authorization must pass on the live account');
});

test('a missing live provider account blocks the listing gracefully', async () => {
  const calls = await runConfirmResaleListing({
    liveAccounts: [],
    owner: COLLECTOR,
    staleAccount: COLLECTOR
  });
  assert.deepEqual(calls.began, []);
  assert.match(calls.errors.join(' '), /Connect your wallet/);
});

async function runPurchaseResaleOnce({ liveAccounts, owner, staleAccount }) {
  const calls = { alerts: [], buys: [] };
  const sandbox = vm.createContext({
    window: {
      currentWalletAddress: staleAccount,
      getCurrentWalletAddress: () => staleAccount,
      ensureWalletConnected: async () => staleAccount,
      web3Modal: liveAccountProvider(liveAccounts),
      ArtSoulContracts: {
        init: async () => {},
        buyResale: async (...args) => { calls.buys.push(args); return '0xhash'; },
        getArtwork: async () => ({ tokenId: '7' })
      },
      ArtSoulDB: { recordDirectPurchase: async () => {} }
    },
    artwork: { blockchain_id: '7', sale_price: '2', current_owner_address: owner },
    artworkId: 'v41:84532:7',
    alert: (message) => calls.alerts.push(message),
    console: { log: () => {}, warn: () => {}, error: () => {} },
    loadArtwork: () => {},
    getTransactionErrorMessage: (error, fallback) => fallback,
    ensureArtworkWriteEnabled: () => true,
    exported: {}
  });
  vm.runInContext([
    extractFunction(artworkSource, 'isSameAddress'),
    extractFunction(artworkSource, 'getLiveProviderAccount'),
    extractFunction(artworkSource, 'purchaseResaleOnce'),
    'exported.purchaseResaleOnce = purchaseResaleOnce;'
  ].join('\n'), sandbox, { filename: 'artwork.jsx purchaseResaleOnce (extracted)' });
  await sandbox.exported.purchaseResaleOnce();
  return calls;
}

test('a stale buyer render cannot self-purchase when the live account is the owner', async () => {
  // UI still shows the Buy button for previous account B, but the wallet
  // switched back to the indexed owner A.
  const calls = await runPurchaseResaleOnce({
    liveAccounts: [COLLECTOR],
    owner: COLLECTOR,
    staleAccount: BIDDER
  });
  assert.deepEqual(calls.buys, [], 'buyResale must not execute for the owner');
  assert.match(calls.alerts.join(' '), /already own this NFT/);
});

test('a live non-owner account completes the resale purchase path', async () => {
  const calls = await runPurchaseResaleOnce({
    liveAccounts: [STRANGER],
    owner: COLLECTOR,
    staleAccount: COLLECTOR
  });
  assert.equal(calls.buys.length, 1, 'buyResale must execute exactly once');
  assert.match(calls.alerts.join(' '), /Purchase successful/);
});

test('a missing live provider account blocks the purchase gracefully', async () => {
  const calls = await runPurchaseResaleOnce({
    liveAccounts: [],
    owner: COLLECTOR,
    staleAccount: BIDDER
  });
  assert.deepEqual(calls.buys, []);
  assert.match(calls.alerts.join(' '), /Connect your wallet/);
});

// ---------------------------------------------------------------------------
// Canonical resale eligibility helper (behavioral, incl. wrong-chain wallet)
// ---------------------------------------------------------------------------

const eligibilitySandbox = vm.createContext({ exported: {} });
vm.runInContext(
  eligibilitySource.replace(/^export /gm, '') + '\nexported.getOwnerResaleEligibility = getOwnerResaleEligibility;',
  eligibilitySandbox,
  { filename: 'resale-eligibility.js (stripped ESM)' }
);
const { getOwnerResaleEligibility } = eligibilitySandbox.exported;

test('resale eligibility: only the indexed owner on Base Sepolia can list', () => {
  const base = {
    walletSettled: true,
    walletAddress: COLLECTOR,
    walletChainId: 84532,
    currentOwnerAddress: COLLECTOR,
    minted: true,
    tokenId: '7',
    floorPrice: 1.2,
    activeListing: false,
    activeAuction: false
  };
  assert.equal(getOwnerResaleEligibility(base).canList, true);
  // Guest wallet.
  assert.equal(getOwnerResaleEligibility({ ...base, walletSettled: false }).showOwnerAction, false);
  // Unrelated wallet.
  assert.equal(getOwnerResaleEligibility({ ...base, walletAddress: STRANGER }).reason, 'not_owner');
  // Wrong-chain write attempt is surfaced and blocked.
  const wrongChain = getOwnerResaleEligibility({ ...base, walletChainId: 1 });
  assert.equal(wrongChain.canList, false);
  assert.equal(wrongChain.reason, 'wrong_chain');
  // Pending settlement (not minted) never exposes the owner action.
  assert.equal(getOwnerResaleEligibility({ ...base, minted: false, tokenId: '' }).reason, 'not_minted');
});

// ---------------------------------------------------------------------------
// Shared Base Sepolia write guard on every contract write entry point
// ---------------------------------------------------------------------------

test('every contract write entry point calls the shared Base Sepolia guard first', () => {
  for (const method of [
    'registerArtwork',
    'createAuction',
    'placeBid',
    'endAuction',
    'completeSettlement',
    'claimSettlementDefault',
    'withdraw',
    'listResale',
    'buyResale'
  ]) {
    const body = contractsSource.slice(
      contractsSource.indexOf(`async ${method}(`),
      contractsSource.indexOf('async ', contractsSource.indexOf(`async ${method}(`) + 6)
    );
    assert.match(
      body,
      /await this\.ensureBaseSepoliaWrite\(\);|return await this\.(registerArtwork|createAuction)\(/,
      `${method} must pass through ensureBaseSepoliaWrite (directly or via a guarded delegate)`
    );
  }
  // The guard itself verifies the live provider chain, not just a flag.
  const guard = contractsSource.slice(
    contractsSource.indexOf('async ensureBaseSepoliaWrite('),
    contractsSource.indexOf('isZeroAddress(')
  );
  assert.match(guard, /getNetwork\(\)/);
  assert.match(guard, /CONTRACTS\.baseSepolia\.chainId/);
  assert.match(guard, /This action requires Base Sepolia/);
});

// ---------------------------------------------------------------------------
// Moderation: server-side authorization only (behavioral)
//
// These tests verify that authorization is server-side and fails closed on
// the staff-role registry. The additional profile/X/Discord factor gate that
// getModerationAccess currently applies is NOT asserted as the accepted
// moderation model — the canon v1.2 delta supersedes the social-factor gate,
// and final moderation access alignment belongs to Phase A8.
// ---------------------------------------------------------------------------

function loadModerationAccess({ sessionWallet, roleRows, profileRows, registryDown = false }) {
  const sandbox = vm.createContext({
    exported: {},
    readWalletSession: () => sessionWallet,
    requireWallet: () => {
      if (!sessionWallet) {
        const error = new Error('Wallet session required');
        error.statusCode = 401;
        throw error;
      }
      return sessionWallet;
    },
    supabaseRest: async (query) => {
      if (registryDown) throw new Error('registry down');
      return query.startsWith('artsoul_staff_roles') ? roleRows : profileRows;
    },
    // A8a: these tests pin the LEGACY (flag disabled) behavior; the enabled
    // path is covered by test/moderation-passkey-foundation.test.cjs.
    isModerationPasskeyEnabled: () => false,
    verifyModerationStepUp: async () => { throw new Error('not reachable with the flag disabled'); }
  });
  const source = moderationAccessSource
    .slice(moderationAccessSource.indexOf('const MODERATION_ROLES'))
    .replace('export async function getModerationAccess', 'async function getModerationAccess')
    + '\nexported.getModerationAccess = getModerationAccess;';
  vm.runInContext(source, sandbox, { filename: 'moderation-access.js (stripped ESM)' });
  return sandbox.exported.getModerationAccess;
}

const STAFF_PROFILE = [{ wallet_address: CREATOR, twitter_id: 't1', discord_id: 'd1' }];

test('staff moderation requires a server-verified wallet session plus an active staff role', async () => {
  const staff = await loadModerationAccess({
    sessionWallet: CREATOR,
    roleRows: [{ role: 'moderator' }],
    profileRows: STAFF_PROFILE
  })({}, { strict: true });
  assert.equal(staff.canModerate, true);
  assert.equal(staff.role, 'moderator');
});

test('non-staff wallets are rejected server-side even with a complete social profile', async () => {
  await assert.rejects(
    loadModerationAccess({
      sessionWallet: STRANGER,
      roleRows: [],
      profileRows: [{ wallet_address: STRANGER, twitter_id: 't1', discord_id: 'd1' }]
    })({}, { strict: true }),
    (error) => error.statusCode === 403 && error.code === 'ADMIN_REQUIRED'
  );
});

test('guests without a wallet session can never moderate', async () => {
  await assert.rejects(
    loadModerationAccess({ sessionWallet: null, roleRows: [], profileRows: [] })({}, { strict: true }),
    (error) => error.statusCode === 401
  );
  const relaxed = await loadModerationAccess({ sessionWallet: null, roleRows: [], profileRows: [] })({});
  assert.equal(relaxed.canModerate, false);
});

test('a role-registry outage fails closed instead of granting access', async () => {
  await assert.rejects(
    loadModerationAccess({ sessionWallet: CREATOR, registryDown: true, roleRows: [], profileRows: [] })({}, { strict: true }),
    (error) => error.statusCode === 503
  );
});

test('the moderation route and UI never trust client-side staff state', () => {
  // Server route: strict authorization before any read or write.
  assert.match(moderationRouteSource, /getModerationAccess\(req, \{ strict: true \}\)/);
  // UI: the staff panel renders only from the server-returned access object.
  assert.match(artworkSource, /\{moderationAccess\?\.canModerate && \(/);
  // The access object is populated exclusively from the server response.
  const loader = extractFunction(artworkSource, 'loadModerationVisibility');
  assert.match(loader, /\/api\/moderation\/artwork-visibility/);
  assert.doesNotMatch(loader, /localStorage|sessionStorage/);
});
