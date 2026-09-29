import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Wallet } from 'ethers';
import { validateImport } from '../scripts/testnet-wallets.mjs';

// Deterministic public test vectors; never funded or used by the application.
const key = '0x' + '01'.padStart(64, '0');
const other = new Wallet('0x' + '02'.padStart(64, '0')).address;
const address = new Wallet(key).address;
const policy = { version: 1, chainId: 84532, excludedAddresses: [other] };

test('a matching individual test key returns only public metadata', () => {
    assert.deepEqual(validateImport(key, address, policy), { address, chainId: 84532 });
    assert.deepEqual(validateImport(key.slice(2), address.toLowerCase(), policy), { address, chainId: 84532 });
});

test('protected addresses, wrong keys and non-testnet policy fail closed', () => {
    assert.throws(() => validateImport(key, address, { ...policy, excludedAddresses: [address] }), /PROTECTED_ADDRESS/);
    assert.throws(() => validateImport(key, other, policy), /KEY_ADDRESS_MISMATCH/);
    for (const chainId of [8453, 11155111, '84532', null]) {
        assert.throws(() => validateImport(key, address, { ...policy, chainId }), /INVALID_TESTNET_POLICY/);
    }
    assert.throws(() => validateImport(key, address, { ...policy, excludedAddresses: [] }), /INVALID_TESTNET_POLICY/);
});

test('seed phrases and invalid key scalars are not accepted', () => {
    assert.throws(() => validateImport('not a private key or seed phrase', address, policy), /INVALID_PRIVATE_KEY_FORMAT/);
    assert.throws(() => validateImport('0x' + '0'.repeat(64), address, policy), /INVALID_KEY_OR_ADDRESS/);
    assert.throws(() => validateImport('0x' + 'f'.repeat(64), address, policy), /INVALID_KEY_OR_ADDRESS/);
});

test('the process boundary sanitizes failures instead of leaking submitted secrets', () => {
    const marker = 'DO_NOT_EXPOSE_THIS_SECRET';
    const run = spawnSync(process.execPath, ['scripts/testnet-wallets.mjs', 'validate-import'], {
        input: JSON.stringify({ privateKey: marker, expectedAddress: address, policy }), encoding: 'utf8'
    });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, 'TESTNET_WALLET_VALIDATION_FAILED\n');
    assert.ok(!(run.stdout + run.stderr).includes(marker));
});

test('the helper does not offer a signing or broadcast command', () => {
    const run = spawnSync(process.execPath, ['scripts/testnet-wallets.mjs', 'send-transaction'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, 'TESTNET_WALLET_VALIDATION_FAILED\n');
});

test('the validator accepts a UTF-8 BOM without relaxing account validation', () => {
    for (const expectedAddress of [address, other]) {
        const run = spawnSync(process.execPath, ['scripts/testnet-wallets.mjs', 'validate-import'], {
            input: '\uFEFF' + JSON.stringify({ privateKey: key, expectedAddress, policy }), encoding: 'utf8'
        });
        assert.equal(run.status, expectedAddress === address ? 0 : 1);
        if (expectedAddress === address) assert.deepEqual(JSON.parse(run.stdout), { address, chainId: 84532 });
        else assert.equal(run.stderr, 'TESTNET_WALLET_VALIDATION_FAILED\n');
        assert.ok(!(run.stdout + run.stderr).includes(key));
    }
});

test('Windows DPAPI roundtrips without printing stored material', { skip: process.platform !== 'win32' }, () => {
    const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File',
        'scripts/testnet-wallets.ps1', '-Action', 'SelfTest'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(run.status, 0, run.stdout || 'DPAPI self-test must succeed');
    assert.equal(run.stdout.trim(), 'DPAPI_SELF_TEST_PASSED');
    assert.equal(run.stderr, '');
});

test('Windows JSON custody pipe is independent of a BOM-emitting console encoding', { skip: process.platform !== 'win32' }, () => {
    const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-Command', '-'], {
        input: '[Console]::InputEncoding = [Text.UTF8Encoding]::new($true)\n& ./scripts/testnet-wallets.ps1 -Action SelfTest\n',
        encoding: 'utf8', timeout: 20000
    });
    assert.equal(run.status, 0, run.stdout || 'UTF-8 console self-test must succeed');
    assert.equal(run.stdout.trim(), 'DPAPI_SELF_TEST_PASSED');
    assert.equal(run.stderr, '');
});
