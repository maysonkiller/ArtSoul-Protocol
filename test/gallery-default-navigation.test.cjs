const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/entries/gallery.jsx', 'utf8');
const navigation = source.slice(source.indexOf('const GALLERY_TABS ='), source.indexOf('function GalleryPage()'));

test('Discovery is the first and default category; explicit bookmarks remain intact', () => {
    const scope = {window: {location: {hash: ''}}};
    vm.runInNewContext(navigation + '\nthis.initial = getInitialGalleryTab; this.ids = GALLERY_TABS.map(tab => tab.id);', scope);
    assert.deepEqual(Array.from(scope.ids), ['discover', 'live_auctions', 'nft', 'marketplace', 'collections']);
    for (const [hash, expected] of [['', 'discover'], ['#unknown', 'discover'], ['#discover', 'discover'],
        ['#auctions', 'live_auctions'], ['#live_auctions', 'live_auctions'], ['#nft', 'nft'],
        ['#marketplace', 'marketplace'], ['#collections', 'collections']]) {
        scope.window.location.hash = hash;
        assert.equal(scope.initial(), expected, hash);
    }
});
