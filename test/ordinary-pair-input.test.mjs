import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { ZeroAddress, ZeroHash } from 'ethers';
import { readReviewedOrdinaryPair } from '../scripts/read-reviewed-ordinary-pair.mjs';

test('the custody register and compact intake file identify the same reviewed pair', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'artsoul-pair-'));
    const file = join(dir, 'pair.json');
    t.after(async () => { await unlink(file); await rmdir(dir); });
    const read = async record => {
        await writeFile(file, JSON.stringify(record));
        return readReviewedOrdinaryPair(file);
    };
    const compact = { chainId: 84532, coreAddress: '0x' + '11'.repeat(20), nftAddress: '0x' + '22'.repeat(20),
        expectedCoreCodeHash: '0x' + 'ab'.repeat(32), expectedNftCodeHash: '0x' + 'cd'.repeat(32) };
    const register = { chainId: compact.chainId, adminSecurity: { owners: ['private-fixture'] },
        core: { address: compact.coreAddress, codeHash: compact.expectedCoreCodeHash, refundBatchLimit: 8 },
        nft: { address: compact.nftAddress, codeHash: compact.expectedNftCodeHash } };
    assert.deepEqual(await read(compact), compact);
    assert.deepEqual(await read(register), compact);
    assert.deepEqual(await read({ ...register, chainId: 8453 }), { ...compact, chainId: 8453 });
    for (const invalid of [
        null, { ...register, chainId: 1 }, { ...register, nft: null },
        { ...register, core: { ...register.core, codeHash: ZeroHash } },
        { ...register, nft: { ...register.nft, codeHash: '0x1234' } },
        { ...compact, coreAddress: ZeroAddress }, { ...compact, nftAddress: compact.coreAddress }
    ]) await assert.rejects(read(invalid), /Invalid ordinary pair/);

    await assert.rejects(read({ ...register, coreAddress: compact.nftAddress }), /Ambiguous ordinary pair/);
    for (const args of [
        ['scripts/index-ordinary-settlement.mjs', file, 'unused-receipt.json'],
        ['scripts/read-ordinary-runner-up.mjs', file, '1', '1', compact.expectedCoreCodeHash],
        ['scripts/check-ordinary-token.mjs', file, '1', '1', compact.expectedCoreCodeHash]
    ]) {
        await assert.rejects(promisify(execFile)(process.execPath, args, { windowsHide: true, timeout: 10_000,
            env: { ...process.env, ARTSOUL_ORDINARY_RPC_URL: 'http://127.0.0.1:1', ARTSOUL_ORDINARY_DATABASE_URL: 'unused' } }),
        error => error.code === 1 && error.stderr.includes('Ambiguous ordinary pair') && !error.stderr.includes('private-fixture'));
    }

    // Validate the launch register before contacting the candidate site or its database.
    const cutover = (core, ...args) => promisify(execFile)(process.execPath, [
        'scripts/verify-mainnet-catalog.mjs', 'http://127.0.0.1:1', core, '160', '--database', ...args
    ], { windowsHide: true, timeout: 10_000, env: { ...process.env, ARTSOUL_CUTOVER_DATABASE_URL: '' } });
    await assert.rejects(cutover(compact.coreAddress), error => error.stderr.includes('Usage:'));
    await read(register);
    await assert.rejects(cutover(compact.coreAddress, file), error => error.stderr.includes('supplied Base mainnet Core'));
    await read({ ...register, chainId: 8453 });
    await assert.rejects(cutover(compact.nftAddress, file), error => error.stderr.includes('supplied Base mainnet Core'));
    await assert.rejects(cutover(compact.coreAddress, file), error => error.stderr.includes('Supply ARTSOUL_CUTOVER_DATABASE_URL'));
    await writeFile(file, 'private-fixture');
    await assert.rejects(cutover(compact.coreAddress, file), error =>
        error.stderr.includes('Could not read the reviewed pair') && !error.stderr.includes('private-fixture'));
});
