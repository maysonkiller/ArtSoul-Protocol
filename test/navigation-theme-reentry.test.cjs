const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function boot(order) {
    const errors = [], elements = new Map(), storage = new Map();
    function element() {
        const classes = new Set();
        return { style: {}, classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: name => classes.has(name) } };
    }
    const nav = { insertBefore(button) { elements.set(button.id, button); } };
    const document = {
        readyState: 'complete', documentElement: element(), body: element(),
        getElementById: id => elements.get(id) || null,
        querySelector: () => nav, createElement: () => element()
    };
    const store = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
    const window = { location: { pathname: '/upload', href: '/upload' } };
    const context = vm.createContext({ window, document, localStorage: store, sessionStorage: store,
        console: { log() {}, debug() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) } });
    for (const file of order) vm.runInContext(fs.readFileSync(`src/ui/${file}-manager.js`, 'utf8'), context, { timeout: 1000 });
    return { window, document, elements, errors };
}

for (const order of [['theme', 'navigation'], ['navigation', 'theme']]) {
    test(`navigation initializes without recursive registration when ${order[0]} loads first`, () => {
        const { window, document, elements, errors } = boot(order);
        assert.deepEqual(errors, [], 'startup must not hide a stack overflow in a theme callback');
        const button = elements.get('backButton');
        assert.ok(button, 'the existing Back action remains available');
        for (let i = 0; i < 20; i++) window.ThemeManager.toggleTheme();
        assert.deepEqual(errors, [], 'repeated switches must not re-enter theme registration');
        assert.equal(document.body.classList.contains('classic'), true);
        assert.equal(elements.get('backButton'), button, 'theme changes preserve the actual button');
        button.onclick();
        assert.equal(window.location.href, '/', 'an empty history still returns home');
        window.NavigationManager.pushHistory('/gallery');
        window.NavigationManager.pushHistory('/upload');
        button.onclick();
        assert.equal(window.location.href, '/gallery', 'existing history navigation remains intact');
    });
}
