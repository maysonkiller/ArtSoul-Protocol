import assert from 'node:assert/strict';
import test from 'node:test';
import { listenForReview } from '../scripts/serve-rehearsal-review.mjs';
import { rehearsalArtwork, rehearsalMetadataUri } from '../scripts/rehearsal-review/client.mjs';

const hash = '0x' + 'a'.repeat(64);
const verified = {
    publicationEvidence: { state: 'verified', can_submit: false, chain_id: 84532, core_address: rehearsalArtwork.core.toLowerCase() },
    rpcReadings: 2, core: rehearsalArtwork.core,
    nft: rehearsalArtwork.nft, metadataUri: rehearsalMetadataUri, workId: '1', creator: '0x' + '1'.repeat(40),
    block: { number: '0x20', hash }, txHash: hash, logIndex: '2',
    atRegistrationBlock: { activeAuctionId: null, tokenId: null, canonicalFloorWei: '0' }
};

async function rehearsal(t, options) {
    const { server, url } = await listenForReview(() => { throw Error('A read-only request must not prepare a wallet plan'); }, options);
    t.after(() => new Promise(resolve => server.close(resolve)));
    return (path, headers = {}) => fetch(new URL(path, url), { headers: { Connection: 'close', ...headers } });
}

test('the auction status page displays the applicable clock without opening a wallet', async t => {
    const end = '2026-11-26T21:38:44.000Z';
    const proof = { chainId: 84532, rpcReadings: 2, core: verified.core, nft: verified.nft, auctionId: '1', artworkId: '1',
        block: verified.block, state: 'Open', dueAction: 'None', observedAt: '2026-11-26T21:22:00.000Z',
        originalBiddingEnd: '2026-11-26T21:28:44.000Z', biddingEnd: end, reserveWei: '1000000000000000',
        highestBidder: verified.creator, highestBidWei: '1000000000000000' };
    const read = await rehearsal(t, { loadAuction: () => proof });
    assert.equal((await read('auction?network=1')).status, 404);
    assert.ok((await (await read('')).text()).includes('href="./auction"'));
    const render = async () => {
        const response = await read('auction');
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.doesNotMatch(html, /<script|<form|eth_requestAccounts|eth_sendTransaction/i);
        return html;
    };
    const open = await render();
    assert.match(open, /22:38:44 Warsaw/);
    assert.ok(open.includes(end) && open.includes(proof.highestBidder));
    assert.doesNotMatch(open, /Winner payment deadline|Runner-up deadline/);
    Object.assign(proof, { state: 'Payment', winnerPaymentEnd: '2026-11-27T22:00:00.000Z' });
    assert.match(await render(), /Winner payment deadline/);
    Object.assign(proof, { state: 'Runner-up offer', winnerPaymentEnd: null, runnerUpOffer: {bidder: verified.creator, priceWei: '1000', end} });
    assert.match(await render(), /Runner-up deadline/);
    Object.assign(proof, { state: 'No bids', highestBidder: null, highestBidWei: '0', runnerUpOffer: null });
    assert.ok((await render()).includes('Highest bid</dt><dd>No bids'));
});

test('ordinary registration is visible only on the selected rehearsal and must be read from its verified pair', async t => {
    const legacy = await rehearsal(t);
    assert.doesNotMatch(await (await legacy('')).text(), /href="\.\/registration"/);
    assert.equal((await legacy('registration')).status, 404);
    let reads = 0, proof = verified;
    const read = await rehearsal(t, { loadRegistration: () => { reads++; return proof; } });
    assert.match(await (await read('')).text(), /href="\.\/registration"/);
    assert.equal((await read('registration?rpc=untrusted')).status, 404);
    assert.equal((await read('registration', { Origin: 'https://invalid.example' })).status, 403);
    assert.equal(reads, 0);
    const response = await read('registration');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    for (const value of [rehearsalArtwork.title, rehearsalMetadataUri, verified.creator, verified.core, verified.nft, hash,
        'Finalized registration block</dt><dd>32', 'Event index</dt><dd>2', 'Minted token at registration</dt><dd>None']) {
        assert.ok(html.includes(value));
    }
    assert.doesNotMatch(html, /<script|<form|<iframe|<img|eth_requestAccounts|eth_sendTransaction/i);
    t.mock.method(console, 'error', () => {});
    for (const changed of [{ ...verified, nft: verified.creator }, { ...verified, publicationEvidence: { state: 'unavailable' } }]) {
        proof = changed;
        const failed = await read('registration');
        assert.equal(failed.status, 503);
        assert.ok(!(await failed.text()).includes(verified.creator));
    }
    assert.equal(reads, 3);
});
