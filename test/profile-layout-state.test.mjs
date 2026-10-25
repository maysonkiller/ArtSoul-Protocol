import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileLayoutState, defaultProfileLayout, validProfileLayout, profileArtworkPointer,
  canSelectProfileArtwork, selectedProfileArtworkKeys, moveProfileItem} from '../src/features/profile/profile-layout-state.js';

const WALLET = '0x' + '1'.repeat(40), OTHER = '0x' + '2'.repeat(40), CORE = '0x' + '3'.repeat(40);
const config = {chainId: 84532, coreAddress: CORE, selectionPolicy: 'owned-or-created'};
const pointer = id => ({chain_id: 84532, core_address: CORE, artwork_id: String(id)});
const card = (id, extra = {}) => ({source: 'v41_projection', chain_id: 84532, artwork_id: String(id), creator: WALLET, ...extra});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const response = (body, status = 200) => ({ok: status < 400, status, json: async () => body});
function harness() {
  const state = {wallet: WALLET, authenticated: WALLET, revision: 0, layout: defaultProfileLayout(), reads: [], writes: [], auth: 0, snapshots: [], cards: []};
  const deps = {
    wallet: WALLET, getWallet: () => state.wallet, authenticate: async () => {state.auth++; return true;},
    request: async (url, options) => {
      if (options.method === 'PUT') {state.writes.push({options, body: JSON.parse(options.body)}); state.layout = JSON.parse(options.body).layout; state.revision++;}
      else state.reads.push({url, options});
      return response({wallet: WALLET, revision: state.revision, ...(url.includes('view=artworks') ? {cards: state.cards} : {layout: state.layout})});
    },
    onChange: value => state.snapshots.push(value)
  };
  const controller = createProfileLayoutState({...deps, authenticate: () => deps.authenticate(), request: (...args) => deps.request(...args)});
  return {state, deps, controller};
}

test('the default public layout needs one public read and no wallet authentication', async () => {
  const h = harness(); h.state.wallet = OTHER;
  await h.controller.load();
  assert.equal(h.state.reads.length, 1); assert.equal(h.state.auth, 0);
  assert.equal(h.state.reads[0].options.credentials, 'omit');
  assert.deepEqual(h.controller.getState().layout, defaultProfileLayout());
  h.controller.edit(); assert.equal(h.controller.getState().editing, false);
});

test('selection remains deployment-scoped and allows authors or current NFT owners without inventing ownership', () => {
  assert.deepEqual(profileArtworkPointer(card(7), config), pointer(7));
  assert.equal(profileArtworkPointer(card(String(2n ** 256n)), config), null);
  assert.equal(canSelectProfileArtwork(card(7), WALLET, config), true);
  assert.equal(canSelectProfileArtwork(card(8, {creator: OTHER, minted: true, current_owner_address: WALLET}), WALLET, config), true);
  for (const value of [card(8, {creator: OTHER, winner: WALLET}), card(8, {creator: OTHER, minted: true, current_owner_address: OTHER}),
    card(8, {chain_id: 1}), card(8, {is_hidden: true}), card(8, {source: 'pending'})]) assert.equal(canSelectProfileArtwork(value, WALLET, config), false);
  assert.equal(canSelectProfileArtwork(card(8, {creator: OTHER}), WALLET, {...config, selectionPolicy: 'unknown'}), false);
});

test('bounded layouts permit one pin and ordered sections but reject unsafe or malformed display data', () => {
  const layout = {...defaultProfileLayout(), pinned: pointer(1), sections: [{id: 'works', label: 'Works', artworks: [pointer(1), pointer(2)]}]};
  assert.equal(validProfileLayout(layout), true); assert.equal(selectedProfileArtworkKeys(layout).size, 2);
  for (const bad of [{...layout, template: 'custom-html'}, {...layout, cover_url: 'javascript:alert(1)'},
    {...layout, sections: [{id: 'x', label: {}, artworks: []}]}, {...layout, pinned: {...pointer(1), artwork_id: 1}},
    {...layout, sections: [{id: 'x', label: 'Works', artworks: Array.from({length: 21}, (_, index) => pointer(index + 1))}]}]) assert.equal(validProfileLayout(bad), false);
  assert.deepEqual(moveProfileItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moveProfileItem(['a', 'b'], 0, -1), ['a', 'b']);
});

test('save sends the exact wallet and expected revision while preview and restore remain draft-only', async () => {
  const h = harness(); await h.controller.load(); h.controller.edit();
  h.controller.change(value => ({...value, template: 'featured'})); h.controller.preview(true);
  assert.equal(h.controller.getState().layout.template, 'default'); assert.equal(h.state.writes.length, 0);
  await h.controller.save();
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.writes[0].options.headers['X-ArtSoul-Wallet'], WALLET);
  assert.equal(h.state.writes[0].options.credentials, 'include');
  assert.deepEqual(h.state.writes[0].body, {expected_revision: 0, layout: {...defaultProfileLayout(), template: 'featured'}});
  assert.equal(h.controller.getState().editing, false); assert.equal(h.controller.getState().revision, 1);
  h.controller.edit(); h.controller.change(defaultProfileLayout()); h.controller.cancel();
  assert.equal(h.controller.getState().layout.template, 'featured'); assert.equal(h.state.writes.length, 1);
});

test('cancel during authentication prevents a later save from starting', async () => {
  const h = harness(), auth = deferred(); await h.controller.load(); h.controller.edit(); h.deps.authenticate = () => auth.promise;
  const pending = h.controller.save(); await tick(); h.controller.cancel(); auth.resolve(true); await pending;
  assert.equal(h.state.writes.length, 0); assert.equal(h.controller.getState().editing, false);
});

test('an A to B to A account transition retires an operation still waiting for sign-in', async () => {
  const h = harness(), auth = deferred(); await h.controller.load(); h.controller.edit(); h.deps.authenticate = () => auth.promise;
  const pending = h.controller.save(); await tick();
  h.state.wallet = OTHER; h.controller.authChanged(OTHER); h.state.wallet = WALLET; h.controller.authChanged(WALLET);
  auth.resolve(true); await pending; assert.equal(h.state.writes.length, 0); assert.equal(h.controller.getState().editing, false);
});

test('the expected missing-session event during sign-in does not cancel the initiating save', async () => {
  const h = harness(); await h.controller.load(); h.controller.edit();
  h.deps.authenticate = async () => {h.controller.authChanged(null); h.controller.authChanged(WALLET); return true;};
  await h.controller.save(); assert.equal(h.state.writes.length, 1);
});

test('retired cover upload is unavailable while an existing cover value survives layout edits', async () => {
  const h = harness();
  h.state.layout.cover_url = 'https://storage.example/profile-covers/historical.png';
  await h.controller.load(); h.controller.edit();
  assert.equal(typeof h.controller.upload, 'undefined');
  h.controller.change(value => ({...value, template: 'featured'})); await h.controller.save();
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.writes[0].body.layout.cover_url, 'https://storage.example/profile-covers/historical.png');
  assert.equal(h.controller.getState().layout.template, 'featured');
});

test('same-wallet sign-out retires a sent save without repainting private editor state', async () => {
  const h = harness(), write = deferred(); await h.controller.load(); h.controller.edit();
  h.deps.request = async (url, options) => {if (options.method === 'PUT') return write.promise; throw new Error('Unexpected read');};
  const pending = h.controller.save(); await tick(); h.controller.authChanged(null);
  write.resolve(response({wallet: WALLET, revision: 1, layout: {...defaultProfileLayout(), template: 'featured'}})); await pending;
  assert.equal(h.controller.getState().layout.template, 'default'); assert.equal(h.controller.getState().editing, false);
});

test('CAS conflict preserves the draft and revision until an explicit reload', async () => {
  const h = harness(); await h.controller.load(); h.controller.edit(); h.controller.change(value => ({...value, template: 'featured'}));
  h.deps.request = async () => response({code: 'LAYOUT_CONFLICT', message: 'Changed elsewhere'}, 409);
  await h.controller.save();
  assert.equal(h.controller.getState().draft.template, 'featured'); assert.equal(h.controller.getState().revision, 0);
  assert.equal(h.controller.getState().conflict, true); assert.equal(h.controller.getState().busy, '');
  h.deps.request = async () => response({wallet: WALLET, revision: 3, layout: defaultProfileLayout()}); await h.controller.load();
  assert.equal(h.controller.getState().draft, null); assert.equal(h.controller.getState().revision, 3);
});

test('an unavailable selection is editable after its 409 without forcing a destructive draft reload', async () => {
  const h = harness(); await h.controller.load(); h.controller.edit();
  h.controller.change(value => ({...value, pinned: pointer(1)}));
  h.deps.request = async () => response({error: 'PROFILE_ARTWORK_UNAVAILABLE', message: 'Remove the unavailable work.'}, 409);
  await h.controller.save();
  assert.equal(h.controller.getState().conflict, false); assert.equal(h.controller.getState().draft.pinned.artwork_id, '1');
  assert.equal(h.controller.getState().error, 'Remove the unavailable work.');
  h.controller.change(value => ({...value, pinned: null}));
  h.deps.request = async () => response({wallet: WALLET, revision: 1, layout: defaultProfileLayout()});
  await h.controller.save(); assert.equal(h.controller.getState().revision, 1);
});

test('save outside an active editor is a harmless no-op', async () => {
  const h = harness(); await h.controller.save(); await h.controller.load(); await h.controller.save();
  assert.equal(h.state.auth, 0); assert.equal(h.state.writes.length, 0);
});

test('simultaneous saves issue one write and malformed success cannot replace the confirmed layout', async () => {
  const h = harness(), auth = deferred(); await h.controller.load(); h.controller.edit(); h.deps.authenticate = () => auth.promise;
  const first = h.controller.save(), second = h.controller.save(); auth.resolve(true); await Promise.all([first, second]);
  assert.equal(h.state.writes.length, 1);
  h.controller.edit(); h.deps.request = async () => response({wallet: WALLET, revision: 2, layout: {version: 1}});
  await h.controller.save(); assert.equal(h.controller.getState().revision, 1); assert.equal(h.controller.getState().editing, true);
});

test('unavailable selected works remain stored while public hydration omits them', async () => {
  const h = harness(); h.state.layout = {...defaultProfileLayout(), pinned: pointer(1)};
  await h.controller.load(); assert.deepEqual(h.controller.getState().cards, []); assert.deepEqual(h.controller.getState().layout.pinned, pointer(1));
  h.controller.edit(); assert.deepEqual(h.controller.getState().draft.pinned, pointer(1));
});

test('a late card response or disposed profile cannot repaint a newer layout', async () => {
  const h = harness(), cards = deferred(); let reads = 0;
  h.deps.request = async url => {
    if (url.includes('view=artworks')) return cards.promise;
    reads++; return response({wallet: WALLET, revision: reads, layout: reads === 1 ? {...defaultProfileLayout(), pinned: pointer(1)} : defaultProfileLayout()});
  };
  const first = h.controller.load(); await tick(); await h.controller.load();
  cards.resolve(response({wallet: WALLET, revision: 1, cards: [card(1)]})); await first;
  assert.equal(h.controller.getState().revision, 2); assert.deepEqual(h.controller.getState().cards, []);
  const final = deferred(); h.deps.request = () => final.promise; const pending = h.controller.load(); await tick();
  h.controller.dispose(); const count = h.state.snapshots.length;
  final.resolve(response({wallet: WALLET, revision: 4, layout: defaultProfileLayout()})); await pending;
  assert.equal(h.state.snapshots.length, count);
});

test('card hydration from another revision fails closed without silently rewriting selected pointers', async () => {
  const h = harness(); h.deps.request = async url => response(url.includes('view=artworks') ? {wallet: WALLET, revision: 2, cards: [card(1)]} :
    {wallet: WALLET, revision: 1, layout: {...defaultProfileLayout(), pinned: pointer(1)}});
  await h.controller.load(); assert.deepEqual(h.controller.getState().cards, []); assert.equal(h.controller.getState().layout.pinned.artwork_id, '1');
  assert.match(h.controller.getState().error, /changed/);
});
