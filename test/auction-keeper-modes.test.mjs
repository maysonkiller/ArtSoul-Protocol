import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, getAddress, keccak256, toBeHex } from 'ethers';
import { checkKeeperAgainstMainnetCustody, runKeeperCycle, validateKeeperEndpoint } from '../scripts/auction-keeper.mjs';

const addr = i => getAddress(toBeHex(i, 20));
const code = '0x6012';
const config = { chainId: 8453, engine: addr(9), codeHash: keccak256(code), startBlock: 1 };
const abi = new Interface(['function dueAuctionAction(uint256) view returns (uint8)', 'function closeAuction(uint256)']);

test('Base observation uses the current chain clock for confirmed funded rounds without accessing a signer', async () => {
    const provider = {
        async send(method) {
            assert.equal(method, 'eth_chainId');
            return '0x2105';
        },
        async getBlock(tag) {
            return tag === 'finalized' ? { number: 5, timestamp: 100 } : { number: 7, timestamp: 110 };
        },
        async getCode(engine, block) {
            assert.equal(engine, config.engine);
            assert.equal(block, 5);
            return code;
        },
        async call(tx) {
            assert.equal(tx.to, config.engine);
            assert.equal(tx.data, abi.encodeFunctionData('dueAuctionAction', [1]));
            return abi.encodeFunctionResult('dueAuctionAction', [1]);
        }
    };
    const store = {
        async sync(_, block) { assert.equal(block, 5); return { through: 5, caughtUp: true }; },
        ready(now) { assert.equal(now, 110); return [{ id: 1n, action: 'closeAuction' }]; }
    };
    const { actions } = await runKeeperCycle({ provider, store, config });
    assert.deepEqual(actions, [{ id: '1', action: 'closeAuction', status: 'preview',
        to: config.engine, value: '0', data: abi.encodeFunctionData('closeAuction', [1]) }]);
    await assert.rejects(runKeeperCycle({ provider, store, config, executeLocal: true }), /local rehearsal/);
    await assert.rejects(runKeeperCycle({ provider, store, config, submitter: {} }), /Base Sepolia/);
    await assert.rejects(runKeeperCycle({ provider, store, config: { ...config, codeHash: keccak256('0xab') } }), /runtime mismatch/);
});

test('the local sender requires a loopback IP and the public reader requires HTTPS', () => {
    validateKeeperEndpoint('http://127.0.0.1:8545', 31337, true);
    validateKeeperEndpoint('https://example.org', 84532, false);
    assert.throws(() => validateKeeperEndpoint('https://example.org', 31337, true), /loopback/);
    assert.throws(() => validateKeeperEndpoint('http://example.org', 84532, false), /HTTPS/);
    assert.throws(() => validateKeeperEndpoint('https://example.org', 8453, true), /read-only/);
});

test('test gas credentials must be independent of all registered mainnet Safes and signers', () => {
    const register = { chainId: 8453, protocolTreasury: { address: addr(4), owners: [addr(1), addr(2)] },
        ecosystemTreasury: { address: addr(5), owners: [addr(2), addr(3)] },
        adminSecurity: { address: addr(6), owners: [addr(1), addr(7)] } };
    checkKeeperAgainstMainnetCustody(addr(8), register);
    for (let id = 1; id <= 7; id++) {
        assert.throws(() => checkKeeperAgainstMainnetCustody(addr(id), register), /overlaps/);
    }
    assert.throws(() => checkKeeperAgainstMainnetCustody(addr(8), { ...register, chainId: 84532 }), /mainnet/);
    assert.throws(() => checkKeeperAgainstMainnetCustody(addr(8), { ...register, adminSecurity: {} }), /owner list/);
});
