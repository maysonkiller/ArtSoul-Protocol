// Prepare an unsigned Safe CALL for the reviewed Genesis deployment. Purely offline.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AbiCoder, Interface, ZeroAddress, ZeroHash, getAddress, id, isHexString, keccak256 } from 'ethers';

const categories = ['Founder', 'Team', 'MainnetActivity', 'Community'];
const domain = id('ArtSoulGenesisGrant(uint256 chainId,address genesis,address safe,uint16 tokenId,uint8 category,address recipient,uint256 activityChainId,bytes32 policyHash,bytes32 evidenceHash)');
const types = ['bytes32', 'uint256', 'address', 'address', 'uint16', 'uint8', 'address', 'uint256', 'bytes32', 'bytes32'];
const abi = new Interface(['function grantBatch((uint16 tokenId,uint8 category,address recipient,uint256 activityChainId,bytes32 decisionHash)[] grants)']);
const hashPresent = value => isHexString(value, 32) && value !== ZeroHash;

export function prepareGenesisGrants(review) {
    if (review?.chainId !== 8453 || !hashPresent(review.policyHash)) throw new Error('Supply Base mainnet and the reviewed public policy hash');
    const safe = getAddress(review.safe);
    const genesis = getAddress(review.genesis);
    const founder = getAddress(review.founder);
    if ([safe, genesis, founder].includes(ZeroAddress) || safe === genesis) throw new Error('Invalid Genesis deployment or authority');
    if (!Array.isArray(review.grants) || review.grants.length < 1 || review.grants.length > 32) throw new Error('Supply 1 to 32 reviewed grants');
    const ids = new Set();
    const grants = review.grants.map(entry => {
        const { tokenId, activityChainId, evidenceHash } = entry;
        const recipient = getAddress(entry.recipient);
        const category = categories.indexOf(entry.category);
        if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= 10000 || ids.has(tokenId) ||
            recipient === ZeroAddress || category < 0 || !hashPresent(evidenceHash)) throw new Error('Invalid or duplicate grant');
        if ((tokenId === 0) !== (category === 0) || (category === 0 && recipient !== founder) ||
            (tokenId > 0 && tokenId <= 200) !== (category === 1) ||
            activityChainId !== (category === 2 ? 8453 : 0)) throw new Error('Grant does not meet its published category');
        ids.add(tokenId);
        const encoded = AbiCoder.defaultAbiCoder().encode(types,
            [domain, 8453, genesis, safe, tokenId, category, recipient, activityChainId, review.policyHash, evidenceHash]);
        return { tokenId, category, recipient, activityChainId, decisionHash: keccak256(encoded) };
    });
    return { chainId: 8453, safe, grants, transaction: { to: genesis, value: '0', operation: 0, data: abi.encodeFunctionData('grantBatch', [grants]) } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 3) throw new Error('Usage: node scripts/prepare-genesis-grants.mjs reviewed-grants.json');
        console.log(JSON.stringify(prepareGenesisGrants(JSON.parse(await readFile(process.argv[2], 'utf8'))), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
