import assert from 'node:assert/strict';
import test from 'node:test';
import { id, keccak256, toQuantity } from 'ethers';
import { prepareGenesisGrants } from '../scripts/prepare-genesis-grants.mjs';
import { verifyGenesisGrants } from '../scripts/verify-genesis-grants.mjs';

import { review, tx, block, head, founder, mainnetCollector, receipt, provider } from './helpers/genesis-grant-rpc.mjs';

test('two providers confirm only the reviewed Genesis serials including founder zero, preserving all three log positions', async () => {
    const result = await verifyGenesisGrants(review, tx, [provider(), provider()]);
    assert.deepEqual(result.block, { number: block.number, hash: block.hash });
    assert.equal(result.transactionIndex, '1');
    assert.deepEqual(result.grants.map(g => [g.tokenId, g.recipient, g.mintIndex, g.lockIndex, g.grantIndex]),
        [[0, founder, '8', '10', '11'], [201, mainnetCollector, '12', '14', '15']]);
    assert.deepEqual(result.grants.map(g => g.decisionHash), prepareGenesisGrants(review).grants.map(g => g.decisionHash));
});

test('retains the reviewed issuer and decision binding when the input changes during RPC reads', async () => {
    const document = structuredClone(review);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const delayed = rpc => async (...args) => { await gate; return rpc(...args); };
    const result = verifyGenesisGrants(document, tx, [delayed(provider()), delayed(provider())]);
    document.genesisCodeHash = id('changed runtime');
    document.policyHash = id('changed policy');
    document.founder = mainnetCollector;
    document.grants[1].recipient = founder;
    release();
    const proof = await result;
    assert.equal(proof.founder, founder);
    assert.equal(proof.genesisCodeHash, review.genesisCodeHash);
    assert.equal(proof.policyHash, review.policyHash);
    assert.equal(proof.calldataHash, keccak256(prepareGenesisGrants(review).transaction.data));
    assert.equal(proof.grants[1].recipient, mainnetCollector);
});

test('rejects a wrong chain, deployment, Safe, runtime or policy even for an internally consistent receipt', async () => {
    const two = [provider(), provider()];
    await assert.rejects(verifyGenesisGrants({ ...review, chainId: 84532 }, tx, two), /mainnet/);
    await assert.rejects(verifyGenesisGrants({ ...review, policyHash: id('other policy') }, tx, two), /GenesisGranted/);
    await assert.rejects(verifyGenesisGrants(review, tx, [two[0], two[0]]), /independent/);
    for (const overrides of [{ chain: '0x14a34' }, { code: '0x62' }, { safe: founder }]) {
        await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider(overrides)]));
    }
    const wrongIssuer = receipt();
    wrongIssuer.logs.forEach(log => { log.address = mainnetCollector; });
    await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider({receipt: wrongIssuer})]), /Genesis events/);
});

test('rejects missing, reordered, removed, duplicated or incorrect mint, lock and grant evidence', async () => {
    for (const edit of [
        logs => logs.splice(2, 1), logs => logs.push(logs[0]), logs => logs.reverse(),
        logs => { logs[2].removed = true; }, logs => { logs[2].logIndex = logs[0].logIndex; },
        logs => { logs[2].transactionHash = id('another tx'); }, logs => { logs[2].blockHash = head.hash; },
        logs => { logs[0].topics[3] = logs[4].topics[3]; }, logs => { logs[2].data = logs[6].data; },
        logs => { logs[3].topics[2] = logs[7].topics[2]; }, logs => { logs[3].topics[3] = logs[7].topics[3]; },
        logs => { logs[7].topics[1] = logs[3].topics[1]; }, logs => { logs[7].data = id('other decision'); }
    ]) {
        const record = receipt();
        edit(record.logs);
        await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider({ receipt: record })]));
    }
});

test('requires finalized inclusion, stable canonical hash on both reads, and agreement on the exact receipt positions', async () => {
    const changed = receipt();
    for (const log of changed.logs) log.logIndex = toQuantity(BigInt(log.logIndex) + 1n);
    for (const overrides of [{ head: { ...head, number: '0x1f' } }, { reorg: true },
        { header: { ...block, transactions: [...block.transactions].reverse() } }, { receipt: { ...receipt(), status: '0x0' } },
        { receipt: changed }]) {
        await assert.rejects(verifyGenesisGrants(review, tx, [provider(), provider(overrides)]));
    }
});
