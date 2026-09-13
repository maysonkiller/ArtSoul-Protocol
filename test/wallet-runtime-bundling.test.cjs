const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('wallet runtime dependencies are pinned and bundled by Vite', () => {
    const packageJson = JSON.parse(read('package.json'));
    const appKit = read('appkit-init.js');
    const core = read('wallet-core-connect.js');
    const walletTest = read('wallet-test.js');
    const vite = read('vite.config.js');

    assert.equal(packageJson.dependencies['@reown/appkit'], '1.8.21');
    assert.equal(packageJson.dependencies['@reown/appkit-adapter-wagmi'], '1.8.21');
    assert.equal(packageJson.dependencies['@walletconnect/modal'], '2.7.0');
    assert.equal(packageJson.dependencies['@wagmi/core'], '3.6.4');
    assert.equal(packageJson.dependencies.wagmi, '3.6.4');
    assert.equal(packageJson.dependencies.viem, '2.55.19');

    assert.match(appKit, /from '@reown\/appkit'/);
    assert.match(appKit, /from '@reown\/appkit-adapter-wagmi'/);
    assert.match(walletTest, /from '@reown\/appkit'/);
    assert.match(core, /from '@walletconnect\/modal'/);

    assert.doesNotMatch(appKit, /https:\/\/esm\.sh\/@reown\//);
    assert.doesNotMatch(walletTest, /https:\/\/esm\.sh\/@reown\//);
    assert.doesNotMatch(core, /https:\/\/esm\.sh\/@walletconnect\/modal/);

    assert.match(vite, /appkit-init\\\.js\|wallet-runtime-loader\\\.js\|wallet-test\\\.js/);
    assert.doesNotMatch(vite, /^\s*'appkit-init\.js',\s*$/m);
    assert.doesNotMatch(vite, /^\s*'wallet-core-connect\.js',\s*$/m);
    assert.doesNotMatch(vite, /^\s*'wallet-test\.js',\s*$/m);

    // The external mobile provider stays demand-loaded on Connect; A-54 must
    // not make that heavy path part of every visitor's cold start.
    assert.match(core, /WC_ETHEREUM_PROVIDER_URL/);
    assert.match(core, /import\(WC_ETHEREUM_PROVIDER_URL\)/);
});

test('shared pages load AppKit through a deferred runtime boundary', () => {
    const pages = [
        'index.html',
        'gallery.html',
        'artwork.html',
        'profile.html',
        'upload.html',
        'admin.html',
        'docs-protocol.html'
    ];

    for (const page of pages) {
        const html = read(page);
        assert.match(html, /<script type="module" src="\/wallet-runtime-loader\.js"><\/script>/,
            `${page} must use the lightweight wallet runtime boundary`);
        assert.doesNotMatch(html, /<script type="module" src="\/appkit-init\.js/,
            `${page} must not make AppKit part of its static module graph`);
    }

    const loader = read('wallet-runtime-loader.js');
    assert.match(loader, /import\('\.\/appkit-init\.js\?v=54'\)/,
        'the boundary must keep AppKit as a Vite dynamic import');
    assert.match(loader, /DOMContentLoaded/,
        'wallet initialization must start only after the page entry can mount');
});
