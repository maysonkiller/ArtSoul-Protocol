const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'features', 'auction', 'bid-error.js')).href;

test('known bid failures map to precise messages', async () => {
    const { classifyBidFailure } = await import(moduleUrl);

    assert.deepEqual(
        classifyBidFailure(new Error('CreatorCannotBid'), { isCreator: true }),
        { category: 'creator_cannot_bid', message: "You can't bid on your own artwork.", rpcCode: null }
    );
    assert.equal(
        classifyBidFailure(new Error('BidTooLow'), { minimumBidEth: '0.02' }).message,
        'Your bid is below the minimum. The minimum next bid is 0.02 ETH.'
    );
    assert.equal(
        classifyBidFailure({ code: 'ACTION_REJECTED', message: 'user rejected' }).category,
        'user_rejected'
    );
    assert.equal(
        classifyBidFailure(new Error('insufficient funds for gas')).category,
        'insufficient_funds'
    );
    assert.equal(
        classifyBidFailure(new Error('This action requires Base Sepolia.')).category,
        'wrong_network'
    );
    assert.equal(
        classifyBidFailure(new Error('provider unavailable'), { providerSource: 'missing' }).category,
        'wallet_session_missing'
    );
    assert.equal(
        classifyBidFailure(new Error('AuctionNotActive'), { isCreator: true }).category,
        'auction_ended'
    );
    assert.equal(
        classifyBidFailure(new Error('BidderCannotSelfOutbid')).category,
        'already_highest_bidder'
    );
});

test('unknown RPC failures show the returned reason, not a list of guesses', async () => {
    const { classifyBidFailure } = await import(moduleUrl);
    const classified = classifyBidFailure({
        code: 'CALL_EXCEPTION',
        shortMessage: 'execution reverted: AuctionPaused'
    });

    assert.equal(classified.category, 'contract_or_rpc_failure');
    assert.equal(classified.message, 'The bid failed: AuctionPaused.');
    assert.doesNotMatch(classified.message, /Common reasons/i);
});
