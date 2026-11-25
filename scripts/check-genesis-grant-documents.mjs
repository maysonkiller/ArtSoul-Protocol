import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { keccak256 } from 'ethers';
import { prepareGenesisGrants } from './prepare-genesis-grants.mjs';
import { readReviewedFile } from './security/read-reviewed-file.mjs';

const reviewLimit = 256 * 1024;
const documentLimit = 1024 * 1024;

function localPath(input) {
    if (typeof input !== 'string' || !input) throw new Error('Supply a local path.');
    const path = resolve(input);
    const networkPath = /^[/\\]{2}/;
    if (networkPath.test(input) || networkPath.test(path)) throw new Error('Choose files on the local disk.');
    return path;
}

async function privateFile(path, limit) {
    try {
        if (!(await lstat(path)).isFile()) throw new Error();
        return await readReviewedFile(path, limit);
    } catch {
        // Filesystem errors can contain identifying filenames.
        throw new Error('A review file is missing, unreadable or outside its size limit.');
    }
}

export async function readLocalGrantJson(file) {
    const bytes = await privateFile(localPath(file), reviewLimit);
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new Error('The reviewed Genesis batch is invalid.');
    }
}

export async function checkGenesisGrantDocuments(algorithm, reviewFile, directory) {
    if (algorithm !== 'keccak256' && algorithm !== 'sha256') throw new Error('Select keccak256 or sha256.');
    const review = await readLocalGrantJson(reviewFile);
    try {
        prepareGenesisGrants(review);
    } catch {
        // Validation exceptions can quote the submitted addresses or document content.
        throw new Error('The reviewed Genesis batch is invalid.');
    }

    const folder = localPath(directory);
    const folderStat = await lstat(folder).catch(() => null);
    if (!folderStat?.isDirectory()) throw new Error('Choose a local document folder.');
    const digest = algorithm === 'keccak256'
        ? keccak256
        : bytes => '0x' + createHash('sha256').update(bytes).digest('hex');
    const policy = await privateFile(join(folder, 'policy.bin'), documentLimit);
    if (digest(policy) !== review.policyHash.toLowerCase()) throw new Error('The policy bytes do not match the reviewed hash.');
    for (const { tokenId, evidenceHash } of review.grants) {
        const evidence = await privateFile(join(folder, `evidence-${tokenId}.bin`), documentLimit);
        if (digest(evidence) !== evidenceHash.toLowerCase()) throw new Error('Evidence bytes do not match the reviewed hash.');
    }
    return { checkedGrants: review.grants.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 5) throw new Error('Supply a hash algorithm, reviewed batch and private document folder.');
        console.log(JSON.stringify(await checkGenesisGrantDocuments(...process.argv.slice(2))));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
