// Read a mined creation against the independently approved build and custody file.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildOrdinaryAuditManifest } from './ordinary-audit-manifest.cjs';
import { payoutCore } from './prepare-ordinary-deployment.mjs';
import { expectedOrdinaryPairRegister, loadReviewedPair, verifyOrdinaryCoreReceipt } from './prepare-rehearsal-core.mjs';
import { readRpc } from './verify-treasury-safes.mjs';

export async function verifyReleasedOrdinaryDeployment(review, custody, hash, providers) {
    assert.equal(review.contract, payoutCore, 'Select the reviewed payout Core for this release');
    const { core, nft, layout, manifest } = await loadReviewedPair(review.contract);
    assert.deepEqual(buildOrdinaryAuditManifest(undefined, core.contractName), manifest, 'C12 build differs from the review');
    const register = expectedOrdinaryPairRegister(custody, review, manifest, layout, core, nft);
    for (const name of ['core', 'nft']) {
        if (!Object.hasOwn(custody, name)) continue;
        const saved = custody[name];
        assert.equal(saved.address.toLowerCase(), register[name].address.toLowerCase(), 'Custody deployment address differs');
        assert.equal(saved.codeHash.toLowerCase(), register[name].codeHash, 'Custody runtime hash differs');
        if (name === 'core') {
            for (const key of ['refundBatchLimit', 'refundTransferGas']) {
                if (Object.hasOwn(saved, key)) assert.equal(BigInt(saved[key]), BigInt(register.core[key]), 'Custody refund limits differ');
            }
        }
    }
    return verifyOrdinaryCoreReceipt(hash, review, register, providers);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        assert.equal(process.argv.length, 5, 'Supply the independent release review, custody file and creation transaction hash');
        const [review, custody] = await Promise.all(process.argv.slice(2, 4).map(async file =>
            JSON.parse((await readFile(file, 'utf8')).trimStart())));
        const providers = [process.env.ARTSOUL_CUSTODY_RPC_URL, process.env.ARTSOUL_CUSTODY_RPC_CHECK_URL].map(readRpc);
        console.log(JSON.stringify(await verifyReleasedOrdinaryDeployment(review, custody, process.argv[4], providers), null, 2));
    } catch {
        console.error('Deployment not verified. Check the release build, review, custody, receipt and two independent HTTPS RPC endpoints.');
        process.exitCode = 1;
    }
}
