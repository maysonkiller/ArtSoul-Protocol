const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const headerPages = ['index', 'gallery', 'artwork', 'profile', 'upload', 'admin', 'collection-builder', 'docs-protocol'];

test('one native shared-header appearance control is present on every product surface', () => {
    for (const page of headerPages) {
        const html = fs.readFileSync(page + '.html', 'utf8');
        assert.equal((html.match(/data-artsoul-theme-toggle/g) || []).length, 1, page);
        assert.equal((html.match(/src="\/src\/ui\/header-theme-toggle\.js\?v=1"/g) || []).length, 1, page);
        assert.match(html, /data-artsoul-theme-toggle[\s\S]*?<div id="navButtons"/, page);
        assert.match(html, /aria-label="Future appearance"/, page);
    }
});

function harness(theme, hasManager = true) {
    const listeners = [], attrs = {}, calls = [];
    const button = {
        dataset: {},
        title: '',
        addEventListener(type, callback) { assert.equal(type, 'click'); this.click = callback; },
        setAttribute(name, value) { attrs[name] = value; }
    };
    const manager = {
        current: theme,
        getTheme() { return this.current; },
        toggleTheme() {
            calls.push('toggle');
            this.current = this.current === 'classic' ? 'future' : 'classic';
            listeners.forEach(callback => callback(this.current));
        },
        addListener(callback) { listeners.push(callback); }
    };
    const document = {
        readyState: 'complete',
        querySelectorAll(selector) { assert.equal(selector, '[data-artsoul-theme-toggle]'); return [button]; }
    };
    vm.runInNewContext(fs.readFileSync('src/ui/header-theme-toggle.js', 'utf8'), {
        document, window: { ThemeManager: hasManager ? manager : undefined }
    });
    return { button, manager, attrs, calls };
}

test('initial Classic and Future mode are described and restored without a second theme state', () => {
    for (const theme of ['classic', 'future']) {
        const { button, manager, attrs, calls } = harness(theme);
        assert.equal(attrs['aria-label'], 'Future appearance');
        assert.equal(attrs['aria-pressed'], String(theme === 'future'));
        assert.equal(button.dataset.currentTheme, theme);
        assert.equal(button.dataset.themeReady, 'true');
        button.click();
        assert.deepEqual(calls, ['toggle']);
        assert.equal(button.dataset.currentTheme, manager.current);
        assert.equal(attrs['aria-pressed'], String(manager.current === 'future'));
        button.click();
        assert.equal(manager.current, theme);
        assert.deepEqual(calls, ['toggle', 'toggle']);
    }
});

test('if the shared theme manager is absent the old account-menu fallback remains available', () => {
    const { button, attrs } = harness('classic', false);
    assert.equal(button.dataset.themeReady, undefined);
    assert.equal(button.click, undefined);
    assert.equal(attrs['aria-pressed'], undefined);
});
