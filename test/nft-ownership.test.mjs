import assert from 'node:assert/strict';
import test from 'node:test';
import { readNftOwnershipConfig, readNftOwnershipBoundary, readNftOwnership,
  readNftHistory, recheckNftOwnershipBoundary, recheckNftOwnership, readWithNftOwnershipRetry } from '../src/api/nft-ownership.js';

const CORE = `0x${'a'.repeat(40)}`, NFT = `0x${'b'.repeat(40)}`;
const FIRST = `0x${'c'.repeat(40)}`, OWNER = `0x${'d'.repeat(40)}`, ZERO = `0x${'0'.repeat(40)}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const env = { SUPABASE_URL: 'https://ownership.example.test', SUPABASE_SERVICE_ROLE_KEY: 'local-ownership-fixture',
  ARTSOUL_NFT_OWNERSHIP_ENABLED: 'true', ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE,
  ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA: NFT, ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH: hash(1),
  ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH: hash(2) };
const checkpoint = () => ({ indexed_through: 120, confirmed_through: 115, covered_hash: hash(120), state_revision: '1234' });
const artwork = (id = '1', token = '9007199254740993') => ({ chain_id: 84532, artwork_id: id, token_id: token, minted: true });
const owner = (id = '1', extra = {}) => ({ artwork_id: id, token_id: '9007199254740993', verified: true,
  first_collector_address: FIRST, current_owner_address: OWNER, latest_transfer: {
    block_number: 118, log_index: 9, transaction_hash: hash(118), recorded_at: '2026-11-01T00:00:00+00:00',
    from_address: FIRST, to_address: OWNER }, ...checkpoint(), ...extra });
const unknown = (id = '1') => owner(id, { token_id: null, verified: false,
  first_collector_address: null, current_owner_address: null, latest_transfer: null });
const unavailable = error => error.statusCode === 503 && error.code === 'NFT_OWNERSHIP_UNAVAILABLE' &&
  error.message === 'Ownership information is temporarily unavailable.';
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const lifecycleEvent = (event_name, event_data, block_number = 100, log_index = 1) => ({
  chain_id: 84532, contract_address: CORE, event_name, event_data, block_number, log_index,
  transaction_hash: hash(block_number), indexed_at: '2026-11-01T00:00:00+00:00' });
const lifecycle = () => ({ lifecycle: [lifecycleEvent('ArtworkRegistered', { artworkId: '1', creator: FIRST, metadataURI: 'ipfs://fixture' })],
  lifecycle_available: true, lifecycle_complete: true });

test('shared NFT ownership reads validate deployment, evidence and snapshot continuity without network access', async t => {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])), originalFetch = globalThis.fetch;
  let calls, respond;
  t.beforeEach(() => {
    Object.assign(process.env, env); calls = [];
    respond = (name, body) => name === 'read_verified_nft_boundary' ? [checkpoint()] : body.p_artwork_ids.map(id => owner(id));
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, env.SUPABASE_URL);
      const name = parsed.pathname.slice('/rest/v1/rpc/'.length), body = JSON.parse(options.body);
      assert.ok(['read_verified_nft_boundary', 'read_verified_nft_cards', 'read_verified_nft_history'].includes(name));
      assert.equal(options.method, 'POST'); assert.ok(options.signal instanceof AbortSignal);
      calls.push({ name, body });
      const value = await respond(name, body);
      return value instanceof Response ? value : json(value);
    };
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  await t.test('only absent or false disables reads, with no fallback configuration or storage calls', async () => {
    for (const value of [undefined, 'false']) {
      if (value === undefined) delete process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED;
      else process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED = value;
      process.env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA = '';
      assert.equal(readNftOwnershipConfig(), null);
      assert.equal(await readNftOwnershipBoundary(), null);
      assert.equal(await readNftOwnership(null), null);
      assert.equal(await readNftHistory(null), null);
      assert.equal(await recheckNftOwnership(null), null);
    }
    assert.deepEqual(calls, []);
  });
  for (const [key, value] of [
    ['ARTSOUL_NFT_OWNERSHIP_ENABLED', ''], ['ARTSOUL_NFT_OWNERSHIP_ENABLED', '1'],
    ['ARTSOUL_NFT_OWNERSHIP_ENABLED', 'TRUE'], ['ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA', ''],
    ['ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA', ZERO], ['ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA', CORE],
    ['ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA', '0x12'], ['ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH', ''],
    ['ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH', hash(0)]
  ]) await t.test(`invalid enabled configuration fails closed: ${key}=${value}`, async () => {
    process.env[key] = value;
    assert.throws(readNftOwnershipConfig, unavailable);
    await assert.rejects(readNftOwnership([artwork()]), unavailable);
    assert.deepEqual(calls, []);
  });

  await t.test('boundary normalizes safe block numbers and pins the exact server deployment', async () => {
    process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = CORE.toUpperCase().replace('0X', '0x');
    const initial = await readNftOwnershipBoundary();
    assert.equal(initial.indexed_through, '120'); assert.equal(initial.confirmed_through, '115');
    assert.equal(initial.config.coreAddress, CORE); assert.ok(Object.isFrozen(initial.config));
    assert.deepEqual(calls[0].body, { p_core_address: CORE, p_nft_address: NFT,
      p_core_code_hash: hash(1), p_nft_code_hash: hash(2) });
    respond = () => [{ ...checkpoint(), indexed_through: '120', confirmed_through: '115' }];
    assert.equal(await recheckNftOwnershipBoundary(initial), initial);
  });
  for (const data of [[], null, {}, [checkpoint(), checkpoint()], [{ ...checkpoint(), indexed_through: 1.5 }],
    [{ ...checkpoint(), indexed_through: Number.MAX_SAFE_INTEGER + 1 }], [{ ...checkpoint(), indexed_through: '01' }],
    [{ ...checkpoint(), confirmed_through: 121 }], [{ ...checkpoint(), covered_hash: hash(0) }],
    [{ ...checkpoint(), state_revision: 1234 }], [{ ...checkpoint(), state_revision: '4294967296' }],
    [{ ...checkpoint(), indexed_through: null }]]) {
    await t.test(`unavailable or malformed boundary fails closed: ${JSON.stringify(data)}`, async () => {
      respond = () => data; await assert.rejects(readNftOwnershipBoundary(), unavailable);
    });
  }

  await t.test('batches at twenty IDs, restores request order and retains exact uint256 text', async () => {
    const huge = String(2n ** 256n - 1n), cards = Array.from({ length: 41 }, (_, i) => artwork(String(i + 1)));
    cards[40] = artwork(huge, huge);
    respond = (name, body) => name === 'read_verified_nft_boundary' ? [checkpoint()] :
      body.p_artwork_ids.map(id => owner(id, id === huge ? { token_id: huge } : {})).reverse();
    const initial = await readNftOwnershipBoundary(), result = await readNftOwnership(cards, initial);
    assert.deepEqual(calls.slice(1).map(call => call.body.p_artwork_ids.length), [20, 20, 1]);
    assert.deepEqual(result.rows.map(row => row.artwork_id), cards.map(card => card.artwork_id));
    assert.equal(result.rows[40].token_id, huge); assert.equal(result.marker, initial.marker);
    assert.ok(Object.isFrozen(result.rows[0].latest_transfer)); assert.ok(Object.isFrozen(result.artworks));
    assert.equal(await recheckNftOwnership(result), result);
  });
  await t.test('unverified evidence has no owner and never falls back to a supplied resale or collector', async () => {
    respond = (name) => name === 'read_verified_nft_boundary' ? [checkpoint()] : [unknown()];
    const result = await readNftOwnership([{ ...artwork(), current_owner_address: OWNER, resale_seller: OWNER, auction_winner_address: FIRST }]);
    assert.equal(result.rows[0].verified, false); assert.equal(result.rows[0].current_owner_address, null);
    assert.equal(result.rows[0].first_collector_address, null); assert.equal(result.rows[0].latest_transfer, null);
  });
  await t.test('legacy-only and empty results retain a fresh boundary without claiming Base ownership', async () => {
    const initial = await readNftOwnershipBoundary();
    const result = await readNftOwnership([{ ...artwork(), chain_id: 11155111 }], initial);
    assert.deepEqual(result.rows, []); assert.equal(calls.length, 1);
    assert.equal(await recheckNftOwnership(result), result); assert.equal(calls.length, 2);
    respond = () => []; await assert.rejects(recheckNftOwnership(result), unavailable);
  });
  await t.test('unminted work can remain explicitly unverified', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [unknown()];
    const result = await readNftOwnership([{ ...artwork(), minted: false, token_id: null }]);
    assert.equal(result.rows[0].verified, false);
  });
  await t.test('an RPC cannot assign verified ownership to an unminted artwork', async () => {
    await assert.rejects(readNftOwnership([{ ...artwork(), minted: false }]), unavailable);
  });
  await t.test('an invalid initial snapshot cannot silently start a replacement read', async () => {
    for (const initial of [false, 0, '', {}, { ...checkpoint(), config: readNftOwnershipConfig(), marker: 'forged' }]) {
      await assert.rejects(readNftOwnership([artwork()], initial), unavailable);
    }
    assert.deepEqual(calls, []);
  });
  for (const cards of [[artwork('01')], [artwork(1)], [artwork(String(2n ** 256n))], [artwork('1', 7)],
    [artwork('1', '7.1')], [artwork('1', '0')], [{ ...artwork(), minted: undefined }],
    [artwork(), artwork()], Array.from({ length: 201 }, (_, i) => artwork(String(i + 1)))]) {
    await t.test(`invalid caller identities reject before RPC: ${cards.length}/${String(cards[0].artwork_id)}/${String(cards[0].token_id)}`, async () => {
      await assert.rejects(readNftOwnership(cards), unavailable); assert.deepEqual(calls, []);
    });
  }

  const badRows = [
    ['missing', () => []], ['extra', () => [owner(), owner('2')]], ['unrequested', () => [owner('2')]],
    ['numeric identifier', () => [owner(1)]], ['numeric token', () => [owner('1', { token_id: 7 })]],
    ['wrong token', () => [owner('1', { token_id: '8' })]], ['truthy verification', () => [owner('1', { verified: 'true' })]],
    ['zero collector', () => [owner('1', { first_collector_address: ZERO })]],
    ['owner mismatch', () => [owner('1', { current_owner_address: FIRST })]],
    ['missing scope', () => [unknown('1')].map(row => ({ ...row, indexed_through: null, confirmed_through: null, covered_hash: null, state_revision: null }))],
    ['changed scope', () => [owner('1', { state_revision: '1235' })]],
    ['unverified owner', () => [{ ...unknown(), current_owner_address: OWNER }]],
    ['unverified collector', () => [{ ...unknown(), first_collector_address: FIRST }]],
    ['unverified movement', () => [{ ...unknown(), latest_transfer: owner().latest_transfer }]],
    ...Object.entries({ block_number: 121, log_index: 1.5, transaction_hash: hash(0), recorded_at: '0', from_address: 'bad', to_address: FIRST })
      .map(([key, value]) => [`invalid movement ${key}`, () => [{ ...owner(), latest_transfer: { ...owner().latest_transfer, [key]: value } }]])
  ];
  for (const [label, rows] of badRows) await t.test(`malformed ownership evidence fails closed: ${label}`, async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : rows();
    await assert.rejects(readNftOwnership([artwork()]), unavailable);
  });
  await t.test('duplicate response rows cannot replace another requested artwork', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [owner(), owner()];
    await assert.rejects(readNftOwnership([artwork(), artwork('2')]), unavailable);
  });
  await t.test('different snapshots across batches cannot produce a combined result', async () => {
    respond = (name, body) => name === 'read_verified_nft_boundary' ? [checkpoint()] :
      body.p_artwork_ids.map(id => owner(id, id === '21' ? { state_revision: '1235' } : {}));
    await assert.rejects(readNftOwnership(Array.from({ length: 21 }, (_, i) => artwork(String(i + 1)))), unavailable);
  });
  await t.test('caller input is captured before asynchronous reads', async () => {
    const card = artwork();
    respond = (name, body) => {
      if (name === 'read_verified_nft_boundary') { card.token_id = '8'; card.artwork_id = '9'; return [checkpoint()]; }
      return body.p_artwork_ids.map(id => owner(id));
    };
    const result = await readNftOwnership([card]); assert.equal(result.rows[0].artwork_id, '1');
    assert.equal(result.artworks[0].token_id, '9007199254740993');
  });
  await t.test('configuration changes during a read or after initial capture invalidate the result', async () => {
    const initial = await readNftOwnershipBoundary();
    respond = (_name, body) => { process.env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA = FIRST; return body.p_artwork_ids.map(id => owner(id)); };
    await assert.rejects(readNftOwnership([artwork()], initial), unavailable);
    process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED = 'false';
    await assert.rejects(readNftOwnership([artwork()], initial), unavailable);
    await assert.rejects(recheckNftOwnershipBoundary(initial), unavailable);
    process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED = 'true';
    await assert.rejects(readNftOwnership([artwork()], null), unavailable);
  });
  await t.test('recheck rejects owner changes even when a response retains the old boundary marker', async () => {
    const result = await readNftOwnership([artwork()]);
    respond = () => [{ ...owner(), current_owner_address: FIRST,
      latest_transfer: { ...owner().latest_transfer, from_address: OWNER, to_address: FIRST } }];
    await assert.rejects(recheckNftOwnership(result), unavailable);
  });
  await t.test('storage failure and provider details are sanitized rather than converted to disabled', async () => {
    respond = () => new Response(JSON.stringify({ message: 'private storage details' }), { status: 500 });
    await assert.rejects(readNftOwnershipBoundary(), unavailable);
    respond = () => { throw new Error('private network details'); };
    await assert.rejects(readNftOwnership([artwork()]), unavailable);
  });

  function history() {
    const movement = owner().latest_transfer;
    const transfers = [{ ...movement, block_number: 117, log_index: 2, transaction_hash: hash(117), to_address: NFT },
      { ...movement, from_address: NFT }];
    return { ownership: owner('1', { latest_transfer: transfers[1] }), transfers, complete: true, ...lifecycle() };
  }
  await t.test('history reuses the initial boundary and yields immutable non-sale transfers', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : history();
    const initial = await readNftOwnershipBoundary(), result = await readNftHistory(artwork(), initial);
    assert.deepEqual(calls.map(call => call.name), ['read_verified_nft_boundary', 'read_verified_nft_history']);
    assert.equal(calls[1].body.p_artwork_id, '1'); assert.equal(result.marker, initial.marker);
    assert.equal(result.rows[0].current_owner_address, OWNER); assert.equal(result.complete, true);
    assert.deepEqual(result.transfers.map(event => [event.block_number, event.log_index]), [[117, 2], [118, 9]]);
    assert.ok(Object.isFrozen(result.transfers[0])); assert.equal(result.transfers[0].price, undefined);
    assert.equal(await recheckNftOwnership(result), result);
    assert.equal(calls.at(-1).name, 'read_verified_nft_history');
  });
  await t.test('history uses row 201 only as a truncation sentinel and preserves the latest owner separately', async () => {
    const transfers = Array.from({ length: 201 }, (_, index) => ({ ...owner().latest_transfer,
      block_number: 118, log_index: index, transaction_hash: hash(1000 + index),
      from_address: index % 2 === 0 ? FIRST : OWNER, to_address: index % 2 === 0 ? OWNER : FIRST }));
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : {
      ownership: owner('1', { latest_transfer: transfers.at(-1) }), transfers, complete: false, ...lifecycle() };
    const result = await readNftHistory(artwork());
    assert.equal(result.complete, false); assert.equal(result.transfers.length, 200);
    assert.equal(result.transfers.at(-1).to_address, FIRST); assert.equal(result.rows[0].current_owner_address, OWNER);
    assert.equal(await recheckNftOwnership(result), result);
  });
  await t.test('mint-only and unknown associations do not invent a transfer or a complete unknown history', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : {
      ownership: owner('1', { current_owner_address: FIRST,
        latest_transfer: { ...owner().latest_transfer, from_address: ZERO, to_address: FIRST } }), transfers: [], complete: true, ...lifecycle() };
    const minted = await readNftHistory(artwork()); assert.equal(minted.complete, true); assert.deepEqual(minted.transfers, []);
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : { ownership: unknown(), transfers: [], complete: false,
      lifecycle: [], lifecycle_available: false, lifecycle_complete: false };
    const absent = await readNftHistory({ ...artwork(), minted: false, token_id: null });
    assert.equal(absent.complete, false); assert.equal(absent.rows[0].current_owner_address, null);
  });
  const invalidHistories = [
    ['wrong artwork association', data => { data.ownership.artwork_id = '2'; }],
    ['changed snapshot', data => { data.ownership.state_revision = '1235'; }],
    ['missing movements', data => { data.transfers = []; }],
    ['missing latest movement', data => { data.transfers.pop(); }],
    ['unsorted positions', data => { data.transfers.reverse(); }],
    ['duplicated movement', data => { data.transfers.unshift(data.transfers[0]); }],
    ['repeated block log position', data => { data.transfers[0] = { ...data.transfers[1], transaction_hash: hash(999) }; }],
    ['transaction in two blocks', data => { data.transfers[0].transaction_hash = data.transfers[1].transaction_hash; }],
    ['mint included as a wallet transfer', data => { data.transfers[0].from_address = ZERO; }],
    ['broken holder continuity', data => { data.transfers[0].from_address = OWNER; }],
    ['movement newer than owner', data => { data.transfers[1] = { ...data.transfers[1], log_index: 10 }; }],
    ['inconsistent truncation flag', data => { data.complete = false; }],
    ['unknown association with transfers', data => { data.ownership = unknown(); data.complete = false; }],
    ['unknown association marked complete', data => { data.ownership = unknown(); data.transfers = []; }],
    ['oversized history', data => { data.transfers = Array(202).fill(data.transfers[0]); data.complete = false; }],
    ['invalid recipient', data => { data.transfers[0].to_address = 'bad'; }]
  ];
  for (const [label, alter] of invalidHistories) await t.test(`history rejects ${label}`, async () => {
    respond = name => {
      if (name === 'read_verified_nft_boundary') return [checkpoint()];
      const data = history(); alter(data); return data;
    };
    await assert.rejects(readNftHistory(artwork()), unavailable);
  });
  await t.test('history recheck catches an earlier changed fact even with unchanged owner and marker', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : history();
    const result = await readNftHistory(artwork());
    respond = () => { const data = history(); data.transfers[0].transaction_hash = hash(999); return data; };
    await assert.rejects(recheckNftOwnership(result), unavailable);
  });
  await t.test('history refuses an enabled foreign-chain lookup and preserves configuration fences', async () => {
    await assert.rejects(readNftHistory({ ...artwork(), chain_id: 11155111 }), unavailable); assert.deepEqual(calls, []);
    const initial = await readNftOwnershipBoundary();
    respond = () => { process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED = 'false'; return history(); };
    await assert.rejects(readNftHistory(artwork(), initial), unavailable);
    await assert.rejects(readNftHistory(artwork(), initial), unavailable);
  });

  const listing = () => ({ token_id: artwork().token_id, seller: OWNER, price: '2500', last_updated_block: 119 });
  await t.test('cards retain only the validated immutable listing and recheck its contents', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [owner('1', { active_listing: listing() })];
    const result = await readNftOwnership([artwork()]);
    assert.equal(calls[1].name, 'read_verified_nft_cards'); assert.deepEqual(result.rows[0].active_listing, listing());
    assert.ok(Object.isFrozen(result.rows[0].active_listing));
    respond = () => [owner('1', { active_listing: { ...listing(), price: '2501' } })];
    await assert.rejects(recheckNftOwnership(result), unavailable);
  });
  for (const [label, alter] of [
    ['foreign token', value => { value.token_id = '8'; }], ['foreign seller', value => { value.seller = FIRST; }],
    ['numeric price', value => { value.price = 2500; }], ['zero price', value => { value.price = '0'; }],
    ['overflow price', value => { value.price = String(2n ** 256n); }],
    ['future listing', value => { value.last_updated_block = 121; }],
    ['listing before latest transfer', value => { value.last_updated_block = 117; }]
  ]) await t.test(`cards reject ${label}`, async () => {
    const value = listing(); alter(value);
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [owner('1', { active_listing: value })];
    await assert.rejects(readNftOwnership([artwork()]), unavailable);
  });
  await t.test('unverified ownership cannot carry a listing', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [{ ...unknown(), active_listing: listing() }];
    await assert.rejects(readNftOwnership([artwork()]), unavailable);
  });
  await t.test('lifecycle records preserve exact Core identity, association and immutable payloads', async () => {
    const data = history();
    data.lifecycle.push(lifecycleEvent('AuctionCreated', { artworkId: '1', auctionId: '2' }, 101),
      lifecycleEvent('AuctionEnded', { auctionId: '2' }, 102),
      lifecycleEvent('SettlementCompleted', { artworkId: '1', auctionId: '2', tokenId: artwork().token_id }, 103),
      lifecycleEvent('ResaleCompleted', { tokenId: artwork().token_id, seller: FIRST, buyer: OWNER, price: '2500' }, 119));
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : data;
    const result = await readNftHistory(artwork());
    assert.deepEqual(result.lifecycle, data.lifecycle); assert.ok(Object.isFrozen(result.lifecycle[1].event_data));
    assert.equal(result.lifecycle_available, true); assert.equal(result.lifecycle_complete, true);
    data.lifecycle[1].event_data.duration = '86400';
    await assert.rejects(recheckNftOwnership(result), unavailable);
  });
  await t.test('lifecycle row 201 is a truncation sentinel independent of transfer completeness', async () => {
    const data = history();
    data.lifecycle.push(...Array.from({ length: 200 }, (_, index) =>
      lifecycleEvent('AuctionCreated', { artworkId: '1', auctionId: String(index + 1) }, 101, index)));
    data.lifecycle_complete = false;
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : data;
    const result = await readNftHistory(artwork());
    assert.equal(result.lifecycle.length, 200); assert.equal(result.lifecycle_complete, false); assert.equal(result.complete, true);
  });
  for (const [label, alter] of [
    ['missing lifecycle', data => { delete data.lifecycle; }],
    ['foreign Core', data => { data.lifecycle[0].contract_address = NFT; }],
    ['foreign chain', data => { data.lifecycle[0].chain_id = 11155111; }],
    ['future event', data => { data.lifecycle[0].block_number = 121; }],
    ['wrong artwork', data => { data.lifecycle[0].event_data.artworkId = '2'; }],
    ['unsupported event', data => { data.lifecycle[0].event_name = 'BidPlaced'; }],
    ['missing registration', data => { data.lifecycle[0].event_name = 'AuctionCreated'; }],
    ['unknown auction', data => { data.lifecycle.push(lifecycleEvent('AuctionEnded', { auctionId: '2' }, 101)); }],
    ['foreign token sale', data => { data.lifecycle.push(lifecycleEvent('ResaleCompleted', { tokenId: '7' }, 101)); }],
    ['duplicate event', data => { data.lifecycle.push(data.lifecycle[0]); }],
    ['unknown registration with events', data => { data.lifecycle_available = false; data.lifecycle_complete = false; }],
    ['false complete lifecycle', data => { data.lifecycle_complete = false; }],
    ['non-scalar event payload', data => { data.lifecycle[0].event_data.artworkId = {}; }]
  ]) await t.test(`lifecycle rejects ${label}`, async () => {
    const data = history(); alter(data);
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : data;
    await assert.rejects(readNftHistory(artwork()), unavailable);
  });

  const advanced = () => ({ indexed_through: 121, confirmed_through: 121, covered_hash: hash(121), state_revision: '1235' });
  await t.test('one complete retry uses a fresh boundary after a fully validated forward publication', async () => {
    let marker = checkpoint(), attempts = 0;
    respond = (name, body) => {
      if (name === 'read_verified_nft_boundary') { const result = [{ ...marker }]; marker = advanced(); return result; }
      return body.p_artwork_ids.map(id => owner(id, marker));
    };
    const result = await readWithNftOwnershipRetry(async () => { attempts++; return readNftOwnership([artwork()]); });
    assert.equal(attempts, 2); assert.equal(result.indexed_through, '121');
    assert.deepEqual(calls.map(call => call.name), ['read_verified_nft_boundary','read_verified_nft_cards',
      'read_verified_nft_boundary','read_verified_nft_cards']);
  });
  await t.test('another forward movement exhausts the single retry and returns ordinary unavailable', async () => {
    let height = 120, attempts = 0;
    respond = (name, body) => {
      const marker = { indexed_through: height, confirmed_through: height, covered_hash: hash(height), state_revision: String(height) };
      if (name === 'read_verified_nft_boundary') { height++; return [marker]; }
      return body.p_artwork_ids.map(id => owner(id, marker));
    };
    await assert.rejects(readWithNftOwnershipRetry(async () => { attempts++; return readNftOwnership([artwork()]); }), unavailable);
    assert.equal(attempts, 2); assert.equal(calls.length, 4);
  });
  for (const change of [{ state_revision: '1235' }, { indexed_through: 119, confirmed_through: 119, covered_hash: hash(119) },
    { ...advanced(), confirmed_through: 120 }]) await t.test(`non-publication boundary changes do not retry: ${JSON.stringify(change)}`, async () => {
    let attempts = 0;
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [owner('1', change)];
    await assert.rejects(readWithNftOwnershipRetry(async () => { attempts++; return readNftOwnership([artwork()]); }), unavailable);
    assert.equal(attempts, 1);
  });
  await t.test('a malformed later owner batch overrides valid forward movement in an earlier batch', async () => {
    let attempts = 0;
    respond = (name, body) => name === 'read_verified_nft_boundary' ? [checkpoint()] :
      body.p_artwork_ids.map(id => owner(id, { ...advanced(), ...(id === '21' ? { current_owner_address: ZERO } : {}) }));
    await assert.rejects(readWithNftOwnershipRetry(async () => {
      attempts++; return readNftOwnership(Array.from({ length: 21 }, (_, i) => artwork(String(i + 1))));
    }), unavailable);
    assert.equal(attempts, 1); assert.equal(calls.length, 3);
  });
  await t.test('foreign lifecycle source is never masked by forward ownership movement', async () => {
    const data = history(); Object.assign(data.ownership, advanced()); data.lifecycle[0].contract_address = NFT;
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : data;
    let attempts = 0;
    await assert.rejects(readWithNftOwnershipRetry(async () => { attempts++; return readNftHistory(artwork()); }), unavailable);
    assert.equal(attempts, 1);
  });
  for (const [key, value] of [['ARTSOUL_NFT_OWNERSHIP_ENABLED','false'], ['ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH',hash(3)]]) {
    await t.test(`configuration change before retry prevents a replacement read: ${key}`, async () => {
      respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [owner('1', advanced())];
      let attempts = 0;
      await assert.rejects(readWithNftOwnershipRetry(async () => {
        attempts++;
        try { return await readNftOwnership([artwork()]); }
        catch (error) { process.env[key] = value; throw error; }
      }), unavailable);
      assert.equal(attempts, 1); assert.equal(calls.length, 2);
    });
  }
  await t.test('a forged retry code cannot restart an unavailable source', async () => {
    let attempts = 0;
    await assert.rejects(readWithNftOwnershipRetry(() => {
      attempts++; throw Object.assign(new Error('source failure'), { code: 'NFT_OWNERSHIP_BOUNDARY_MOVED' });
    }), /source failure/);
    assert.equal(attempts, 1);
  });
  await t.test('an overlapping mint does not retry an unproven old artwork identity', async () => {
    respond = name => name === 'read_verified_nft_boundary' ? [checkpoint()] : [owner('1', advanced())];
    let attempts = 0;
    await assert.rejects(readWithNftOwnershipRetry(async () => {
      attempts++; return readNftOwnership([{ ...artwork(), minted: false, token_id: null }]);
    }), unavailable);
    assert.equal(attempts, 1);
  });
});
