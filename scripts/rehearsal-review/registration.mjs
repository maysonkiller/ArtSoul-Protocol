import assert from 'node:assert/strict';
import { formatEther } from 'ethers';
import { rehearsalArtwork, rehearsalMetadataUri, refundWork } from './client.mjs';

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
    if (proof.metadataUri === refundWork.metadataUri) assert.equal(proof.workId, '2');
    else assert.equal(proof.metadataUri, rehearsalMetadataUri);
    const metadata = JSON.parse(Buffer.from(proof.metadataUri.split(',')[1], 'base64').toString('utf8'));
    const snapshot = proof.atRegistrationBlock;
    const fields = [
        ['Work ID', proof.workId], ['Creator', proof.creator], ['Core', proof.core], ['NFT contract', proof.nft],
        ['Finalized registration block', BigInt(proof.block.number)], ['Block hash', proof.block.hash],
        ['Registration transaction', proof.txHash], ['Event index', proof.logIndex],
        ['Auction at registration', snapshot.activeAuctionId ?? 'None'],
        ['Minted token at registration', snapshot.tokenId ?? 'None'], ['Floor at registration (wei)', snapshot.canonicalFloorWei]
    ];
    return evidencePage('Verified artwork registration', metadata.name, metadata.description, 'Verified Base Sepolia registration', fields,
        '<details><summary>Registered metadata URI</summary><pre>' + text(proof.metadataUri) + '</pre></details>');
}

export function auctionPage(proof) {
    assert(proof.chainId === 84532 && proof.core === rehearsalArtwork.core && proof.nft === rehearsalArtwork.nft &&
        proof.rpcReadings === 2 && proof.artworkId === '1' && proof.auctionId === '1', 'Unexpected auction evidence');
    const warsaw = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'medium' });
    const time = utc => warsaw.format(new Date(utc)) + ' Warsaw · ' + utc;
    const eth = wei => formatEther(wei) + ' test ETH';
    const fields = [
        ['State at this block', proof.state], ['Action due at this block', proof.dueAction],
        ['Original bidding end', time(proof.originalBiddingEnd)], ['Bidding end at this block', time(proof.biddingEnd)],
        ['Reserve', eth(proof.reserveWei)], ['Highest bid', proof.highestBidder ? eth(proof.highestBidWei) : 'No bids']
    ];
    if (proof.highestBidder) fields.push(['Highest bidder', proof.highestBidder]);
    if (proof.winnerPaymentEnd) fields.push(['Winner payment deadline', time(proof.winnerPaymentEnd)]);
    if (proof.runnerUpOffer) fields.push(['Runner-up bidder', proof.runnerUpOffer.bidder],
        ['Runner-up price', eth(proof.runnerUpOffer.priceWei)], ['Runner-up deadline', time(proof.runnerUpOffer.end)]);
    fields.push(['Block time', time(proof.observedAt)], ['Finalized block', BigInt(proof.block.number)],
        ['Block hash', proof.block.hash], ['Core', proof.core], ['NFT contract', proof.nft]);
    return evidencePage('Auction status', 'Auction 1 · Work 1',
        'Both Base Sepolia providers confirmed this block. Newer bids may still be awaiting finality.',
        'Finalized auction details', fields);
}

function evidencePage(title, heading, description, section, fields, details = '') {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(title)} · ArtSoul</title><link rel="stylesheet" href="./review.css"></head>
<body><main><a href="./">Back to rehearsal</a>
<h1>${text(heading)}</h1><p>${text(description)}</p>
<h2>${text(section)}</h2>
<dl>${fields.map(([label, value]) => '<dt>' + label + '</dt><dd>' + text(value) + '</dd>').join('')}</dl>
${details}
</main></body></html>`;
}
