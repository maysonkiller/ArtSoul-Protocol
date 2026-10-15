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
    assert.match(artwork, /ref=\{moderationTriggerRef\}[^>]+disabled=\{moderationBusy\}/);
    assert.match(artwork, /if \(moderationBusy\) return;\s*if \(await loadModerationVisibility/);
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

test('a wallet change during moderation authentication prevents the write', async () => {
    const auth = deferred(), state = {wallet: 'staff', writes: 0};
    const submit = vm.runInNewContext(`(${pageFunction('handleModerationVisibility')})`, {
        artwork: {chain_id: 84532, artwork_id: '28'}, moderationSequenceRef: {current: 0}, moderationBusy: false,
        moderationReason: 'reason', window: {getCurrentWalletAddress: () => state.wallet, ensureAuthenticated: () => auth.promise},
        fetch: async () => {state.writes++;}, console
    });
    const work = submit(true); state.wallet = 'other'; auth.resolve(true); await work;
    assert.equal(state.writes, 0);
});
