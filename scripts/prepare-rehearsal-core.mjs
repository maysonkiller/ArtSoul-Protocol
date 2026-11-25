// Prepare the nonce-bound Base Sepolia Core review after both treasury Safe creations finalize.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AbiCoder, concat, getAddress, getBytes, getCreateAddress, isHexString, keccak256, toBeHex, toQuantity } from 'ethers';
import { buildOrdinaryAuditManifest } from './ordinary-audit-manifest.cjs';
import { historicalCore, payoutCore, prepareOrdinaryDeployment } from './prepare-ordinary-deployment.mjs';
import { prepareRehearsalSafes } from './prepare-rehearsal-safes.mjs';
import { readRpc, requireIndependentProviders, verifyTreasurySafesWithTwoProviders } from './verify-treasury-safes.mjs';

const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const rehearsalLimits = [8, 30_000];
const load = async file => JSON.parse((await readFile(file, 'utf8')).trimStart());
const defaultProviders = () => [readRpc('https://sepolia.base.org'), readRpc('https://base-sepolia-rpc.publicnode.com')];

export function buildRehearsalCoreReview(artifact, manifest, custody, payer, nonce) {
    assert.equal(custody.chainId, 84532, 'Select the Base Sepolia rehearsal register');
    const qualified = artifact.sourceName + ':' + artifact.contractName;
    assert([historicalCore, payoutCore].includes(qualified), 'Unknown Core artifact');
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
    requireIndependentProviders(providers);
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

export async function verifyRehearsalCoreReceipt(txHash, review, register, providers = defaultProviders()) {
    assert(isHexString(txHash, 32), 'Expected a public deployment transaction hash');
    assert.equal(register.chainId, 84532, 'Expected a Base Sepolia register');
    assert.equal(review.chainId, register.chainId, 'Review chain differs from register');
    assert.equal(getAddress(review.expectedCore), getAddress(register.core.address), 'Unexpected Core in register');
    assert.equal(getAddress(review.expectedNFT), getAddress(register.nft.address), 'Unexpected NFT in register');
    requireIndependentProviders(providers);
    txHash = txHash.toLowerCase();
    const readReceipt = async rpc => {
        const [tx, receipt] = await Promise.all([
            rpc('eth_getTransactionByHash', [txHash]), rpc('eth_getTransactionReceipt', [txHash])
        ]);
        assert(tx && receipt, 'Deployment transaction or receipt is unavailable');
        assert.equal(tx.hash?.toLowerCase(), txHash, 'Unexpected transaction hash');
        assert.equal(receipt.transactionHash?.toLowerCase(), txHash, 'Unexpected receipt hash');
        assert.equal(tx.chainId, toQuantity(review.chainId), 'Transaction is on the wrong chain');
        assert.equal(getAddress(tx.from), getAddress(review.payer), 'Unexpected deployment payer');
        assert.equal(getAddress(receipt.from), getAddress(review.payer), 'Unexpected receipt payer');
        assert(tx.to === null && receipt.to === null, 'Expected direct contract creation');
        assert.equal(tx.nonce, toQuantity(review.nonce), 'Unexpected deployment nonce');
        assert.equal(tx.value, '0x0', 'Expected zero deployment value');
        assert.equal(keccak256(tx.input), review.initCodeHash, 'Unexpected creation bytecode or constructor arguments');
        assert.equal(receipt.status, '0x1', 'Deployment transaction failed');
        assert.equal(getAddress(receipt.contractAddress), getAddress(review.expectedCore), 'Receipt has the wrong Core address');
        assert(isHexString(receipt.blockHash, 32) && /^0x[0-9a-f]+$/i.test(receipt.blockNumber), 'Invalid receipt block');
        assert(tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber, 'Transaction and receipt blocks differ');
        assert(/^0x[0-9a-f]+$/i.test(receipt.transactionIndex) && tx.transactionIndex === receipt.transactionIndex,
            'Transaction and receipt indices differ');
        const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
        assert(block?.hash === receipt.blockHash && block.number === receipt.blockNumber &&
            block.transactions?.[Number(BigInt(receipt.transactionIndex))]?.toLowerCase() === txHash,
            'Deployment transaction is absent at its canonical block position');
        return { number: receipt.blockNumber, hash: receipt.blockHash, transactionIndex: receipt.transactionIndex };
    };
    const [first, second] = await Promise.all(providers.map(readReceipt));
    assert.deepEqual(first, second, 'Providers disagree on deployment inclusion');
    const block = { number: first.number, hash: first.hash };
    const state = await verifyTreasurySafesWithTwoProviders(register, providers[0], providers[1], { requirePair: true, expectedBlock: block });
    return { ...state, txHash, transactionIndex: first.transactionIndex, payer: review.payer, nonce: review.nonce,
        initCodeHash: review.initCodeHash, core: register.core.address, nft: register.nft.address, rpcReadings: 2 };
}

export async function loadReviewedPair(qualified) {
    assert([historicalCore, payoutCore].includes(qualified), 'Unrecognized reviewed Core');
    const payout = qualified === payoutCore;
    const [source, name] = qualified.split(':');
    const [core, nft, layout, manifest] = await Promise.all([
        load(new URL(`../artifacts/${source}/${name}.json`, import.meta.url)),
        load(new URL('../artifacts/contracts/replacement/SettledArtworkNFT.sol/SettledArtworkNFT.json', import.meta.url)),
        load(new URL('../docs/architecture/' + (payout ? 'C1_ORDINARY_PAYOUT_STORAGE.json' : 'C1_ORDINARY_PAIR_STORAGE_2026-11-20.json'), import.meta.url)),
        load(new URL('../docs/security/' + (payout ? 'C12_ORDINARY_PAYOUT_MANIFEST.json' : 'C12_ORDINARY_AUDIT_MANIFEST.json'), import.meta.url))
    ]);
    return { core, nft, layout, manifest };
}

export async function prepareRehearsalCore(savedPlan, qualified = historicalCore) {
    const { core, manifest } = await loadReviewedPair(qualified);
    assert.deepEqual(buildOrdinaryAuditManifest(undefined, core.contractName), manifest, 'C12 source, compiler or artifact verification failed');
    const providers = defaultProviders();
    const { payer, custody } = savedPlan;
    const verified = await prepareRehearsalSafes({ adminSafe: custody.adminSecurity.address, payer, providers });
    assert.deepEqual(verified.custody, custody, 'Reviewed treasury addresses or owner sets have changed');
    assert.equal(verified.roleRequests.length, 0, 'Both verified treasury Safe proxies must be finalized before preparing the Core review');
    const nonce = await readUnusedCoreNonce(payer, providers);
    return buildRehearsalCoreReview(core, manifest, custody, payer, nonce);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [, , planFile, option, reviewFile, txHash] = process.argv;
        assert(process.argv.length === 3 || (process.argv.length === 4 && option === '--payout') || (process.argv.length === 5 && option === '--register') ||
            (process.argv.length === 6 && option === '--verify-receipt'),
            'Usage: node scripts/prepare-rehearsal-core.mjs <approved-test-safe-plan.json> [--payout | --register <core-review.json> | --verify-receipt <core-review.json> <transaction-hash>]');
        const saved = await load(planFile);
        if (reviewFile) {
            const review = await load(reviewFile);
            const { core, nft, layout, manifest } = await loadReviewedPair(review.contract);
            assert.deepEqual(buildOrdinaryAuditManifest(undefined, core.contractName), manifest, 'C12 manifest verification failed');
            assert.equal(getAddress(saved.payer), getAddress(review.payer), 'Unexpected deployment payer');
            const register = expectedRehearsalPairRegister(saved.custody, review, manifest, layout, core, nft);
            const result = option === '--verify-receipt' ? await verifyRehearsalCoreReceipt(txHash, review, register) : register;
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(JSON.stringify(await prepareRehearsalCore(saved, option === '--payout' ? payoutCore : historicalCore), null, 2));
        }
    } catch (error) {
        console.error('Core rehearsal preparation stopped:', error.shortMessage ?? error.message.split('\n')[0]);
        process.exitCode = 1;
    }
}
