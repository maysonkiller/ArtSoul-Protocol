import test from 'node:test';
import assert from 'node:assert/strict';
import { readFinalizedFee } from '../scripts/read-testnet-fee.mjs';

const hash = '0x' + '1'.repeat(64);
const blockHash = '0x' + '2'.repeat(64);
const sender = '0x' + '3'.repeat(40);
const target = '0x' + '4'.repeat(40);
const receipt = {
    transactionHash: hash, type: '0x2', from: sender, to: target, blockHash, blockNumber: '0x64',
    transactionIndex: '0x0', logs: [], status: '0x1', gasUsed: '0x19995', effectiveGasPrice: '0x5b8d80', l1Fee: '0xa0'
};

function reader({ result = receipt, finalized = '0x66', finalizedHash = blockHash, chain = '0x14a34', canonical = blockHash } = {}) {
    return async (method, params) => {
        if (method === 'eth_chainId') return chain;
        if (method === 'eth_getTransactionReceipt' && params[0] === hash) return result;
        if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') return { number: finalized, hash: finalizedHash };
        if (method === 'eth_getBlockByNumber' && params[0] === receipt.blockNumber) return { number: params[0], hash: canonical };
        throw new Error('Unexpected RPC method: ' + method);
    };
}

test('separates execution and L1 fees, including gas paid on a revert', async () => {
    for (const [status, label] of [['0x1', 'success'], ['0x0', 'reverted']]) {
        const result = { ...receipt, status };
        const fee = await readFinalizedFee(hash, sender, target, [reader({ result }), reader({ result, finalized: '0x64' })]);
        assert.equal(fee.status, label);
        assert.equal(fee.executionFeeWei, '629118000000');
        assert.equal(fee.l1DataFeeWei, '160');
        assert.equal(fee.networkFeeWei, '629118000160');
    }
});

test('requires both providers to confirm finality, identities and the full fee', async () => {
    for (const [second, reason] of [
        [{ chain: '0x2105' }, /Base Sepolia/],
        [{ finalized: '0x63' }, /finality/],
        [{ finalized: '0x64', finalizedHash: hash }, /finality/],
        [{ canonical: hash }, /BLOCK/],
        [{ result: null }, /finality/],
        [{ result: { ...receipt, to: sender } }, /IDENTITY/],
        [{ result: { ...receipt, from: target } }, /IDENTITY/],
        [{ result: { ...receipt, type: '0x7e' } }, /IDENTITY/],
        [{ result: { ...receipt, l1Fee: null } }, /IDENTITY/],
        [{ result: { ...receipt, l1Fee: '0xa1' } }, /FIELDS/],
        [{ result: { ...receipt, operatorFee: '0x1' } }, /UNSUPPORTED_RECEIPT_FEE/]
    ]) {
        await assert.rejects(readFinalizedFee(hash, sender, target, [reader(), reader(second)]), reason);
    }
});
