const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const original = 'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/portrait.png';
let compiled;
test.before(async () => {
    const {transformWithOxc} = await import('vite');
    const source = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
    const start = source.indexOf('        function MediaViewer(');
    const end = source.indexOf('        function TransactionProcessingLabel(', start);
    assert.ok(start > 0 && end > start);
    compiled = (await transformWithOxc(source.slice(start, end), 'media-viewer.jsx', {jsx: {runtime: 'classic'}})).code;
});

function descendants(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(descendants)];
}

function harness(type = 'image', url = original) {
    const states = [], refs = [], effects = [], focused = [];
    let si, ri, ei, pending, tree, props = {media: {type, url}, title: 'Portrait'};
    const body = {style: {overflow: 'auto'}};
    const modal = {open: false, shown: 0, closed: 0,
        showModal() { this.open = true; this.shown++; },
        close() { this.open = false; this.closed++; }};
    const closeButton = {focus(options) {focused.push({target: 'close', ...options});}};
    const listeners = new Map();
    const menu = {open: false, contains: target => target === menu,
        querySelector: () => ({focus: options => focused.push({target: 'menu', ...options})})};
    const trigger = {isConnected: true, focus(options) {focused.push({target: 'trigger', ...options});}};
    const React = {
        createElement: (type, props, ...children) => ({type, props: {...props, children}}),
        useState(initial) {const i = si++; if (!(i in states)) states[i] = initial;
            return [states[i], value => {states[i] = typeof value === 'function' ? value(states[i]) : value;}];},
        useRef(initial) {return refs[ri++] ||= {current: initial};},
        useEffect(fn, deps) {const i = ei++, old = effects[i];
            if (!old || deps.some((value, j) => value !== old.deps[j])) pending.push(() => {
                old?.cleanup?.(); effects[i] = {deps, cleanup: fn()};
            });}
    };
    const window = {ReactDOM: {createPortal: node => node}};
    vm.runInNewContext(fs.readFileSync('storage-image.js', 'utf8'), {window, URL});
    window.ArtSoulSecurity = {isValidStorageUrl: window.ArtSoulStorageImage.isValidStorageUrl, sanitizeText: value => value};
    const component = vm.runInNewContext(compiled + '\nMediaViewer;', {
        React, window, URL, document: {body,
            addEventListener: (type, fn) => listeners.set(type, fn),
            removeEventListener: type => listeners.delete(type)},
        useDecodedImage: url => ({url, failed: false})
    });
    const render = (next = props) => {
        props = next; si = ri = ei = 0; pending = []; tree = component(props);
        for (const node of descendants(tree)) {
            if (node.props.ref) node.props.ref.current = node.type === 'dialog' ? modal : node.type === 'details' ? menu : closeButton;
        }
        pending.forEach(fn => fn());
        return tree;
    };
    const find = predicate => descendants(tree).find(predicate);
    const toolbar = () => find(node => node.props.className === 'artwork-detail-image-controls');
    const open = () => {descendants(toolbar()).find(node => node.type === 'button').props.onClick({currentTarget: trigger}); render();};
    render();
    return {render, find, toolbar, open, modal, body, focused, trigger, window, menu, listeners,
        unmount: () => effects.forEach(effect => effect.cleanup?.())};
}

for (const type of ['image', 'gif']) test(`${type} exposes full-size and original controls without transforming its source`, () => {
    const url = type === 'gif' ? original.replace('.png', '.gif') : original;
    const h = harness(type, url);
    const controls = descendants(h.toolbar());
    const button = controls.find(node => node.type === 'button');
    const link = controls.find(node => node.props['aria-label'] === 'Open original artwork in a new tab');
    assert.equal(button.props['aria-label'], 'View full size');
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-haspopup'], 'dialog');
    assert.equal(link.props.href, url);
    assert.equal(link.props.target, '_blank');
    assert.equal(link.props.rel, 'noopener noreferrer');
    assert.equal(link.props.download, undefined, 'cross-origin saving is left to the original-file browser tab');
    h.open();
    assert.equal(h.modal.open, true);
    assert.equal(h.find(node => node.type === 'dialog').props['aria-label'], 'Portrait full-size view');
    assert.equal(h.find(node => node.props.className === 'artwork-image-lightbox-media').props.src, url);
    assert.deepEqual(h.focused, [{target: 'close', preventScroll: true}]);
    assert.equal(h.body.style.overflow, 'hidden');
    h.unmount();
    assert.equal(h.modal.open, false);
    assert.equal(h.body.style.overflow, 'auto');
});

test('the image menu downloads public Storage originals without replacing the artwork URL', () => {
    const h = harness('image', original + '?cache=1');
    const download = h.find(node => node.type === 'a' && node.props.children[0] === 'Download image');
    const target = new URL(download.props.href);
    assert.equal(target.pathname, new URL(original).pathname);
    assert.equal(target.searchParams.get('download'), '');
    assert.equal(target.searchParams.get('cache'), '1');
    assert.equal(download.props.rel, 'noopener noreferrer');
    h.menu.open = true;
    download.props.onClick();
    assert.equal(h.menu.open, false);
    assert.deepEqual(h.focused.at(-1), {target: 'menu', preventScroll: true});
    h.menu.open = true;
    h.find(node => node.props['aria-label'] === 'Open original artwork in a new tab').props.onClick();
    assert.equal(h.menu.open, false);
    assert.deepEqual(h.focused.at(-1), {target: 'menu', preventScroll: true});
    assert.equal(h.find(node => node.props.role === 'button').props.src, original + '?cache=1');
    h.unmount();
});

test('image options close on outside press, Escape and enlargement and remove their listeners', () => {
    const h = harness();
    h.menu.open = true;
    h.listeners.get('pointerdown')({type: 'pointerdown', target: h.menu});
    assert.equal(h.menu.open, true);
    h.listeners.get('pointerdown')({type: 'pointerdown', target: {}});
    assert.equal(h.menu.open, false);
    h.menu.open = true;
    h.listeners.get('keydown')({type: 'keydown', key: 'Escape', preventDefault() {}});
    assert.equal(h.menu.open, false);
    assert.equal(h.focused.at(-1).target, 'menu');
    h.menu.open = true; h.open();
    assert.equal(h.menu.open, false);
    h.unmount();
    assert.equal(h.listeners.size, 0);
});

test('image keyboard activation, Escape, close and backdrop return focus to the initiating control', () => {
    const h = harness();
    const image = () => h.find(node => node.props.role === 'button');
    for (const key of ['Enter', ' ']) {
        let prevented = false;
        image().props.onKeyDown({key, currentTarget: h.trigger, preventDefault() {prevented = true;}});
        h.render();
        assert.equal(prevented, true);
        assert.equal(h.modal.open, true);
        const dialog = h.find(node => node.type === 'dialog');
        dialog.props.onClick({target: {}, currentTarget: h.modal}); h.render();
        assert.equal(h.modal.open, true, 'clicking the enlarged image keeps it open');
        dialog.props.onCancel({preventDefault() {}}); h.render();
        assert.equal(h.modal.open, false);
        assert.equal(h.body.style.overflow, 'auto');
        assert.deepEqual(h.focused.at(-1), {target: 'trigger', preventScroll: true});
    }
    h.open();
    h.find(node => node.props.className === 'artwork-image-lightbox-close').props.onClick(); h.render();
    assert.equal(h.modal.open, false);
    h.open();
    h.find(node => node.type === 'dialog').props.onClick({target: h.modal, currentTarget: h.modal}); h.render();
    assert.equal(h.modal.open, false);
    h.open();
    h.modal.open = false;
    h.find(node => node.type === 'dialog').props.onClose(); h.render();
    assert.deepEqual(h.focused.at(-1), {target: 'trigger', preventScroll: true});
    h.unmount();
});

test('original links fail closed for rejected hosts, non-HTTPS schemes and unavailable guards', () => {
    for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', 'https://other.example/art.png']) {
        const h = harness('image', url);
        assert.equal(h.toolbar(), undefined);
        assert.equal(h.find(node => node.type === 'a'), undefined);
        h.unmount();
    }
    for (const scheme of ['javascript', 'http', 'ftp']) {
        const h = harness('image', original.replace('https:', `${scheme}:`));
        assert.equal(h.find(node => node.type === 'a'), undefined, 'a host-only media check cannot authorize a navigable scheme');
        h.unmount();
    }
    const h = harness();
    delete h.window.ArtSoulSecurity; h.render();
    assert.equal(h.toolbar(), undefined);
    h.unmount();
});

test('removing the image after a load error closes the modal and restores the scroll state', () => {
    const h = harness();
    h.open();
    h.trigger.isConnected = false;
    h.find(node => node.props.role === 'button').props.onError(); h.render();
    assert.equal(h.modal.open, false);
    assert.equal(h.body.style.overflow, 'auto');
    assert.equal(h.toolbar(), undefined);
    assert.deepEqual(h.focused, [{target: 'close', preventScroll: true}], 'do not focus an unmounted artwork control');
    h.unmount();
});

test('image controls remain focusable during the global rapid-click guard window', () => {
    const listeners = new Map();
    const context = vm.createContext({
        window: {addEventListener() {}}, console: {log() {}}, setTimeout() {},
        document: {readyState: 'loading', addEventListener(name, fn) {listeners.set(name, fn);}}
    });
    const performanceSource = fs.readFileSync('src/core/utils/performance-utils.js', 'utf8')
        .replace(/export\s*\{[\s\S]*?\};/, '');
    vm.runInContext(performanceSource, context);
    vm.runInContext('enableLazyLoading = setupIntersectionObserver = optimizeAnimations = () => {}; initPerformanceOptimizations();', context);
    const captureClick = props => {
        const target = {disabled: false, style: {}, dataset: {allowRapid: props['data-allow-rapid']},
            classList: {contains() {return false;}}, closest() {return this;}};
        listeners.get('click')({target});
        return target.disabled;
    };
    assert.equal(captureClick({}), true, 'the ordinary button guard is active');
    const h = harness();
    const trigger = descendants(h.toolbar()).find(node => node.type === 'button');
    assert.equal(captureClick(trigger.props), false, 'closing immediately can restore trigger focus');
    assert.equal(captureClick(h.find(node => node.props.role === 'button').props), false);
    h.open();
    assert.equal(captureClick(h.find(node => node.props.className === 'artwork-image-lightbox-close').props), false);
    h.unmount();
});
