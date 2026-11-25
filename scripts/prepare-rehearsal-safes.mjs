// Read-only preparation for the two Base Sepolia Safe proxies used in the C13 rehearsal.
import { pathToFileURL } from 'node:url';
import {
    Interface, ZeroAddress, concat, getAddress, getCreate2Address, id, keccak256, solidityPacked, zeroPadValue
} from 'ethers';
import { confirmFinalizedBlock, finalizedBlock, readRpc, requireIndependentProviders, verifySafeAtBlock } from './verify-treasury-safes.mjs';

// Safe's v1.4.1 deployment registry for chain 84532 and the published v1.4.1 SafeProxy artifact.
export const rehearsalSafeRelease = Object.freeze({
    factory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
    factoryCodeHash: '0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317',
    singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
    singletonCodeHash: '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff',
    fallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
    fallbackCodeHash: '0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9',
    proxyCreationCodeHash: '0x1856e0ee08399d74e0ea0b03adca210aeade6f748969ac023cdcb4dd62dcaf5f',
    proxyCodeHash: '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'
});
const release = rehearsalSafeRelease;
const chainId = 84532;
const treasuryRoles = ['protocolTreasury', 'ecosystemTreasury'];
const safe = new Interface([
    'function getOwners() view returns(address[])',
    'function setup(address[],uint256,address,bytes,address,address,uint256,address)'
]);
const factory = new Interface([
    'function proxyCreationCode() pure returns(bytes)',
    'function createProxyWithNonce(address,bytes,uint256) returns(address)'
]);
const sentinel = '0x0000000000000000000000000000000000000001';

function check(condition, message) {
    if (!condition) throw new Error(message);
}

function registerEntry(address, owners) {
    return {
        address, owners, threshold: 2, proxyCodeHash: release.proxyCodeHash, singleton: release.singleton,
        singletonCodeHash: release.singletonCodeHash, modules: [], guard: ZeroAddress, moduleGuard: ZeroAddress,
        fallbackHandler: release.fallbackHandler
    };
}

export function buildRehearsalRequests({ adminSafe, payer, owners, proxyCreationCode }) {
    adminSafe = getAddress(adminSafe);
    payer = getAddress(payer);
    const signers = owners.map(getAddress).sort();
    const accounts = [adminSafe, payer, ...signers];
    check(signers.length === 3 && new Set(accounts).size === 5 && !accounts.includes(ZeroAddress) &&
        !accounts.includes(sentinel), 'Expected three distinct test owners, a separate admin Safe and a separate payer');
    check(keccak256(proxyCreationCode) === release.proxyCreationCodeHash, 'Unexpected Safe proxy creation code');
    const initializer = safe.encodeFunctionData('setup',
        [signers, 2, ZeroAddress, '0x', release.fallbackHandler, ZeroAddress, 0n, ZeroAddress]);
    const initCodeHash = keccak256(concat([proxyCreationCode, zeroPadValue(release.singleton, 32)]));
    const custody = { chainId, adminSecurity: registerEntry(adminSafe, signers) };
    const roleRequests = treasuryRoles.map(role => {
        const saltNonce = BigInt(id('ArtSoul/C13/Base-Sepolia/1/' + adminSafe.toLowerCase() + '/' + role)).toString();
        const salt = keccak256(solidityPacked(['bytes32', 'uint256'], [keccak256(initializer), saltNonce]));
        const address = getCreate2Address(release.factory, salt, initCodeHash);
        check(!accounts.includes(address), 'Predicted Safe overlaps an existing role');
        accounts.push(address);
        custody[role] = registerEntry(address, signers);
        const data = factory.encodeFunctionData('createProxyWithNonce', [release.singleton, initializer, saltNonce]);
        return {
            role, safe: address, saltNonce, initializer, dataHash: keccak256(data),
            transaction: { from: payer, to: release.factory, chainId: '0x14a34', value: '0x0', data }
        };
    });
    return { chainId, payer, roleRequests, custody };
}

async function readPlanAtBlock(adminSafe, payer, rpc, block) {
    const at = { blockHash: block.hash, requireCanonical: true };
    for (const [component, expected] of [
        [release.factory, release.factoryCodeHash], [release.singleton, release.singletonCodeHash],
        [release.fallbackHandler, release.fallbackCodeHash]
    ]) {
        check(keccak256(await rpc('eth_getCode', [component, at])) === expected, 'Unexpected Safe release runtime at ' + component);
    }
    check(await rpc('eth_getCode', [payer, at]) === '0x', 'Test deployment payer must be an externally owned account');
    const ownersRaw = await rpc('eth_call', [{ to: adminSafe, data: safe.encodeFunctionData('getOwners') }, at]);
    const [owners] = safe.decodeFunctionResult('getOwners', ownersRaw);
    const codeRaw = await rpc('eth_call', [{ to: release.factory, data: factory.encodeFunctionData('proxyCreationCode') }, at]);
    const [proxyCreationCode] = factory.decodeFunctionResult('proxyCreationCode', codeRaw);
    const plan = buildRehearsalRequests({ adminSafe, payer, owners, proxyCreationCode });
    await verifySafeAtBlock(plan.custody.adminSecurity, 'adminSecurity', rpc, block);
    const pending = [];
    for (const request of plan.roleRequests) {
        if (await rpc('eth_getCode', [request.safe, at]) !== '0x') {
            await verifySafeAtBlock(plan.custody[request.role], request.role, rpc, block);
            continue;
        }
        const { from, to, data, value } = request.transaction;
        const simulated = await rpc('eth_call', [{ from, to, data, value }, at]);
        const [predicted] = factory.decodeFunctionResult('createProxyWithNonce', simulated);
        check(predicted === request.safe, 'Factory simulation disagrees with CREATE2 for ' + request.role);
        pending.push(request);
    }
    return { ...plan, roleRequests: pending, block };
}

export async function prepareRehearsalSafes({ adminSafe, payer, providers = [
    readRpc('https://sepolia.base.org'), readRpc('https://base-sepolia-rpc.publicnode.com')
] }) {
    adminSafe = getAddress(adminSafe);
    payer = getAddress(payer);
    requireIndependentProviders(providers);
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(chainId, rpc)));
    const block = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    await Promise.all(providers.map((rpc, index) => confirmFinalizedBlock(rpc, heads[index], block)));
    const [primary, secondary] = await Promise.all(providers.map(rpc => readPlanAtBlock(adminSafe, payer, rpc, block)));
    check(JSON.stringify(primary) === JSON.stringify(secondary), 'RPC providers disagree on the Safe plan');
    return primary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        check(process.argv.length === 4, 'Usage: node scripts/prepare-rehearsal-safes.mjs <test-admin-safe> <test-payer>');
        const [, , adminSafe, payer] = process.argv;
        console.log(JSON.stringify(await prepareRehearsalSafes({ adminSafe, payer }), null, 2));
    } catch (error) {
        console.error('Safe rehearsal preparation stopped:', error.shortMessage ?? error.message);
        process.exitCode = 1;
    }
}
