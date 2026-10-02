import test from 'node:test';
import assert from 'node:assert/strict';
import { donationMessageState, visibleDonationMessage } from '../src/features/artwork/donation-message.js';
import { projectDonation, parseDonationEvent } from '../src/indexer/donation-events.js';
import { publicDonation } from '../src/api/routes/public/donations.js';

const donor = `0x${'12'.repeat(20)}`, creator = `0x${'34'.repeat(20)}`, deployment = `0x${'56'.repeat(20)}`;
const event = { contractAddress: deployment, transactionHash: `0x${'ab'.repeat(32)}`, logIndex: 2, blockNumber: 100,
    eventData: { donor, creator, artworkId: 1n, amount: 500000000000000n, message: 'Thank you', anonymous: true } };

test('donation display counts graphemes separately from UTF-8 bytes', () => {
    assert.deepEqual(donationMessageState('e\u0301'.repeat(140)), {valid: true, characters: 140, bytes: 420});
    assert.deepEqual(donationMessageState('😀'.repeat(140)), {valid: true, characters: 140, bytes: 560});
    assert.equal(donationMessageState('a'.repeat(141)).valid, false);
    assert.equal(donationMessageState('😀'.repeat(141)).valid, false);
    assert.equal(donationMessageState('\ud800').valid, false);
    assert.equal(donationMessageState('\udc00').valid, false);
    assert.equal(donationMessageState('').valid, true);
    assert.equal(donationMessageState('a\0b').valid, false);
});

test('valid on-chain NUL bytes cannot poison PostgreSQL JSONB or text persistence', async () => {
    const input = parseDonationEvent([donor, creator, 1n, 5n, 'a\0b', false]);
    assert.equal(input.message, null);
    assert.equal(input.message_utf8_hex, '610062');
    assert.ok(!JSON.stringify(input, (_key,value)=>typeof value==='bigint'?String(value):value).includes('\\u0000'));
    let values;
    await projectDonation({query:async(_sql,args)=>{values=args;}},{...event,eventData:input},84532,deployment,new Date());
    assert.equal(values[10],null);
});

test('hidden or excessive messages never enter a public donation response', () => {
    assert.equal(visibleDonationMessage('normal', true), null);
    assert.equal(visibleDonationMessage('a'.repeat(141)), null);
    assert.equal(visibleDonationMessage(null), null);
    assert.equal(visibleDonationMessage('<b>plain</b> https://example.test'), '<b>plain</b> https://example.test');
});

test('anonymous projection omits the donor address and profile name', () => {
    const names = new Map([[donor, 'Private donor']]);
    const row = {...event.eventData, amount: '500000000000000', donor, transaction_hash:event.transactionHash};
    const projected = publicDonation(row, names);
    assert.equal(projected.donor, null);
    assert.equal(projected.donor_name, null);
    assert.equal(projected.creator, creator);
    assert.equal(projected.amount, row.amount);
    assert.equal(projected.transaction_hash, event.transactionHash);
    assert.equal(publicDonation({...row, anonymous:false}, names).donor_name, 'Private donor');
});

test('projection accepts only the exact configured deployment and valid event values', async () => {
    const writes=[];
    const client={query: async(...args)=>writes.push(args)};
    for (const [input, chain, address] of [[event,46630,deployment], [event,84532,''],
        [{...event,contractAddress:creator},84532,deployment],
        [{...event,eventData:{...event.eventData,amount:0n}},84532,deployment],
        [{...event,eventData:{...event.eventData,anonymous:'true'}},84532,deployment]]) {
        await assert.rejects(projectDonation(client,input,chain,address,new Date()), /Donation event/);
    }
    assert.equal(writes.length,0);
    await projectDonation(client,event,84532,deployment,new Date(0));
    assert.equal(writes.length,1);
    assert.equal(writes[0][1][5],'1');
    assert.equal(writes[0][1][8],'500000000000000');
    assert.match(writes[0][0], /ON CONFLICT \(chain_id, transaction_hash, log_index\) DO NOTHING/);
});

test('projection preserves the donation when a direct caller exceeds UI character limits', async () => {
    let values;
    await projectDonation({query: async(_sql,input)=>{values=input;}},
        {...event,eventData:{...event.eventData,message:'a'.repeat(141)}},84532,deployment,new Date(0));
    assert.equal(values[10],null);
    assert.equal(values[8],'500000000000000');
});
