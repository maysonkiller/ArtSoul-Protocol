const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('webmcp-tools.js', 'utf8');

/**
 * webmcp-tools.js is a classic deferred script like the other root assets, so it
 * is exercised the way they are: executed against a fake window rather than a
 * browser. `modelContext` is what a WebMCP-capable browser exposes; leaving it
 * out is the ordinary visitor, and that path must register nothing.
 */
function load({ modelContext = null, contracts = null } = {}) {
  const win = {
    ArtSoulContracts: contracts,
    setTimeout: (fn) => fn(),
    location: { assign() {} }
  };
  const doc = modelContext ? { modelContext } : {};
  new Function('window', 'document', 'navigator', 'console', source)(win, doc, {}, console);
  return win;
}

function toolsFrom(win, dependencies) {
  const tools = win.ArtSoulWebMCP.createTools(dependencies);
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function jsonFetch(routes) {
  return async (path) => {
    for (const [fragment, payload] of Object.entries(routes)) {
      if (path.includes(fragment)) return payload;
    }
    throw new Error(`unexpected request: ${path}`);
  };
}

const AUCTION_CARD = {
  artwork_id: '31',
  title: 'Northern Static',
  description: 'A study in interference',
  creator_name: 'vera',
  creator: '0xabc',
  status: 'auction',
  current_bid: '0.42',
  start_price: '0.1',
  auction_end_time: '2026-09-01T12:00:00+00:00',
  minted: false
};

const SETTLED_CARD = {
  artwork_id: '12',
  title: 'Quiet Harbour',
  creator_name: 'ilya',
  status: 'sold',
  current_bid: '0.8',
  canonical_floor: '0.8',
  minted: true
};

test('an ordinary browser gets no tools, no requests and no handlers', () => {
  // Without a WebMCP-capable browser the bootstrap must exit before it touches
  // anything: this site already carries a tight first-paint budget, and a
  // visitor who will never talk to an agent must not pay for this file.
  let idleAsked = false;
  const win = load();
  win.requestIdleCallback = () => { idleAsked = true; };
  assert.equal(idleAsked, false);
  assert.equal(typeof win.ArtSoulWebMCP.createTools, 'function');
});

test('the eleven ArtSoul tools are registered when the browser supports WebMCP', async () => {
  const registered = [];
  const win = load({ modelContext: { registerTool: async (tool) => registered.push(tool.name) } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(registered, [
    'search_artworks',
    'find_active_auctions',
    'get_artwork',
    'get_auction_state',
    'get_artwork_provenance',
    'explain_settlement',
    'open_artwork',
    'prepare_bid',
    'place_bid',
    'end_expired_auction',
    'prepare_artwork_registration'
  ]);
  assert.equal(typeof win.ArtSoulWebMCP.register, 'function');
});

test('one rejected descriptor does not cost the other tools', async () => {
  const win = load();
  const accepted = [];
  const modelContext = {
    registerTool: async (tool) => {
      if (tool.name === 'search_artworks') throw new Error('unsupported');
      accepted.push(tool.name);
    }
  };
  const tools = win.ArtSoulWebMCP.createTools({ fetchJson: async () => ({}) });
  const names = await win.ArtSoulWebMCP.register(modelContext, tools);
  assert.equal(names.includes('search_artworks'), false);
  assert.equal(accepted.length, 10);
});

test('every tool declares a JSON Schema so the agent never guesses an input', () => {
  const win = load();
  for (const tool of win.ArtSoulWebMCP.createTools({ fetchJson: async () => ({}) })) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a usable description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} needs an object schema`);
    assert.equal(typeof tool.execute, 'function');
  }
});

test('search_artworks matches free text and caps the result count', async () => {
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD, SETTLED_CARD] } })
  });

  const hit = JSON.parse(await tools.get('search_artworks').execute({ query: 'harbour' }));
  assert.equal(hit.count, 1);
  assert.equal(hit.results[0].artwork_id, '12');
  assert.equal(hit.results[0].url, '/artwork/12');

  const byCreator = JSON.parse(await tools.get('search_artworks').execute({ creator: 'vera' }));
  assert.equal(byCreator.count, 1);
  assert.equal(byCreator.results[0].title, 'Northern Static');

  const capped = JSON.parse(await tools.get('search_artworks').execute({ limit: 1 }));
  assert.equal(capped.count, 2);
  assert.equal(capped.results.length, 1);
});

test('find_active_auctions sorts by the nearest deadline and honours the window', async () => {
  const later = { ...AUCTION_CARD, artwork_id: '40', auction_end_time: '2026-09-03T12:00:00+00:00' };
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [later, AUCTION_CARD] } }),
    now: () => Date.parse('2026-09-01T06:00:00+00:00')
  });

  const all = JSON.parse(await tools.get('find_active_auctions').execute({}));
  assert.deepEqual(all.auctions.map((entry) => entry.artwork_id), ['31', '40']);
  assert.equal(all.auctions[0].hours_remaining, 6);

  const soon = JSON.parse(await tools.get('find_active_auctions').execute({ ending_within_hours: 12 }));
  assert.equal(soon.count, 1);
  assert.equal(soon.auctions[0].artwork_id, '31');
});

test('get_auction_state prefers the live auction row over the cached card', async () => {
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({
      '/api/public/artworks': { data: [{ ...AUCTION_CARD, active_auction_id: '31', bids: [{}, {}] }] },
      '/api/public/auction-live': {
        auction: {
          status: 'auction',
          current_bid: '0.55',
          current_bidder: '0xfeed',
          auction_end_time: '2026-09-01T12:00:00+00:00'
        }
      }
    })
  });

  const state = JSON.parse(await tools.get('get_auction_state').execute({ artwork_id: '31' }));
  assert.equal(state.current_bid_eth, '0.55');
  assert.equal(state.current_bidder, '0xfeed');
  assert.equal(state.bid_count, 2);
});

test('an artwork id that is not a protocol number is refused before any request', async () => {
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: async () => { throw new Error('no request should be made'); }
  });
  const answer = JSON.parse(await tools.get('get_auction_state').execute({ artwork_id: '31; drop' }));
  assert.match(answer.error, /artwork number/);
});

test('provenance names the three canon roles and explains First Collector', async () => {
  // The payload below is the real shape of /api/public/artwork-provenance,
  // captured from production: roles are `*_address` fields under `roles`, and
  // the timeline arrives as `events`. An earlier version of this tool guessed a
  // `provenance.timeline` shape and returned three nulls against live data, so
  // this fixture is deliberately verbatim rather than convenient.
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({
      '/api/public/artwork-provenance': {
        success: true,
        source: 'v41_provenance_projection',
        chain_id: 84532,
        artwork_id: '19',
        roles: {
          creator_address: '0xA61C114E38cEAc5BDE6325956F4e808582690329',
          first_collector_address: '0x6EC8C121043357aC231E36D403EdAbf90AE6989B',
          current_owner_address: '0x6EC8C121043357aC231E36D403EdAbf90AE6989B'
        },
        events: [
          {
            type: 'artwork_registered',
            block_number: 43660058,
            log_index: 138,
            transaction_hash: '0x3ad3e5',
            recorded_at: '2026-07-03T14:20:12.598+00:00',
            creator_address: '0xA61C114E38cEAc5BDE6325956F4e808582690329'
          },
          {
            type: 'auction_started',
            transaction_hash: '0x2b96a6',
            recorded_at: '2026-07-03T14:20:47.805+00:00',
            start_price: '0.001',
            duration_seconds: 129600
          },
          {
            type: 'settlement_completed',
            transaction_hash: '0x079ced',
            recorded_at: '2026-07-05T07:46:19.314+00:00',
            first_collector_address: '0x6EC8C121043357aC231E36D403EdAbf90AE6989B',
            final_price: '0.001'
          }
        ]
      }
    })
  });

  const answer = JSON.parse(await tools.get('get_artwork_provenance').execute({ artwork_id: '19' }));
  assert.equal(answer.creator, '0xA61C114E38cEAc5BDE6325956F4e808582690329');
  assert.equal(answer.first_collector, '0x6EC8C121043357aC231E36D403EdAbf90AE6989B');
  assert.equal(answer.owner, '0x6EC8C121043357aC231E36D403EdAbf90AE6989B');
  assert.match(answer.note, /First Collector/);

  assert.equal(answer.timeline.length, 3);
  assert.deepEqual(answer.timeline.map((entry) => entry.event), [
    'artwork_registered',
    'auction_started',
    'settlement_completed'
  ]);
  assert.equal(answer.timeline[2].amount_eth, '0.001');
  assert.equal(answer.timeline[2].at, '2026-07-05T07:46:19.314+00:00');
  // Block numbers and log indexes mean nothing in a conversation.
  assert.equal('block_number' in answer.timeline[0], false);
});

test('a long provenance timeline is capped instead of flooding the agent', async () => {
  const events = Array.from({ length: 40 }, (_, i) => ({ type: `resale_${i}`, recorded_at: '2026-07-05T07:46:19Z' }));
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artwork-provenance': { roles: {}, events } })
  });
  const answer = JSON.parse(await tools.get('get_artwork_provenance').execute({ artwork_id: '19' }));
  assert.equal(answer.timeline.length, 25);
  assert.equal(answer.creator, null, 'missing roles must be null, never undefined');
});

test('explain_settlement keeps the canon floor rule and refuses to quote figures it cannot read', async () => {
  const win = load();
  const tools = toolsFrom(win, { fetchJson: jsonFetch({ '/api/public/artworks': { data: [SETTLED_CARD] } }) });

  const general = JSON.parse(await tools.get('explain_settlement').execute({}));
  assert.match(general.floor_rule, /only by a successful settlement/);
  assert.match(general.exact_figures, /contract constants/);

  const placed = JSON.parse(await tools.get('explain_settlement').execute({ artwork_id: '12' }));
  assert.equal(placed.current_status, 'sold');
  assert.equal(placed.minted, true);
});

test('prepare_bid never signs: it opens the auction and hands the action to the person', async () => {
  const opened = [];
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    openPath: (path) => opened.push(path)
  });

  const prepared = JSON.parse(await tools.get('prepare_bid').execute({ artwork_id: '31', intended_bid_eth: '0.5' }));
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.signed_by, 'the person, in their own wallet');
  assert.equal(prepared.intended_bid_eth, '0.5');
  assert.match(prepared.instruction, /never signs/);
  assert.deepEqual(opened, ['/artwork/31']);
  // The prepared answer must not carry a bid amount presented as final, and no
  // field may claim the bid was placed.
  assert.equal('transaction' in prepared, false);
  assert.equal('signature' in prepared, false);
});

test('prepare_bid refuses a work that is not open for bidding', async () => {
  const opened = [];
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [SETTLED_CARD] } }),
    openPath: (path) => opened.push(path)
  });

  const answer = JSON.parse(await tools.get('prepare_bid').execute({ artwork_id: '12' }));
  assert.equal(answer.prepared, false);
  assert.match(answer.reason, /not open for bidding/);
  assert.deepEqual(opened, [], 'a closed auction must not navigate the page');
});

test('prepare_bid reports contract constants only when the chain can be read', async () => {
  const win = load();
  const withoutWallet = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } })
  });
  const guest = JSON.parse(await withoutWallet.get('prepare_bid').execute({ artwork_id: '31' }));
  assert.equal(guest.contract_constants, null);

  const withWallet = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => ({
      isReady: () => true,
      getAuctionConstants: async () => ({ minDeposit: '10000000000000000' })
    })
  });
  const connected = JSON.parse(await withWallet.get('prepare_bid').execute({ artwork_id: '31' }));
  assert.equal(connected.contract_constants.minDeposit, '10000000000000000');

  // A failed read must stay null rather than becoming an invented number.
  const broken = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => ({ isReady: () => true, getAuctionConstants: async () => { throw new Error('rpc down'); } })
  });
  const failed = JSON.parse(await broken.get('prepare_bid').execute({ artwork_id: '31' }));
  assert.equal(failed.contract_constants, null);
});

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    map
  };
}

function walletStub(onBid) {
  const calls = [];
  return {
    calls,
    contracts: {
      isReady: () => true,
      placeBid: async (artworkId, amount) => {
        calls.push([artworkId, amount]);
        return onBid ? onBid(artworkId, amount) : '0xhash';
      }
    }
  };
}

test('place_bid opens the wallet only after the person grants permission themselves', async () => {
  const wallet = walletStub();
  const storage = memoryStorage();
  const prompts = [];
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => wallet.contracts,
    storage,
    confirmAction: (message) => { prompts.push(message); return true; }
  });

  const first = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(first.submitted, true);
  assert.equal(first.approved_by, 'the person, in their own wallet');
  assert.equal(first.transaction_hash, '0xhash');
  assert.deepEqual(wallet.calls, [['31', '0.5']]);
  // The dialog must name the amount and the artwork, and must not promise that
  // the page will sign anything.
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /0\.5 ETH/);
  assert.match(prompts[0], /artwork 31/);
  assert.match(prompts[0], /never signs for you/);

  // Granted once, remembered for this browser: no second dialog.
  await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.6' });
  assert.equal(prompts.length, 1);
  assert.equal(wallet.calls.length, 2);
});

test('a refused permission means no wallet call at all', async () => {
  const wallet = walletStub();
  const storage = memoryStorage();
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => wallet.contracts,
    storage,
    confirmAction: () => false
  });

  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(answer.submitted, false);
  assert.match(answer.reason, /did not grant/);
  assert.deepEqual(wallet.calls, []);
  assert.equal(storage.map.size, 0, 'a refusal must not be remembered as a grant');
});

test('no tool can raise the agent permission by itself', () => {
  const win = load();
  const names = win.ArtSoulWebMCP.createTools({ fetchJson: async () => ({}) }).map((t) => t.name);
  // The grant exists only behind a human click in the confirmation dialog. If a
  // tool ever appears that sets it, this test is the thing that should stop it.
  assert.equal(names.some((name) => /permission|grant|allow|approve/i.test(name)), false);
  assert.equal(typeof win.ArtSoulWebMCP.revokePermission, 'function');
  assert.equal(win.ArtSoulWebMCP.permissionLevel(), 'read');
});

test('place_bid refuses without a connected wallet, on a closed auction, and on a bad amount', async () => {
  const win = load();
  const storage = memoryStorage({ 'artsoul.agent.permission': 'wallet' });
  const noWallet = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    storage
  });
  const guest = JSON.parse(await noWallet.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(guest.submitted, false);
  assert.match(guest.reason, /No wallet is connected/);

  const wallet = walletStub();
  const closed = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [SETTLED_CARD] } }),
    readContracts: () => wallet.contracts,
    storage
  });
  const sold = JSON.parse(await closed.get('place_bid').execute({ artwork_id: '12', bid_eth: '0.5' }));
  assert.equal(sold.submitted, false);
  assert.match(sold.reason, /not open for bidding/);
  assert.deepEqual(wallet.calls, []);

  const live = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => wallet.contracts,
    storage
  });
  for (const bad of ['0', '-1', 'a lot', '']) {
    const answer = JSON.parse(await live.get('place_bid').execute({ artwork_id: '31', bid_eth: bad }));
    assert.equal(answer.submitted, false, `${bad} must be refused`);
  }
  assert.deepEqual(wallet.calls, [], 'an invalid amount must never reach the wallet');
});

test('a rejected signature is reported as an ordinary outcome, not a crash', async () => {
  const wallet = walletStub(() => { throw new Error('User rejected the request.'); });
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => wallet.contracts,
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' })
  });

  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(answer.submitted, false);
  assert.match(answer.reason, /User rejected/);
});

test('a storage that throws denies the permission instead of granting it', async () => {
  const wallet = walletStub();
  const hostile = {
    getItem() { throw new Error('site data blocked'); },
    setItem() { throw new Error('site data blocked'); }
  };
  let asked = 0;
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => wallet.contracts,
    storage: hostile,
    confirmAction: () => { asked += 1; return true; }
  });

  await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' });
  await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' });
  // Unreadable storage costs an extra confirmation, which is the safe direction.
  assert.equal(asked, 2);
  assert.equal(wallet.calls.length, 2);
});

const INDEXER_STATUS = {
  success: true,
  chains: [{
    chain_id: 84532,
    last_indexed_block: 46109894,
    last_confirmed_block: 46109894,
    last_indexed_at: '2026-08-29T07:21:22.652508+00:00',
    lag_to_observed_block: 0,
    stale_projection: false
  }]
};

test('every listing carries the auction number and how fresh the answer is', async () => {
  // Both exist because of what a real agent did without them: to name auctions
  // it went to the contract for their ids, and to claim the answer was current
  // it proved freshness with an RPC read. Two round trips the page could have
  // answered for free.
  const win = load();
  const requests = [];
  const tools = toolsFrom(win, {
    fetchJson: async (path) => {
      requests.push(path);
      if (path.includes('indexer-status')) return INDEXER_STATUS;
      return { data: [{ ...AUCTION_CARD, active_auction_id: '32' }] };
    },
    now: () => Date.parse('2026-09-01T06:00:00+00:00')
  });

  const auctions = JSON.parse(await tools.get('find_active_auctions').execute({}));
  assert.equal(auctions.auctions[0].auction_id, '32');
  assert.deepEqual(auctions.as_of, {
    indexed_block: 46109894,
    confirmed_block: 46109894,
    indexed_at: '2026-08-29T07:21:22.652508+00:00',
    blocks_behind_chain: 0,
    stale: false
  });

  const search = JSON.parse(await tools.get('search_artworks').execute({}));
  assert.equal(search.results[0].auction_id, '32');
  assert.ok(search.as_of, 'search answers are time-sensitive too');

  // Freshness is read once per page, not once per tool call.
  assert.equal(requests.filter((path) => path.includes('indexer-status')).length, 1);
});

test('a work with no auction reports no auction number rather than a stale one', async () => {
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({
      '/api/public/indexer-status': INDEXER_STATUS,
      '/api/public/artworks': { data: [SETTLED_CARD] }
    })
  });
  const answer = JSON.parse(await tools.get('search_artworks').execute({}));
  assert.equal(answer.results[0].auction_id, null);
});

test('an unreadable projection status costs the answer nothing', async () => {
  // Freshness is context, never the answer itself.
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: async (path) => {
      if (path.includes('indexer-status')) throw new Error('status endpoint down');
      return { data: [{ ...AUCTION_CARD, active_auction_id: '32' }] };
    },
    now: () => Date.parse('2026-09-01T06:00:00+00:00')
  });

  const auctions = JSON.parse(await tools.get('find_active_auctions').execute({}));
  assert.equal(auctions.as_of, null);
  assert.equal(auctions.count, 1);
  assert.equal(auctions.auctions[0].auction_id, '32');
});

test('search finds a work by its number, the way people actually refer to it', async () => {
  // The number is the identifier printed in the URL, so "31", "#31" and
  // "artwork 31" are all ordinary ways to name a work in a conversation.
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD, SETTLED_CARD] } })
  });

  for (const query of ['31', '#31', 'artwork 31', 'Artwork  #31']) {
    const answer = JSON.parse(await tools.get('search_artworks').execute({ query }));
    assert.equal(answer.count, 1, `${query} must find exactly one work`);
    assert.equal(answer.results[0].artwork_id, '31');
  }

  // A number that is part of a title still matches by text, and a number that
  // matches nothing returns nothing rather than everything.
  const none = JSON.parse(await tools.get('search_artworks').execute({ query: '999' }));
  assert.equal(none.count, 0);
});

test('get_artwork answers the whole public record of one work', async () => {
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({
      '/api/public/artworks': {
        data: [{
          ...AUCTION_CARD,
          current_owner_address: '0xowner',
          token_id: '0',
          like_count: 4,
          would_buy_count: 2,
          watching_count: 7,
          bids: [{}, {}]
        }]
      }
    })
  });

  const answer = JSON.parse(await tools.get('get_artwork').execute({ artwork_id: '31' }));
  assert.equal(answer.artwork_id, '31');
  assert.equal(answer.title, 'Northern Static');
  assert.equal(answer.description, 'A study in interference');
  assert.equal(answer.creator_address, '0xabc');
  assert.equal(answer.owner, '0xowner');
  assert.equal(answer.bid_count, 2);
  // ArtSoulNFT assigns the first token id 1, so a zero is the projection saying
  // "no token" and must never be reported to an agent as token zero.
  assert.equal(answer.token_id, null);
  assert.deepEqual(answer.community_signals, { likes: 4, would_buy: 2, watching: 7 });
  // Discovery signals must never arrive dressed as money.
  assert.equal('value' in answer.community_signals, false);
});

test('open_artwork navigates, and refuses a work that does not exist', async () => {
  const opened = [];
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    openPath: (path) => opened.push(path)
  });

  const answer = JSON.parse(await tools.get('open_artwork').execute({ artwork_id: '31' }));
  assert.equal(answer.opened, true);
  assert.equal(answer.title, 'Northern Static');
  assert.deepEqual(opened, ['/artwork/31']);

  const missing = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [] } }),
    openPath: (path) => opened.push(path)
  });
  const refused = JSON.parse(await missing.get('open_artwork').execute({ artwork_id: '77' }));
  assert.equal(refused.opened, false);
  assert.equal(opened.length, 1, 'a missing artwork must not navigate anywhere');
});

test('end_expired_auction only finalizes an auction whose time has actually passed', async () => {
  const calls = [];
  const contracts = {
    isReady: () => true,
    endAuction: async (id) => { calls.push(id); return '0xended'; }
  };
  const win = load();
  const storage = memoryStorage({ 'artsoul.agent.permission': 'wallet' });

  const live = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [AUCTION_CARD] } }),
    readContracts: () => contracts,
    storage
  });
  const stillRunning = JSON.parse(await live.get('end_expired_auction').execute({ artwork_id: '31' }));
  assert.equal(stillRunning.submitted, false);
  assert.match(stillRunning.reason, /end time has passed/);
  assert.deepEqual(calls, [], 'a running auction must never reach the wallet');

  const expired = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [{ ...AUCTION_CARD, status: 'awaiting_end' }] } }),
    readContracts: () => contracts,
    storage
  });
  const finalized = JSON.parse(await expired.get('end_expired_auction').execute({ artwork_id: '31' }));
  assert.equal(finalized.submitted, true);
  assert.equal(finalized.transaction_hash, '0xended');
  assert.equal(finalized.approved_by, 'the person, in their own wallet');
  assert.deepEqual(calls, ['31']);
});

test('end_expired_auction needs a wallet and the same granted permission as a bid', async () => {
  const calls = [];
  const contracts = {
    isReady: () => true,
    endAuction: async (id) => { calls.push(id); return '0xended'; }
  };
  const expiredCard = { '/api/public/artworks': { data: [{ ...AUCTION_CARD, status: 'awaiting_end' }] } };
  const win = load();

  const guest = toolsFrom(win, {
    fetchJson: jsonFetch(expiredCard),
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' })
  });
  const noWallet = JSON.parse(await guest.get('end_expired_auction').execute({ artwork_id: '31' }));
  assert.equal(noWallet.submitted, false);
  assert.match(noWallet.reason, /No wallet is connected/);

  const refused = toolsFrom(win, {
    fetchJson: jsonFetch(expiredCard),
    readContracts: () => contracts,
    storage: memoryStorage(),
    confirmAction: () => false
  });
  const denied = JSON.parse(await refused.get('end_expired_auction').execute({ artwork_id: '31' }));
  assert.equal(denied.submitted, false);
  assert.match(denied.reason, /did not grant/);
  assert.deepEqual(calls, []);
});

test('the tools that reach the chain are exactly the three that need a signature', () => {
  // A guard against the layer growing a write nobody reviewed. Every other tool
  // must stay readable by an anonymous visitor with no wallet at all.
  const win = load();
  const source = fs.readFileSync('webmcp-tools.js', 'utf8');
  const writes = win.ArtSoulWebMCP.createTools({ fetchJson: async () => ({}) })
    .map((tool) => tool.name)
    .filter((name) => /^(place_|end_|prepare_)/.test(name));
  assert.deepEqual(writes, ['prepare_bid', 'place_bid', 'end_expired_auction', 'prepare_artwork_registration']);
  // Only two of those actually call the wallet, and both go through the grant.
  assert.equal((source.match(/readPermission\(\) !== PERMISSION_WALLET/g) || []).length, 2);
});

test('a creator is told they cannot bid on their own work, before any wallet opens', async () => {
  // ArtSoulCore reverts this with CreatorCannotBid. Found while filming a demo:
  // every live auction belonged to the connected wallet, so the only thing the
  // agent could have produced was an approved transaction that reverted and a
  // spent gas fee. The card and the connected address answer it beforehand.
  const wallet = walletStub();
  const win = load();
  const deps = {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [{ ...AUCTION_CARD, creator: '0xABC' }] } }),
    readContracts: () => wallet.contracts,
    readWalletAddress: () => '0xabc',
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' })
  };
  const tools = toolsFrom(win, deps);

  const placed = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(placed.submitted, false);
  assert.match(placed.reason, /created this artwork/);
  assert.match(placed.reason, /different wallet/);
  assert.deepEqual(wallet.calls, [], 'the wallet must never be opened for a bid the contract will refuse');

  // The read-only path says the same thing rather than promising a bid.
  const prepared = JSON.parse(await tools.get('prepare_bid').execute({ artwork_id: '31' }));
  assert.equal(prepared.prepared, false);
  assert.match(prepared.reason, /created this artwork/);
});

test('the highest bidder is told they cannot outbid themselves', async () => {
  const wallet = walletStub();
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({
      '/api/public/artworks': { data: [{ ...AUCTION_CARD, creator: '0xother', current_bidder: '0xMe' }] }
    }),
    readContracts: () => wallet.contracts,
    readWalletAddress: () => '0xme',
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' })
  });

  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(answer.submitted, false);
  assert.match(answer.reason, /already the highest bidder/);
  assert.deepEqual(wallet.calls, []);
});

test('a different wallet is allowed through to the wallet as before', async () => {
  const wallet = walletStub();
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({
      '/api/public/artworks': { data: [{ ...AUCTION_CARD, creator: '0xcreator', current_bidder: '0xsomeone' }] }
    }),
    readContracts: () => wallet.contracts,
    readWalletAddress: () => '0xvisitor',
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' })
  });

  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(answer.submitted, true);
  assert.deepEqual(wallet.calls, [['31', '0.5']]);
});

test('an unknown connected address leaves the decision to the contract', async () => {
  // Not knowing who is connected must not become a refusal: the wallet and the
  // contract remain the authority, and this layer only reports what it knows.
  const wallet = walletStub();
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [{ ...AUCTION_CARD, creator: '0xABC' }] } }),
    readContracts: () => wallet.contracts,
    readWalletAddress: () => '',
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' })
  });

  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(answer.submitted, true);
  assert.deepEqual(wallet.calls, [['31', '0.5']]);
});

test('a tool waits for the deferred wallet runtime before saying there is no wallet', async () => {
  // A-80. The wallet SDK is moving off the first-load path, so a page can be
  // interactive before the runtime exists. Deciding from the first read alone
  // would tell a connected person to connect.
  let loads = 0;
  let contracts = null;
  const wallet = walletStub();
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [{ ...AUCTION_CARD, creator: '0xother' }] } }),
    readContracts: () => contracts,
    readWalletAddress: () => '0xvisitor',
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' }),
    loadWalletRuntime: async () => {
      loads += 1;
      contracts = wallet.contracts;
    }
  });

  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(loads, 1, 'the runtime must be given its chance exactly once');
  assert.equal(answer.submitted, true);
  assert.deepEqual(wallet.calls, [['31', '0.5']]);
});

test('a runtime that is already there is not waited for', async () => {
  let loads = 0;
  const wallet = walletStub();
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [{ ...AUCTION_CARD, creator: '0xother' }] } }),
    readContracts: () => wallet.contracts,
    readWalletAddress: () => '0xvisitor',
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' }),
    loadWalletRuntime: async () => { loads += 1; }
  });

  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(loads, 0, 'an available wallet must not pay for a runtime wait');
  assert.equal(answer.submitted, true);
});

test('a runtime that never arrives is still reported as no wallet', async () => {
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [{ ...AUCTION_CARD, creator: '0xother' }] } }),
    readContracts: () => null,
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' }),
    loadWalletRuntime: async () => { throw new Error('offline'); }
  });

  // A load that throws must not become an unhandled rejection or a promise of a
  // wallet that is not there.
  const answer = JSON.parse(await tools.get('place_bid').execute({ artwork_id: '31', bid_eth: '0.5' }));
  assert.equal(answer.submitted, false);
  assert.match(answer.reason, /No wallet is connected/);
});

test('end_expired_auction waits for the same runtime', async () => {
  let loads = 0;
  let contracts = null;
  const calls = [];
  const ready = { isReady: () => true, endAuction: async (id) => { calls.push(id); return '0xended'; } };
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({ '/api/public/artworks': { data: [{ ...AUCTION_CARD, status: 'awaiting_end' }] } }),
    readContracts: () => contracts,
    storage: memoryStorage({ 'artsoul.agent.permission': 'wallet' }),
    loadWalletRuntime: async () => { loads += 1; contracts = ready; }
  });

  const answer = JSON.parse(await tools.get('end_expired_auction').execute({ artwork_id: '31' }));
  assert.equal(loads, 1);
  assert.equal(answer.submitted, true);
  assert.deepEqual(calls, ['31']);
});

test('the wallet wait goes through the documented runtime entry point', () => {
  // Pinned so the boundary survives a refactor of the wallet loader: the tools
  // must not reach past ArtSoulWalletRuntime.load() into the SDK themselves.
  const source = fs.readFileSync('webmcp-tools.js', 'utf8');
  assert.match(source, /window\.ArtSoulWalletRuntime/);
  assert.match(source, /runtime\.load\(\)/);
  assert.doesNotMatch(source, /import\(['"`]\.\/appkit-init/);
});

test('prepare_artwork_registration says registration is not a mint', async () => {
  const opened = [];
  const win = load();
  const tools = toolsFrom(win, { fetchJson: async () => ({}), openPath: (path) => opened.push(path) });

  const prepared = JSON.parse(await tools.get('prepare_artwork_registration').execute({ title: 'Slow Water' }));
  assert.equal(prepared.prepared, true);
  assert.match(prepared.instruction, /does not mint an NFT/);
  assert.deepEqual(opened, ['/upload']);

  const rejected = JSON.parse(await tools.get('prepare_artwork_registration').execute({ title: '  ' }));
  assert.equal(rejected.prepared, false);
});

test('no frozen economic value is copied into the agent layer', () => {
  // Deposit size and bid increment are contract constants. A second copy here
  // would drift from the canon the moment either changes, so the tools report
  // what the chain and the projection say and never carry the numbers.
  assert.equal(/0\.01\s*ETH/.test(source), false, 'the deposit must not be hardcoded');
  assert.equal(/2\.5\s*%/.test(source), false, 'the bid increment must not be hardcoded');
  assert.equal(/97\.5|92\.5|5\.5/.test(source), false, 'fee splits must not be hardcoded');
});

test('the agent layer only ever reads Base Sepolia', () => {
  const win = load();
  assert.equal(win.ArtSoulWebMCP.CHAIN_ID, 84532);
  assert.equal(/11155111/.test(source), false, 'legacy Ethereum Sepolia is never agent-selectable');
});
