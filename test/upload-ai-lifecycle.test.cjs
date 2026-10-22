const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/upload.js', 'utf8');
const valuesSource = fs.readFileSync('src/features/artwork/ai-valuation-values.js', 'utf8').replace(/^export /gm, '');
const valid = { estimated_value_min_eth: 0.00001, estimated_value_max_eth: 0.0001, suggested_start_price_eth: 0.00002 };

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1);
    let cursor = source.indexOf('(', start), depth = 0;
    do {
        if (source[cursor] === '(') depth += 1;
        if (source[cursor] === ')') depth -= 1;
    } while (++cursor < source.length && depth);
    cursor = source.indexOf('{', cursor);
    do {
        if (source[cursor] === '{') depth += 1;
        if (source[cursor] === '}') depth -= 1;
    } while (++cursor < source.length && depth);
    return (source.slice(start - 6, start) === 'async ' ? 'async ' : '') + source.slice(start, cursor);
}

function lifecycle(request) {
    const states = [], timers = new Set();
    let formKey = 'initial';
    const context = vm.createContext({
        window: { getCurrentWalletAddress: () => '0xcreator', getCurrentChainId: () => 84532, ArtSoulAIValuation: { request } },
        selectedFile: { type: 'image/png', name: 'fixture.png' },
        latestAIValuation: null, latestAIValuationFormKey: '', aiValuationRequestId: 0,
        aiValuationController: null, aiValuationAttemptCount: 0, AI_TOTAL_ATTEMPT_LIMIT: 3, AI_ANALYSIS_TIMEOUT_MS: 100,
        AbortController, console: { warn() {} },
        setTimeout(callback) { const id = { callback }; timers.add(id); return id; }, clearTimeout(id) { timers.delete(id); },
        getFormCompletionError: () => '', getAIValuationFormKey: () => formKey,
        getUploadFormValues: () => ({ title: 'Fixture', description: 'Local artwork', price: '0.01' }),
        createAIImagePreview: async () => 'data:image/png;base64,AQID',
        setAIValuationState: (state, details) => states.push({ state, details }),
        updateAIValuationRetryState() {}, updatePublishReadiness() {}
    });
    vm.runInContext(valuesSource + '\n' + [
        'createUploadError', 'describeAIValuationError', 'requestAIValuation', 'cancelAIValuation'
    ].map(extract).join('\n'), context);
    return { context, states, timers, changeForm: () => { formKey = 'changed'; } };
}

test('AI success moves from loading to ready and stores only validated values', async () => {
    const { context, states, timers } = lifecycle(async () => ({ valuation: valid, logged: true }));
    await context.requestAIValuation();
    assert.deepEqual(states.map(value => value.state), ['loading', 'ready']);
    assert.equal(context.latestAIValuation.estimated_value_min_eth, 0.00001);
    assert.equal(context.aiValuationController, null);
    assert.equal(timers.size, 0);
});

test('network failure and malformed success both leave the upload unavailable and retryable', async () => {
    for (const request of [async () => { throw new Error('Network unavailable'); }, async () => ({ valuation: { ...valid, estimated_value_max_eth: 0.000001 } })]) {
        const { context, states, timers } = lifecycle(request);
        await context.requestAIValuation();
        assert.deepEqual(states.map(value => value.state), ['loading', 'unavailable']);
        assert.equal(context.latestAIValuation, null);
        assert.equal(context.aiValuationController, null);
        assert.equal(context.aiValuationAttemptCount, 1);
        assert.equal(timers.size, 0);
    }
});

test('late responses cannot apply after file cancellation or a wallet/form change', async () => {
    for (const canceled of [false, true]) {
        let resolve;
        const reply = new Promise(done => { resolve = done; });
        const harness = lifecycle(() => reply);
        const pending = harness.context.requestAIValuation();
        await Promise.resolve();
        if (canceled) harness.context.cancelAIValuation();
        else harness.changeForm();
        resolve({ valuation: valid, logged: true });
        await pending;
        assert.equal(harness.context.latestAIValuation, null);
        assert.equal(harness.states.some(value => value.state === 'ready'), false);
        assert.equal(harness.context.aiValuationController, null);
        assert.equal(harness.timers.size, 0);
    }
});

test('a stalled image decode is aborted and its object URL is released before any model request', async () => {
    const revoked = [], controller = new AbortController();
    let previewImage;
    const context = vm.createContext({
        URL: { createObjectURL: () => 'blob:local-fixture', revokeObjectURL: url => revoked.push(url) },
        Image: class { constructor() { previewImage = this; } },
        DOMException, console: { warn() {} }
    });
    vm.runInContext(extract('createAIImagePreview'), context);
    const pending = context.createAIImagePreview({ type: 'image/png' }, controller.signal);
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.deepEqual(revoked, ['blob:local-fixture']);
    assert.equal(previewImage.src, '');
    assert.equal(previewImage.onload, null);
});

test('ready UI does not present invalid prices and identifies text-only analysis', () => {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', disabled: false });
        return elements.get(id);
    };
    const context = vm.createContext({ document: { getElementById: element }, aiValuationAttemptCount: 1, AI_TOTAL_ATTEMPT_LIMIT: 3,
        updateAIValuationRetryState() {}, updatePublishReadiness() {} });
    vm.runInContext(valuesSource + '\n' + ['formatEthEstimate', 'setAIValuationState'].map(extract).join('\n'), context);
    context.setAIValuationState('loading');
    assert.equal(element('aiValuationContent').style.display, 'none');
    context.setAIValuationState('ready', { valuation: { ...valid, used_media: false }, logged: true });
    assert.match(element('aiValuationRange').textContent, /0[.,]00001.*0[.,]0001 ETH/);
    assert.match(element('aiValuationStatus').textContent, /text metadata only/);
    assert.equal(element('aiValuationContent').style.display, 'block');
    context.setAIValuationState('ready', { valuation: { ...valid, estimated_value_min_eth: 1 } });
    assert.equal(element('aiValuationContent').style.display, 'none');
    assert.match(element('aiValuationStatus').textContent, /unavailable/);
});

function authorization({ chain = 84532, authenticated = true, switchError, changeWallet = false } = {}) {
    const calls = [], states = [], hints = [];
    let wallet = '0x1111111111111111111111111111111111111111';
    const context = vm.createContext({
        BASE_SEPOLIA_CHAIN_ID: 84532, MAX_ARTWORK_UPLOAD_MB: 100,
        authorizedWalletAddress: '', authorizationInProgress: false, aiValuationController: null,
        currentPublishStage: '', submittedRegisterTxHash: '', selectedFile: {},
        window: {
            getCurrentWalletAddress: () => wallet, getCurrentChainId: () => chain,
            ensureArtSoulWriteNetwork: async () => { calls.push('network'); if (switchError) throw switchError; chain = 84532; return true; },
            SupabaseAuth: { isAuthenticatedForWallet: async () => { calls.push('session'); return authenticated; } },
            ensureAuthenticated: async () => { calls.push('signature'); if (changeWallet) wallet = '0x2222222222222222222222222222222222222222'; return true; }
        },
        getFormCompletionError: () => '', requestAIValuation: async () => calls.push('analysis'),
        updateAIValuationRetryState() {}, updatePublishReadiness: message => hints.push(message),
        setAIValuationState: (state, details) => states.push({ state, details })
    });
    vm.runInContext(['createUploadError', 'describePublishError', 'mapPublishError',
        'ensureUploadAuthorization', 'beginPrePublishFlow'].map(extract).join('\n'), context);
    return { context, calls, states, hints };
}

test('analysis prepares the actual write network before authorization, including unknown chains', async () => {
    for (const chain of [1, 0, 84532]) {
        const { context, calls } = authorization({ chain, authenticated: false });
        await context.beginPrePublishFlow();
        assert.deepEqual(calls, ['network', 'session', 'signature', 'analysis']);
        assert.equal(context.authorizedWalletAddress, '0x1111111111111111111111111111111111111111');
        assert.equal(context.authorizationInProgress, false);
    }
});

test('declined or unavailable network never starts analysis and keeps a useful retry message', async () => {
    for (const code of ['BASE_SEPOLIA_SWITCH_REJECTED', 'BASE_SEPOLIA_REQUIRED', 'UNSUPPORTED_NETWORK']) {
        const { context, calls, states, hints } = authorization({ chain: 1, switchError: { code, message: 'This action requires Base Sepolia.' } });
        await context.beginPrePublishFlow();
        assert.deepEqual(calls, ['network']);
        assert.match(states.at(-1).details.message, /Base Sepolia/);
        assert.equal(hints.at(-1), states.at(-1).details.message);
        assert.equal(context.authorizedWalletAddress, '');
        assert.equal(context.authorizationInProgress, false);
    }
});

test('a wallet change while signing cannot authorize analysis for the previous creator', async () => {
    const { context, calls, states } = authorization({ authenticated: false, changeWallet: true });
    await context.beginPrePublishFlow();
    assert.equal(calls.includes('analysis'), false);
    assert.equal(context.authorizedWalletAddress, '');
    assert.match(states.at(-1).details.message, /wallet changed/i);
});

test('unexpected authorization failure is not described as a publishing or AI failure', async () => {
    const { context, states, hints } = authorization();
    context.window.SupabaseAuth.isAuthenticatedForWallet = async () => { throw new TypeError('Failed to fetch'); };
    await context.beginPrePublishFlow();
    assert.match(states.at(-1).details.message, /authorization.*try again/i);
    assert.doesNotMatch(states.at(-1).details.message, /publish flow/);
    assert.equal(hints.at(-1), states.at(-1).details.message);
});
