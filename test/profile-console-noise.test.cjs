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

test('genesis state treats an uninitialised contract layer as expected', () => {
  // The wallet provider is not always available when the profile mounts.
  // Reporting that as "Could not load Genesis state: Contracts not initialized"
  // put an error in every fresh profile load for a state that resolves itself.
  const genesisBlock = profileEntry.slice(
    profileEntry.indexOf('const provider = await window.web3Modal?.getWalletProvider?.()'),
    profileEntry.indexOf('Could not load Genesis state')
  );
  assert.match(genesisBlock, /window\.ArtSoulContracts\.isReady\?\.\(\) === false/);
  assert.match(genesisBlock, /return fallback;/);
});
