import { Interface, ZeroAddress, ZeroHash, isHexString, keccak256 } from 'ethers';
import { checkReceipt, decodeReceiptLog, verifyTransactionPosition } from '../src/indexer/settlement-receipt.js';
import { confirmFinalizedBlock } from './verify-treasury-safes.mjs';

const events = new Interface([
    'event AuctionFinalized(uint256 indexed phaseId,uint256 clearingPrice,uint256 winners,bool subscribed)',
    'event CollectionMinted(uint256 indexed phaseId,address indexed payer,address indexed recipient,uint256 firstTokenId,uint256 quantity,uint256 unitPrice)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
]);

// The reviewed state and both receipts must belong to the same finalized chain.
export async function readCollectionOpeningReceipts(rpc, head, address, runtimeHash, work, hashes) {
    const transactionHashes = [hashes.settlement, hashes.issuance].map(hash => {
        if (!isHexString(hash, 32) || hash.toLowerCase() === ZeroHash) throw new Error('Supply both mined collection transaction hashes.');
        return hash.toLowerCase();
    });
    async function read(hash) {
        const receipt = await rpc('eth_getTransactionReceipt', [hash]);
        if (!receipt || !isHexString(receipt.blockHash, 32) || receipt.blockHash.toLowerCase() === ZeroHash) {
            throw new Error('Missing collection receipt block');
        }
        const block = { number: receipt.blockNumber, hash: receipt.blockHash.toLowerCase() };
        const header = await confirmFinalizedBlock(rpc, head, block);
        checkReceipt(receipt, { blockNumber: header.number, blockHash: block.hash }, hash, 'collection');
        verifyTransactionPosition(receipt, header, hash);
        const code = await rpc('eth_getCode', [address, { blockHash: block.hash, requireCanonical: true }]);
        if (code === '0x' || keccak256(code) !== runtimeHash.toLowerCase()) throw new Error('Collection receipt runtime differs from the reviewed deployment.');
        return receipt;
    }
    const [settlementHash, issuanceHash] = transactionHashes;
    const [settlement, issuance = settlement] = await Promise.all([...new Set(transactionHashes)].map(read));
    function find(receipt, name, indexed) {
        const topics = events.encodeFilterTopics(name, indexed);
        const logs = receipt.logs.filter(log => log.address?.toLowerCase() === address.toLowerCase() &&
            topics.every((topic, i) => topic === null || log.topics?.[i]?.toLowerCase() === topic));
        if (logs.length !== 1) throw new Error('Expected one collection ' + name + ' for the opening work');
        return decodeReceiptLog(events, name, logs[0], receipt);
    }
    const paid = find(settlement, 'AuctionFinalized', [0]);
    const issued = find(issuance, 'CollectionMinted', [0]);
    const mint = find(issuance, 'Transfer', [ZeroAddress, null, 1]);
    const settlementHeight = BigInt(settlement.blockNumber), issuanceHeight = BigInt(issuance.blockNumber);
    if (settlementHeight > issuanceHeight || (settlementHeight === issuanceHeight &&
        (settlement.blockHash.toLowerCase() !== issuance.blockHash.toLowerCase() || paid.index >= mint.index ||
        (settlementHash !== issuanceHash && BigInt(settlement.transactionIndex) >= BigInt(issuance.transactionIndex))))) {
        throw new Error('Collection settlement must precede the opening mint.');
    }
    if (!paid.args.subscribed || paid.args.winners !== 1n || paid.args.clearingPrice !== work.price ||
        issued.args.unitPrice !== work.price || issued.args.payer !== work.firstCollector ||
        issued.args.firstTokenId !== 1n || issued.args.quantity !== 1n || issued.args.recipient === ZeroAddress ||
        mint.args.to !== issued.args.recipient || mint.index >= issued.index) {
        throw new Error('The funded opening, NFT delivery and issued collection state disagree.');
    }
    function location(receipt, index) {
        return { blockHash: receipt.blockHash.toLowerCase(), blockNumber: BigInt(receipt.blockNumber).toString(),
            transactionHash: receipt.transactionHash.toLowerCase(), transactionIndex: BigInt(receipt.transactionIndex).toString(),
            logIndex: index };
    }
    return { settlement: location(settlement, paid.index), issuance: location(issuance, issued.index),
        mintLogIndex: mint.index, mintRecipient: issued.args.recipient };
}
