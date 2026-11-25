// Read-only verification against a private, independently reviewed custody register.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface, MaxUint256, ZeroAddress, getAddress, id, isAddress, keccak256 } from 'ethers';

const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const refundSettings = ['refundBatchLimit', 'refundTransferGas'];
const views = new Interface([
    'function getOwners() view returns (address[])',
    'function getThreshold() view returns (uint256)',
    'function getModulesPaginated(address start, uint256 size) view returns (address[], address)',
    'function nft() view returns (address)',
    'function core() view returns (address)',
    ...refundSettings.map(name => 'function ' + name + '() view returns (uint256)'),
    ...roles.map(role => 'function ' + role + '() view returns (address)')
]);
const sentinel = '0x0000000000000000000000000000000000000001';
const slots = {
    singleton: '0x0',
    guard: id('guard_manager.guard.address'),
    fallbackHandler: id('fallback_manager.handler.address'),
    moduleGuard: id('module_manager.module_guard.address')
};
const hash = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

class VerificationError extends Error {}
function check(condition, message) {
    if (!condition) throw new VerificationError(message);
}
function address(value, field, allowZero = false) {
    check(typeof value === 'string' && isAddress(value) && (allowZero || getAddress(value) !== ZeroAddress),
        'Invalid address for ' + field);
    return getAddress(value);
}
function addressSet(values, field) {
    check(Array.isArray(values), 'Missing ' + field);
    const list = values.map(value => address(value, field)).sort();
    check(new Set(list).size === list.length, 'Duplicate address in ' + field);
    return list;
}

export function requireIndependentProviders(providers) {
    const [first, second] = providers;
    check(providers.length === 2 && typeof first === 'function' && typeof second === 'function' && first !== second,
        'Use two independent RPC providers');
    check(!first.origin || !second.origin || first.origin !== second.origin,
        'Use separate RPC provider origins for a second reading');
}

export async function finalizedBlock(chain, rpc) {
    check(chain === 84532 || chain === 8453, 'Choose Base Sepolia or Base mainnet');
    check(BigInt(await rpc('eth_chainId', [])) === BigInt(chain), 'Wrong RPC chain');
    const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]);
    check(hash(finalized?.hash) && /^0x[0-9a-f]+$/i.test(finalized.number), 'Missing finalized block');
    return { number: finalized.number, hash: finalized.hash };
}

export async function confirmFinalizedBlock(rpc, head, block) {
    check(hash(block.hash) && /^0x[0-9a-f]+$/i.test(block.number), 'Invalid requested block');
    const height = BigInt(block.number);
    check(height <= BigInt(head.number), 'Provider has not finalized the requested block');
    if (height === BigInt(head.number)) {
        check(head.hash.toLowerCase() === block.hash.toLowerCase(), 'Providers disagree on the finalized block');
    }
    const canonical = await rpc('eth_getBlockByNumber', [block.number, false]);
    check(hash(canonical?.hash) && /^0x[0-9a-f]+$/i.test(canonical.number) && BigInt(canonical.number) === height &&
        canonical.hash.toLowerCase() === block.hash.toLowerCase(), 'Providers disagree on the finalized block');
    return canonical;
}

export async function verifyTreasurySafes(register, rpc, expectedBlock) {
    const head = await finalizedBlock(register.chainId, rpc);
    if (expectedBlock) await confirmFinalizedBlock(rpc, head, expectedBlock);
    return verifyAtBlock(register, rpc, expectedBlock ?? head);
}

export async function verifyTreasurySafesWithTwoProviders(register, first, second, { requirePair = false, expectedBlock } = {}) {
    let refundLimits;
    if (requirePair) {
        check(register.core && register.nft, 'The pair check requires reviewed Core and NFT entries');
        for (const role of roles) {
            check(register[role]?.threshold === 2 && addressSet(register[role].owners, role + ' owners').length === 3,
                'The ordinary release requires a two-of-three Safe for ' + role);
        }
        refundLimits = {};
        for (const name of refundSettings) {
            const value = register.core[name];
            check((Number.isSafeInteger(value) && value > 0) ||
                (typeof value === 'string' && /^[1-9]\d{0,77}$/.test(value) && BigInt(value) <= MaxUint256),
                'Supply the reviewed positive uint256 for ' + name);
            refundLimits[name] = String(value);
        }
    }
    requireIndependentProviders([first, second]);
    const [firstHead, secondHead] = await Promise.all([finalizedBlock(register.chainId, first), finalizedBlock(register.chainId, second)]);
    const block = expectedBlock ?? (BigInt(firstHead.number) <= BigInt(secondHead.number) ? firstHead : secondHead);
    await Promise.all([confirmFinalizedBlock(first, firstHead, block), confirmFinalizedBlock(second, secondHead, block)]);
    const [result] = await Promise.all([verifyAtBlock(register, first, block, refundLimits), verifyAtBlock(register, second, block, refundLimits)]);
    return result;
}

function blockReaders(rpc, block) {
    const at = { blockHash: block.hash, requireCanonical: true };

    async function view(to, name, args = []) {
        const data = views.encodeFunctionData(name, args);
        const raw = await rpc('eth_call', [{ to, data }, at]);
        return views.decodeFunctionResult(name, raw);
    }
    async function checkCode(to, expectedHash, field) {
        check(hash(expectedHash), 'Missing reviewed runtime hash for ' + field);
        const code = await rpc('eth_getCode', [to, at]);
        check(code !== '0x', 'No deployed code for ' + field + ' at finalized block ' + BigInt(block.number));
        check(keccak256(code) === expectedHash.toLowerCase(), 'Runtime code mismatch for ' + field);
    }

    return { at, view, checkCode };
}

export async function verifySafeAtBlock(entry, role, rpc, block) {
    const { at, view, checkCode } = blockReaders(rpc, block);
    const owners = addressSet(entry.owners, role + ' owners');
    const modules = addressSet(entry.modules, role + ' modules');
    check(Number.isSafeInteger(entry.threshold) && entry.threshold >= 2 && entry.threshold <= owners.length,
        'Invalid multisig threshold for ' + role);
    await checkCode(entry.address, entry.proxyCodeHash, role + ' proxy');
    for (const [field, slot] of Object.entries(slots)) {
        const expected = address(entry[field], role + ' ' + field, field !== 'singleton');
        const word = await rpc('eth_getStorageAt', [entry.address, slot, at]);
        check(hash(word) && getAddress('0x' + word.slice(-40)) === expected, role + ' ' + field + ' mismatch');
    }
    await checkCode(entry.singleton, entry.singletonCodeHash, role + ' singleton');
    const [actualOwners] = await view(entry.address, 'getOwners');
    const [threshold] = await view(entry.address, 'getThreshold');
    check(addressSet(actualOwners, 'on-chain owners').join() === owners.join(), role + ' owner set mismatch');
    check(threshold === BigInt(entry.threshold), role + ' threshold mismatch');
    const [actualModules, next] = await view(entry.address, 'getModulesPaginated', [sentinel, Math.max(1, modules.length)]);
    check(next === sentinel && addressSet(actualModules, 'on-chain modules').join() === modules.join(),
        role + ' enabled modules mismatch');
    return { owners: owners.length, threshold: entry.threshold };
}

async function verifyAtBlock(register, rpc, block, refundLimits) {
    const assigned = roles.map(role => address(register[role]?.address, role));
    check(new Set(assigned).size === roles.length, 'Each custody role needs its own Safe address');
    if (register.nft) check(register.core, 'An NFT register entry requires its paired Core');
    const { view, checkCode } = blockReaders(rpc, block);
    const summary = {};
    for (const role of roles) {
        summary[role] = await verifySafeAtBlock(register[role], role, rpc, block);
    }
    if (register.core) {
        const core = address(register.core.address, 'Core');
        await checkCode(core, register.core.codeHash, 'Core');
        for (const role of roles) {
            const [bound] = await view(core, role);
            check(bound === getAddress(register[role].address), 'Core binding mismatch for ' + role);
        }
        if (refundLimits) {
            for (const name of refundSettings) {
                const [actual] = await view(core, name);
                check(actual === BigInt(refundLimits[name]), 'Core refund setting mismatch for ' + name);
            }
        }
        if (register.nft) {
            const nft = address(register.nft.address, 'NFT');
            check(new Set([...assigned, core, nft]).size === roles.length + 2, 'Core, NFT and custody addresses must be distinct');
            await checkCode(nft, register.nft.codeHash, 'NFT');
            const [pairedNFT] = await view(core, 'nft');
            check(pairedNFT === nft, 'Core binding mismatch for NFT');
            const [mintingCore] = await view(nft, 'core');
            check(mintingCore === core, 'NFT binding mismatch for Core');
        }
    }
    return {
        chainId: register.chainId, block, roles: summary,
        coreBindingsChecked: Boolean(register.core), nftPairChecked: Boolean(register.nft),
        ...(refundLimits && { refundLimits })
    };
}

export function readRpc(url) {
    const endpoint = url && new URL(url);
    check(endpoint?.protocol === 'https:', 'Supply a private HTTPS RPC endpoint');
    const read = async (method, params) => {
        const res = await fetch(url, {
            method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000)
        });
        check(res.ok, 'RPC HTTP failure on ' + method);
        const body = await res.json();
        check(body?.id === 1 && body.jsonrpc === '2.0' && body.result != null && !body.error, 'RPC read failed on ' + method);
        return body.result;
    };
    return Object.assign(read, { origin: endpoint.origin });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const requirePair = process.argv[3] === '--require-pair';
        check(process.argv.length === 3 || (process.argv.length === 4 && requirePair),
            'Usage: node scripts/verify-treasury-safes.mjs <private-register.json> [--require-pair]');
        const register = JSON.parse(await readFile(process.argv[2], 'utf8'));
        const rpc = process.env.ARTSOUL_CUSTODY_RPC_URL;
        const second = process.env.ARTSOUL_CUSTODY_RPC_CHECK_URL;
        if (requirePair) check(rpc && second, 'The pair check requires two independent RPC endpoints');
        if (second) check(new URL(second).origin !== new URL(rpc).origin, 'Use separate RPC provider origins for a second reading');
        const result = second
            ? await verifyTreasurySafesWithTwoProviders(register, readRpc(rpc), readRpc(second), { requirePair })
            : await verifyTreasurySafes(register, readRpc(rpc));
        console.log(JSON.stringify({ ...result, rpcReadings: second ? 2 : 1 }, null, 2));
    } catch (error) {
        console.error(error instanceof VerificationError ? error.message : 'Unable to read the register or validate the RPC response');
        process.exitCode = 1;
    }
}
