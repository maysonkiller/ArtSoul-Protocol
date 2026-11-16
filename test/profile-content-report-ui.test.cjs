const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40);
const source = fs.readFileSync('src/features/moderation/profile-content-report.jsx', 'utf8');
const profileSource = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const adminSource = fs.readFileSync('src/entries/admin.jsx', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const elements = (node, predicate) => Array.isArray(node) ? node.flatMap(child => elements(child, predicate))
    : React.isValidElement(node) ? [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)] : [];
let compiledReport, compiledAdmin;
test.before(async () => {
    const { transformWithOxc } = await import('vite');
    const compile = async (text, name) => (await transformWithOxc(text.replace(/^import .*;\r?$/gm, '').replace(/^export /gm, ''), name, { jsx: { runtime: 'classic' } })).code;
    compiledReport = await compile(source, 'profile-report-fixture.jsx');
    compiledAdmin = await compile(adminSource.slice(0, adminSource.indexOf('function AccessGate')), 'profile-review-fixture.jsx');
});

function reportHarness({ authenticate, fetchPage, target = B } = {}) {
    const values = [], refs = [], effects = [], listeners = new Map();
    let si, ri, ei, pending;
    const state = { wallet: A, session: A, calls: [], closed: 0, show: 0 };
    const scope = { AbortController, React: { ...React,
        useState(initial) { const i = si++; if (!(i in values)) values[i] = initial; return [values[i], value => { values[i] = value; }]; },
        useRef(initial) { return refs[ri++] ||= { current: initial }; },
        useEffect(fn, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((d, j) => d !== old.deps[j])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); }
    }, createPortal: value => value, document: { body: {}, activeElement: null },
        window: { getCurrentWalletAddress: () => state.wallet, ensureAuthenticated: () => authenticate ? authenticate(state) : Promise.resolve(true),
            SupabaseAuth: { getAuthenticatedWallet: () => state.session },
            addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
        fetch: async (url, options) => { state.calls.push({ url, options }); return fetchPage ? fetchPage(url, options) : Response.json({ success: true, report: { reference: 'report-1' } }); } };
    vm.runInNewContext(compiledReport + '\nthis.Component = ProfileContentReport;', scope);
    const h = { state, render() {
        si = ri = ei = 0; pending = [];
        const view = scope.Component({ profileWallet: target, onClose: () => { state.closed++; } });
        view.ref.current ||= { showModal() { state.show++; }, close() {} };
        pending.forEach(fn => fn()); return view;
    }, change(id, value) { elements(h.render(), node => node.props.id === id)[0].props.onChange({ target: { value, checked: value } }); },
        submit() { return elements(h.render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); },
        event() { listeners.get('artsoul:wallet-state-changed')?.(); },
        html() { return renderToStaticMarkup(h.render()); }, unmount() { effects.forEach(effect => effect.cleanup?.()); } };
    h.render(); h.change('profileReportDetails', 'A profile is impersonating an artist.'); h.change('profileReportReference', 'https://example.com/evidence'); h.change('profileReportCategory', 'impersonation'); h.change('profileReportDetails', 'A profile is impersonating an artist.');
    elements(h.render(), node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
    return h;
}

test('profile reports submit their real target without artwork identifiers and show dedup receipts', async () => {
    const h = reportHarness({ fetchPage: async () => Response.json({ success: true, alreadySubmitted: true, report: { reference: 'existing-report' } }) });
    await h.submit();
    assert.equal(h.state.calls.length, 1);
    const { url, options } = h.state.calls[0];
    assert.equal(url, '/api/moderation/reports');
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers['X-ArtSoul-Wallet'], A);
    assert.deepEqual(JSON.parse(options.body), { target_type: 'profile_content', profile_wallet: B, category: 'impersonation', details: 'A profile is impersonating an artist.', reference_url: 'https://example.com/evidence', good_faith_confirmed: true });
    assert.match(h.html(), /Report already received|existing-report/);
    assert.equal(elements(h.render(), node => node.type === 'form').length, 0);
    assert.equal(h.state.show, 1, 'parent callback identity changes do not remount the dialog');
    h.unmount();
});

test('report sign-in and in-flight submission are canceled when the wallet switches', async () => {
    for (const stage of ['auth', 'post']) {
        const wait = deferred();
        const h = reportHarness({ authenticate: stage === 'auth' ? () => wait.promise : undefined,
            fetchPage: stage === 'post' ? () => wait.promise : undefined });
        const submitting = h.submit(); await tick();
        h.state.wallet = C; h.event();
        wait.resolve(stage === 'auth' ? true : Response.json({ success: true, report: { reference: 'late-result' } }));
        await submitting;
        assert.equal(h.state.closed, 1);
        assert.equal(h.state.calls.length, stage === 'auth' ? 0 : 1);
        if (stage === 'post') assert.equal(h.state.calls[0].options.signal.aborted, true);
        assert.doesNotMatch(h.html(), /late-result|Report received/);
        h.unmount();
    }
});

test('a pending report cannot be submitted twice and a later session change cannot confirm it', async () => {
    const wait = deferred(), h = reportHarness({ fetchPage: () => wait.promise });
    const first = h.submit(); await tick(); await h.submit();
    assert.equal(h.state.calls.length, 1);
    h.state.session = C;
    wait.resolve(Response.json({ success: true, report: { reference: 'previous-session' } })); await first;
    assert.doesNotMatch(h.html(), /previous-session|Report received/);
    assert.match(h.html(), /sign-in wallet changed/); h.unmount();
});

test('reports enforce a connected same-wallet session, block self reports and retain rate-limit feedback', async () => {
    const self = reportHarness({ target: A }); await self.submit(); assert.equal(self.state.calls.length, 0); assert.match(self.html(), /another public profile/); self.unmount();
    const mismatch = reportHarness(); mismatch.state.session = C; await mismatch.submit(); assert.equal(mismatch.state.calls.length, 0); assert.match(mismatch.html(), /sign-in wallet changed/); mismatch.unmount();
    const guest = reportHarness(); guest.state.wallet = ''; await guest.submit(); assert.equal(guest.state.calls.length, 0); assert.match(guest.html(), /Connect your wallet/); guest.unmount();
    const limited = reportHarness({ fetchPage: async () => Response.json({ message: 'Please wait before submitting another report.' }, { status: 429 }) });
    await limited.submit(); assert.match(limited.html(), /Please wait before submitting another report/); assert.equal(elements(limited.render(), node => node.type === 'button' && node.props.type === 'submit')[0].props.disabled, false); limited.unmount();
});

function editorHarness(fetchPage) {
    const state = { wallet: A, session: A, draft: null, open: false, error: '', calls: [] };
    const scope = { AbortController, profile: { wallet_address: A, username: '', bio: '', avatar_url: '', profile_content_hidden: true }, isOwnProfile: true,
        profileEditRef: { current: 0 }, profileRequestRef: { current: 1 }, profileEditRequestRef: { current: null }, profileEditWalletRef: { current: '' },
        getActiveWalletAddress: () => state.wallet, window: { ensureAuthenticated: async () => true, SupabaseAuth: { getAuthenticatedWallet: () => state.session } },
        fetch: async (url, options) => { state.calls.push({ url, options }); return fetchPage ? fetchPage() : Response.json({ success: true, profile: { wallet_address: A, username: 'Original artist', bio: 'Original biography', avatar_url: 'https://example.com/avatar.png' } }); },
        setProfileEditLoading: value => { state.loading = value; }, setProfileEditError: value => { state.error = value; }, setProfileDraft: value => { state.draft = value; }, setEditMode: value => { state.open = value; } };
    const handlers = profileSource.slice(profileSource.indexOf('async function startProfileEdit('), profileSource.indexOf('async function handleAvatarUpload('));
    vm.runInNewContext(handlers + '\nthis.open = startProfileEdit; this.cancel = cancelProfileEdit;', scope);
    return { state, scope };
}

test('owner editing loads originals privately without replacing the masked public summary', async () => {
    const h = editorHarness(); await h.scope.open();
    assert.equal(h.state.draft.username, 'Original artist'); assert.equal(h.state.open, true);
    assert.equal(h.scope.profile.username, ''); assert.equal(h.scope.profile.profile_content_hidden, true);
    assert.equal(h.state.calls[0].url, '/api/profile');
    assert.equal(h.state.calls[0].options.headers['X-ArtSoul-Wallet'], A);
    assert.equal(h.state.calls[0].options.cache, 'no-store');
    h.scope.cancel(); assert.equal(h.state.draft, null); assert.equal(h.state.open, false);
});

test('owner editor rejects stale, mismatched and failed original-content reads instead of using public blanks', async () => {
    for (const failure of ['wallet-switch', 'cancel', 'profile-switch', 'session-switch', 'failed', 'wrong-owner']) {
        const wait = deferred(), h = editorHarness(() => wait.promise);
        const opening = h.scope.open(); await tick();
        if (failure === 'wallet-switch') h.state.wallet = B;
        if (failure === 'cancel') h.scope.cancel();
        if (failure === 'profile-switch') h.scope.profileRequestRef.current++;
        if (failure === 'session-switch') h.state.session = B;
        wait.resolve(failure === 'failed' ? Response.json({ error: 'Unavailable' }, { status: 503 })
            : Response.json({ success: true, profile: { wallet_address: failure === 'wrong-owner' ? B : A, username: 'Must not appear' } }));
        await opening; assert.equal(h.state.draft, null, failure); assert.equal(h.state.open, false, failure);
    }
});

test('private editing closes immediately on a same-wallet sign-out or connected-wallet change', async () => {
    for (const event of ['artsoul:auth-state-changed', 'artsoul:wallet-state-changed']) {
        const h = editorHarness(), listeners = new Map(); let cleanup;
        h.scope.window.addEventListener = (name, fn) => listeners.set(name, fn);
        h.scope.window.removeEventListener = name => listeners.delete(name);
        h.scope.useEffect = fn => { cleanup = fn(); };
        const marker = profileSource.indexOf('const cancelChangedWalletEdit =');
        vm.runInNewContext(profileSource.slice(profileSource.lastIndexOf('useEffect(() => {', marker), profileSource.indexOf('}, []);', marker) + 7), h.scope);
        await h.scope.open(); assert.equal(h.state.open, true);
        if (event.includes('auth-state')) h.state.session = '';
        else h.state.wallet = B;
        listeners.get(event)();
        assert.equal(h.state.draft, null); assert.equal(h.state.open, false);
        cleanup(); assert.equal(listeners.size, 0);
    }
});

test('profile review groups keep wallets and captured revisions separate and render untrusted snapshots safely', () => {
    const scope = { React, URL }; vm.runInNewContext(compiledAdmin + '\nthis.group = groupReports; this.Snapshot = ProfileReportSnapshot; this.Actions = ReportActions;', scope);
    const report = { id: 'r1', target_type: 'profile_content', profile_wallet: B, profile_content_hash: 'one', status: 'pending_review', profile_content_snapshot: { username: '<script>unsafe()</script>', bio: '<img src=x>', avatar_url: 'javascript:bad()', discord_profile_url: 'javascript:bad()' } };
    const groups = scope.group([report, { ...report, id: 'r2', profile_wallet: C }, { ...report, id: 'r3', profile_content_hash: 'two' }]);
    assert.equal(groups.length, 3);
    const html = renderToStaticMarkup(React.createElement(scope.Snapshot, { report }));
    assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|javascript:|<img/);
    for (const status of ['pending_review', 'dismissed', 'resolved']) {
        const view = scope.Actions({ report: { ...report, status, profile_content_changed: true }, onChoose() {} });
        const protectedButton = elements(view, node => node.type === 'button')[0]; assert.equal(protectedButton.props.disabled, true);
    }
    const restored = scope.Actions({ report: { ...report, status: 'actioned', profile_content_changed: true }, onChoose() {} });
    assert.equal(elements(restored, node => node.type === 'button')[0].props.disabled, undefined, 'historical reports remain resolvable');
});

test('hidden-profile review navigation requests a wallet target without fabricating artwork identifiers', async () => {
    let path, returned;
    const scope = { useCallback: fn => fn, setupEpoch: { current: 2 }, currentSetupWallet: () => A, queueRequest: { current: 0 }, readySession: { current: { epoch: 2, wallet: A } },
        queueTargetRef: { current: { target_type: 'profile_content', profile_wallet: B } }, sessionIsCurrent: () => true, api: async value => { path = value; return { data: { reports: [] } }; }, setData: value => { returned = value; } };
    vm.runInNewContext(adminSource.slice(adminSource.indexOf('const loadQueue ='), adminSource.indexOf('const accessFailed =')) + '\nthis.load = loadQueue;', scope);
    assert.equal(await scope.load('actioned'), true);
    assert.equal(path, `review-queue?status=actioned&target_type=profile_content&profile_wallet=${B}`);
    assert.ok(returned);
});
