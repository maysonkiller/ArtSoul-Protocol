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
