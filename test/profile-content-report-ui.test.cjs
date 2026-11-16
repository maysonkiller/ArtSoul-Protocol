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
let compiledReport, compiledAdmin, compiledProfileReportControls, compiledProfileEditFeedback;
test.before(async () => {
    const { transformWithOxc } = await import('vite');
    const compile = async (text, name) => (await transformWithOxc(text.replace(/^import .*;\r?$/gm, '').replace(/^export /gm, ''), name, { jsx: { runtime: 'classic' } })).code;
    compiledReport = await compile(source, 'profile-report-fixture.jsx');
    compiledAdmin = await compile(adminSource.slice(0, adminSource.indexOf('function AccessGate')), 'profile-review-fixture.jsx');
    const buttonStart = profileSource.indexOf('{!isOwnProfile && profileReportingEnabled');
    const button = profileSource.slice(buttonStart, profileSource.indexOf(')}', profileSource.indexOf('</button>', buttonStart)) + 2);
    const dialogStart = profileSource.indexOf('{profileReportOpen && profileReportingEnabled');
    const dialog = profileSource.slice(dialogStart, profileSource.indexOf('\n', dialogStart));
    compiledProfileReportControls = await compile(`function ProfileReportControls({ profile, isOwnProfile = false, profileReportingEnabled = true, profileReportOpen = false, setProfileReportOpen }) { return <>${button}${dialog}</>; }`, 'profile-report-controls-fixture.jsx');
    const feedbackStart = profileSource.indexOf('{profileEditError && <p');
    const feedback = profileSource.slice(feedbackStart, profileSource.indexOf('\n', feedbackStart));
    compiledProfileEditFeedback = await compile(`function ProfileEditFeedback({ profileEditError, profileEditErrorIsNotice }) { return <>${feedback}</>; }`, 'profile-edit-feedback-fixture.jsx');
});

test('profile report controls render only for a stored profile, including an already-open dialog', () => {
    const scope = { React, ProfileContentReport: ({ profileWallet }) => React.createElement('div', { 'data-profile-report': profileWallet }) };
    vm.runInNewContext(compiledProfileReportControls + '\nthis.Controls = ProfileReportControls;', scope);
    let open = false;
    const props = { profile: { id: 'stored-profile', wallet_address: B }, setProfileReportOpen: value => { open = value; } };
    const view = scope.Controls(props);
    assert.match(renderToStaticMarkup(view), /Report profile/);
    assert.doesNotMatch(renderToStaticMarkup(view), /data-profile-report/);
    elements(view, node => node.type === 'button')[0].props.onClick();
    assert.equal(open, true);
    assert.match(renderToStaticMarkup(scope.Controls({ ...props, profileReportOpen: open })), new RegExp(`data-profile-report="${B}"`));
    for (const profile of [null, { wallet_address: B, username: '', bio: '', avatar_url: '' }]) {
        const html = renderToStaticMarkup(scope.Controls({ ...props, profile, profileReportOpen: true }));
        assert.doesNotMatch(html, /Report profile|data-profile-report/, 'missing profiles cannot offer or retain a report dialog');
    }
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
        setProfileEditLoading: value => { state.loading = value; }, setProfileEditError: value => { state.error = value; }, setProfileEditErrorIsNotice: value => { state.notice = value; }, setProfileDraft: value => { state.draft = value; }, setEditMode: value => { state.open = value; } };
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

function mobileProfileAuthHarness({ deferAuthentication = false, verificationFailure = null, verificationError = null, debugEnabled = false } = {}) {
    const auth = fs.readFileSync('supabase-auth.js', 'utf8');
    const app = fs.readFileSync('appkit-init.js', 'utf8');
    const listeners = new Map(), storage = new Map();
    const state = { wallet: A, signatures: 0, verifies: 0, privateReads: 0, alerts: 0, restarts: 0, open: false, error: '', debugEnabled, diagnostics: [] };
    const response = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data), json: async () => data });
    const provider = { request: async ({ method }) => {
        if (method === 'eth_accounts') return [state.wallet];
        if (method === 'eth_chainId') return '0x2105';
        if (method === 'personal_sign') {
            state.signatures++;
            return new Promise((resolve, reject) => { state.resolveSignature = resolve; state.rejectSignature = reject; });
        }
        throw new Error(`Unexpected provider method: ${method}`);
    } };
    const window = { location: { host: 'example.test', origin: 'https://example.test' }, getCurrentWalletAddress: () => state.wallet,
        addEventListener(name, fn) { const handlers = listeners.get(name) || []; handlers.push(fn); listeners.set(name, handlers); },
        removeEventListener() {}, dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); } };
    const scope = { window, document: { visibilityState: 'visible' }, TextEncoder, AbortController,
        CustomEvent: class { constructor(type) { this.type = type; } },
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        fetch: async url => {
            if (url.endsWith('/session')) return response({ authenticated: false });
            if (url.includes('/nonce?')) return response({ nonce: 'fixture-nonce' });
            if (url.endsWith('/verify')) { state.verifies++; if (verificationError) throw verificationError; return verificationFailure ? response({ error: verificationFailure.code }, verificationFailure.status) : response({ wallet: A }); }
            if (url.endsWith('/logout')) return response({ success: true });
            if (url === '/api/profile') { state.privateReads++; return response({ success: true, profile: { id: 'stored-profile', wallet_address: A, username: 'Artist' } }); }
            throw new Error(`Unexpected auth request: ${url}`);
        }, console: { log() {}, warn() {}, error() {} }, alert: () => { state.alerts++; },
        isMobileDevice: () => true, isInjectedWalletBrowser: () => false,
        walletDebugEnabled: () => state.debugEnabled, walletDebugSequence: 0, walletDebugEntries: state.diagnostics,
        walletDebugLog(step, detail) { if (state.debugEnabled) state.diagnostics.push({ sequence: ++scope.walletDebugSequence, step, detail }); },
        maskWalletAddress: value => value, getProviderForWallet: async () => provider, setCoreAuthLifecycleState() {},
        isWalletExplicitlyDisconnected: () => false, isCoreSessionActive: () => true, isCoreConnectInFlight: () => false,
        restartWalletConnectTransport: async () => { state.restarts++; }, recheckDeferredCoreDisconnect: async () => {},
        getWalletDebugSnapshot: () => ({}), walletResumeWaiters: new Set(), scheduleWalletReconciliation() {},
        profile: { id: 'stored-profile', wallet_address: A }, isOwnProfile: true,
        profileEditRef: { current: 0 }, profileRequestRef: { current: 1 }, profileEditRequestRef: { current: null }, profileEditWalletRef: { current: '' },
        setProfileEditLoading: value => { state.loading = value; }, setProfileEditError: value => { state.error = value; }, setProfileEditErrorIsNotice: value => { state.notice = value; },
        setProfileDraft: value => { state.draft = value; }, setEditMode: value => { state.open = value; }, useEffect: fn => fn() };
    vm.createContext(scope);
    window.ArtSoulWalletDebug = { log: scope.walletDebugLog };
    vm.runInContext(auth, scope);
    for (const name of ['getWalletErrorCode', 'isUserRejectedError', 'classifyAuthenticationFailure', 'authenticationDiagnosticReference']) {
        vm.runInContext(app.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0], scope);
    }
    vm.runInContext(`let authenticationPromise = null, deferMobileAuthenticationThisTurn = ${deferAuthentication};\n`
        + app.match(/window\.ensureAuthenticated = async[\s\S]*?\n\};/)[0], scope);
    vm.runInContext(app.match(/async function processWalletResume[\s\S]*?\n\}/)[0], scope);
    const marker = profileSource.indexOf('const cancelChangedWalletEdit =');
    vm.runInContext(profileSource.slice(profileSource.lastIndexOf('useEffect(() => {', marker), profileSource.indexOf('}, []);', marker) + 7), scope);
    vm.runInContext(profileSource.slice(profileSource.indexOf('async function startProfileEdit('), profileSource.indexOf('async function handleAvatarUpload(')), scope);
    vm.runInContext(compiledProfileEditFeedback + '\nthis.Feedback = ProfileEditFeedback;', scope);
    return { state, scope, open: () => scope.startProfileEdit(),
        feedback: () => { scope.React = React; return renderToStaticMarkup(scope.Feedback({ profileEditError: state.error, profileEditErrorIsNotice: state.notice })); } };
}

test('profile editing waits for a mobile signature across early browser resume', async () => {
    const h = mobileProfileAuthHarness(), pending = h.open(); await tick();
    assert.equal(h.state.signatures, 1);
    h.scope.document.visibilityState = 'hidden';
    h.scope.document.visibilityState = 'visible';
    await h.scope.processWalletResume('pageshow + visibility return + window focus');
    assert.equal(h.state.restarts, 1);
    assert.equal(h.state.loading, true); assert.equal(h.state.error, ''); assert.equal(h.state.alerts, 0);
    assert.equal(h.state.verifies, 0); assert.equal(h.state.privateReads, 0); assert.equal(h.state.open, false);
    await h.open(); assert.equal(h.state.signatures, 1, 'repeated Edit cannot request a second pending signature');
    h.state.resolveSignature('0xsynthetic-signature'); await pending;
    assert.equal(h.state.verifies, 1); assert.equal(h.state.privateReads, 1); assert.equal(h.state.open, true);
    assert.equal(h.state.error, ''); assert.equal(h.state.alerts, 0);
});

test('a rejected mobile signature permits a fresh edit retry without opening private content early', async () => {
    const h = mobileProfileAuthHarness(), first = h.open(); await tick();
    h.state.rejectSignature(Object.assign(new Error('User rejected the request'), { code: 4001 })); await first;
    assert.equal(h.state.privateReads, 0); assert.equal(h.state.open, false); assert.equal(h.state.loading, false);
    assert.match(h.state.error, /Sign-in was canceled/);
    assert.equal(h.state.alerts, 0); assert.equal(h.state.notice, true);
    assert.match(h.feedback(), /role="status"/); assert.doesNotMatch(h.feedback(), /is-error|role="alert"/);
    const retry = h.open(); await tick(); assert.equal(h.state.signatures, 2);
    h.state.resolveSignature('0xsynthetic-signature'); await retry;
    assert.equal(h.state.verifies, 1); assert.equal(h.state.privateReads, 1); assert.equal(h.state.open, true);
});

test('profile sign-in presents one safe inline failure and never retries a signature automatically', async () => {
    for (const scenario of [
        { error: Object.assign(new Error('private RPC response'), { code: 4900 }), message: /temporarily unavailable/ },
        { error: new Error('signature=private-signature; token=private-token; RPC_BODY'), message: /could not be completed/ },
        { verificationFailure: { code: 'INVALID_OR_EXPIRED_NONCE', status: 401 }, message: /request expired/ },
        { verificationFailure: { code: 'INVALID_SIGNATURE', status: 401 }, message: /could not be verified/ }
    ]) {
        const h = mobileProfileAuthHarness(scenario), pending = h.open(); await tick();
        if (scenario.error) h.state.rejectSignature(scenario.error); else h.state.resolveSignature('0xsynthetic-signature');
        await pending;
        assert.equal(h.state.signatures, 1); assert.equal(h.state.privateReads, 0); assert.equal(h.state.open, false);
        assert.equal(h.state.alerts, 0); assert.equal(h.state.loading, false); assert.equal(h.state.notice, false);
        assert.match(h.state.error, scenario.message); assert.match(h.feedback(), /role="alert"/);
        assert.doesNotMatch(h.feedback(), /private-signature|private-token|RPC_BODY|private RPC response/);
    }
});

test('shared authentication preserves boolean legacy results and alerts once while delivering scoped inline failures', async () => {
    const h = mobileProfileAuthHarness();
    const legacy = h.scope.window.ensureAuthenticated(), profile = h.open(), duplicateLegacy = h.scope.window.ensureAuthenticated();
    await tick(); assert.equal(h.state.signatures, 1);
    h.state.rejectSignature(new Error('private RPC response'));
    assert.equal(await legacy, false); assert.equal(await duplicateLegacy, false); await profile;
    assert.equal(h.state.alerts, 1); assert.match(h.state.error, /could not be completed/);
    assert.equal(h.state.privateReads, 0);
    const retry = h.scope.window.ensureAuthenticated(); await tick(); assert.equal(h.state.signatures, 2);
    h.state.resolveSignature('0xsynthetic-signature');
    assert.equal(await retry, true); assert.equal(h.state.alerts, 1);
});

test('opt-in profile diagnostics distinguish a failed wallet request from failed verification without exposing raw errors', async () => {
    for (const stage of ['signature', 'verify']) {
        const h = mobileProfileAuthHarness({ debugEnabled: true, verificationError: stage === 'verify' ? new TypeError('Failed to fetch') : null });
        const pending = h.open(); await tick();
        if (stage === 'signature') h.state.rejectSignature(new TypeError('Cannot read properties of undefined (reading "private-provider-value")'));
        else h.state.resolveSignature('0xsynthetic-signature');
        await pending;
        assert.match(h.state.error, new RegExp(`Reference: ${stage}/TypeError/${stage === 'verify' ? 'network-fetch' : 'property-access'}\\.`));
        assert.equal(h.state.verifies, stage === 'verify' ? 1 : 0);
        assert.equal(h.state.signatures, 1); assert.equal(h.state.alerts, 0); assert.equal(h.state.privateReads, 0);
        assert.doesNotMatch(h.state.error, /private-provider-value|Failed to fetch|synthetic-signature/);
    }
});

test('profile diagnostic references are opt-in, bounded and never reuse an earlier attempt', async () => {
    const h = mobileProfileAuthHarness({ debugEnabled: true });
    h.scope.walletDebugLog('SIWE auth operation failed', { stage: 'verify', name: 'Error', code: 'INVALID_SIGNATURE', status: 401 });
    h.scope.getProviderForWallet = async () => { throw new TypeError('Unavailable before an auth operation record exists'); };
    await h.open();
    assert.match(h.state.error, /Reference: provider-selection\./);
    assert.doesNotMatch(h.state.error, /INVALID_SIGNATURE|Unavailable before/);
    const afterSequence = h.scope.walletDebugSequence;
    h.scope.walletDebugLog('SIWE auth operation failed', { stage: 'signature', name: 'TypeError', code: 4900, status: 503, kind: 'network-fetch' });
    assert.equal(h.scope.authenticationDiagnosticReference(afterSequence), 'signature/TypeError/network-fetch/4900/503');
    h.scope.walletDebugLog('SIWE auth operation failed', { stage: 'signature', name: 'private-name', code: 'private-code', status: 'private-status', kind: 'private-kind', message: 'private-message' });
    assert.equal(h.scope.authenticationDiagnosticReference(afterSequence), 'signature');
    h.scope.walletDebugLog('SIWE auth operation failed', { stage: 'private-stage', name: 'Error' });
    assert.equal(h.scope.authenticationDiagnosticReference(afterSequence), '');
    h.state.debugEnabled = false;
    h.state.diagnostics.push({ sequence: ++h.scope.walletDebugSequence, step: 'SIWE auth operation failed', detail: { stage: 'verify', name: 'TypeError' } });
    assert.equal(h.scope.authenticationDiagnosticReference(0), '');
});

test('wrapper diagnostics identify an unrecorded auth call or malformed result without reusing an old event', async () => {
    for (const stage of ['auth-call', 'auth-result']) {
        const h = mobileProfileAuthHarness({ debugEnabled: true });
        h.scope.walletDebugLog('SIWE auth operation failed', { stage: 'verify', name: 'Error', code: 'INVALID_SIGNATURE', status: 401 });
        h.scope.window.SupabaseAuth.authenticateWithWallet = stage === 'auth-call'
            ? async () => { throw new TypeError('private unrecorded failure'); }
            : async () => null;
        await h.open();
        assert.match(h.state.error, new RegExp(`Reference: ${stage}\\.`));
        assert.doesNotMatch(h.state.error, /INVALID_SIGNATURE|private unrecorded/);
        assert.equal(h.state.alerts, 0); assert.equal(h.state.privateReads, 0);
    }
});

test('an unavailable optional diagnostic reference does not replace the authentication failure', async () => {
    const h = mobileProfileAuthHarness({ debugEnabled: true });
    h.scope.walletDebugEnabled = () => { throw new Error('Optional diagnostics unavailable'); };
    const pending = h.open(); await tick();
    h.state.rejectSignature(Object.assign(new Error('User rejected'), { code: 4001 }));
    await pending;
    assert.equal(h.state.error, 'Sign-in was canceled. You can try again when you are ready.');
    assert.equal(h.state.notice, true); assert.equal(h.state.alerts, 0); assert.equal(h.state.privateReads, 0);
});

test('a real account change while the mobile signature is pending prevents a late editor opening', async () => {
    const h = mobileProfileAuthHarness(), pending = h.open(); await tick();
    h.state.wallet = B; h.scope.window.dispatchEvent({ type: 'artsoul:wallet-state-changed' });
    h.state.resolveSignature('0xsynthetic-signature'); await pending;
    assert.equal(h.state.privateReads, 0); assert.equal(h.state.open, false); assert.equal(h.state.draft, null);
    assert.equal(h.scope.window.SupabaseAuth.getAuthenticatedWallet(), '');
});

test('same-turn mobile pairing deferral shows verification feedback without requesting a signature', async () => {
    const h = mobileProfileAuthHarness({ deferAuthentication: true });
    await h.open();
    assert.equal(h.state.signatures, 0); assert.equal(h.state.privateReads, 0); assert.equal(h.state.alerts, 0);
    assert.match(h.state.error, /Verify your wallet/);
    const retry = h.open(); await tick(); assert.equal(h.state.signatures, 1);
    h.state.resolveSignature('0xsynthetic-signature'); await retry;
    assert.equal(h.state.privateReads, 1); assert.equal(h.state.open, true); assert.equal(h.state.error, '');
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
