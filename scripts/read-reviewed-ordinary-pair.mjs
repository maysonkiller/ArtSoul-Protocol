import { readFile } from 'node:fs/promises';
import { isAddress, isHexString, ZeroAddress, ZeroHash } from 'ethers';

export class InputError extends Error {}

export async function readReviewedOrdinaryPair(file) {
    const record = JSON.parse((await readFile(file, 'utf8')).trimStart());
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new InputError('Invalid ordinary pair register');
    const nested = record.core !== undefined || record.nft !== undefined;
    const fields = ['coreAddress', 'nftAddress', 'expectedCoreCodeHash', 'expectedNftCodeHash'];
    if (nested && fields.some(key => Object.hasOwn(record, key))) {
        throw new InputError('Ambiguous ordinary pair register. Use either the custody register or the compact pair file.');
    }
    // Only these five fields belong to an intake. A full custody register also contains private signer information.
    const { chainId } = record;
    const coreAddress = nested ? record.core?.address : record.coreAddress;
    const nftAddress = nested ? record.nft?.address : record.nftAddress;
    const expectedCoreCodeHash = nested ? record.core?.codeHash : record.expectedCoreCodeHash;
    const expectedNftCodeHash = nested ? record.nft?.codeHash : record.expectedNftCodeHash;
    if (![8453, 84532].includes(chainId) ||
        ![coreAddress, nftAddress].every(address => isHexString(address, 20) && isAddress(address) && address !== ZeroAddress) ||
        coreAddress.toLowerCase() === nftAddress.toLowerCase() ||
        ![expectedCoreCodeHash, expectedNftCodeHash].every(hash => isHexString(hash, 32) && hash !== ZeroHash)) {
        throw new InputError('Invalid ordinary pair register. Check the Base chain ID, distinct addresses and both initialized runtime hashes.');
    }
    return { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash };
}
