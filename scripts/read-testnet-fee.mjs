import { pathToFileURL } from 'node:url';
import { getAddress, isHexString } from 'ethers';
import { networkFees, verifiedReceipt } from './testnet-transaction.mjs';
import { readRpc } from './verify-treasury-safes.mjs';

export async function readFinalizedFee(hash, sender, target, rpcs) {
    if (!isHexString(hash, 32) || rpcs.length !== 2) throw new Error('Expected a transaction hash and two RPC providers');
    const record = { hash, sender: getAddress(sender), to: getAddress(target), type: '0x2' };
    const finalized = await Promise.all(rpcs.map(async rpc => {
        if (BigInt(await rpc('eth_chainId', [])) !== 84532n) throw new Error('Expected Base Sepolia');
        const block = await rpc('eth_getBlockByNumber', ['finalized', false]);
        if (!isHexString(block?.hash, 32) || !/^0x[0-9a-f]+$/i.test(block.number)) throw new Error('Invalid finalized block');
        return block;
    }));
    const receipt = await verifiedReceipt(record, rpcs, 'FEE_RECEIPT');
    if (!receipt || finalized.some(block => BigInt(block.number) < BigInt(receipt.blockNumber) ||
        (BigInt(block.number) === BigInt(receipt.blockNumber) && block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()))) {
        throw new Error('Transaction finality could not be confirmed');
    }
    const fees = networkFees(receipt);
    return {
        chainId: 84532, transactionHash: hash, from: record.sender, to: record.to,
        blockNumber: BigInt(receipt.blockNumber).toString(), blockHash: receipt.blockHash,
        status: receipt.status === '0x1' ? 'success' : 'reverted',
        gasUsed: BigInt(receipt.gasUsed).toString(), effectiveGasPriceWei: BigInt(receipt.effectiveGasPrice).toString(),
        executionFeeWei: fees.executionWei.toString(), l1DataFeeWei: fees.l1DataWei.toString(), networkFeeWei: fees.totalWei.toString()
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 5) throw new Error('Usage: node scripts/read-testnet-fee.mjs TX_HASH EXPECTED_SENDER EXPECTED_CONTRACT');
        const rpcs = ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(readRpc);
        console.log(JSON.stringify(await readFinalizedFee(...process.argv.slice(2), rpcs), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
