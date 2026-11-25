import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, ZeroAddress, getAddress, getCreateAddress, keccak256, toBeHex } from 'ethers';
import { buildRehearsalRequests, prepareRehearsalSafes } from '../scripts/prepare-rehearsal-safes.mjs';
import { buildRehearsalCoreReview, readUnusedCoreNonce } from '../scripts/prepare-rehearsal-core.mjs';
import { prepareOrdinaryDeployment } from '../scripts/prepare-ordinary-deployment.mjs';

const addr = n => getAddress(toBeHex(n, 20));
const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const owners = [addr(20), addr(21), addr(22)];
const payer = addr(30);
const adminSafe = addr(12);
const custody = { chainId: 84532, ...Object.fromEntries(roles.map((key, i) =>
    [key, { address: addr(10 + i), threshold: 2, owners }])) };
const artifact = {
    contractName: 'OrdinaryMarket', sourceName: 'contracts/replacement/OrdinaryMarket.sol',
    abi: ['constructor(address,address,address,uint256,uint256)'], bytecode: '0x6001', deployedBytecode: '0x6002'
};
const manifest = { contracts: { [artifact.sourceName + ':' + artifact.contractName]: {
    creation: { keccak256: keccak256(artifact.bytecode) }, runtimeTemplate: { keccak256: keccak256(artifact.deployedBytecode) }
} } };

test('Base Sepolia rehearsal checks release code and independent payer before emitting a request', async () => {
    const args = { adminSafe, payer, owners, proxyCreationCode: '0x6000' };
    for (const invalid of [
        { owners: owners.slice(0, 2) }, { owners: [owners[0], owners[0], owners[1]] },
        { payer: owners[0] }, { payer: adminSafe }, { owners: [ZeroAddress, ...owners.slice(1)] }
    ]) {
        assert.throws(() => buildRehearsalRequests({ ...args, ...invalid }), /three distinct/);
    }
    assert.throws(() => buildRehearsalRequests(args), /proxy creation code/);
    const wrongChain = async () => '0x2105';
    await assert.rejects(prepareRehearsalSafes({ adminSafe, payer, providers: [wrongChain, async () => '0x2105'] }), /Wrong RPC chain/);
    await assert.rejects(prepareRehearsalSafes({ adminSafe, payer, providers: [wrongChain, wrongChain] }), /independent/);
});

test('independent rehearsal constructor encoding matches the release request and keeps test-only settings', () => {
    const review = buildRehearsalCoreReview(artifact, manifest, custody, payer, 7);
    const plan = prepareOrdinaryDeployment(artifact, review, custody);
    const suffix = new Interface(artifact.abi).encodeDeploy([...roles.map(role => custody[role].address), 8, 30_000]);
    assert.equal(plan.transaction.data, artifact.bytecode + suffix.slice(2));
    assert.equal(review.expectedCore, getCreateAddress({ from: payer, nonce: 7 }));
    assert.equal(plan.transaction.chainId, '0x14a34');
    assert.throws(() => buildRehearsalCoreReview(artifact, manifest, { ...custody, chainId: 8453 }, payer, 7), /Base Sepolia/);
    assert.throws(() => buildRehearsalCoreReview({ ...artifact, bytecode: '0x6003' }, manifest, custody, payer, 7), /C12/);
    assert.throws(() => buildRehearsalCoreReview({ ...artifact, deployedBytecode: '0x6003' }, manifest, custody, payer, 7), /C12/);
});

function nonceProvider({ latest = '0x10', pending = latest, code = '0x', occupied = false } = {}) {
    return async (method, [address, tag]) => {
        if (method === 'eth_getCode') return code;
        assert.equal(method, 'eth_getTransactionCount');
        if (address === payer) return tag === 'pending' ? pending : latest;
        assert.equal(tag, 'pending');
        return occupied ? '0x01' : '0x00';
    };
}

test('nonce review requires agreement, no outstanding transaction and two unused contract addresses', async () => {
    assert.equal(await readUnusedCoreNonce(payer, [nonceProvider(), nonceProvider()]), 16);
    for (const [change, expected] of [
        [{ pending: '0x11' }, /pending transaction/], [{ latest: '0x11' }, /disagree/],
        [{ code: '0x60' }, /contains code/], [{ occupied: true }, /has a nonce/]
    ]) {
        await assert.rejects(readUnusedCoreNonce(payer, [nonceProvider(), nonceProvider(change)]), expected);
    }
});
