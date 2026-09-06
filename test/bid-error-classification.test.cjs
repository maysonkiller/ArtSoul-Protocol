const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'features', 'auction', 'bid-error.js')).href;

test('recorded estimate diagnostics do not leak into bid messages', async () => {
    const { classifyBidFailure } = await import(moduleUrl);
    const error = { message: 'Transaction creation failed. URL: https://sepolia.base.org Request body: {"method":"eth_estimateGas"} Details: EVM error: OutOfFunds' };
    assert.equal(classifyBidFailure(error).category, 'insufficient_funds');
    assert.doesNotMatch(classifyBidFailure(error).message, /Request body|eth_estimateGas|https?:/);
    const unknown = classifyBidFailure({ message: error.message.replace('OutOfFunds', 'unknown') });
    assert.equal(unknown.message, 'The bid failed: Transaction creation failed.');
});

test('transport closure and nonce failure are not evidence that an auction ended or a bid was too low', async () => {
    const { classifyBidFailure } = await import(moduleUrl);
    assert.equal(classifyBidFailure(new Error('RPC connection closed')).category, 'contract_or_rpc_failure');
    assert.equal(classifyBidFailure(new Error('nonce too low')).category, 'contract_or_rpc_failure');
    assert.equal(classifyBidFailure(new Error('Base Sepolia RPC timed out')).category, 'contract_or_rpc_failure');
});

test('internal transport codes do not replace the returned bid failure reason', async () => {
    const { classifyBidFailure } = await import(moduleUrl);
    const result = classifyBidFailure({ code: 'UNKNOWN_ERROR', message: 'RPC connection closed' });
    assert.equal(result.message, 'The bid failed: RPC connection closed.');
    assert.equal(result.rpcCode, 'UNKNOWN_ERROR');
});

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
