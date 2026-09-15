// B-12: the agent can now do what a person does on ArtSoul after an auction.
//
// The founder asked for the agent to reach the rest of the journey - see what
// they have, pay for a won auction, resell, close, withdraw, start an auction -
// and for it to be "as productive as possible and as safe as possible". Every
// test below is one of the ways it stays safe:
//
// - it refuses, before any wallet opens, whatever the contract would revert,
//   so nobody pays gas to learn a rule the page already knew;
// - amounts come from the contract or the chain-backed projection, never from
//   the conversation, and are compared as integers of wei;
// - any action carrying an amount or a price is confirmed on the page every
//   time, because the wallet does not show a bid, a listing price or a starting
//   price - those travel inside the transaction data;
// - one wallet action at a time, so a repeated command cannot stack approvals;
// - the agent can lower its own access and never raise it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('webmcp-tools.js', 'utf8');

function load() {
  const win = { ArtSoulContracts: null, setTimeout: (fn) => fn(), location: { assign() {} } };
  new Function('window', 'document', 'navigator', 'console', source)(win, {}, {}, console);
  return win;
}

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    map
  };
}

const GRANTED = () => memoryStorage({ 'artsoul.agent.permission': 'wallet' });
const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const NOW = Date.parse('2026-09-15T12:00:00Z');
const seconds = (ms) => Math.floor(ms / 1000);

function recorder(overrides = {}) {
  const calls = [];
  const contracts = {
    isReady: () => true,
    completeSettlement: async (...args) => { calls.push(['completeSettlement', ...args]); return '0xsettle'; },
    claimSettlementDefault: async (...args) => { calls.push(['claimSettlementDefault', ...args]); return '0xdefault'; },
    listResale: async (...args) => { calls.push(['listResale', ...args]); return '0xlist'; },
    buyResale: async (...args) => { calls.push(['buyResale', ...args]); return '0xbuy'; },
    getResaleListing: async () => ({ seller: OTHER, price: '0.0011', active: true }),
    withdraw: async (...args) => { calls.push(['withdraw', ...args]); return '0xwithdraw'; },
    getPendingWithdrawal: async () => '0.0042',
    createAuction: async (...args) => { calls.push(['createAuction', ...args]); return '0xauction'; },
    getAuctionConstants: async () => ({ allowedDurations: [86400, 129600, 172800] }),
    ...overrides
  };
  return { calls, contracts };
}

function tools({ cards, contracts = null, address = ME, storage = GRANTED(), confirm = () => true, prompts = [] }) {
  const win = load();
  const list = win.ArtSoulWebMCP.createTools({
    fetchJson: async (path) => {
      if (path.includes('/api/public/indexer-status')) return { chains: [] };
      if (path.includes('/api/public/artworks?id=')) {
        const id = decodeURIComponent(path.split('id=')[1]);
        return { data: cards.filter((card) => card.artwork_id === id) };
      }
      if (path.includes('/api/public/artworks')) return { data: cards };
      throw new Error(`unexpected ${path}`);
    },
    readContracts: () => contracts,
    readWalletAddress: () => address,
    loadWalletRuntime: async () => {},
    storage,
    now: () => NOW,
    confirmAction: (message) => { prompts.push(message); return confirm(message); }
  });
  return new Map(list.map((tool) => [tool.name, tool]));
}

const run = async (map, name, input) => JSON.parse(await map.get(name).execute(input || {}));

const WON = {
  artwork_id: '30', title: 'Solar August 12', status: 'settlement_pending', creator: OTHER,
  current_bidder: ME, current_bid: '0.015', settlement_deadline: seconds(NOW + 3 * 3600 * 1000), minted: false
};
const EXPIRED = { ...WON, settlement_deadline: seconds(NOW - 9 * 24 * 3600 * 1000) };
const OWNED = {
  artwork_id: '19', title: 'TesstV', status: 'sold', creator: OTHER, current_owner_address: ME,
  canonical_floor: '0.001', minted: true, token_id: '4'
};
const LISTED = { ...OWNED, status: 'for_sale', current_owner_address: OTHER, sale_price: '0.0011' };
const UNSOLD = { artwork_id: '31', title: 'Northern', status: 'defaulted', creator: ME, minted: false };

// ---------------------------------------------------------------------------
// get_my_activity
// ---------------------------------------------------------------------------

test('my activity gathers what a wallet has and what is waiting on it', async () => {
  const { contracts } = recorder();
  const map = tools({
    cards: [WON, OWNED, UNSOLD, { ...EXPIRED, artwork_id: '14', creator: ME, current_bidder: OTHER },
      { artwork_id: '9', title: 'Late', status: 'awaiting_end', creator: ME, minted: false }],
    contracts
  });
  const answer = await run(map, 'get_my_activity');

  assert.equal(answer.connected, true);
  assert.equal(answer.address, ME);
  assert.equal(answer.won_awaiting_payment.count, 1);
  assert.equal(answer.won_awaiting_payment.items[0].window_open, true);
  assert.equal(answer.owned.count, 1);
  assert.equal(answer.created.count, 3);
  assert.equal(answer.pending_withdrawal_eth, '0.0042');

  const actions = answer.needs_attention.map((entry) => `${entry.tool}:${entry.artwork_id}`);
  assert.ok(actions.includes('complete_settlement:30'), 'pay for what you won');
  assert.ok(actions.includes('close_expired_settlement:14'), 'free your work from an unpaid settlement');
  assert.ok(actions.includes('start_auction:31'), 'auction your unsold work');
  assert.ok(actions.includes('end_expired_auction:9'), 'end your finished auction');
  assert.ok(actions.includes('withdraw_pending_funds:null'), 'withdraw what is owed');
});

test('my activity with no wallet says so rather than showing someone else', async () => {
  const answer = await run(tools({ cards: [WON], address: '' }), 'get_my_activity');
  assert.equal(answer.connected, false);
  assert.match(answer.reason, /No wallet is connected/);
});

test('my activity never offers payment for a window that has closed', async () => {
  const answer = await run(tools({ cards: [EXPIRED], contracts: recorder().contracts }), 'get_my_activity');
  assert.equal(answer.won_awaiting_payment.items[0].window_open, false);
  assert.equal(answer.needs_attention.some((entry) => entry.tool === 'complete_settlement'), false);
});

// ---------------------------------------------------------------------------
// complete_settlement
// ---------------------------------------------------------------------------

test('the winner pays through the wallet after confirming the work on the page', async () => {
  const { calls, contracts } = recorder();
  const prompts = [];
  const answer = await run(tools({ cards: [WON], contracts, prompts }), 'complete_settlement', { artwork_id: '30' });

  assert.equal(answer.submitted, true);
  assert.deepEqual(calls, [['completeSettlement', '30', { idType: 'artwork' }]]);
  assert.equal(prompts.length, 1, 'confirmed every time even with the grant');
  assert.match(prompts[0], /Solar August 12/);
  assert.match(prompts[0], /artwork 30/);
  assert.match(prompts[0], /computed by the contract/);
});

test('a settlement is refused before the wallet when the contract would revert it', async () => {
  const { calls, contracts } = recorder();
  const notWinner = await run(tools({ cards: [{ ...WON, current_bidder: OTHER }], contracts }), 'complete_settlement', { artwork_id: '30' });
  assert.equal(notWinner.submitted, false);
  assert.match(notWinner.reason, /did not win/);

  const late = await run(tools({ cards: [EXPIRED], contracts }), 'complete_settlement', { artwork_id: '30' });
  assert.equal(late.submitted, false);
  assert.match(late.reason, /no longer accepts payment/);

  const wrongState = await run(tools({ cards: [OWNED], contracts }), 'complete_settlement', { artwork_id: '19' });
  assert.equal(wrongState.submitted, false);

  assert.deepEqual(calls, [], 'NotAuctionWinner and SettlementExpired are never paid for in gas');
});

// ---------------------------------------------------------------------------
// close_expired_settlement
// ---------------------------------------------------------------------------

test('an expired settlement is closed only once the chain would agree', async () => {
  const { calls, contracts } = recorder();
  const early = await run(tools({ cards: [WON], contracts }), 'close_expired_settlement', { artwork_id: '30' });
  assert.equal(early.submitted, false);
  assert.match(early.reason, /can still pay until/);

  const edge = { ...WON, settlement_deadline: seconds(NOW - 30 * 1000) };
  const margin = await run(tools({ cards: [edge], contracts }), 'close_expired_settlement', { artwork_id: '30' });
  assert.equal(margin.submitted, false, 'inside the clock margin the page also waits');
  assert.deepEqual(calls, []);

  const closed = await run(tools({ cards: [EXPIRED], contracts, address: OTHER }), 'close_expired_settlement', { artwork_id: '30' });
  assert.equal(closed.submitted, true, 'anyone may close it, as the contract allows');
  assert.deepEqual(calls, [['claimSettlementDefault', '30', { idType: 'artwork' }]]);
});

test('the agent waits out the same clock margin as the page and the cards', () => {
  const margin = (text) => (text.match(/const SETTLEMENT_CLOCK_MARGIN_MS = ([^;]+);/) || [])[1];
  const page = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
  const card = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');
  assert.ok(margin(source));
  assert.equal(margin(source), margin(page));
  assert.equal(margin(source), margin(card));
});

// ---------------------------------------------------------------------------
// list_for_resale
// ---------------------------------------------------------------------------

test('an owner lists at or above the floor, confirmed with the price on the page', async () => {
  const { calls, contracts } = recorder();
  const prompts = [];
  const answer = await run(tools({ cards: [OWNED], contracts, prompts }), 'list_for_resale', { artwork_id: '19', price_eth: '0.002' });

  assert.equal(answer.submitted, true);
  assert.deepEqual(calls, [['listResale', '19', '0.002', undefined, { idType: 'artwork' }]]);
  assert.match(prompts[0], /0\.002 ETH/);
  assert.match(prompts[0], /Canonical floor: 0\.001 ETH/);
});

test('a listing below the floor, by a non-owner, or of an unminted work never opens the wallet', async () => {
  const { calls, contracts } = recorder();
  const below = await run(tools({ cards: [OWNED], contracts }), 'list_for_resale', { artwork_id: '19', price_eth: '0.0009' });
  assert.equal(below.submitted, false);
  assert.match(below.reason, /below this work's canonical floor/);

  // Wei, not floats: exactly the floor is allowed, one wei under is not.
  const exact = await run(tools({ cards: [OWNED], contracts }), 'list_for_resale', { artwork_id: '19', price_eth: '0.001' });
  assert.equal(exact.submitted, true);
  const underByOneWei = await run(tools({ cards: [OWNED], contracts }), 'list_for_resale', { artwork_id: '19', price_eth: '0.000999999999999999' });
  assert.equal(underByOneWei.submitted, false);

  const notMine = await run(tools({ cards: [{ ...OWNED, current_owner_address: OTHER }], contracts }), 'list_for_resale', { artwork_id: '19', price_eth: '1' });
  assert.equal(notMine.submitted, false);
  const unminted = await run(tools({ cards: [UNSOLD], contracts }), 'list_for_resale', { artwork_id: '31', price_eth: '1' });
  assert.equal(unminted.submitted, false);
  for (const bad of ['0', '-1', 'ten', '1e3', '0.1234567890123456789']) {
    const answer = await run(tools({ cards: [OWNED], contracts }), 'list_for_resale', { artwork_id: '19', price_eth: bad });
    assert.equal(answer.submitted, false, `${bad} must be refused`);
  }

  assert.equal(calls.length, 1, 'only the exact-floor listing reached the wallet');
});

// ---------------------------------------------------------------------------
// buy_resale_listing
// ---------------------------------------------------------------------------

test('a purchase pays the price the contract holds, not a price from the conversation', async () => {
  const { calls, contracts } = recorder();
  const prompts = [];
  const answer = await run(tools({ cards: [LISTED], contracts, prompts }), 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(answer.submitted, true);
  assert.deepEqual(calls, [['buyResale', '19', '0.0011', { idType: 'artwork' }]]);
  assert.match(prompts[0], /TesstV/);
  assert.match(prompts[0], /0\.0011 ETH/);
});

test('a changed price, a seller buying their own listing, or an inactive listing stops the purchase', async () => {
  const { calls, contracts } = recorder();
  const moved = await run(tools({ cards: [LISTED], contracts }), 'buy_resale_listing', { artwork_id: '19', expected_price_eth: '0.001' });
  assert.equal(moved.submitted, false);
  assert.match(moved.reason, /listing price is 0\.0011 ETH, not 0\.001 ETH/);

  // The same amount written differently is the same amount.
  const same = await run(tools({ cards: [LISTED], contracts }), 'buy_resale_listing', { artwork_id: '19', expected_price_eth: '0.00110' });
  assert.equal(same.submitted, true);

  const own = await run(tools({ cards: [LISTED], contracts, address: OTHER }), 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(own.submitted, false);

  const gone = recorder({ getResaleListing: async () => ({ seller: OTHER, price: '0.0011', active: false }) });
  const inactive = await run(tools({ cards: [LISTED], contracts: gone.contracts }), 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(inactive.submitted, false);

  const broken = recorder({ getResaleListing: async () => { throw new Error('rpc down'); } });
  const unreadable = await run(tools({ cards: [LISTED], contracts: broken.contracts }), 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(unreadable.submitted, false, 'no purchase on a price the page cannot confirm');

  assert.equal(calls.length, 1);
  assert.deepEqual(gone.calls, []);
  assert.deepEqual(broken.calls, []);
});

// ---------------------------------------------------------------------------
// withdraw_pending_funds
// ---------------------------------------------------------------------------

test('withdrawal goes to the same wallet, and only when something is owed', async () => {
  const { calls, contracts } = recorder();
  const answer = await run(tools({ cards: [], contracts }), 'withdraw_pending_funds');
  assert.equal(answer.submitted, true);
  assert.equal(answer.amount_eth, '0.0042');
  assert.deepEqual(calls, [['withdraw']]);

  const empty = recorder({ getPendingWithdrawal: async () => '0.0' });
  const nothing = await run(tools({ cards: [], contracts: empty.contracts }), 'withdraw_pending_funds');
  assert.equal(nothing.submitted, false);
  assert.match(nothing.reason, /nothing to withdraw/);
  assert.deepEqual(empty.calls, []);
});

// ---------------------------------------------------------------------------
// start_auction
// ---------------------------------------------------------------------------

test('a creator starts an auction with a duration the contract reports', async () => {
  const { calls, contracts } = recorder();
  const prompts = [];
  const answer = await run(tools({ cards: [UNSOLD], contracts, prompts }), 'start_auction',
    { artwork_id: '31', start_price_eth: '0.005', duration_hours: 36 });
  assert.equal(answer.submitted, true);
  assert.deepEqual(calls, [['createAuction', '31', '0.005', 129600]]);
  assert.match(prompts[0], /0\.005 ETH/);
  assert.match(prompts[0], /36 hours/);
});

test('a duration the contract does not accept, or cannot be read, is refused rather than guessed', async () => {
  const { calls, contracts } = recorder();
  const odd = await run(tools({ cards: [UNSOLD], contracts }), 'start_auction',
    { artwork_id: '31', start_price_eth: '0.005', duration_hours: 12 });
  assert.equal(odd.submitted, false);
  assert.deepEqual(odd.allowed_duration_hours, [24, 36, 48], 'read from the contract stub, not from this file');

  const blind = recorder({ getAuctionConstants: async () => { throw new Error('rpc down'); } });
  const unreadable = await run(tools({ cards: [UNSOLD], contracts: blind.contracts }), 'start_auction',
    { artwork_id: '31', start_price_eth: '0.005', duration_hours: 24 });
  assert.equal(unreadable.submitted, false);

  const notCreator = await run(tools({ cards: [{ ...UNSOLD, creator: OTHER }], contracts }), 'start_auction',
    { artwork_id: '31', start_price_eth: '0.005', duration_hours: 24 });
  assert.equal(notCreator.submitted, false);

  const running = await run(tools({ cards: [{ ...UNSOLD, status: 'awaiting_end' }], contracts }), 'start_auction',
    { artwork_id: '31', start_price_eth: '0.005', duration_hours: 24 });
  assert.match(running.reason, /End it first/);

  assert.deepEqual(calls, []);
  assert.deepEqual(blind.calls, []);
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('a declined page confirmation means no wallet call, and the grant alone is not enough', async () => {
  const { calls, contracts } = recorder();
  const answer = await run(tools({ cards: [LISTED], contracts, confirm: () => false }), 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(answer.submitted, false);
  assert.match(answer.reason, /did not confirm/);
  assert.deepEqual(calls, []);
});

test('without the grant, one dialog grants access and names the action together', async () => {
  const { calls, contracts } = recorder();
  const prompts = [];
  const storage = memoryStorage();
  await run(tools({ cards: [LISTED], contracts, storage, prompts }), 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(prompts.length, 1, 'not two dialogs for one action');
  assert.match(prompts[0], /Allow this page's AI agent/);
  assert.match(prompts[0], /0\.0011 ETH/);
  assert.equal(storage.map.get('artsoul.agent.permission'), 'wallet');
  assert.equal(calls.length, 1);
});

test('a second wallet action cannot start while the first waits for the person', async () => {
  let release;
  const slow = recorder({
    withdraw: () => new Promise((resolve) => { release = () => resolve('0xslow'); })
  });
  const map = tools({ cards: [LISTED], contracts: slow.contracts });
  const first = map.get('withdraw_pending_funds').execute({});
  await new Promise((resolve) => setImmediate(resolve));
  const second = await run(map, 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(second.submitted, false);
  assert.match(second.reason, /still waiting for the person/);
  release();
  assert.equal(JSON.parse(await first).submitted, true);
  const third = await run(map, 'buy_resale_listing', { artwork_id: '19' });
  assert.equal(third.submitted, true, 'the lock is released when the first action ends');
});

test('the agent can take away its own wallet access, and then must ask again', async () => {
  const { calls, contracts } = recorder();
  const storage = GRANTED();
  const prompts = [];
  const map = tools({ cards: [OWNED], contracts, storage, prompts, confirm: () => false });
  const revoked = await run(map, 'revoke_wallet_access');
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.level, 'read');

  const afterwards = await run(map, 'list_for_resale', { artwork_id: '19', price_eth: '0.002' });
  assert.equal(afterwards.submitted, false);
  assert.match(prompts[0], /Allow this page's AI agent/, 'the grant is asked for again');
  assert.deepEqual(calls, []);
});

test('get_artwork reports the resale price the projection actually carries', async () => {
  const answer = await run(tools({ cards: [LISTED] }), 'get_artwork', { artwork_id: '19' });
  assert.equal(answer.resale_price_eth, '0.0011');
  const sold = await run(tools({ cards: [{ ...OWNED, sale_price: '0.9' }] }), 'get_artwork', { artwork_id: '19' });
  assert.equal(sold.resale_price_eth, null, 'a price is a resale price only while the work is listed');
});

test('no new tool carries a frozen figure', () => {
  assert.equal(/86400|129600|172800/.test(source), false, 'auction durations are read from the contract');
  assert.equal(/\b24\s*h|\b36\s*h|\b48\s*h/i.test(source), false);
  assert.equal(/\b80\s*\/\s*20\b|\b80%|\b20%/.test(source), false, 'the default split lives in the contract');
});
