const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const supabaseClient = fs.readFileSync('supabase-client.js', 'utf8');
const contracts = fs.readFileSync('contracts-integration.js', 'utf8');
const profileEntry = fs.readFileSync('src/entries/profile.jsx', 'utf8');

test('a wallet with no profile row does not provoke an HTTP 406', () => {
  // A first visit legitimately has no profiles row. The public profile route
  // returns profile:null, rather than asking PostgREST for singular JSON and
  // provoking a 406 response for that normal state.
  const readBlock = supabaseClient.slice(
    supabaseClient.indexOf("const request = (async () => {"),
    supabaseClient.indexOf('profileReadCache.set(normalizedAddress')
  );
  assert.match(readBlock, /backendRead\(\s*`\/api\/public\/profile\?address=/);
  assert.doesNotMatch(readBlock, /\.single\(\);/);
  // With zero rows no longer an error, the PGRST116 special case is dead code
  // and must not be reintroduced as a way to swallow real failures.
  assert.doesNotMatch(readBlock, /PGRST116/);
});

test('lookups that address a single row by id still use single()', () => {
  // Only the profile read expects zero rows. An artwork or auction fetched by
  // id returning nothing is genuinely exceptional and must keep failing loudly.
  assert.match(supabaseClient, /\.eq\('id', artworkId\)\s*\n\s*\.single\(\);/);
  assert.match(supabaseClient, /\.eq\('id', auctionId\)\s*\n\s*\.single\(\);/);
});

test('contract readiness is observable without throwing', () => {
  // ensureCore throws by design for protected actions. Presentational callers
  // need to ask instead of catching an exception they then have to ignore.
  assert.match(contracts, /isReady\(\) \{\s*\n\s*return Boolean\(this\.coreContract\);\s*\n\s*\}/);
  assert.match(contracts, /ensureCore\(\) \{/);
});

test('Genesis status stays keyed to the profile, with no wallet provider or testnet prototype lookup', async () => {
  const { transformWithOxc } = await import('vite');
  const vm = require('node:vm');
  const source = fs.readFileSync('src/features/profile/genesis-status.jsx', 'utf8');
  const {code} = await transformWithOxc(source.replace(/^import .*;\r?$/gm, '').replace(/^export /gm, ''), 'genesis-status.jsx', { jsx: { runtime: 'classic' } });
  assert.match(profileEntry, /<GenesisStatus key=\{profile.wallet_address\} wallet=\{profile.wallet_address\} enabled=\{genesisProfileEnabled\}/);
  const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
  const requests = [];
  let enabled = false, state, effect;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const window = { get ethereum() { assert.fail('Unexpected wallet request'); }, get ArtSoulContracts() { assert.fail('Unexpected contract read'); } };
  const Component = vm.runInNewContext(code + '\nGenesisStatus;', {
    window, AbortController,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    React: { createElement: (_type, _props, ...children) => children.flat(), useEffect: fn => { effect = fn; }, useState: initial => { state = initial; return [state, next => { state = next; }]; } }
  });
  const mount = wallet => { const view = Component({wallet, enabled}); return {view, cleanup: effect()}; };
  const off = mount(A); await tick();
  assert.ok(off.view.includes('Testnet does not qualify.')); assert.equal(requests.length, 0);
  enabled = true;
  const first = mount(A); await tick(); first.cleanup();
  const second = mount(B); await tick();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(requests[1].url, '/api/public/profile?address=' + B + '&view=genesis');
  requests[1].resolve(Response.json({wallet: B, serial: 0})); await tick();
  assert.equal(state.label, 'Genesis #0');
  requests[0].resolve(Response.json({wallet: A, serial: 201})); await tick();
  assert.equal(state.label, 'Genesis #0'); second.cleanup();
  const last = mount(A); await tick();
  requests[2].resolve(Response.json({wallet: B, serial: 201})); await tick();
  assert.equal(state.label, 'Unconfirmed'); last.cleanup();
});
