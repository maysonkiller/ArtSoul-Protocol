import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement } from './helpers/avatar-dropdown-harness.cjs';
import { installFirstVisitGuide } from '../src/ui/first-visit-guide.js';
import { visitPaths } from '../src/ui/first-visit-paths.js';

const source = file => fs.readFileSync(file, 'utf8');
const origin = 'https://artsoul.test';
const progressKey = 'artsoul_first_visit_guide_v1';
const arrivalKey = progressKey + '_arrival';
const cardLink = '.gallery-results-grid a.artsoul-card-link';
const builderLink = '.publication-type-nav a[href="/collection-builder"]';
const picker = '.upload-file-picker';
const urls = { window: {}, URLSearchParams };
vm.runInNewContext(source('src/ui/artwork-url.js'), urls);

function memory() {
    const items = new Map();
    return {
        getItem: key => items.get(key) ?? null,
        setItem: (key, value) => items.set(key, value),
        removeItem: key => items.delete(key)
    };
}

// Drive the shipped event handlers across separate documents. Slots come from
// the page sources. Tests mount and remove controls as the product entries do.
function visitor(localStorage = memory(), sessionStorage = memory()) {
    function page(path, navigation = 'navigate', initial = []) {
        const location = new URL(path, origin);
        const file = location.pathname.split('/')[1].replace(/\.html$/, '') || 'index';
        const html = source(file + '.html');
        const jsx = fs.existsSync('src/entries/' + file + '.jsx') ? source('src/entries/' + file + '.jsx') : '';
        const events = [], selectors = new Map();
        let refresh = () => {};
        class Element extends FakeElement {
            get parentElement() { return this.parentNode; }
            get isConnected() { return this === doc.body || Boolean(this.parentElement?.isConnected); }
            removeAttribute(key) { delete this.attributes[key]; }
            hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
            remove() { this.parentElement?.removeChild(this); }
            append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
            replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
            matches(selector) { return this.selector === selector || (selector === 'a[href]' && !!this.href); }
            closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
            contains(node) { return node === this || this.children.some(child => child.contains(node)); }
            getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; }
            focus(options) { events.push(['focus', this, options]); }
            scrollIntoView(options) { events.push(['scroll', this, options]); }
        }
        const doc = new Element('document');
        doc.body = new Element('body');
        doc.createElement = tag => new Element(tag);
        doc.querySelector = selector => selectors.get(selector)?.isConnected ? selectors.get(selector) : null;
        function add(selector, href) {
            const node = doc.createElement(href ? 'a' : 'button');
            node.selector = selector;
            if (href) node.href = new URL(href, origin).href;
            selectors.set(selector, node);
            doc.body.append(node);
            return node;
        }
        const pageId = html.match(/data-visit-page="([^"]+)"/)?.[1];
        if (pageId) add('[data-visit-page]').dataset.visitPage = pageId;
        for (const [, slot] of (html + jsx).matchAll(/data-visit-slot="([^"]+)"/g)) {
            add(`[data-visit-slot="${slot}"]`).hidden = true;
        }
        if (jsx.includes('data-open-visit-guide=')) add('[data-open-visit-guide]');
        for (const selector of initial) add(selector);
        const win = new Element('window');
        Object.assign(win, {
            history: { state: null, replaceState(state, title, url) {
                this.state = state;
                if (url) location.href = new URL(url, location.href).href;
            } },
            localStorage, sessionStorage, location, ArtSoulArtworkUrl: urls.window.ArtSoulArtworkUrl,
            performance: { getEntriesByType: () => [{ type: navigation }] },
            MutationObserver: class {
                constructor(fn) { this.fn = fn; }
                observe() { refresh = this.fn; }
                disconnect() { refresh = () => {}; }
            }
        });
        location.assign = url => events.push(['navigate', url]);
        const forbidden = () => assert.fail('Guide invoked a wallet, network or product action');
        win.ethereum = { request: forbidden };
        win.safeConnectWallet = win.ensureAuthenticated = win.fetch = forbidden;
        Element.prototype.click = forbidden;
        installFirstVisitGuide(win, doc);

        function all(node = doc.body) { return [node, ...node.children.flatMap(child => all(child))]; }
        const panel = () => all().find(node => node.tagName === 'aside');
        const labels = () => panel() ? all(panel()).filter(node => node.tagName === 'button').map(node => node.textContent) : [];
        function click(node, options = {}) {
            assert.ok(node, 'expected a mounted control');
            const event = { type: 'click', button: 0, target: node, ...options };
            node.dispatchEvent(event);
            doc.dispatchEvent(event);
        }
        function press(label) {
            const control = panel() && all(panel()).find(node => node.tagName === 'button' && node.textContent === label);
            assert.ok(control, `Missing ${label} in ${labels().join(', ')}`);
            click(control);
        }
        return { win, doc, events, add, panel, labels, click, press, refresh: () => refresh(),
            control: selector => doc.querySelector(selector),
            text: () => panel() ? all(panel()).map(node => node.textContent).join(' ') : '',
            openDocs: () => click(doc.querySelector('[data-open-visit-guide]')),
            nextPage: () => {
                const navigation = events.filter(event => event[0] === 'navigate').at(-1);
                assert.ok(navigation, 'expected deliberate navigation');
                return navigation[1];
            }
        };
    }
    function start(label, controls = []) {
        const home = page('/');
        home.press('Start');
        home.press(label);
        return page(home.nextPage(), 'navigate', controls);
    }
    return { page, start, localStorage, sessionStorage };
}

test('a first visit from an invitation or the home page offers the guide once without moving focus or scrolling', () => {
    for (const route of ['/gallery', '/profile', '/upload', '/collection-builder', '/artwork/1', '/docs-protocol']) {
        const first = visitor();
        const entry = first.page(route);
        assert.deepEqual(entry.labels(), ['Start', 'Skip'], route);
        assert.deepEqual(entry.events, []);
        entry.press('Skip');
        assert.equal(first.page('/').panel(), undefined);
    }
    const v = visitor();
    assert.equal(v.page('/admin').panel(), undefined);
    assert.equal(v.localStorage.getItem(progressKey), null);
    const home = v.page('/index.html');
    assert.deepEqual(home.labels(), ['Start', 'Skip']);
    assert.deepEqual(home.events, []);
    assert.equal(v.page('/', 'reload').panel(), undefined, 'an ignored offer counts as seen');
    home.press('Skip');
    assert.equal(v.page('/').panel(), undefined);
    const docs = v.page('/docs-protocol.html');
    docs.openDocs();
    for (const path of Object.values(visitPaths)) assert.ok(docs.labels().includes(path.label));
    docs.press('Browse artworks');
    assert.equal(docs.nextPage(), '/gallery#all');
});

test('a real gallery link continues on the chosen artwork and back returns to the gallery', () => {
    const v = visitor();
    const gallery = v.start('Browse artworks', ['.gallery-search-input']);
    assert.match(gallery.text(), /Find a work/);
    gallery.press('Next');
    assert.match(gallery.text(), /clear the filter/);
    assert.ok(!gallery.labels().includes('Open artwork'), 'no synthetic artwork during an empty or failed load');
    const link = gallery.add(cardLink, '/artwork/24');
    gallery.refresh();
    assert.ok(link.hasAttribute('data-visit-highlight'));
    const second = gallery.add(cardLink, '/artwork?id=v41%3A11155111%3A19');
    gallery.click(second, { ctrlKey: true });
    assert.equal(v.sessionStorage.getItem(arrivalKey), null);
    gallery.click(second);
    const detail = v.page(second.href, 'navigate', ['button[aria-label="About community reactions"]']);
    assert.match(detail.text(), /Read about reactions/);
    assert.equal(v.sessionStorage.getItem(arrivalKey), null);
    assert.deepEqual(detail.events.filter(event => event[0] === 'navigate'), []);
    detail.press('Back');
    assert.equal(detail.nextPage(), '/gallery#all');
    const back = v.page(detail.nextPage());
    back.add(cardLink, '/artwork/24');
    back.refresh();
    back.press('Open artwork');
    assert.equal(back.nextPage(), '/artwork/24');
    const last = v.page(back.nextPage());
    last.press('Finish guide');
    assert.equal(v.page('/').panel(), undefined);
    assert.equal(v.page('/artwork/24', 'reload').panel(), undefined);
});

test('profile guidance follows guest, owner and native editor controls without activating them', () => {
    const v = visitor();
    const profile = v.start('Create a profile');
    const connect = profile.add('[data-profile-connect]');
    profile.refresh();
    assert.match(profile.text(), /Connect Wallet/);
    assert.ok(connect.hasAttribute('data-visit-highlight'));
    profile.press('Show control');
    assert.equal(profile.events.at(-1)[1], connect);
    connect.remove();
    const edit = profile.add('.profile-inline-edit-action button');
    profile.refresh();
    assert.ok(edit.hasAttribute('data-visit-highlight'));
    const name = profile.add('#profileName');
    profile.refresh();
    assert.equal(profile.panel().parentElement.selector, '[data-visit-slot="profile-name"]');
    assert.ok(name.hasAttribute('data-visit-highlight'));
    assert.ok(!edit.hasAttribute('data-visit-highlight'));
    const save = profile.add('.profile-edit-dialog .profile-actions .btn-main');
    profile.press('Next');
    assert.equal(profile.panel().parentElement.selector, '[data-visit-slot="profile-save"]');
    assert.ok(save.hasAttribute('data-visit-highlight'));
    profile.press('Dismiss');
    assert.deepEqual(profile.labels(), ['Resume guide']);
    profile.press('Resume guide');
    profile.press('Back');
    assert.ok(name.hasAttribute('data-visit-highlight'));
    profile.press('Skip guide');
    assert.equal(v.page('/profile').panel(), undefined);
    assert.deepEqual(profile.events.filter(event => event[0] === 'navigate'), []);
});

test('single artwork steps preserve form help, never submit, and resume the saved step after reload', () => {
    const v = visitor();
    const controls = [picker, '#artTitle', '#originalWorkConfirm', '#prePublishAction', '#publishBtn'];
    const upload = v.start('Publish one artwork', controls);
    assert.ok(upload.control(picker).hasAttribute('data-visit-highlight'));
    upload.control('#artTitle').setAttribute('aria-describedby', 'artTitleError');
    upload.press('Next');
    assert.equal(upload.control('#artTitle').getAttribute('aria-describedby'), 'artTitleError visit-guide-hint');
    upload.press('Dismiss');
    assert.equal(upload.control('#artTitle').getAttribute('aria-describedby'), 'artTitleError');
    const docs = v.page('/docs-protocol#publishing');
    docs.openDocs();
    docs.press('Resume guide');
    assert.equal(docs.nextPage(), '/upload');
    const resumed = v.page(docs.nextPage(), 'navigate', controls);
    assert.ok(resumed.control('#artTitle').hasAttribute('data-visit-highlight'));
    const reload = v.page('/upload', 'reload', controls);
    assert.deepEqual(reload.events, []);
    assert.deepEqual(reload.labels(), ['Resume guide']);
    reload.press('Resume guide');
    for (const selector of controls.slice(2)) {
        reload.press('Next');
        assert.ok(reload.control(selector).hasAttribute('data-visit-highlight'), selector);
        reload.press('Show control');
        assert.equal(reload.events.at(-1)[1], reload.control(selector));
    }
    reload.press('Finish guide');
    assert.equal(v.page('/upload', 'reload').panel(), undefined);
    assert.equal(v.page('/').panel(), undefined);
});

test('collection visits Publication type, edits phases and reviews a browser draft', () => {
    const v = visitor();
    const upload = v.start('Design a collection');
    const link = upload.add(builderLink, '/collection-builder');
    upload.refresh();
    assert.ok(link.hasAttribute('data-visit-highlight'));
    upload.click(link);
    const controls = ['#collectionName', '[data-draft-step="Phases"]', '[data-draft-step="Review"]', '[data-save-collection-draft]'];
    const builder = v.page(link.href, 'navigate', controls);
    assert.ok(builder.control(controls[0]).hasAttribute('data-visit-highlight'));
    builder.press('Back');
    assert.equal(builder.nextPage(), '/upload');
    const type = v.page('/upload');
    type.press('Open builder');
    assert.equal(type.nextPage(), '/collection-builder');
    const next = v.page(type.nextPage(), 'navigate', controls);
    for (const selector of controls.slice(1)) {
        next.press('Next');
        assert.ok(next.control(selector).hasAttribute('data-visit-highlight'));
    }
    assert.match(next.text(), /stays unpublished/);
    assert.match(next.text(), /does not deploy a contract or mint an NFT/);
    next.press('Finish guide');
    assert.equal(v.page('/collection-builder', 'reload').panel(), undefined);
});

test('Escape restores an in-place resume control and browser history stays passive', () => {
    const v = visitor();
    const home = v.page('/');
    home.press('Start');
    const target = home.panel().children[0];
    let prevented = false;
    home.doc.dispatchEvent({ type: 'keydown', key: 'Escape', target, preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.ok(prevented);
    assert.deepEqual(home.labels(), ['Resume guide']);
    home.press('Resume guide');
    home.press('Design a collection');
    const upload = v.page(home.nextPage());
    upload.press('Open builder');
    const builder = v.page(upload.nextPage(), 'navigate', ['#collectionName']);
    builder.press('Next');
    const before = home.events.length;
    home.win.dispatchEvent({ type: 'pageshow', persisted: true });
    assert.deepEqual(home.labels(), ['Resume guide']);
    assert.equal(home.events.length, before);
    const elsewhere = v.page('/profile?address=someone', 'back_forward');
    assert.equal(elsewhere.panel(), undefined);
    assert.deepEqual(elsewhere.events, []);
    home.press('Resume guide');
    assert.equal(home.nextPage(), '/collection-builder');
    const reload = v.page('/collection-builder', 'reload');
    assert.deepEqual(reload.labels(), ['Resume guide'], 'a stale navigation ticket cannot start a reload');
    assert.deepEqual(reload.events, []);
});

test('blocked or malformed storage degrades to a manual guide without a repeating prompt', () => {
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
    const sessionOnly = visitor(blocked);
    sessionOnly.page('/').press('Skip');
    assert.equal(sessionOnly.page('/').panel(), undefined);
    const privateTab = visitor(blocked, blocked);
    assert.equal(privateTab.page('/').panel(), undefined);
    const docs = privateTab.page('/docs-protocol');
    docs.openDocs();
    docs.press('Create a profile');
    const profile = privateTab.page(docs.nextPage(), 'navigate', ['[data-profile-connect]']);
    assert.equal(profile.win.location.search, '');
    assert.deepEqual(profile.events, []);
    assert.deepEqual(profile.labels(), ['Resume guide']);
    profile.press('Resume guide');
    assert.ok(profile.control('[data-profile-connect]').hasAttribute('data-visit-highlight'));
    const v = visitor();
    for (const raw of ['{', 'null', '{"status":"started","goal":"__proto__","step":0}',
        '{"status":"started","goal":"profile","step":99}', '{"status":"started","goal":"browse","step":2,"work":"https://elsewhere.test/artwork/1"}']) {
        v.localStorage.setItem(progressKey, raw);
        v.sessionStorage.setItem(arrivalKey, raw);
        const home = v.page('/');
        assert.equal(home.panel(), undefined);
        assert.deepEqual(home.events, []);
    }
});

test('a fallback link preserves gallery filters and cannot restart a skipped guide', () => {
    const v = visitor();
    const path = '/gallery?view=grid&visitGuide=browse.0#all';
    const gallery = v.page(path, 'reload');
    assert.equal(gallery.win.location.href, origin + '/gallery?view=grid#all');
    assert.deepEqual(gallery.events, []);
    assert.deepEqual(gallery.labels(), ['Resume guide']);
    gallery.press('Resume guide');
    gallery.press('Skip guide');
    assert.equal(v.page(path).panel(), undefined);
});

test('an asynchronous target gets a highlight without interrupting a visitor who has already interacted', () => {
    const v = visitor();
    const gallery = v.start('Browse artworks');
    assert.deepEqual(gallery.events, []);
    gallery.doc.dispatchEvent({ type: 'pointerdown' });
    const filter = gallery.add('.gallery-search-input');
    gallery.refresh();
    assert.ok(filter.hasAttribute('data-visit-highlight'));
    assert.deepEqual(gallery.events, []);
});

test('skipping in another tab wins over a pending arrival and a cached page', () => {
    const v = visitor();
    const home = v.page('/');
    home.press('Start');
    const second = visitor(v.localStorage);
    const docs = second.page('/docs-protocol');
    docs.openDocs();
    home.press('Browse artworks');
    docs.press('Skip guide');
    const arrival = v.page(home.nextPage(), 'navigate', ['.gallery-search-input']);
    assert.equal(arrival.panel(), undefined);
    assert.deepEqual(arrival.events, []);
    home.win.dispatchEvent({ type: 'pageshow', persisted: true });
    assert.equal(home.panel(), undefined);
});

test('the single-artwork targets and collection link resolve in the shipped Publish form', () => {
    const html = source('upload.html');
    const form = new FakeElement();
    form.innerHTML = html.slice(html.indexOf('<main class="upload-page-main'), html.indexOf('</main>'));
    for (const step of visitPaths.artwork.steps) {
        for (const variant of [step, ...(step.alternatives || [])]) {
            assert.ok(form.querySelector(variant.selector), variant.selector);
        }
    }
    const nav = form.querySelector('.publication-type-nav');
    assert.ok(nav.children.some(child => child.tagName === 'a' && child.href === '/collection-builder'));
    assert.equal(form.querySelector('.upload-zone').querySelector('[data-visit-slot]'), null,
        'guide buttons must be outside the file picker click handler');
});

test('only public guide pages load the entry and all step slots belong to their route', () => {
    for (const file of fs.readdirSync('.').filter(name => name.endsWith('.html'))) {
        const html = source(file);
        const enabled = ['index', 'docs-protocol', 'upload', 'profile', 'artwork', 'collection-builder', 'gallery'].includes(file.replace('.html', ''));
        assert.equal(html.includes('/src/entries/first-visit-guide.js'), enabled, file);
        assert.equal(html.includes('data-visit-page='), enabled, file);
    }
    for (const path of Object.values(visitPaths)) {
        for (const step of path.steps) {
            const page = step.route.slice(1).split('#')[0];
            const jsx = 'src/entries/' + page + '.jsx';
            const markup = source(page + '.html') + (fs.existsSync(jsx) ? source(jsx) : '');
            for (const variant of [step, ...(step.alternatives || [])]) {
                if (variant.slot) assert.ok(markup.includes(`data-visit-slot="${variant.slot}"`), variant.slot);
            }
        }
    }
    const css = source('src/ui/first-visit-guide.css');
    assert.match(css, /flex-wrap: wrap/);
    assert.match(css, /min-height: 44px/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(css, /position:\s*(fixed|absolute)|#[a-f0-9]{3,8}\b/i);
});
