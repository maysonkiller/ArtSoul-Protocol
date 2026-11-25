import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareOrdinaryDeployment } from '../scripts/prepare-ordinary-deployment.mjs';
import { verifyArtworkRegistration } from '../src/api/upload-registration-evidence.js';
import { collectionAssetKey, getCollectionNetwork } from '../src/config/collection-networks.js';
import { createFirstArtworkDraft, reviewConfig } from '../src/features/collections/launch-config.js';

const collection = '0x' + 'ab'.repeat(20);

test('NFT identity uses the issuing chain and preserves the full uint256 token ID', () => {
    const maxId = (1n << 256n) - 1n;
    const keys = [84532, 46630, 4663].map(id => collectionAssetKey(id, collection, maxId));
    assert.equal(new Set(keys).size, keys.length);
    for (const id of [46630, 46630n, '46630', '0xb626']) {
        assert.equal(getCollectionNetwork(id)?.chainId, 46630);
        assert.equal(collectionAssetKey(id, collection, maxId.toString()), keys[1]);
    }
    for (const value of [true, [46630], {}, '4.663e4', Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(getCollectionNetwork(value), null);
        assert.throws(() => collectionAssetKey(value, collection, 1), TypeError);
    }
    for (const token of [[1], true, '01', maxId + 1n, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => collectionAssetKey(46630, collection, token), TypeError);
    }
});

test('Robinhood collection drafts stay local and payment networks cannot become publication targets', async () => {
    const draft = createFirstArtworkDraft();
    // Circle domains 6 and 26 identify transport endpoints. The other values are EVM chain IDs.
    for (const chainId of [84532, 46630, 4663, 5042, 5042002, 6, 26]) {
        const review = reviewConfig({ ...draft, chainId });
        assert.equal(review.findings.some(item => item.code === 'TESTNET_REQUIRED'), ![84532, 46630].includes(chainId));
        assert.equal(review.canPublish, false);
        assert.ok(review.deploymentBlockers.length);
        if (chainId === 84532) continue;
        assert.throws(() => prepareOrdinaryDeployment({}, { chainId }, { chainId }), /same Base network/);
        await assert.rejects(verifyArtworkRegistration({
            deployment: { chainId, core: collection, coreCodeHash: '0x' + '01'.repeat(32), startBlock: '0' },
            creator: collection, metadataUri: 'ipfs://test', transactionHash: '0x' + '02'.repeat(32)
        }, { rpcs: [() => assert.fail('Unexpected RPC'), () => assert.fail('Unexpected RPC')] }), /INVALID_RECOVERY_SCOPE/);
    }
});
