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
            this.isConnected = true;
            this.tabIndex = 0;
            this.textContent = '';
            this.style = { top: '', left: '', width: '', maxHeight: '' };
            this.scrollTop = 0;
            this.offsetTop = 0;
            this.offsetHeight = 44;
            this.clientHeight = 42;
            this.scrollHeight = 132;
            this.rect = { left: 20, right: 220, top: 100, bottom: 144, width: 200, height: 44 };
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
        append(...children) {
            for (const child of children) {
                child.offsetTop = this.children.length * 44;
                this.children.push(child);
            }
        }
        replaceChildren(...children) { this.children = [...children]; }
        insertAdjacentElement(position, element) { assert.equal(position, 'afterend'); this.adjacent = element; }
        addEventListener(type, listener) {
            const listeners = this.listeners.get(type) || [];
            listeners.push(listener);
            this.listeners.set(type, listeners);
        }
        removeEventListener(type, listener) {
            this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener));
        }
        dispatchEvent(event) {
            for (const listener of this.listeners.get(event.type) || []) listener(event);
            return !event.defaultPrevented;
        }
        focus() { if (!this.disabled) { activeElement = this; this.dispatchEvent(new Event('focus')); } }
        contains(element) { return this === element || this.children.some(child => child.contains(element)); }
        scrollIntoView() { assert.fail('option navigation must not scroll the surrounding page'); }
        getBoundingClientRect() { return this.rect; }
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
    const viewport = Object.assign(new Element('viewport'), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
    const window = Object.assign(new Element('window'), {
        HTMLSelectElement: Select, Element, setTimeout: fn => timers.push(fn),
        innerWidth: 390, innerHeight: 844, visualViewport: viewport,
        getComputedStyle: () => ({ position: window.popupPosition }), popupPosition: 'absolute'
    });
    const context = vm.createContext({ window, document, Event,
        CustomEvent: class extends Event { constructor(type, init) { super(type); this.detail = init.detail; } },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target, config) { this.target = target; this.config = config; }
        }
    });
    vm.runInContext(fs.readFileSync('src/ui/themed-selects.js', 'utf8'), context);
    return { select, label, window, viewport, document, enhance: () => window.ArtSoulThemedSelects.enhance(select),
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

function mobileSelect(options) {
    const h = boot(options);
    h.enhance();
    h.window.popupPosition = 'fixed';
    Object.assign(h.listbox(), { scrollHeight: 190, clientHeight: 190, offsetHeight: 192 });
    return h;
}

function popupBounds(h) {
    const style = h.listbox().style;
    const left = parseFloat(style.left), top = parseFloat(style.top);
    const width = parseFloat(style.width), height = parseFloat(style.maxHeight);
    assert.ok([left, top, width, height].every(Number.isFinite), 'popup geometry must be finite');
    assert.ok(width > 0 && height > 0);
    return { left, top, width, height, right: left + width, bottom: top + height };
}

function positionListenerCount(h) {
    return [h.window, h.viewport].reduce((total, target) => total
        + (target.listeners.get('scroll') || []).length
        + (target.listeners.get('resize') || []).length, 0);
}

test('a mobile popup opens beside its trigger instead of the screen bottom', () => {
    const h = mobileSelect();
    h.button().dispatchEvent(new Event('click'));
    const popup = popupBounds(h), trigger = h.button().rect;
    assert.equal(popup.left, trigger.left);
    assert.equal(popup.width, trigger.width);
    assert.ok(popup.top > trigger.bottom && popup.top - trigger.bottom < 12);
    assert.ok(popup.bottom < h.viewport.height - 100, 'short menu must not be pinned to the bottom');
    assert.equal(h.button().getAttribute('aria-expanded'), 'true');
    assert.equal(h.button().getAttribute('aria-activedescendant'), h.listbox().children[0].id);
});

test('a mobile popup flips above a low trigger and clamps its right edge', () => {
    const h = mobileSelect();
    h.button().rect = { left: 300, right: 500, top: 740, bottom: 784, width: 200, height: 44 };
    h.button().dispatchEvent(new Event('click'));
    const popup = popupBounds(h);
    assert.ok(popup.bottom < h.button().rect.top && h.button().rect.top - popup.bottom < 12);
    assert.ok(popup.left >= 0 && popup.right < h.viewport.width);
    assert.equal(popup.height, 192, 'short options remain fully visible when there is room above');
});

test('a long mobile menu fits the available landscape space and visual viewport offsets', () => {
    const h = mobileSelect();
    Object.assign(h.viewport, { width: 320, height: 240, offsetLeft: 30, offsetTop: 50 });
    h.button().rect = { left: 20, right: 520, top: 148, bottom: 192, width: 500, height: 44 };
    h.listbox().scrollHeight = 1000;
    press(h.button(), 'Enter');
    const popup = popupBounds(h);
    assert.ok(popup.left >= 30 && popup.right <= 350);
    assert.ok(popup.top >= 50 && popup.bottom <= 290);
    assert.ok(popup.height < h.listbox().scrollHeight, 'long options remain internally scrollable');
    assert.ok(popup.top > h.button().rect.bottom && popup.top - h.button().rect.bottom < 12);
});

test('invalid or unavailable visual viewport measurements use finite window bounds', () => {
    for (const visualViewport of [undefined, { width: NaN, height: Infinity, offsetLeft: NaN, offsetTop: Infinity }]) {
        const h = mobileSelect();
        if (visualViewport) Object.assign(h.viewport, visualViewport);
        else h.window.visualViewport = undefined;
        press(h.button(), 'Enter');
        const popup = popupBounds(h);
        assert.ok(popup.left >= 0 && popup.right <= h.window.innerWidth);
        assert.ok(popup.top >= 0 && popup.bottom <= h.window.innerHeight);
        press(h.button(), 'Escape');
        assert.equal(positionListenerCount(h), 0);
    }
});

test('unusable geometry closes the menu without leaving active descendants or listeners', () => {
    const cases = [
        h => { h.viewport.height = 20; },
        h => { h.button().rect.top = NaN; },
        h => { h.button().rect.top = 900; h.button().rect.bottom = 944; },
        h => { h.viewport.width = NaN; h.window.innerWidth = NaN; },
        h => { h.select.adjacent.isConnected = false; }
    ];
    for (const change of cases) {
        const h = mobileSelect();
        change(h);
        press(h.button(), 'ArrowDown');
        assert.equal(h.button().getAttribute('aria-expanded'), 'false');
        assert.equal(h.button().getAttribute('aria-activedescendant'), null);
        assert.equal(h.listbox().hidden, true);
        assert.equal(positionListenerCount(h), 0);
    }
});

test('open popups follow scrolling and viewport changes while closed controls have no positioning listeners', () => {
    const h = mobileSelect();
    assert.equal(positionListenerCount(h), 0);
    for (let cycle = 0; cycle < 2; cycle += 1) {
        press(h.button(), 'Enter');
        assert.equal(positionListenerCount(h), 4);
        h.button().rect = { left: 30, right: 230, top: 200, bottom: 244, width: 200, height: 44 };
        h.window.dispatchEvent(new Event('scroll'));
        assert.ok(popupBounds(h).top > 244);
        Object.assign(h.viewport, { height: 400, offsetTop: 100 });
        h.viewport.dispatchEvent(new Event('resize'));
        const popup = popupBounds(h);
        assert.ok(popup.top >= 100 && popup.bottom <= 500);
        h.viewport.dispatchEvent(new Event('scroll'));
        press(h.button(), 'Tab');
        assert.equal(positionListenerCount(h), 0);
        assert.deepEqual(h.listbox().style, { top: '', left: '', width: '', maxHeight: '' });
    }
});

test('desktop CSS placement is restored when an open popup changes input layout', () => {
    const h = mobileSelect();
    press(h.button(), 'Enter');
    popupBounds(h);
    h.window.popupPosition = 'absolute';
    h.window.dispatchEvent(new Event('resize'));
    assert.deepEqual(h.listbox().style, { top: '', left: '', width: '', maxHeight: '' });
    assert.equal(h.button().getAttribute('aria-expanded'), 'true');
    h.window.popupPosition = 'fixed';
    h.window.dispatchEvent(new Event('resize'));
    popupBounds(h);
    press(h.button(), 'Escape');
    assert.equal(positionListenerCount(h), 0);
});

test('keyboard navigation scrolls only the option list and retains the focused combobox', () => {
    const h = mobileSelect({ options: Array.from({ length: 10 }, (_, index) => ({
        value: String(index), textContent: `Option ${index}`, disabled: index === 8
    })) });
    Object.assign(h.listbox(), { scrollHeight: 440, clientHeight: 88, offsetHeight: 90 });
    h.button().focus();
    press(h.button(), 'Enter');
    press(h.button(), 'End');
    assert.equal(h.listbox().scrollTop, 352);
    assert.equal(h.focused(), h.button());
    press(h.button(), 'ArrowUp');
    assert.equal(h.button().getAttribute('aria-activedescendant'), h.listbox().children[7].id);
    press(h.button(), 'Home');
    assert.equal(h.listbox().scrollTop, 0);
    press(h.button(), 'End');
    press(h.button(), 'Enter');
    assert.equal(h.select.value, '9');
    assert.equal(positionListenerCount(h), 0);
});

test('outside dismissal, another select, disabling and detaching release popup listeners', () => {
    const dismissals = [
        h => h.document.dispatchEvent(new Event('pointerdown')),
        h => h.document.dispatchEvent(Object.assign(new Event('artsoul-select-open'), { detail: {} })),
        h => { h.select.disabled = true; h.mutate(); },
        h => { h.select.adjacent.isConnected = false; h.window.dispatchEvent(new Event('scroll')); }
    ];
    for (const dismiss of dismissals) {
        const h = mobileSelect();
        press(h.button(), 'Enter');
        dismiss(h);
        assert.equal(h.listbox().hidden, true);
        assert.equal(positionListenerCount(h), 0);
        assert.equal(h.button().getAttribute('aria-activedescendant'), null);
    }
});
