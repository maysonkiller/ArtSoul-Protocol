const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadDiscoveryService() {
  const context = vm.createContext({
    window: {
      location: { search: '' },
      localStorage: { getItem: () => null },
      ArtSoulSecurity: { isValidStorageUrl: () => true }
    },
    URLSearchParams,
    console
  });
  vm.runInContext(
    fs.readFileSync('src/features/discovery/discovery-service.js', 'utf8'),
    context,
    { filename: 'src/features/discovery/discovery-service.js' }
  );
  return context.window.ArtSoulDiscovery;
}

test('one- to three-letter searches match title, creator, and collection substrings', () => {
  const discovery = loadDiscoveryService();
  const artworks = [
    { id: 'title', title: 'Rialo tesnetn' },
    { id: 'creator', title: 'Portrait', creator_name: 'Natalia' },
    { id: 'collection', title: 'Forest', collection_name: 'Nature Studies' },
    { id: 'none', title: 'Ocean' }
  ];

  assert.deepEqual(
    Array.from(discovery.searchArtworks(artworks, 'ri'), artwork => artwork.id),
    ['title']
  );
  assert.deepEqual(
    Array.from(discovery.searchArtworks(artworks, 'RIALO TESNETN'), artwork => artwork.id),
    ['title']
  );
  assert.deepEqual(
    Array.from(discovery.searchArtworks(artworks, 'NA'), artwork => artwork.id),
    ['creator', 'collection']
  );
  assert.deepEqual(
    Array.from(discovery.searchArtworks(artworks, 'tes'), artwork => artwork.id),
    ['title']
  );
});

test('gallery search is debounced, global, stable, and Discovery-ranked', () => {
  const source = fs.readFileSync('src/entries/gallery.jsx', 'utf8');
  const hiddenFilter = source.indexOf('artwork.moderation_hidden !== true');
  const searchFilter = source.indexOf("if (searchQuery.trim() !== '')");

  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*setDebouncedSearchQuery\(searchQuery\);[\s\S]*\}, 300\)/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*loadArtworks\(\);[\s\S]*\}, \[\]\)/);
  assert.match(source, /if \(!globalSearch && window\.ArtSoulDiscovery\?\.filterForGalleryTab\)/);
  assert.match(source, /globalSearch \? 'discovery' : sortBy/);
  assert.match(source, /results across all categories/);
  assert.match(source, /categoryLabelForArtwork/);
  assert.ok(hiddenFilter >= 0 && hiddenFilter < searchFilter, 'hidden works must be removed before search');
  assert.doesNotMatch(source, /setLoading\(true\);[\s\S]{0,250}setDebouncedSearchQuery/);
});

test('clearing search restores the selected tab without another API request', () => {
  const source = fs.readFileSync('src/entries/gallery.jsx', 'utf8');

  assert.match(source, /setDebouncedSearchQuery\(searchQuery\)/);
  assert.match(source, /searchQuery: debouncedSearchQuery/);
  assert.match(source, /!globalSearch[\s\S]*filterForGalleryTab\(result, activeTab\)/);
  assert.match(source, /getPublicProjectionArtworks\(\{[\s\S]*limit: 200[\s\S]*\}\)/);
  assert.doesNotMatch(source, /getPublicProjectionArtworks\(\{[\s\S]*view:/);
});
