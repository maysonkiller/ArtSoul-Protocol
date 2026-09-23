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
