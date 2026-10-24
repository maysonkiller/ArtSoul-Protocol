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

test('donation history makes no background read or layout insertion until opened, and ignores a closed response', async () => {
    const {transformWithOxc} = await import('vite');
    const code = support.slice(support.indexOf('const { useEffect')).replace('export function', 'function');
    const compiled = await transformWithOxc(code, 'support.jsx', {jsx: {runtime: 'classic'}});
    const h = hooks(), calls = [], response = deferred();
    const React = {...h, createElement: (type, props, ...children) => ({type, props: {...props, children}})};
    const render = vm.runInNewContext(compiled.code + '\nArtistSupport;', {
        React, AbortController, fetch: (url, options) => {calls.push({url, options}); return response.promise;},
        donationIdentityKey: () => 'fixture', donationOperations: {read() {}, subscribe: () => () => {}},
        donationMessageState: () => ({valid: true}), console
    });
    const props = {deployment: {enabled: true, chainId: 84532, address: 'contract'}, artworkId: '28', creator: 'creator'};
    let tree = h.render(() => render(props));
    assert.equal(calls.length, 0, 'collapsed history does not compete with artwork and avatar loads');
    const historyButton = () => descendants(tree).find(node => node.props?.['aria-controls'] === 'artistSupportHistory');
    assert.equal(historyButton().props['aria-expanded'], false);
    historyButton().props.onClick(); tree = h.render(() => render(props));
    assert.equal(calls.length, 1);
    historyButton().props.onClick(); tree = h.render(() => render(props));
    assert.equal(calls[0].options.signal.aborted, true);
    response.resolve({ok: true, json: async () => ({creator: 'creator', contract_address: 'contract', top: {amount: '1'}, donations: []})});
    await tick(); tree = h.render(() => render(props));
    assert.equal(descendants(tree).some(node => node.props?.id === 'artistSupportHistory'), false);
    assert.equal(descendants(tree).some(node => node.props?.className === 'artist-support-top'), false);
    historyButton().props.onClick(); tree = h.render(() => render(props)); await tick(); tree = h.render(() => render(props));
    const history = descendants(tree).find(node => node.props?.id === 'artistSupportHistory');
    assert.equal(descendants(history).filter(node => node.props?.className === 'artist-support-top').length, 1);
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

test('late moderation reads cannot restore staff controls after wallet changes or invalidation', async () => {
    for (const boundary of ['wallet', 'auth']) {
        const response = deferred(), state = {wallet: 'staff', writes: []};
        const scope = {artwork: {chain_id: 84532, artwork_id: '28'}, moderationSequenceRef: {current: 0}, URLSearchParams,
            window: {getCurrentWalletAddress: () => state.wallet}, fetch: () => response.promise,
            setModerationAccess: value => state.writes.push(value), setModerationReason() {}, setModerationMessage() {}, console};
        const load = vm.runInNewContext(`(${pageFunction('loadModerationVisibility')})`, scope);
        const work = load();
        if (boundary === 'wallet') state.wallet = 'other'; else scope.moderationSequenceRef.current++;
        response.resolve({ok: true, json: async () => ({access: {canModerate: true}, data: {hidden_reason: 'private'}})});
        assert.equal(await work, false); assert.equal(state.writes.length, 0);
    }
});

test('moderation stays in a closed dialog until the staff button rechecks server access', () => {
    assert.match(artwork, /<dialog ref=\{moderationDialogRef\}[^>]+aria-label="Staff moderation"/);
    assert.doesNotMatch(artwork, /<dialog ref=\{moderationDialogRef\}[^>]+\sopen[\s=>]/);
    assert.match(artwork, /if \(await loadModerationVisibility\(artwork, \{ interactive: true \}\)\) \{\s*moderationDialogRef\.current\?\.showModal\(\)/);
    assert.match(artwork, /moderationSequenceRef\.current\+\+;\s*moderationDialogRef\.current\?\.close\(\)/);
    assert.match(artwork, /const refresh = \(\) => \{\s*invalidate\(\);[\s\S]*?void loadModerationVisibility\(artwork\)/);
    assert.match(artwork, /addEventListener\('artsoul:auth-state-changed', refresh\)/);
    assert.match(artwork, /ref=\{moderationTriggerRef\}[^>]+disabled=\{moderationBusy \|\| moderationChecking\}/);
    assert.match(artwork, /if \(moderationBusy \|\| moderationChecking\) return;\s*setModerationChecking\(true\)/);
});

test('a current-wallet read cannot display the previous signed-in wallet staff data', async () => {
    const writes = [];
    const load = vm.runInNewContext(`(${pageFunction('loadModerationVisibility')})`, {
        artwork: {chain_id: 84532, artwork_id: '28'}, moderationSequenceRef: {current: 0}, URLSearchParams,
        window: {getCurrentWalletAddress: () => 'new-wallet'},
        fetch: async () => ({ok: true, json: async () => ({access: {wallet: 'old-wallet', canModerate: true}, data: {hidden_reason: 'private'}})}),
        setModerationAccess: value => writes.push(value), console
    });
    assert.equal(await load(), false);
    assert.deepEqual(writes, [null]);
});

test('moderation controls never invoke sign-in to open, and a changed wallet cannot submit', async () => {
    const state = {wallet: 'other', writes: 0};
    assert.doesNotMatch(pageFunction('loadModerationVisibility'), /ensureAuthenticated/);
    const submit = vm.runInNewContext(`(${pageFunction('handleModerationVisibility')})`, {
        artwork: {chain_id: 84532, artwork_id: '28'}, moderationSequenceRef: {current: 0}, moderationBusy: false,
        moderationAccess: {canModerate: true, wallet: 'staff'},
        moderationReason: 'reason', window: {getCurrentWalletAddress: () => state.wallet},
        fetch: async () => {state.writes++;}, console
    });
    await submit(true);
    assert.equal(state.writes, 0);
});

test('visibility mutation relies on current server access and expired access directs staff to Admin', async () => {
    const state = {access: {canModerate: true, wallet: 'staff'}, busy: false, message: '', writes: 0};
    const submit = vm.runInNewContext(`(${pageFunction('handleModerationVisibility')})`, {
        artwork: {chain_id: 84532, artwork_id: '28'}, moderationSequenceRef: {current: 0}, moderationBusy: false,
        moderationAccess: state.access, moderationReason: 'reason', window: {getCurrentWalletAddress: () => 'staff'},
        setModerationAccess: value => {state.access = value;}, setModerationBusy: value => {state.busy = value;},
        setModerationMessage: value => {state.message = value;}, console: {error() {}},
        fetch: async () => {state.writes++; return {ok: false, status: 403, json: async () => ({error: 'STEP_UP_REQUIRED'})};}
    });
    await submit(true);
    assert.equal(state.writes, 1); assert.equal(state.access, null); assert.equal(state.busy, false);
    assert.match(state.message, /Verify your access in Admin/);
});
