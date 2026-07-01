const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const artworkPage = fs.readFileSync('artwork.html', 'utf8') + fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const uploadPage = fs.readFileSync('upload.html', 'utf8') + fs.readFileSync('src/entries/upload.js', 'utf8');

function functionSource(name, nextName) {
    const start = artworkPage.indexOf(`async function ${name}`);
    const end = artworkPage.indexOf(`async function ${nextName}`, start + 1);
    assert.notEqual(start, -1, `${name} must exist`);
    assert.notEqual(end, -1, `${nextName} must follow ${name}`);
    return artworkPage.slice(start, end);
}

function assertConfirmGatesProviderAndTransaction(source, transactionCall) {
    const confirmIndex = source.indexOf('await confirmAuctionAction(');
    const cancelIndex = source.indexOf('if (!confirmed) return;', confirmIndex);
    const providerIndex = source.indexOf('getWalletProvider', cancelIndex);
    const transactionIndex = source.indexOf(transactionCall, providerIndex);

    assert.ok(confirmIndex >= 0, 'the action must await the in-app confirmation');
    assert.ok(cancelIndex > confirmIndex, 'Cancel must return before wallet access');
    assert.ok(providerIndex > cancelIndex, 'wallet access must start only after confirmation');
    assert.ok(transactionIndex > providerIndex, 'the transaction must start only after wallet access');
}

function assertProviderPrecedesTransaction(source, transactionCall) {
    const providerIndex = source.indexOf('getWalletProvider');
    const transactionIndex = source.indexOf(transactionCall, providerIndex);

    assert.ok(providerIndex >= 0, 'wallet access must exist');
    assert.ok(transactionIndex > providerIndex, 'the transaction must start only after wallet access');
}

test('auction confirmations gate every affected wallet transaction', () => {
    // The re-auction modal's explicit Confirm button is the confirmation gate.
    assertProviderPrecedesTransaction(
        functionSource('handleConfirmNewAuction', 'handleEndAuction'),
        'ArtSoulContracts.createAuction('
    );
    assertConfirmGatesProviderAndTransaction(
        functionSource('endAuctionOnce', 'handleVote'),
        'ArtSoulContracts.endAuction('
    );
    assertConfirmGatesProviderAndTransaction(
        functionSource('settleAuctionOnce', 'handleDirectPurchase'),
        'ArtSoulContracts.completeSettlement('
    );

    const bidSource = functionSource('placeBidOnce', 'requestFreshReauctionValuation');
    const networkConfirmIndex = bidSource.indexOf('await confirmAuctionAction(');
    const networkSwitchIndex = bidSource.indexOf('switchArtSoulNetwork(', networkConfirmIndex);
    const switchedBidIndex = bidSource.indexOf('ArtSoulContracts.placeBid(', networkSwitchIndex);
    assert.ok(networkConfirmIndex >= 0, 'network confirmation must be awaited');
    assert.ok(networkSwitchIndex > networkConfirmIndex, 'network switch must wait for confirmation');
    assert.ok(switchedBidIndex > networkSwitchIndex, 'the bid transaction must wait for the confirmed network switch');
});

test('new auction action is explicit, eligible, and redirects only after success', () => {
    const createSource = functionSource('handleConfirmNewAuction', 'handleEndAuction');

    assert.match(createSource, /canCreateNewAuctionForWallet\(artwork, walletAddress\)/);
    assert.match(createSource, /blockchainArtwork\.minted/);
    assert.match(createSource, /blockchainArtwork\.activeAuctionId/);
    assert.match(createSource, /\[24, 36, 48\]/);
    assert.ok(
        createSource.indexOf('ArtSoulContracts.createAuction(') <
        createSource.indexOf("window.location.assign('gallery.html#auctions')"),
        'redirect must happen only after createAuction succeeds'
    );
    assert.match(artworkPage, /Create New Auction/);
    assert.match(artworkPage, /End Expired Auction/);
    assert.match(artworkPage, /Complete Settlement & Mint NFT/);
});

test('normal artwork re-auctions have no attempt cap and use one createAuction transaction', () => {
    const eligibilityStart = artworkPage.indexOf('function canCreateNewAuctionForWallet');
    const eligibilityEnd = artworkPage.indexOf('function v41InteractionKey', eligibilityStart);
    const eligibilitySource = artworkPage.slice(eligibilityStart, eligibilityEnd);
    const createSource = functionSource('handleConfirmNewAuction', 'handleEndAuction');
    const createCalls = createSource.match(/ArtSoulContracts\.createAuction\(/g) || [];

    assert.equal(createCalls.length, 1, 'an already-registered artwork needs one createAuction transaction');
    assert.doesNotMatch(eligibilitySource, /attempt|retry.?count|max.?auction|limit/i);
    assert.doesNotMatch(createSource, /attempt|retry.?count|max.?auction|limit/i);
});

test('staff controls remain gated and live bid polling remains intact', () => {
    assert.match(artworkPage, /moderationAccess\?\.canModerate && \(/);
    assert.doesNotMatch(artworkPage, /Verify Staff Access/);
    assert.match(artworkPage, /refreshLiveBidActivity/);
    assert.match(artworkPage, /data-testid="live-auction-bid-feed"/);
});

test('initial publish remains the canonical register then create two-transaction flow', () => {
    const registerIndex = uploadPage.indexOf('ArtSoulContracts.uploadArtwork(');
    const createIndex = uploadPage.indexOf('ArtSoulContracts.createAuction(', registerIndex);

    assert.ok(registerIndex >= 0, 'publish must register the artwork');
    assert.ok(createIndex > registerIndex, 'publish must create the primary auction after registration');
});
