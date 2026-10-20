const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const pages = ['index', 'gallery', 'artwork', 'profile', 'upload', 'collection-builder', 'admin', 'docs-protocol'];
function element(...initial) {
    const classes = new Set(initial);
    return { classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name)
    } };
}

for (const page of pages) {
    test(`${page} paints its saved theme before any visible body content or deferred runtime`, () => {
        const html = fs.readFileSync(`${page}.html`, 'utf8');
        const headScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
        const bodyStart = html.indexOf('>', html.indexOf('<body')) + 1;
        const firstBodyScript = html.slice(bodyStart).match(/^\s*<script>([\s\S]*?)<\/script>/)?.[1];
        assert.ok(firstBodyScript, 'the body must inherit the selected theme before its header is parsed');
        for (const saved of ['classic', 'future', 'invalid', null, 'storage-denied']) {
            const document = {
                documentElement: element('wallet-state-resolving'),
                body: element('protocol-admin-page')
            };
            const context = vm.createContext({ document, localStorage: {
                getItem: key => {
                    if (saved === 'storage-denied') throw new Error('Storage unavailable');
                    return key === 'artsoul_theme' ? saved : null;
                }
            } });
            vm.runInContext(headScript, context);
            vm.runInContext(firstBodyScript, context);
            const expected = saved === 'future' ? 'future' : 'classic';
            assert.equal(document.body.classList.contains(expected), true);
            assert.equal(document.documentElement.classList.contains(expected), true);
            assert.equal(document.body.classList.contains('protocol-admin-page'), true);
            assert.equal(document.documentElement.classList.contains('wallet-state-resolving'), true);
        }
    });
}

test('a page entry reads the prepaint theme while DOMContentLoaded is still waiting', () => {
    const listeners = {};
    const document = {
        readyState: 'loading', documentElement: element('future'),
        body: element('future', 'protocol-admin-page'),
        addEventListener: (name, listener) => { listeners[name] = listener; },
        getElementById: () => null
    };
    const window = {};
    vm.runInNewContext(fs.readFileSync('src/ui/theme-manager.js', 'utf8'), {
        document, window, console: { log() {}, error() {} },
        localStorage: { getItem: () => 'future', setItem() {} }
    });
    assert.equal(window.ThemeManager.getTheme(), 'future', 'initial React render must not use Classic');
    assert.equal(window.ThemeSync.getTheme(), 'future');
    listeners.DOMContentLoaded();
    assert.equal(window.ThemeManager.getTheme(), 'future');
    assert.equal(document.body.classList.contains('protocol-admin-page'), true);
    window.ThemeManager.setTheme('classic');
    assert.equal(window.ThemeManager.getTheme(), 'classic', 'explicit theme changes still take effect');
});

test('theme-dependent React entries initialize from the prepaint theme', () => {
    for (const page of ['gallery', 'artwork', 'profile']) {
        const entry = fs.readFileSync(`src/entries/${page}.jsx`, 'utf8');
        assert.match(entry, /const \[theme, setTheme\] = useState\(\(\) => window\.ThemeSync\?\.getTheme\(\) \|\| 'classic'\)/, page);
    }
});

test('page fonts do not replace already painted fallback text after a slow download', () => {
    for (const page of [...pages, 'visual-lab']) {
        const html = fs.readFileSync(`${page}.html`, 'utf8');
        const fonts = [...html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/g)];
        assert.equal(fonts.length, 1, page);
        const request = new URL(fonts[0][1]);
        assert.equal(request.searchParams.get('family'), 'Inter:wght@300;400;500;600;700', page);
        assert.equal(request.searchParams.get('display'), 'optional', page);
    }
});
