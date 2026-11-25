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
