import assert from 'node:assert/strict';
import test from 'node:test';
import { hexlify, concat, getBytes, Interface, Signature, TypedDataEncoder, Wallet, ZeroAddress } from 'ethers';
import { prepareGenesisGrants } from '../scripts/prepare-genesis-grants.mjs';
import { checkGrantConfirmations } from '../scripts/check-genesis-safe-proposal.mjs';
import { review } from './helpers/genesis-grant-rpc.mjs';

const safe = new Interface(['function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)']);
const safeFields = ['address to', 'uint256 value', 'bytes data', 'uint8 operation', 'uint256 safeTxGas', 'uint256 baseGas',
    'uint256 gasPrice', 'address gasToken', 'address refundReceiver', 'uint256 nonce'];
const types = { SafeTx: safeFields.map(s => { const [type, name] = s.split(' '); return { type, name }; }) };
const prepared = prepareGenesisGrants(review);
const domain = { chainId: 8453, verifyingContract: prepared.safe };
const tx = { ...prepared.transaction, safeTxGas: 0, baseGas: 0, gasPrice: 0, gasToken: ZeroAddress, refundReceiver: ZeroAddress, nonce: 12 };
const args = Object.values(types.SafeTx).slice(0, 9).map(field => tx[field.name]);
const owners = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
const custody = { address: prepared.safe, owners: owners.map(w => w.address), threshold: 2 };
const digest = TypedDataEncoder.hash(domain, types, tx);
const first = await owners[0].signTypedData(domain, types, tx);
const ethSign = Signature.from(await owners[1].signMessage(getBytes(digest)));
const second = concat([ethSign.r, ethSign.s, hexlify(Uint8Array.of(ethSign.v + 4))]);
const proposal = (signatures, payload = args) => ({ chainId: 8453, to: prepared.safe, value: '0',
    data: safe.encodeFunctionData('execTransaction', [...payload, concat(signatures)]) });
const verify = (item, nonce = 12) => checkGrantConfirmations(prepared, custody, item, nonce);

test('counts distinct Safe EOA approvals for the same grant, domain and nonce', async () => {
    assert.deepEqual(verify(proposal([first, second])), { checkedGrants: 2, confirmations: 2, safeTxHash: digest });
    for (const wrong of [[first], [first, first], [second, first],
        [first, await owners[2].signTypedData({ ...domain, chainId: 84532 }, types, tx)],
        [first, await Wallet.createRandom().signTypedData(domain, types, tx)],
        [first, second.slice(0, -2) + '01']]) {
        assert.throws(() => verify(proposal(wrong)));
    }
    assert.throws(() => verify(proposal([first, second]), 13));
    assert.throws(() => checkGrantConfirmations(prepared, { ...custody, threshold: 3 }, proposal([first, second]), 12));
    assert.throws(() => checkGrantConfirmations(prepared, { ...custody, owners: [owners[0].address, owners[0].address] },
        proposal([first, second]), 12));
});

test('compares actual calldata, value, operation, gas and refund fields before accepting signatures', () => {
    for (const [i, value] of [[0, prepared.safe], [1, 1], [2, '0x'], [3, 1], [4, 1], [5, 1], [6, 1],
        [7, prepared.safe], [8, prepared.safe]]) {
        const payload = [...args];
        payload[i] = value;
        assert.throws(() => verify(proposal([first, second], payload)));
    }
    const good = proposal([first, second]);
    for (const change of [{ value: '1' }, { to: prepared.transaction.to }, { chainId: 84532 }, { data: good.data + '00' }]) {
        assert.throws(() => verify({ ...good, ...change }));
    }
});
