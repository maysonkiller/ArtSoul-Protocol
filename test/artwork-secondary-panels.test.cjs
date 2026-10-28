const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const support = fs.readFileSync('src/features/artwork/artist-support.jsx', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; return {promise: new Promise(done => {resolve = done;}), resolve: value => resolve(value)}; };
function pageFunction(name) {
    const match = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(artwork);
    const tail = artwork.slice(match.index), end = new RegExp(`^${match[1]}}`, 'm').exec(tail);
    return tail.slice(0, end.index + end[0].length);
}
function hooks() {
    const values = [], refs = [], effects = [];
    let si, ri, ei, pending;
    return {
        useState(initial) { const i = si++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
            return [values[i], value => {values[i] = typeof value === 'function' ? value(values[i]) : value;}]; },
        useRef(initial) { return refs[ri++] ||= {current: initial}; },
        useEffect(fn, deps) { const i = ei++, old = effects[i];
            if (!old || deps.some((value, j) => value !== old.deps[j])) pending.push(() => {
                old?.cleanup?.(); effects[i] = {deps, cleanup: fn()};
            }); },
        render(fn) { si = ri = ei = 0; pending = []; const result = fn(); pending.forEach(fn => fn()); return result; },
        unmount() { effects.forEach(effect => effect.cleanup?.()); }
    };
}
function descendants(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(descendants)];
}

test('donation history stays inside Donate, reads only its open tab, and ignores a closed response', async () => {
    const {transformWithOxc} = await import('vite');
    const code = support.slice(support.indexOf('const { useEffect')).replace('export function', 'function');
    const compiled = await transformWithOxc(code, 'support.jsx', {jsx: {runtime: 'classic'}});
    const h = hooks(), calls = [], response = deferred();
    const React = {...h, createElement: (type, props, ...children) => ({type, props: {...props, children}})};
    const render = vm.runInNewContext(compiled.code + '\nArtistSupport;', {
        React, ExplainedAction: 'ExplainedAction', AbortController, fetch: (url, options) => {calls.push({url, options}); return response.promise;},
        donationIdentityKey: () => 'fixture', donationOperations: {read() {}, subscribe: () => () => {}},
        donationMessageState: () => ({valid: true}), console,
        document: {querySelector: () => null}, window: {requestAnimationFrame: fn => fn()}
    });
    const props = {deployment: {enabled: true, chainId: 84532, address: 'contract'}, artworkId: '28', creator: 'creator'};
    let tree = h.render(() => render(props));
    const viewport = {scrollTop: 0, showModal() { this.open = true; }, close() { this.open = false; }};
    descendants(tree).find(node => node.props?.className === 'artist-support-content').props.ref.current = viewport;
    assert.equal(calls.length, 0, 'collapsed history does not compete with artwork and avatar loads');
    const historyButton = () => descendants(tree).find(node => node.props?.id === 'artistSupportHistoryTab');
    const donateButton = () => descendants(tree).find(node => node.props?.id === 'artistSupportDonateTab');
    const openButton = () => tree.props.children.find(node => node?.type === 'button');
    assert.equal(tree.props.children.filter(node => node?.type === 'button').length, 1, 'Community has only one support action');
    assert.equal(historyButton().props['aria-selected'], false);
    openButton().props.onClick(); tree = h.render(() => render(props));
    assert.equal(calls.length, 0, 'opening Donate does not load history');
    viewport.scrollTop = 400;
    historyButton().props.onClick(); tree = h.render(() => render(props));
    assert.equal(viewport.scrollTop, 0, 'opening history starts at its controls');
    assert.equal(calls.length, 1);
    assert.equal(historyButton().props['aria-selected'], true);
    assert.equal(descendants(tree).find(node => node.props?.id === 'artistSupportDonate').props.hidden, true);
    viewport.scrollTop = 250;
    tree = h.render(() => render(props));
    assert.equal(viewport.scrollTop, 250, 'ordinary rerenders preserve the history reading position');
    donateButton().props.onClick(); tree = h.render(() => render(props));
    assert.equal(viewport.scrollTop, 0, 'returning to Donate starts at the creator and amount');
    assert.equal(calls[0].options.signal.aborted, true);
    response.resolve({ok: true, json: async () => ({creator: 'creator', contract_address: 'contract', top: {amount: '1'}, donations: []})});
    await tick(); tree = h.render(() => render(props));
    assert.equal(descendants(tree).some(node => node.props?.id === 'artistSupportHistory'), false);
    assert.equal(descendants(tree).some(node => node.props?.className === 'artist-support-top'), false);
    historyButton().props.onClick(); tree = h.render(() => render(props)); await tick(); tree = h.render(() => render(props));
    const history = descendants(tree).find(node => node.props?.id === 'artistSupportHistory');
    assert.equal(descendants(history).filter(node => node.props?.className === 'artist-support-top').length, 1);
    const dialog = descendants(tree).find(node => node.type === 'dialog');
    assert.ok(descendants(dialog).includes(history));
    const orderButton = label => descendants(tree).find(node => node.type === 'button' && node.props?.children?.includes(label));
    orderButton('Largest first').props.onClick();
    tree = h.render(() => render(props)); await tick(); tree = h.render(() => render(props));
    assert.equal(orderButton('Largest first').props['aria-pressed'], true);
    assert.equal(orderButton('Newest first').props['aria-pressed'], false);
    assert.match(calls.at(-1).url, /sort=amount&offset=0/);
    orderButton('Newest first').props.onClick();
    tree = h.render(() => render(props)); await tick(); tree = h.render(() => render(props));
    assert.equal(orderButton('Newest first').props['aria-pressed'], true);
    assert.match(calls.at(-1).url, /sort=newest&offset=0/);
    descendants(tree).find(node => node.props?.['aria-label'] === 'Close donation').props.onClick();
    tree = h.render(() => render(props));
    assert.equal(calls.at(-1).options.signal.aborted, true, 'closing Donate cancels its history read');
    openButton().props.onClick(); tree = h.render(() => render(props));
    assert.equal(donateButton().props['aria-selected'], true, 'reopening starts on the donation form');
    assert.equal(calls.length, 4, 'reopening the form does not refetch history');
    h.unmount();
});

test('Donate tabs support keyboard navigation and history preserves exact message-report targets', async () => {
    const {transformWithOxc} = await import('vite');
    const code = support.slice(support.indexOf('const { useEffect')).replace('export function', 'function');
    const compiled = await transformWithOxc(code, 'support.jsx', {jsx: {runtime: 'classic'}});
    const h = hooks(), reported = [], focused = [], reads = [];
    const donation = {transaction_hash: `0x${'55'.repeat(32)}`, log_index: 3, amount: '1', anonymous: true,
        message: 'Thank you', recorded_at: '2026-10-26T09:00:00Z'};
    let applyOperation;
    const React = {...h, createElement: (type, props, ...children) => ({type, props: {...props, children}})};
    const render = vm.runInNewContext(compiled.code + '\nArtistSupport;', {
        React, ExplainedAction: 'ExplainedAction', AbortController,
        fetch: async (url, options) => { reads.push({url, options}); return {ok: true, json: async () => ({
            creator: 'creator', contract_address: 'contract', donations: [donation], top: donation, next_offset: null
        })}; },
        donationIdentityKey: () => 'fixture', donationOperations: {read() {}, subscribe: (identity, apply) => {applyOperation = apply; return () => {}; }},
        donationMessageState: () => ({valid: true}), document: {querySelector: () => null},
        window: {requestAnimationFrame: fn => fn()}, console
    });
    const props = {deployment: {enabled: true, chainId: 84532, address: 'contract'}, artworkId: '28', creator: 'creator',
        onReportDonation: target => reported.push({...target})};
    let tree = h.render(() => render(props));
    tree.props.children.find(node => node?.type === 'button').props.onClick(); tree = h.render(() => render(props));
    const tabs = () => descendants(tree).find(node => node.props?.role === 'tablist');
    const press = key => tabs().props.onKeyDown({key, preventDefault() {},
        currentTarget: {querySelector: selector => ({focus: () => focused.push(selector)})}});
    press('End'); tree = h.render(() => render(props)); await tick(); tree = h.render(() => render(props));
    assert.deepEqual(focused, ['#artistSupportHistoryTab']);
    assert.equal(reads.length, 1, 'history never needs wallet signing or a contract call');
    const history = descendants(tree).find(node => node.props?.id === 'artistSupportHistory');
    descendants(history).find(node => node.type === 'button' && node.props.children.includes('Report message')).props.onClick();
    assert.deepEqual(reported, [{transaction_hash: donation.transaction_hash, log_index: 3}]);
    press('Home'); tree = h.render(() => render(props));
    assert.equal(reads[0].options.signal.aborted, true);
    assert.equal(descendants(tree).find(node => node.props?.id === 'artistSupportDonate').props.hidden, false);
    applyOperation({status: 'pending', hash: donation.transaction_hash}); tree = h.render(() => render(props));
    assert.ok(descendants(tabs()).filter(node => node.props?.role === 'tab').every(node => node.props.disabled));
    press('End'); tree = h.render(() => render(props));
    assert.equal(reads.length, 1, 'a pending transaction cannot be hidden by a keyboard tab change');
    h.unmount();
});

test('a same-wallet avatar remains visible during decoding, but artwork media never borrows the previous image', async () => {
    const h = hooks(), pending = new Map();
    const prepare = source => {const task = deferred(); pending.set(source, task); return task.promise;};
    const useImage = vm.runInNewContext(`(${pageFunction('useDecodedImage')})`, {...h, decodeImage: prepare});
    const render = (source, keep = true) => h.render(() => useImage(source, '/fallback', prepare, keep));
    assert.equal(render('/first').url, ''); pending.get('/first').resolve('/first-decoded'); await tick();
    assert.equal(render('/first').url, '/first-decoded');
    assert.equal(render('/updated').url, '/first-decoded');
    assert.equal(render('/updated', false).url, '', 'artwork images still clear on identity changes');
    pending.get('/updated').resolve('/updated-decoded'); await tick();
    assert.equal(render('/updated').url, '/updated-decoded');
    assert.equal(render('').url, '', 'unknown identity does not retain an avatar');
    assert.match(artwork, /<OwnershipIdentity\s+key=\{address\.toLowerCase\(\)\}/);
    h.unmount();
});

test('Ownership reveals the name and decoded avatar together, keeping the rest of the page independent', async () => {
    const {transformWithOxc} = await import('vite');
    const h = hooks(), prepared = deferred();
    const React = {...h, createElement: (type, props, ...children) => ({type, props: {...props, children}})};
    const compiled = await transformWithOxc(pageFunction('useDecodedImage') + '\n' + pageFunction('OwnershipIdentity'),
        'ownership.jsx', {jsx: {runtime: 'classic'}});
    const render = vm.runInNewContext(compiled.code + '\nOwnershipIdentity;', {
        React, ...h, decodeImage() {}, prepareAvatar: () => prepared.promise, readPreparedAvatar: () => ''
    });
    const props = {source: '/portrait.png', label: 'Creator', name: 'Artist', className: 'avatar-border', isClassic: true};
    let tree = h.render(() => render(props));
    const nodes = () => descendants(tree);
    assert.equal(nodes().filter(n => n.type === 'img').length, 0);
    assert.equal(nodes().some(n => n.type === 'span' && n.props.className === props.className), false);
    assert.equal(nodes().some(n => n.props?.children?.includes('Artist')), false);
    assert.equal(nodes().some(n => n.props?.role === 'status'), true);
    prepared.resolve('/decoded-portrait.png'); await tick();
    tree = h.render(() => render(props));
    assert.equal(nodes().find(n => n.type === 'img').props.src, '/decoded-portrait.png');
    assert.equal(nodes().some(n => n.props?.children?.includes('Artist')), true);
    assert.equal(nodes().some(n => n.props?.role === 'status'), false);
    h.unmount();
});

test('a prepared Ownership avatar and name are present in the first render without a loading flash', async () => {
    const {transformWithOxc} = await import('vite');
    const h = hooks();
    const React = {...h, createElement: (type, props, ...children) => ({type, props: {...props, children}})};
    const compiled = await transformWithOxc(pageFunction('useDecodedImage') + '\n' + pageFunction('OwnershipIdentity'),
        'ownership.jsx', {jsx: {runtime:'classic'}});
    const ready = source => source === '/ready.png' ? '/decoded.png' : '';
    const render = vm.runInNewContext(compiled.code + '\nOwnershipIdentity;', {
        React, ...h, decodeImage() {}, prepareAvatar: source => Promise.resolve(ready(source)), readPreparedAvatar: ready
    });
    const nodes = descendants(h.render(() => render({source:'/ready.png',label:'Creator',name:'Artist'})));
    assert.equal(nodes.find(node => node.type === 'img').props.src, '/decoded.png');
    assert.equal(nodes.some(node => node.props?.children?.includes('Artist')), true);
    assert.equal(nodes.some(node => node.props?.role === 'status'), false);
    const other = descendants(h.render(() => render({source:'/other.png',label:'Creator',name:'Other artist'})));
    assert.equal(other.find(node => node.type === 'img').props.src, '/decoded.png', 'same identity keeps its current picture while preparing an update');
    h.unmount();
});

test('an uncovered Highest Bidder without an avatar resolves after its profile read', async () => {
    const {transformWithOxc} = await import('vite');
    const compiled = await transformWithOxc(pageFunction('renderOwnershipRole'), 'role.jsx', {jsx: {runtime: 'classic'}});
    const address = '0x1111111111111111111111111111111111111111', bidderProfiles = {};
    const render = vm.runInNewContext(compiled.code + '\nrenderOwnershipRole;', {
        React: {createElement: (type, props, ...children) => ({type, props: {...props, children}})},
        OwnershipIdentity: 'OwnershipIdentity', artwork: {}, creatorProfile: null, bidderProfiles,
        resolvedProfileAddresses: new Set(), isClassic: true, isZeroAddress: () => false,
        isSameAddress: (left, right) => left === right,
        getProfileAvatarUrl: profile => profile?.avatar_url || '/default-avatar.png',
        getProfileDisplayName: profile => profile?.username || address
    });
    const identity = profile => descendants(render({label: 'Highest Bidder', address, profile})).find(node => node.type === 'OwnershipIdentity');
    assert.equal(identity(null).props.source, '', 'unresolved profiles retain loading feedback');
    for (const profile of [null, {wallet_address: address, username: 'Collector', avatar_url: null}]) {
        bidderProfiles[address] = profile;
        assert.equal(identity(profile).props.source, '/default-avatar.png');
        assert.equal(identity(profile).props.name, profile?.username || address);
    }
});

test('artwork contains no staff visibility lookup, mutation, state or controls', () => {
    assert.doesNotMatch(artwork, /loadModerationVisibility|handleModerationVisibility|moderationAccess|moderationDialogRef|moderationSequenceRef/);
    assert.doesNotMatch(artwork, /\/api\/moderation\/artwork-visibility|Staff moderation|Moderation tools|Hide Artwork|Unhide Artwork/);
    assert.match(artwork, /fetch\('\/api\/moderation\/reports'/, 'ordinary visitor reports remain available');
    assert.match(artwork, /onReportDonation=\{reportingEnabled \? openArtworkReport : undefined\}/);
});
