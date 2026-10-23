const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const read = file => fs.readFileSync(file, 'utf8');
const noImports = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '');
function load() {
    const window = {};
    const context = vm.createContext({window, console: {log() {}, warn() {}, error() {}}, ethers: {}});
    vm.runInContext(noImports(read('contracts-integration.js')), context);
    vm.runInContext(read('src/config/upload-policy.js').replace(/^export /gm, '') + '\n' +
        noImports(read('src/entries/upload.js')).replace(/^\s*bindUploadFlow\(\);\s*$/m, ''), context);
    vm.runInContext("currentPublishStage = 'register';", context);
    return context;
}
const wrapped = error => ({code: 'UNKNOWN_ERROR', shortMessage: 'could not coalesce error',
    error, payload: {method: 'eth_sendTransaction', params: [{data: 'PRIVATE_CALLDATA'}]}});

test('nested wallet refusals and balance failures are not called a Base outage', () => {
    const context = load();
    for (const [error, expected] of [
        [{code: 4001, message: 'User rejected the request'}, 'USER_REJECTED'],
        [{code: -32603, data: {originalError: {message: 'insufficient funds for gas'}}}, 'INSUFFICIENT_FUNDS'],
        [{code: 'CORE_METHOD_RUNTIME_MISMATCH', message: 'The WalletConnect session cannot execute eth_sendTransaction.'}, 'WALLET_SESSION_REQUIRED'],
        [{code: 4100, message: 'Unauthorized account'}, 'WALLET_SESSION_REQUIRED'],
        [{code: 4901, message: 'Disconnected from requested chain'}, 'NETWORK_CHANGED']
    ]) assert.equal(context.mapPublishError(wrapped(error)).code, expected);
});

test('changed networks and explicit reverts take precedence over generic ethers wrappers', () => {
    const context = load();
    assert.equal(context.mapPublishError({code: 'NETWORK_ERROR', event: 'changed', message: 'network changed: 1 => 84532'}).code, 'NETWORK_CHANGED');
    assert.equal(context.mapPublishError({code: 'CALL_EXCEPTION', shortMessage: 'missing revert data',
        info: {error: {message: 'execution reverted: EnforcedPause'}}}).code, 'TRANSACTION_REVERTED');
});

test('an unknown wallet submission result never promises nothing was sent', () => {
    const context = load();
    const result = context.mapPublishError(wrapped({code: -32603, message: 'Internal JSON-RPC error.'}));
    assert.equal(result.code, 'WALLET_REQUEST_FAILED');
    assert.doesNotMatch(result.message, /nothing was sent|this is the network/i);
    assert.match(result.message, /wallet.*activity/i);
    assert.match(result.message, /eth_sendTransaction/);
    assert.match(result.message, /-32603/);
    assert.doesNotMatch(result.message, /PRIVATE_CALLDATA/);
    const timeout = context.mapPublishError({code: 'TIMEOUT', info: {payload: {method: 'eth_sendTransaction'}}});
    assert.equal(timeout.code, 'WALLET_REQUEST_FAILED');
});

test('recorded registration hashes keep their uncertain-confirmation recovery', () => {
    const context = load();
    vm.runInContext("submittedRegisterTxHash = '0x' + 'a'.repeat(64);", context);
    assert.equal(context.mapPublishError(wrapped({code: -32603})).code, 'REGISTRATION_UNCONFIRMED');
    for (const error of [{code: 'NETWORK_ERROR', message: 'network changed'}, wrapped({code: 4901}), wrapped({code: 4100})]) {
        assert.equal(context.mapPublishError(error).code, 'REGISTRATION_UNCONFIRMED');
    }
    const cleanup = read('src/entries/upload.js').split('if (pendingArtwork?.register_tx_hash')[1].split('removePendingArtwork')[0];
    assert.match(cleanup, /error\?\.receipt\?\.status === 0/, 'only a proven failed receipt can discard a broadcast registration');
});

test('nested diagnostics are bounded even with circular provider errors', () => {
    const context = load();
    const error = wrapped({code: 4001}); error.cause = error;
    assert.equal(context.mapPublishError(error).code, 'USER_REJECTED');
});

test('an auction failure never says its confirmed artwork was not published', () => {
    const context = load();
    vm.runInContext("currentPublishStage = 'auction'; submittedRegisterTxHash = '0x' + 'a'.repeat(64);", context);
    for (const error of [{code: 'NETWORK_ERROR'}, wrapped({code: 4001})]) {
        const result = context.mapPublishError(error);
        assert.notEqual(result.code, 'REGISTRATION_UNCONFIRMED');
        assert.match(result.message, /artwork is already registered/i);
        assert.doesNotMatch(result.message, /no artwork was published|nothing was published/i);
    }
});

async function loadPreparationFailure(failAt, failure) {
    const {prepareBrowserPublication} = await import('../src/features/artwork/publication-preparation.js');
    const context = load(), alerts = [], requests = [], saved = new Map();
    const wallet = '0x' + '11'.repeat(20), core = '0x' + 'aa'.repeat(20);
    const file = {name: 'artwork.png', type: 'image/png', size: 3}, hash = 'ab'.repeat(32);
    let hashReads = 0;
    const dependencies = {
        storage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)},
        locks: {request: (_key, _options, run) => run()},
        randomUUID: () => '11111111-1111-4111-8111-111111111111',
        createMetadata: value => ({...value, name: value.title}),
        upload: async () => {},
        async request(body, owner) {
            requests.push(body.action);
            assert.equal(owner, wallet);
            if (body.action === failAt) throw failure;
            if (body.action === 'config') return {success: true, enabled: true, chain_id: 84532,
                core_address: core, can_submit: false};
            if (body.action === 'issue') return {publication_id: body.publication_id, chain_id: 84532,
                core_address: core, can_submit: false, upload: {
                    path: 'uploads/artwork.png', public_url: 'https://storage.example/artwork.png'}};
            assert.fail(`Unexpected publication action: ${body.action}`);
        }
    };
    Object.assign(context, {
        fileFixture: file, walletFixture: wallet, alert: message => alerts.push(message),
        document: {getElementById: id => id === 'originalWorkConfirm' ? {checked: true} : {innerHTML: 'Publish'}},
        getUploadFormValues: () => ({title: 'Artwork', description: 'Original artwork.', price: '0.001'}),
        validateArtworkFile: () => null, validateArtworkDetails: () => null,
        updatePublishReadiness: () => true, clearBlockingStep() {}, getAIValuationFormKey: () => 'ready',
        setTransactionButtonProcessing() {}, restoreTransactionButton() {},
        prepareBrowserPublication: args => prepareBrowserPublication(args, dependencies)
    });
    Object.assign(context.window, {
        getCurrentWalletAddress: () => wallet, getCurrentChainId: () => 84532,
        SupabaseAuth: {isAuthenticatedForWallet: async () => true},
        IPFSClient: {generateFileHash: async () => {
            hashReads++;
            if (failAt === 'fingerprint') throw failure;
            return hash;
        }},
        ArtSoulContracts: {init() {assert.fail('Preparation failure must not initialize a wallet');},
            uploadArtwork() {assert.fail('Preparation failure must not register an artwork');}}
    });
    vm.runInContext("selectedFile = fileFixture; selectedAuctionDuration = 24; latestAIValuation = {estimate: 1}; " +
        "latestAIValuationFormKey = 'ready'; authorizedWalletAddress = walletFixture;", context);
    await context.handleUpload();
    return {alerts, requests, saved, hashReads};
}

for (const step of ['config', 'issue', 'prepare']) {
    test(`an interrupted ${step} request after hashing is not a file-read failure`, async () => {
        for (const failure of [new TypeError('Failed to fetch'), new DOMException('Request aborted', 'AbortError')]) {
            const result = await loadPreparationFailure(step, failure);
            assert.equal(result.hashReads, 1);
            assert.deepEqual(result.requests, ['config', 'issue', 'prepare'].slice(0, ['config', 'issue', 'prepare'].indexOf(step) + 1));
            assert.equal(result.alerts.length, 1);
            assert.match(result.alerts[0], /Artwork preparation was interrupted/);
            assert.match(result.alerts[0], /Check publication/);
            assert.doesNotMatch(result.alerts[0], /file could not be read|Choose the file again|nothing was sent/);
            assert.equal(result.saved.size, step === 'config' ? 0 : 1, 'existing preparation is not discarded');
        }
    });
}

test('a genuine fingerprint read rejection retains its file-read explanation', async () => {
    const result = await loadPreparationFailure('fingerprint', new DOMException('File unavailable', 'NotReadableError'));
    assert.equal(result.hashReads, 1);
    assert.deepEqual(result.requests, []);
    assert.equal(result.saved.size, 0);
    assert.equal(result.alerts.length, 1);
    assert.match(result.alerts[0], /selected file could not be read/);
    assert.doesNotMatch(result.alerts[0], /preparation was interrupted/);
});

test('a retained publication attempt overrides preparation and nested wallet failures', () => {
    const context = load();
    vm.runInContext("currentPublishStage = 'publication_preparation';", context);
    for (const cause of [new TypeError('Failed to fetch'), {code: 4001}, {code: 'NETWORK_ERROR'}]) {
        const mapped = context.mapPublishError({code: 'PUBLICATION_ATTEMPT_PENDING', cause});
        assert.equal(mapped.code, 'PUBLICATION_ATTEMPT_PENDING');
        assert.match(mapped.message, /do not publish the file again/);
        assert.doesNotMatch(mapped.message, /file could not be read|preparation was interrupted|No artwork was published/);
    }
});
