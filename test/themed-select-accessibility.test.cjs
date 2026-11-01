const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function boot(options = {}) {
    const observers = [], timers = [];
    let activeElement = null;
    class Element {
        constructor(tagName = 'div') {
            this.tagName = tagName;
            this.attributes = new Map();
            this.children = [];
            this.dataset = {};
            this.listeners = new Map();
            this.id = '';
            this.disabled = false;
            this.tabIndex = 0;
            this.textContent = '';
            const classes = new Set();
            this.classList = {
                add: value => classes.add(value), remove: value => classes.delete(value),
                contains: value => classes.has(value),
                toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); }
            };
        }
        setAttribute(name, value) { this.attributes.set(name, String(value)); }
        getAttribute(name) { return this.attributes.get(name) ?? null; }
        removeAttribute(name) { this.attributes.delete(name); }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = [...children]; }
        insertAdjacentElement(position, element) { assert.equal(position, 'afterend'); this.adjacent = element; }
        addEventListener(type, listener) {
            const listeners = this.listeners.get(type) || [];
            listeners.push(listener);
            this.listeners.set(type, listeners);
        }
        dispatchEvent(event) {
            for (const listener of this.listeners.get(event.type) || []) listener(event);
            return !event.defaultPrevented;
        }
        focus() { if (!this.disabled) { activeElement = this; this.dispatchEvent(new Event('focus')); } }
        contains(element) { return this === element || this.children.some(child => child.contains(element)); }
        scrollIntoView() {}
        querySelectorAll() { return []; }
    }
    class Select extends Element {
        constructor() {
            super('select');
            this.name = 'sort';
            this.options = [
                { value: 'new', textContent: 'Newest', disabled: false },
                { value: 'blocked', textContent: 'Unavailable', disabled: true },
                { value: 'old', textContent: 'Oldest', disabled: false }
            ];
            this.selectedIndex = 0;
            this.labels = [];
            this.multiple = false;
            this.required = false;
            this.size = 0;
            this.form = new Element('form');
        }
        get value() { return this.options[this.selectedIndex]?.value || ''; }
        set value(value) { this.selectedIndex = this.options.findIndex(option => option.value === value); }
    }
    const select = Object.assign(new Select(), options);
    const label = new Element('label');
    label.textContent = 'Artwork order';
    if (options.labelled) select.labels = [label];
    const document = new Element('document');
    Object.defineProperty(document, 'activeElement', { get: () => activeElement });
    document.readyState = 'loading';
    document.createElement = tagName => new Element(tagName);
    const window = { HTMLSelectElement: Select, Element, setTimeout: fn => timers.push(fn) };
    const context = vm.createContext({ window, document, Event,
        CustomEvent: class extends Event { constructor(type, init) { super(type); this.detail = init.detail; } },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target, config) { this.target = target; this.config = config; }
        }
    });
    vm.runInContext(fs.readFileSync('src/ui/themed-selects.js', 'utf8'), context);
    return { select, label, enhance: () => window.ArtSoulThemedSelects.enhance(select),
        button: () => select.adjacent?.children[0], listbox: () => select.adjacent?.children[1],
        mutate: () => observers.filter(observer => observer.target === select).forEach(observer => observer.callback()),
        flush: () => timers.splice(0).forEach(fn => fn()), focused: () => activeElement };
}

function press(element, key) {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: key });
    element.dispatchEvent(event);
}

test('enhancement leaves one keyboard/screen-reader control without disabling the form field', () => {
    const h = boot();
    h.select.setAttribute('aria-label', 'Sort artworks');
    h.enhance();
    assert.equal(h.select.getAttribute('aria-hidden'), 'true');
    assert.equal(h.select.tabIndex, -1);
    assert.equal(h.select.disabled, false);
    assert.equal(h.select.name, 'sort');
    assert.equal(h.select.value, 'new');
    assert.equal(h.button().getAttribute('role'), 'combobox');
    assert.equal(h.button().getAttribute('aria-label'), 'Sort artworks');
    assert.equal(h.button().getAttribute('aria-hidden'), null);
    assert.equal(h.button().tabIndex, 0);
    const root = h.select.adjacent;
    h.enhance();
    assert.equal(h.select.adjacent, root, 'repeated scans must not create another control');
});

test('associated native labels keep their accessible name and focus the visible control', () => {
    const h = boot({ labelled: true });
    h.enhance();
    assert.ok(h.label.id);
    assert.equal(h.button().getAttribute('aria-labelledby'), h.label.id);
    h.select.focus();
    assert.equal(h.focused(), h.button());
    const activation = new Event('click', { cancelable: true });
    h.select.dispatchEvent(activation);
    assert.equal(activation.defaultPrevented, true, 'label activation must not open the hidden native picker');
    assert.equal(h.focused(), h.button());
});

test('enhancing an already focused native field moves focus before hiding it', () => {
    const h = boot();
    h.select.focus();
    h.enhance();
    assert.equal(h.focused(), h.button());
    assert.equal(h.select.getAttribute('aria-hidden'), 'true');
});

test('explicit labels, descriptions, validation and disabled state stay synchronized', () => {
    const h = boot({ labelled: true });
    h.select.setAttribute('aria-labelledby', 'external-label');
    h.select.setAttribute('aria-describedby', 'help');
    h.enhance();
    assert.equal(h.button().getAttribute('aria-labelledby'), 'external-label');
    assert.equal(h.button().getAttribute('aria-describedby'), 'help');
    h.select.removeAttribute('aria-labelledby');
    h.select.setAttribute('aria-label', 'Renamed sort');
    h.select.setAttribute('aria-invalid', 'true');
    h.select.required = true;
    h.select.disabled = true;
    h.mutate();
    assert.equal(h.button().getAttribute('aria-labelledby'), null);
    assert.equal(h.button().getAttribute('aria-label'), 'Renamed sort');
    assert.equal(h.button().getAttribute('aria-invalid'), 'true');
    assert.equal(h.button().getAttribute('aria-required'), 'true');
    assert.equal(h.button().disabled, true);
});

test('custom keyboard selection still updates the native value and emits bubbling input/change', () => {
    const h = boot(), events = [];
    h.select.addEventListener('input', event => events.push([event.type, event.bubbles, h.select.value]));
    h.select.addEventListener('change', event => events.push([event.type, event.bubbles, h.select.value]));
    h.enhance();
    press(h.button(), 'ArrowDown');
    press(h.button(), 'Enter');
    assert.equal(h.select.value, 'old', 'disabled option remains skipped');
    assert.deepEqual(events, [['input', true, 'old'], ['change', true, 'old']]);
    assert.equal(h.button().getAttribute('aria-expanded'), 'false');
    assert.equal(h.button().children[0].textContent, 'Oldest');
});

test('pointer selection, external native changes and form reset retain their value behavior', () => {
    const h = boot();
    h.enhance();
    h.listbox().children[2].dispatchEvent(new Event('click'));
    assert.equal(h.select.value, 'old');
    assert.equal(h.focused(), h.button());
    h.select.value = 'new';
    h.select.dispatchEvent(new Event('change'));
    assert.equal(h.button().children[0].textContent, 'Newest');
    h.select.value = 'old';
    h.select.form.dispatchEvent(new Event('reset'));
    h.select.value = 'new';
    h.flush();
    assert.equal(h.button().children[0].textContent, 'Newest');
});

for (const tabIndex of [-1, 3]) test(`the custom control preserves the native tab order ${tabIndex}`, () => {
    const h = boot({ tabIndex });
    h.enhance();
    assert.equal(h.button().tabIndex, tabIndex);
    assert.equal(h.select.tabIndex, -1);
});

for (const options of [{ multiple: true }, { size: 4 }]) {
    test(`unsupported ${options.multiple ? 'multiple' : 'listbox'} selection stays native and accessible`, () => {
        const h = boot(options);
        h.enhance();
        assert.equal(h.select.adjacent, undefined);
        assert.equal(h.select.getAttribute('aria-hidden'), null);
        assert.equal(h.select.tabIndex, 0);
        assert.equal(h.select.classList.contains('artsoul-themed-select__native'), false);
        h.select.focus();
        assert.equal(h.focused(), h.select);
    });
}

test('a field that has not been enhanced retains native focus and accessibility', () => {
    const h = boot();
    assert.equal(h.select.getAttribute('aria-hidden'), null);
    assert.equal(h.select.tabIndex, 0);
    h.select.focus();
    assert.equal(h.focused(), h.select);
});
