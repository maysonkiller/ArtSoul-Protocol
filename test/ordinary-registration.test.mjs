import assert from 'node:assert/strict';
import test from 'node:test';
import { MaxUint256 } from 'ethers';
import { readOrdinaryRegistration } from '../src/indexer/nft-deployment-proof.js';
import { verifyPairReading } from '../scripts/read-reviewed-ordinary-pair.mjs';
import { ingestOrdinaryReceipt } from '../scripts/read-ordinary-receipt.mjs';
import { registrationFixture } from './helpers/ordinary-registration-postgres.mjs';

test('registration intake preserves exact Solidity URI bytes and requires one canonical event and the same stored work', async () => {
    const read = (options = {}) => {
        const f = registrationFixture(91, options);
        return verifyPairReading(f.pair, f.location, f.providers, readOrdinaryRegistration);
    };
    for (const metadata of ['0x6100ff', '0x' + '7f'.repeat(2048)]) {
        const proof = await read({metadata});
        assert.equal(proof.artworkId, String(MaxUint256));
        assert.equal(proof.metadataUriHex, metadata);
        assert.equal(proof.logIndex, 0);
        assert.equal(proof.rpcReadings, 2);
    }
    await assert.rejects(read({metadata:'0x'}), /Invalid ordinary registration event/);
    await assert.rejects(read({metadata:'0x' + '7f'.repeat(2049)}), /Invalid ordinary registration event/);
    await assert.rejects(read({workMetadata:'0x616263'}), /finalized work disagree/);
    await assert.rejects(read({logs: l => [l, l]}), /ambiguous/);
    await assert.rejects(read({logs: l => [{...l,removed:true}]}), /log position/);
    await assert.rejects(read({logs: l => [{...l,address:'0x' + '2'.repeat(40)}]}), /ambiguous/);
    await assert.rejects(read({logs: l => [{...l,data:l.data + '00'}]}), /Invalid ordinary registration event/);
    const f = registrationFixture(91), other = registrationFixture(91, {metadata:'0x62'});
    const noDatabase = {connect: () => assert.fail('Contradictory readings must stop before database access')};
    await assert.rejects(ingestOrdinaryReceipt('registration', noDatabase, f.pair, f.location,
        [f.providers[0], other.providers[1]]), /disagree/);
    await assert.rejects(ingestOrdinaryReceipt('registration', noDatabase, f.pair, f.location,
        [f.providers[0], f.providers[0]]), /independent/);
});
