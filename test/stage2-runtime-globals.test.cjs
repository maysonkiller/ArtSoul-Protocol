const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');

test('React pages and shared card components use one exposed React runtime', () => {
  const runtime = read('src/entries/react-runtime.js');
  assert.match(runtime, /window\.React = React/);
  assert.match(runtime, /window\.ReactDOM = Object\.assign/);

  for (const entry of ['gallery.jsx', 'artwork.jsx', 'profile.jsx', 'docs.jsx']) {
    const source = read(`src/entries/${entry}`);
    assert.match(source, /from '\.\/react-runtime\.js'/, `${entry} must use the shared runtime`);
    assert.doesNotMatch(source, /from 'react'/, `${entry} must not import another React binding`);
  }

  assert.match(read('src/entries/index.js'), /import '\.\/react-runtime\.js'/);
  assert.match(read('src/entries/loading-skeletons.jsx'), /from '\.\/react-runtime\.js'/);
  assert.match(read('src/ui/components/artwork-card.js'), /const React = window\.React/);
});

test('ArtSoulDB exposes the complete auction API used by profile', () => {
  const client = read('supabase-client.js');
  const profile = read('src/entries/profile.jsx');

  assert.match(client, /async function getAuctions\(options = \{\}\)/);
  assert.match(client, /state: projectionAuctionState\(artwork\.status\)/);
  assert.match(client, /highestBidder: artwork\.auction_winner_address \|\| artwork\.current_bidder/);
  assert.match(client, /createAuction,[\s\S]*getAuctions,[\s\S]*getActiveAuctions/);
  assert.match(profile, /window\.ArtSoulDB\.getAuctions\(\)/);
  assert.match(profile, /auction\.artwork \|\| await window\.ArtSoulDB\.getArtwork/);
});

test('homepage projection work starts immediately and server reads are parallel', () => {
  const homepage = read('src/entries/index.js');
  const publicArtworks = read('src/api/routes/public/artworks.js');

  assert.doesNotMatch(homepage, /attempt < 40/);
  assert.match(homepage, /const db = window\.ArtSoulDB/);
  assert.match(homepage, /loadHomeArtworks\(\)/);
  assert.match(publicArtworks, /await Promise\.all\(\[/);
  assert.doesNotMatch(publicArtworks, /v41_artworks: await queryTable/);
});

test('service initialization waits for global runtime dependencies', () => {
  const services = read('src/index.js');
  assert.match(services, /async function initializeServicesWhenReady/);
  assert.match(services, /window\.ArtSoulContracts && window\.ArtSoulDB/);
  assert.match(services, /void initializeServicesWhenReady\(\)/);
});

test('queue WAL runtime files stay out of source control', () => {
  assert.match(read('.gitignore'), /^\.queue-wal\/$/m);
});
