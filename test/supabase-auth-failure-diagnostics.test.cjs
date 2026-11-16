const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase-auth.js'), 'utf8');
const wallet = '0x1111111111111111111111111111111111111111';
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data) });
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ fetchReply, logFailure } = {}) {
    const storage = new Map();
    const state = { requests: [], methods: [], failures: [], consoleErrors: [], events: [] };
    const window = {
        location: { host: 'example.test', origin: 'https://example.test' },
        getCurrentWalletAddress: () => wallet,
        dispatchEvent: event => state.events.push(event.type),
        ArtSoulWalletDebug: { log(step, detail) {
            if (logFailure) throw logFailure;
            state.failures.push({ step, detail: JSON.parse(JSON.stringify(detail)) });
        } }
    };
    const provider = { request: async ({ method }) => {
        state.methods.push(method);
        if (method === 'eth_accounts') return [wallet];
        if (method === 'eth_chainId') return '0x2105';
        if (method === 'personal_sign') return new Promise((resolve, reject) => {
            state.resolveSignature = resolve;
            state.rejectSignature = reject;
        });
        throw new Error(`Unexpected wallet method: ${method}`);
    } };
    vm.runInNewContext(source, {
        window, TextEncoder,
        CustomEvent: class { constructor(type) { this.type = type; } },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        console: { log() {}, warn() {}, error: (...args) => state.consoleErrors.push(args) },
        fetch: async (url, options = {}) => {
            state.requests.push({ url, options });
            if (fetchReply) {
                const custom = await fetchReply(url, options);
                if (custom) return custom;
            }
            if (url.endsWith('/session')) return response(200, { authenticated: false });
            if (url.includes('/nonce?')) return response(200, { nonce: 'fixture-nonce' });
            if (url.endsWith('/verify')) return response(200, { wallet });
            throw new Error(`Unexpected backend request: ${url}`);
        }
    });
    return { state, window, start: () => window.SupabaseAuth.authenticateWithWallet(wallet, provider)
        .then(session => ({ session }), error => ({ error })) };
}

function assertNoAuthentication(h) {
    assert.equal(h.window.SupabaseAuth.getAuthenticatedWallet(), '');
    assert.equal(h.state.methods.filter(method => method === 'personal_sign').length, 1);
    assert.deepEqual(h.state.consoleErrors, [], 'raw rejections must not be printed');
}

test('signature and verification network failures identify their stage without retries or early authentication', async () => {
    for (const stage of ['signature', 'verify']) {
        const failure = new TypeError('Load failed');
        const h = harness({ fetchReply: async url => {
            if (stage === 'verify' && url === '/api/auth/verify') throw failure;
        } });
        const pending = h.start(); await tick();
        assert.equal(h.state.requests.some(request => request.url.endsWith('/verify')), false);
        assert.equal(h.window.SupabaseAuth.getAuthenticatedWallet(), '');
        if (stage === 'signature') h.state.rejectSignature(failure);
        else h.state.resolveSignature('synthetic-signature');
        assert.equal((await pending).error, failure);
        assertNoAuthentication(h);
        assert.equal(h.state.requests.filter(request => request.url.endsWith('/verify')).length, stage === 'verify' ? 1 : 0);
        assert.deepEqual(h.state.failures, [{ step: 'SIWE auth operation failed', detail: {
            stage, name: 'TypeError', code: null, status: null, kind: 'network-fetch'
        } }]);
    }
});

test('semantic authentication rejections preserve known codes and never replay verification through the fallback route', async () => {
    for (const code of ['INVALID_OR_EXPIRED_NONCE', 'INVALID_SIGNATURE', 'INVALID_SIWE_MESSAGE']) {
        const h = harness({ fetchReply: async url => url.endsWith('/verify')
            ? response(401, { error: code, message: 'private-backend-body' }) : undefined });
        const pending = h.start(); await tick(); h.state.resolveSignature('synthetic-signature');
        const { error } = await pending;
        assert.equal(error.status, 401); assert.equal(error.code, code);
        assert.deepEqual(h.state.requests.filter(request => request.url.endsWith('/verify')).map(request => request.url), ['/api/auth/verify']);
        assertNoAuthentication(h);
        assert.equal(h.state.failures[0].detail.code, code);
        assert.equal(h.state.failures[0].detail.status, 401);
        assert.doesNotMatch(JSON.stringify(h.state.failures), /private-backend-body|synthetic-signature|fixture-nonce/);
    }
});

test('a missing primary authentication route still falls back once using the existing signature', async () => {
    const h = harness({ fetchReply: async url => url === '/api/auth/verify' ? response(404, {}) : undefined });
    const pending = h.start(); await tick(); h.state.resolveSignature('synthetic-signature');
    assert.equal((await pending).session.walletAddress, wallet);
    const verification = h.state.requests.filter(request => request.url.endsWith('/verify'));
    assert.deepEqual(verification.map(request => request.url), ['/api/auth/verify', '/auth/verify']);
    assert.equal(verification[0].options.body, verification[1].options.body);
    assert.equal(h.state.methods.filter(method => method === 'personal_sign').length, 1);
    assert.equal(h.window.SupabaseAuth.getAuthenticatedWallet(), wallet);
    assert.deepEqual(h.state.failures, []);
});

test('diagnostics preserve frozen and primitive signature rejections even when the optional logger fails', async () => {
    const frozen = Object.freeze(Object.assign(new Error('private-error-body'), { code: 4900 }));
    for (const failure of [frozen, 'private-rejection', undefined, null, false, 0]) {
        for (const logFailure of [null, new Error('logger unavailable')]) {
            const h = harness({ logFailure });
            const pending = h.start(); await tick(); h.state.rejectSignature(failure);
            assert.equal((await pending).error, failure);
            assertNoAuthentication(h);
            assert.equal(h.state.requests.filter(request => request.url.endsWith('/verify')).length, 0);
            assert.doesNotMatch(JSON.stringify(h.state.failures), /private-error-body|private-rejection/);
        }
    }
});

test('verification fetch preserves a falsy rejection and an abort without fallback or signature retry', async () => {
    for (const failure of [null, Object.assign(new Error('private-abort-body'), { name: 'AbortError' })]) {
        const h = harness({ fetchReply: async url => { if (url === '/api/auth/verify') throw failure; } });
        const pending = h.start(); await tick(); h.state.resolveSignature('synthetic-signature');
        assert.equal((await pending).error, failure);
        assertNoAuthentication(h);
        assert.equal(h.state.requests.filter(request => request.url.endsWith('/verify')).length, 1);
        assert.equal(h.state.failures[0].detail.stage, 'verify');
        assert.equal(h.state.failures[0].detail.name, failure ? 'AbortError' : 'Error');
        assert.doesNotMatch(JSON.stringify(h.state.failures), /private-abort-body/);
    }
});

test('auth diagnostics retain only bounded names, codes, status and fixed TypeError categories', async () => {
    for (const [failure, expected] of [
        [{ name: 'private-name', code: 'private-code', status: 'private-status', signature: 'private-signature' }, { name: 'Error', code: null, status: null, kind: 'other' }],
        [{ name: 'Error', code: '4900', status: 503 }, { name: 'Error', code: 4900, status: 503, kind: 'other' }],
        [{ name: 'Error', code: 'CORE_SIGN_CLIENT_UNAVAILABLE' }, { name: 'Error', code: 'CORE_SIGN_CLIENT_UNAVAILABLE', status: null, kind: 'other' }],
        [{ name: 'Error', code: Infinity, status: 999 }, { name: 'Error', code: null, status: null, kind: 'other' }],
        [{ name: 'Error', code: NaN, status: 401.5 }, { name: 'Error', code: null, status: null, kind: 'other' }],
        [new TypeError("Cannot read properties of undefined (reading 'private-property')"), { name: 'TypeError', code: null, status: null, kind: 'property-access' }],
        [new TypeError('undefined is not an object (evaluating private.property)'), { name: 'TypeError', code: null, status: null, kind: 'property-access' }],
        [new TypeError('private-message'), { name: 'TypeError', code: null, status: null, kind: 'other' }]
    ]) {
        const h = harness(), pending = h.start(); await tick(); h.state.rejectSignature(failure);
        assert.equal((await pending).error, failure);
        assert.deepEqual(h.state.failures[0].detail, { stage: 'signature', ...expected });
        assert.doesNotMatch(JSON.stringify(h.state.failures), /private/);
    }
});

test('unknown backend response codes are not promoted into safe auth diagnostics', async () => {
    const h = harness({ fetchReply: async url => url.endsWith('/verify')
        ? response(500, { error: 'private-response-code', message: 'private-response-body' }) : undefined });
    const pending = h.start(); await tick(); h.state.resolveSignature('synthetic-signature');
    const { error } = await pending;
    assert.equal(error.code, undefined); assert.equal(error.status, 500);
    assert.equal(h.state.failures[0].detail.code, null);
    assert.doesNotMatch(JSON.stringify(h.state.failures), /private-response/);
    assertNoAuthentication(h);
});

test('getter-backed rejection fields cannot change between diagnostic validation and logging', async () => {
    const reads = { name: 0, status: 0, message: 0 };
    const failure = {
        get name() { return ++reads.name === 1 ? 'TypeError' : 'private-name'; },
        get status() { return ++reads.status === 1 ? 503 : 'private-status'; },
        get message() { return ++reads.message === 1 ? 'Load failed' : 'private-message'; }
    };
    const h = harness(), pending = h.start(); await tick(); h.state.rejectSignature(failure);
    assert.equal((await pending).error, failure);
    assert.deepEqual(reads, { name: 1, status: 1, message: 1 });
    assert.deepEqual(h.state.failures[0].detail, {
        stage: 'signature', name: 'TypeError', code: null, status: 503, kind: 'network-fetch'
    });
    assert.doesNotMatch(JSON.stringify(h.state.failures), /private/);
});

test('backend network failures retain their recognized code without repeating verification', async () => {
    const h = harness({ fetchReply: async url => url.endsWith('/verify')
        ? response(500, { error: 'SUPABASE_REQUEST_FAILED', message: 'Internal server error' }) : undefined });
    const pending = h.start(); await tick(); h.state.resolveSignature('synthetic-signature');
    assert.equal((await pending).error.code, 'SUPABASE_REQUEST_FAILED');
    assert.equal(h.state.failures[0].detail.code, 'SUPABASE_REQUEST_FAILED');
    assert.equal(h.state.requests.filter(request => request.url.endsWith('/verify')).length, 1);
    assertNoAuthentication(h);
});

test('wallet-test includes operation-stage failures in the current authentication attempt summary', () => {
    const diagnosticSource = fs.readFileSync(path.join(root, 'wallet-test.js'), 'utf8');
    const start = diagnosticSource.indexOf('const A1_AUTH_DIAGNOSTIC_STEPS =');
    const end = diagnosticSource.indexOf('const A1_UPLOAD_POLICY_CASES =');
    const entries = [
        { sequence: 1, step: 'SIWE auth operation failed', detail: { stage: 'nonce' } },
        { sequence: 3, step: 'SIWE auth operation failed', detail: { stage: 'verify', name: 'TypeError', kind: 'network-fetch' } },
        { sequence: 4, step: 'SIWE signature failed', detail: { code: 'AUTH_UNAVAILABLE', message: 'Fixed public message' } }
    ];
    const scope = { window: { ArtSoulWalletDebug: { snapshot: () => entries } }, safeDetail: value => value };
    vm.runInNewContext(diagnosticSource.slice(start, end), scope);
    const summary = scope.summarizeA1AuthenticationAttempt(2);
    assert.equal(summary.outcome, 'failed');
    assert.deepEqual(Array.from(summary.diagnostics, entry => entry.sequence), [3, 4]);
    assert.equal(summary.diagnostics[0].detail.stage, 'verify');
});
