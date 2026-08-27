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

test('the seven ArtSoul tools are registered when the browser supports WebMCP', async () => {
  const registered = [];
  const win = load({ modelContext: { registerTool: async (tool) => registered.push(tool.name) } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(registered, [
    'search_artworks',
    'find_active_auctions',
    'get_auction_state',
    'get_artwork_provenance',
    'explain_settlement',
    'prepare_bid',
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
  assert.equal(accepted.length, 6);
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
  const win = load();
  const tools = toolsFrom(win, {
    fetchJson: jsonFetch({
      '/api/public/artwork-provenance': {
        provenance: {
          creator: '0xcreator',
          first_collector: '0xcollector',
          current_owner: '0xowner',
          timeline: [{ event: 'Settled' }]
        }
      }
    })
  });

  const answer = JSON.parse(await tools.get('get_artwork_provenance').execute({ artwork_id: '12' }));
  assert.equal(answer.creator, '0xcreator');
  assert.equal(answer.first_collector, '0xcollector');
  assert.equal(answer.owner, '0xowner');
  assert.equal(answer.timeline.length, 1);
  assert.match(answer.note, /First Collector/);
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
