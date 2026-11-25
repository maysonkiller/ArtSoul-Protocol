// Prepare the nonce-bound Base Sepolia Core review after both treasury Safe creations finalize.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AbiCoder, concat, getAddress, getBytes, getCreateAddress, keccak256, toBeHex } from 'ethers';
import { buildOrdinaryAuditManifest } from './ordinary-audit-manifest.cjs';
import { prepareOrdinaryDeployment } from './prepare-ordinary-deployment.mjs';
import { prepareRehearsalSafes } from './prepare-rehearsal-safes.mjs';
import { readRpc } from './verify-treasury-safes.mjs';

const qualified = 'contracts/replacement/OrdinaryMarket.sol:OrdinaryMarket';
const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const rehearsalLimits = [8, 30_000];
const load = async file => JSON.parse((await readFile(file, 'utf8')).trimStart());

export function buildRehearsalCoreReview(artifact, manifest, custody, payer, nonce) {
    assert.equal(custody.chainId, 84532, 'Select the Base Sepolia rehearsal register');
    const record = manifest.contracts[qualified];
    assert.equal(keccak256(artifact.bytecode), record.creation.keccak256, 'Core creation bytecode differs from C12');
    assert.equal(keccak256(artifact.deployedBytecode), record.runtimeTemplate.keccak256, 'Core runtime template differs from C12');
    const args = AbiCoder.defaultAbiCoder().encode(['address', 'address', 'address', 'uint256', 'uint256'],
        [...roles.map(role => custody[role].address), ...rehearsalLimits]);
    const expectedCore = getCreateAddress({ from: payer, nonce });
    const review = {
        contract: qualified, chainId: 84532, payer: getAddress(payer), nonce, expectedCore,
        expectedNFT: getCreateAddress({ from: expectedCore, nonce: 1 }),
        constructorArgs: [...roles.map(role => '$' + role), ...rehearsalLimits],
        initCodeHash: keccak256(concat([artifact.bytecode, args]))
    };
    // Independently encode through the artifact ABI and apply the release constraints.
    prepareOrdinaryDeployment(artifact, review, custody);
    return review;
}

export function expectedRehearsalPairRegister(custody, review, manifest, layout, coreArtifact, nftArtifact) {
    assert.deepEqual(review, buildRehearsalCoreReview(coreArtifact, manifest, custody, review.payer, review.nonce),
        'Core review differs from the independently encoded test deployment');
    const values = {
        ...Object.fromEntries(roles.map(role => [role, custody[role].address])),
        core: review.expectedCore, nft: review.expectedNFT, refundBatchLimit: rehearsalLimits[0], refundTransferGas: rehearsalLimits[1]
    };
    function boundRuntime(artifact) {
        const key = artifact.sourceName + ':' + artifact.contractName;
        const record = manifest.contracts[key];
        assert.equal(keccak256(artifact.deployedBytecode), record.runtimeTemplate.keccak256, 'C12 runtime template mismatch');
        const code = getBytes(artifact.deployedBytecode);
        const offsets = [];
        for (const entry of layout.contracts[key].immutables) {
            assert(Object.hasOwn(values, entry.name), 'Unknown immutable ' + entry.name);
            const replacement = getBytes(toBeHex(values[entry.name], 32));
            for (const { start, length } of entry.bytecodeReferences) {
                assert(length === 32 && start >= 0 && start + length <= code.length, 'Invalid immutable offset');
                assert(code.subarray(start, start + length).every(byte => byte === 0), 'Expected an unbound immutable');
                code.set(replacement, start);
                offsets.push({ length, start });
            }
        }
        assert.deepEqual(offsets.sort((a, b) => a.start - b.start), record.immutableOffsets, 'C12 immutable references differ');
        return keccak256(code);
    }
    return {
        ...custody,
        core: { address: review.expectedCore, codeHash: boundRuntime(coreArtifact),
            refundBatchLimit: rehearsalLimits[0], refundTransferGas: rehearsalLimits[1] },
        nft: { address: review.expectedNFT, codeHash: boundRuntime(nftArtifact) }
    };
}

export async function readUnusedCoreNonce(payer, providers) {
    assert(providers.length === 2 && providers[0] !== providers[1], 'Use two independent providers');
    const nonces = await Promise.all(providers.map(async rpc => {
        const [pending, latest] = await Promise.all(['pending', 'latest'].map(tag => rpc('eth_getTransactionCount', [payer, tag])));
        assert.equal(BigInt(pending), BigInt(latest), 'The payer has a pending transaction');
        return BigInt(pending);
    }));
    assert.equal(nonces[0], nonces[1], 'RPC providers disagree on the payer nonce');
    assert(nonces[0] >= 0n && nonces[0] <= BigInt(Number.MAX_SAFE_INTEGER), 'Invalid payer nonce');
    const nonce = Number(nonces[0]);
    const core = getCreateAddress({ from: payer, nonce });
    const nft = getCreateAddress({ from: core, nonce: 1 });
    for (const rpc of providers) {
        for (const address of [core, nft]) {
            assert.equal(await rpc('eth_getCode', [address, 'pending']), '0x', 'Predicted address already contains code');
            assert.equal(BigInt(await rpc('eth_getTransactionCount', [address, 'pending'])), 0n, 'Predicted address already has a nonce');
        }
    }
    return nonce;
}

export async function prepareRehearsalCore(savedPlan) {
    const manifest = await load(new URL('../docs/security/C12_ORDINARY_AUDIT_MANIFEST.json', import.meta.url));
    assert.deepEqual(buildOrdinaryAuditManifest(), manifest, 'C12 source, compiler or artifact verification failed');
    const artifact = await load(new URL('../artifacts/contracts/replacement/OrdinaryMarket.sol/OrdinaryMarket.json', import.meta.url));
    const providers = [readRpc('https://sepolia.base.org'), readRpc('https://base-sepolia-rpc.publicnode.com')];
    const { payer, custody } = savedPlan;
    const verified = await prepareRehearsalSafes({ adminSafe: custody.adminSecurity.address, payer, providers });
    assert.deepEqual(verified.custody, custody, 'Reviewed treasury addresses or owner sets have changed');
    assert.equal(verified.roleRequests.length, 0, 'Both verified treasury Safe proxies must be finalized before preparing the Core review');
    const nonce = await readUnusedCoreNonce(payer, providers);
    return buildRehearsalCoreReview(artifact, manifest, custody, payer, nonce);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [, , planFile, option, reviewFile] = process.argv;
        assert(process.argv.length === 3 || (process.argv.length === 5 && option === '--register'),
            'Usage: node scripts/prepare-rehearsal-core.mjs <approved-test-safe-plan.json> [--register <approved-core-review.json>]');
        const saved = await load(planFile);
        if (option === '--register') {
            const manifest = await load(new URL('../docs/security/C12_ORDINARY_AUDIT_MANIFEST.json', import.meta.url));
            assert.deepEqual(buildOrdinaryAuditManifest(), manifest, 'C12 manifest verification failed');
            const layout = await load(new URL('../docs/architecture/C1_ORDINARY_PAIR_STORAGE_2026-11-20.json', import.meta.url));
            const [core, nft] = await Promise.all(['OrdinaryMarket', 'SettledArtworkNFT'].map(name =>
                load(new URL('../artifacts/contracts/replacement/' + name + '.sol/' + name + '.json', import.meta.url))));
            const review = await load(reviewFile);
            assert.equal(getAddress(saved.payer), getAddress(review.payer), 'Unexpected deployment payer');
            console.log(JSON.stringify(expectedRehearsalPairRegister(saved.custody, review, manifest, layout, core, nft), null, 2));
        } else {
            console.log(JSON.stringify(await prepareRehearsalCore(saved), null, 2));
        }
    } catch (error) {
        console.error('Core rehearsal preparation stopped:', error.shortMessage ?? error.message.split('\n')[0]);
        process.exitCode = 1;
    }
}
