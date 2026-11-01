const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGES = ['index.html','gallery.html','artwork.html','profile.html',
    'upload.html','collection-builder.html','admin.html','docs-protocol.html'];
const DESTINATIONS = ['/','/gallery#discover','/upload','/docs-protocol','/profile'];

test('shared native header has five destinations, Profile last, on every product route', () => {
    for (const page of PAGES) {
        const html = fs.readFileSync(page, 'utf8');
        const nav = html.match(/<nav\b[^>]*site-primary-nav[^>]*>[\s\S]*?<\/nav>/)?.[0];
        assert.ok(nav, page);
        const links = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(links, DESTINATIONS, page);
        assert.match(nav, /href="\/profile"[^>]*aria-label="My profile"/);
        assert.match(nav, /href="\/docs-protocol"[^>]*aria-label="How it works"/);
        assert.match(nav, /site-nav-guide-long/);
        assert.match(nav, /site-nav-guide-short/);
        if (page === 'profile.html') assert.match(nav, /href="\/profile"[^>]*aria-current="page"/);
    }
});

test('all five primary destinations remain visible on mobile with nontruncated 44px targets', () => {
    const css = fs.readFileSync('unified-styles.css', 'utf8');
    assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
    assert.match(css, /site-header \.site-nav-guide-long \{ display: none; \}/);
    assert.match(css, /site-header \.site-nav-guide-short \{ display: inline; \}/);
    assert.match(css, /site-header \.site-primary-nav a \{[\s\S]*?min-height: 44px;/);
});
