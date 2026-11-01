const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pages = {
  'index.html': ['ArtSoul — Discover Artworks & Auctions', 'Explore original digital artworks, discover independent creators, and follow live auctions on ArtSoul.'],
  'gallery.html': ['ArtSoul Gallery — Explore Artworks', 'Browse original artworks, live auctions, and independent creators in the ArtSoul gallery.'],
  'artwork.html': ['ArtSoul — Artwork & Auction Details', 'Explore the creator, auction status, provenance, and collecting history behind an artwork on ArtSoul.'],
  'profile.html': ['ArtSoul — Artist & Collector Profiles', 'Explore an artist or collector profile, their artworks, auctions, and collected pieces on ArtSoul.'],
  'upload.html': ['ArtSoul — Publish Artwork', 'Publish original artwork for discovery and prepare an auction on ArtSoul.'],
  'docs-protocol.html': ['ArtSoul — How Art Auctions Work', 'Learn how artwork discovery, bidding, settlement and NFT minting work on ArtSoul.']
};
function tag(html, kind, name) {
    const match = [...html.matchAll(/<meta\b[^>]*>/g)].map(m => m[0]).find(x => x.includes(`${kind}="${name}"`));
    return match?.match(/content="([^"]*)"/)?.[1] || null;
}

test('the server-rendered OG and X metadata matches the current product on all six public pages', () => {
    for (const [page, [title, desc]] of Object.entries(pages)) {
        const html = fs.readFileSync(page, 'utf8');
        assert.equal(tag(html, 'property', 'og:title'), title, page);
        assert.equal(tag(html, 'property', 'og:description'), desc, page);
        assert.equal(tag(html, 'name', 'twitter:title'), title, page);
        assert.equal(tag(html, 'name', 'twitter:description'), desc, page);
        assert.doesNotMatch(html, /Discover digital art through auctions, collector conviction, and delayed minting/);
        assert.match(html, /property="og:image" content="https:\/\/artsoulprotocol\.com\/artsoul-social-preview-v2\.png"/);
        assert.match(html, /property="og:url" content="https:\/\/artsoulprotocol\.com\//);
    }
});

test('fragment-only gallery URL shares the gallery page, not a demo or obsolete title', () => {
    const gallery = fs.readFileSync('gallery.html', 'utf8');
    assert.match(gallery, /rel="canonical" href="https:\/\/artsoulprotocol\.com\/gallery"/);
    assert.equal(tag(gallery, 'property', 'og:url'), 'https://artsoulprotocol.com/gallery');
    assert.equal(tag(gallery, 'property', 'og:title'), pages['gallery.html'][0]);
});
