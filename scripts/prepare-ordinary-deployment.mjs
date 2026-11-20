// Prepare a direct contract-creation request from a reviewed build, without a signer or RPC.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface, ZeroAddress, concat, dataLength, getAddress, getCreateAddress, isAddress, isHexString, keccak256, toQuantity } from 'ethers';

const roleNames = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const maxRuntimeBytes = 24_576; // EIP-170
const maxInitCodeBytes = 49_152; // EIP-3860, including encoded constructor arguments
class ReviewError extends Error {}
function requireReview(condition, message) {
    if (!condition) throw new ReviewError(message);
}

export function prepareOrdinaryDeployment(artifact, review, custody) {
    const { chainId, nonce } = review;
    requireReview([84532, 8453].includes(chainId) && chainId === custody.chainId, 'Review and custody must identify the same Base network');
    requireReview(Number.isSafeInteger(nonce) && nonce >= 0, 'Supply the exact nonnegative deployment nonce');
    requireReview(isAddress(review.payer) && getAddress(review.payer) !== ZeroAddress, 'Supply a deployment payer');
    const payer = getAddress(review.payer);
    const contractName = artifact.contractName;
    requireReview(typeof contractName === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(contractName) &&
        /^contracts\/replacement\/[A-Za-z][A-Za-z0-9_]*\.sol$/.test(artifact.sourceName) &&
        !/fixture|harness|mock|stub/i.test(contractName + ':' + artifact.sourceName) &&
        review.contract === artifact.sourceName + ':' + contractName, 'Expected the reviewed qualified production Core artifact');
    requireReview(isHexString(artifact.bytecode, true) && artifact.bytecode !== '0x', 'Expected nonempty linked creation bytecode');
    requireReview(isHexString(artifact.deployedBytecode, true) && artifact.deployedBytecode !== '0x', 'Expected nonempty linked runtime bytecode');
    const runtimeTemplateBytes = dataLength(artifact.deployedBytecode);
    requireReview(runtimeTemplateBytes <= maxRuntimeBytes, 'Core runtime exceeds the EIP-170 limit of 24576 bytes');
    requireReview(isHexString(review.initCodeHash, 32), 'Supply the independently reviewed hash of the full creation data');

    const roles = {};
    for (const role of roleNames) {
        const account = custody[role];
        requireReview(isAddress(account?.address) && getAddress(account.address) !== ZeroAddress, 'Invalid ' + role + ' address');
        roles[role] = getAddress(account.address);
        requireReview(Array.isArray(account.owners) && account.owners.length > 0 && account.owners.every(isAddress),
            'Missing reviewed owners for ' + role);
        requireReview(!account.owners.some(owner => getAddress(owner) === payer), 'The deployment payer is an active Safe owner');
    }
    requireReview(new Set([payer, ...Object.values(roles)]).size === 4, 'Use three distinct Safes and a separate payer');

    const abi = new Interface(artifact.abi);
    requireReview(Array.isArray(review.constructorArgs) && review.constructorArgs.length === abi.deploy.inputs.length,
        'The constructor argument count differs from the artifact');
    const seen = [];
    const values = review.constructorArgs.map((value, index) => {
        const role = typeof value === 'string' && value.startsWith('$') ? value.slice(1) : null;
        if (!roleNames.includes(role)) return value;
        requireReview(abi.deploy.inputs[index].type === 'address', 'A Safe reference must occupy an address argument');
        seen.push(role);
        return roles[role];
    });
    requireReview(seen.join() === roleNames.join(), 'Use each custody reference once in protocol, ecosystem, security order');
    const data = concat([artifact.bytecode, abi.encodeDeploy(values)]);
    const initCodeBytes = dataLength(data);
    requireReview(initCodeBytes <= maxInitCodeBytes, 'Full Core initcode exceeds the EIP-3860 limit of 49152 bytes');
    const initCodeHash = keccak256(data);
    requireReview(initCodeHash === review.initCodeHash.toLowerCase(), 'Creation bytecode or constructor data differs from the independent review');

    const core = getCreateAddress({ from: payer, nonce });
    const nft = getCreateAddress({ from: core, nonce: 1 });
    requireReview(isAddress(review.expectedCore) && core === getAddress(review.expectedCore) &&
        isAddress(review.expectedNFT) && nft === getAddress(review.expectedNFT), 'Predicted Core or NFT differs from the reviewed address');
    requireReview(new Set([core, nft, payer, ...Object.values(roles)]).size === 6, 'Predicted deployments overlap the payer or a Safe');
    return {
        contract: review.contract, initCodeHash, initCodeBytes, runtimeTemplateBytes, roles, core, nft,
        transaction: { from: payer, to: null, chainId: toQuantity(chainId), nonce: toQuantity(nonce), value: '0x0', data }
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        requireReview(process.argv.length === 5, 'Usage: node scripts/prepare-ordinary-deployment.mjs <artifact.json> <review.json> <custody.json>');
        const inputs = await Promise.all(process.argv.slice(2).map(async file => JSON.parse((await readFile(file, 'utf8')).trimStart())));
        console.log(JSON.stringify(prepareOrdinaryDeployment(...inputs), null, 2));
    } catch (error) {
        console.error(error instanceof ReviewError ? error.message : 'Unable to read the inputs or encode the reviewed constructor');
        process.exitCode = 1;
    }
}
