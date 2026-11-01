const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entries = {
    index: 'index.js',
    gallery: 'gallery.jsx',
    artwork: 'artwork.jsx',
    profile: 'profile.jsx',
    upload: 'upload.js',
    'collection-builder': 'collection-builder.jsx',
    admin: 'admin.jsx',
    'docs-protocol': 'docs-protocol.jsx'
};

for (const [page, entry] of Object.entries(entries)) {
    test(`${page} loads its product runtime without disabled diagnostic scripts or startup hooks`, () => {
        const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
        const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(match => match[0]).join('\n');
        assert.doesNotMatch(scripts, /(?:theme-validator|system-logger|log-viewer-ui|admin-control-panel|status-banner-system)\.js/);
        assert.doesNotMatch(scripts, /\b(?:ThemeValidator|SystemLogger|LogViewerUI|AdminControlPanel|StatusBannerSystem)\b/);
        for (const src of ['/header-prepaint.js', '/src/ui/theme-manager.js', '/avatar-dropdown.js', '/wallet-runtime-loader.js', `/src/entries/${entry}`]) {
            assert.ok(scripts.includes(`src="${src}"`) || scripts.includes(`src="${src}?`), `${page} must retain ${src}`);
        }
        assert.match(html, /window\.ArtSoulHeaderPrepaint\?\.hydrate\(document\.getElementById\('navButtons'\)\)/);
    });
}

test('product services do not load legacy AI demos; live guidance keeps its authenticated client', () => {
    const services = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    assert.doesNotMatch(services, /import\s+['"].*(?:ai\/index|ai-evaluation-panel)\.js['"]/);
    for (const page of ['artwork', 'upload']) {
        const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
        assert.match(html, /src="\/src\/features\/artwork\/ai-valuation-client\.js\?v=4"/);
    }
    const client = fs.readFileSync(path.join(root, 'src/features/artwork/ai-valuation-client.js'), 'utf8');
    assert.match(client, /\/api\/ai\/analyze/);
});
