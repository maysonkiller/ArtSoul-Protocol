import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Wallet, id } from 'ethers';
import { checkBannerSignatures, prepareBannerReview } from '../scripts/review-banner-terms.mjs';

const maker = Wallet.createRandom();
const reviewer = Wallet.createRandom();
const directory = { ledgerId: id('private rehearsal fixture'), members: [
    { role: 'proposer', wallet: maker.address, person: 'maker', groups: ['program'] },
    { role: 'reviewer', wallet: reviewer.address, person: 'reader', groups: ['review'] }
] };
const source = { proposerGroup: 'program', reviewerGroup: 'review', sponsorGroup: 'artist',
    preview: { revision: 9, terms: { id: 'exhibit', slot: 1, kind: 'auction', reserveWei: '100000000000000001' },
        award: { sponsor: { name: 'Spring exhibition', relationship: 'Auction sponsor' }, winningBidWei: '123456789123456789' } } };

async function confirm(roster = directory, chainId = 84532) {
    const { domain, types, requests } = prepareBannerReview(source, roster);
    return {
        proposer: await maker.signTypedData({ ...domain, chainId }, types, requests[0]),
        reviewer: await reviewer.signTypedData({ ...domain, chainId }, types, requests[1])
    };
}

test('the two rehearsal confirmations bind the exact recorded award, roster, chain and decision roles', async () => {
    const signed = await confirm();
    const record = checkBannerSignatures(source, directory, signed);
    assert.equal(record.stage, 'award');
    assert.equal(record.reviewer, reviewer.address.toLowerCase());
    const changed = structuredClone(source);
    changed.preview.award.winningBidWei = '123456789123456788';
    assert.throws(() => checkBannerSignatures(changed, directory, signed), /authorized group/);
    for (const altered of [
        { ...source, sponsorGroup: 'another' }, { ...source, preview: { ...source.preview, revision: 10 } },
        { ...source, preview: { ...source.preview, award: null } }
    ]) assert.throws(() => checkBannerSignatures(altered, directory, signed), /authorized group/);
    assert.throws(() => checkBannerSignatures(source, { ...directory, ledgerId: id('another register') }, signed), /authorized group/);
    const mainnet = await confirm(directory, 8453);
    assert.throws(() => checkBannerSignatures(source, directory, mainnet), /authorized group/);
    assert.throws(() => checkBannerSignatures(source, directory, { ...signed, reviewer: signed.proposer }), /authorized group/);
});

test('secondary affiliations and two wallets for one identified person cannot supply an independent review', async () => {
    for (const [index, overrides, pattern] of [
        [0, { groups: ['program', 'artist'] }, /Sponsor affiliation/],
        [1, { groups: ['review', 'artist'] }, /Sponsor affiliation/],
        [1, { groups: ['review', 'program'] }, /Independent human/],
        [1, { person: 'maker' }, /Independent human/]
    ]) {
        const roster = structuredClone(directory);
        Object.assign(roster.members[index], overrides);
        const signed = await confirm(roster);
        assert.throws(() => checkBannerSignatures(source, roster, signed), pattern);
    }
    const duplicate = { ...directory, members: [...directory.members, directory.members[0]] };
    assert.throws(() => prepareBannerReview(source, duplicate), /Invalid reviewer directory member/);
});
