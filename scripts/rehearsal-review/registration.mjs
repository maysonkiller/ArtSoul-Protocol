import assert from 'node:assert/strict';
import { rehearsalArtwork, rehearsalMetadataUri } from './client.mjs';

// All dynamic values appear in text nodes. No wallet, executable script or remote media is loaded.
function text(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function registrationPage(proof) {
    assert.equal(proof.publicationEvidence?.state, 'verified');
    assert.equal(proof.publicationEvidence.can_submit, false);
    assert.equal(proof.publicationEvidence.chain_id, 84532);
    assert.equal(proof.publicationEvidence.core_address, rehearsalArtwork.core.toLowerCase());
    assert.equal(proof.rpcReadings, 2);
    assert.equal(proof.core, rehearsalArtwork.core);
    assert.equal(proof.nft.toLowerCase(), rehearsalArtwork.nft.toLowerCase());
    assert.equal(proof.metadataUri, rehearsalMetadataUri);
    const metadata = JSON.parse(Buffer.from(proof.metadataUri.split(',')[1], 'base64').toString('utf8'));
    const snapshot = proof.atRegistrationBlock;
    const fields = [
        ['Work ID', proof.workId], ['Creator', proof.creator], ['Core', proof.core], ['NFT contract', proof.nft],
        ['Finalized registration block', BigInt(proof.block.number)], ['Block hash', proof.block.hash],
        ['Registration transaction', proof.txHash], ['Event index', proof.logIndex],
        ['Auction at registration', snapshot.activeAuctionId ?? 'None'],
        ['Minted token at registration', snapshot.tokenId ?? 'None'], ['Floor at registration (wei)', snapshot.canonicalFloorWei]
    ];
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verified artwork registration · ArtSoul</title><link rel="stylesheet" href="./review.css"></head>
<body><main><a href="./">Back to rehearsal</a>
<h1>${text(metadata.name)}</h1><p>${text(metadata.description)}</p>
<h2>Verified Base Sepolia registration</h2>
<dl>${fields.map(([label, value]) => '<dt>' + label + '</dt><dd>' + text(value) + '</dd>').join('')}</dl>
<details><summary>Registered metadata URI</summary><pre>${text(proof.metadataUri)}</pre></details>
</main></body></html>`;
}
