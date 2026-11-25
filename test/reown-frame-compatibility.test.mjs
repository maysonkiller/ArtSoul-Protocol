import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import config from '../vite.config.js';

test('the bundled Reown frame handles wallet responses with patched Zod', async () => {
    const resolve = createRequire(import.meta.url).resolve;
    const entry = path.resolve(path.dirname(resolve('@reown/appkit-wallet')), '../src/W3mFrameSchema.js');
    assert.equal(createRequire(entry)('zod/package.json').version, '4.6.7');
    const compatibility = config.plugins.find(p => p.name === 'artsoul-reown-frame-schema');
    assert.ok(compatibility);
    assert.ok(config.optimizeDeps.rolldownOptions.plugins.some(p => p.name === compatibility.name));
    const bundle = await build({
        configFile: false, logLevel: 'silent', plugins: [compatibility],
        build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'wallet-schema' } }
    });
    const [chunk] = bundle[0].output.filter(output => output.type === 'chunk' && output.isEntry);
    const { W3mFrameSchema } = await import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
    function check(direction, type, payload, accepted) {
        const app = direction === 'app';
        const message = { id: '1', type: '@w3m-' + direction + '/' + type, ...payload };
        const result = W3mFrameSchema[app ? 'appEvent' : 'frameEvent'].safeParse(message);
        assert.equal(result.success, accepted, type);
        if (accepted) assert.deepEqual(result.data, message);
    }

    for (const payload of [{}, { payload: undefined }, { payload: null }, { payload: '0x14a34' }, { payload: [] }]) {
        check('frame', 'RPC_REQUEST_SUCCESS', payload, true);
    }
    check('frame', 'RPC_REQUEST_ERROR', { payload: { message: 'User cancelled' } }, true);
    check('frame', 'RPC_REQUEST_ERROR', {}, false);
    check('frame', 'GET_USER_SUCCESS', {}, false);
    const address = '0x0000000000000000000000000000000000000001';
    check('frame', 'GET_USER_SUCCESS', {
        payload: { address, chainId: 84532, accounts: [{ address, type: 'eoa' }, { address, type: 'smartAccount' }] }
    }, true);
    check('frame', 'IS_CONNECTED_SUCCESS', { payload: { isConnected: true } }, true);
    check('frame', 'IS_CONNECTED_SUCCESS', { payload: { isConnected: 'true' } }, false);
    check('app', 'SWITCH_NETWORK', { payload: { chainId: 84532 } }, true);
    check('app', 'RPC_REQUEST', { payload: { method: 'eth_chainId', chainNamespace: 'eip155' } }, true);
    check('app', 'RPC_REQUEST', { payload: { method: 'eth_getBalance', params: ['0x1', 'latest'] } }, true);
    check('app', 'RPC_REQUEST', { payload: { method: 'personal_sign', params: ['Message', address] } }, true);
    check('app', 'RPC_REQUEST', {
        payload: { method: 'wallet_sendCalls', params: [{ chainId: '0x14a34', from: address,
            calls: [{ to: address, data: '0x', value: '0x0' }] }] }
    }, true);
    check('app', 'UNKNOWN_METHOD', { payload: {} }, false);
    check('app', 'CONNECT_EMAIL', { payload: { email: 'a.b+test@example.org' } }, true);
    check('app', 'CONNECT_EMAIL', { payload: { email: "o'brien@example.org" } }, false);
    check('app', 'CONNECT_EMAIL', { payload: { email: 'invalid' } }, false);
    check('app', 'SYNC_THEME', { payload: { themeMode: 'dark', themeVariables: { size: 12 } } }, true);
    check('app', 'SYNC_THEME', { payload: { themeMode: 'invalid' } }, false);
});
