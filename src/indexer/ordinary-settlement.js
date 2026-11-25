import { Interface, ZeroAddress, toBeHex } from 'ethers';

const events = new Interface([
    'event AuctionSettled(uint256 indexed auctionId, uint256 indexed artworkId, uint256 tokenId, uint256 price)',
    'event RunnerUpOfferAccepted(uint256 indexed auctionId, address indexed bidder, uint256 price)',
    'event SettledArtworkIssued(uint256 indexed auctionId, uint256 indexed artworkId, uint256 indexed tokenId, address creator, address firstCollector)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
]);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);

// The reader supplies a verified pair and canonical block. Do not infer the buyer
// from the highest bid, the transaction sender, or a transfer after the mint.
export function parseOrdinarySettlement(receipt, proof, transactionHash, auctionId) {
    if (receipt?.status !== '0x1' || receipt.transactionHash?.toLowerCase() !== transactionHash ||
        receipt.blockHash?.toLowerCase() !== proof.blockHash || !quantity(receipt.blockNumber) ||
        BigInt(receipt.blockNumber) !== BigInt(proof.blockNumber) || !quantity(receipt.transactionIndex) || !Array.isArray(receipt.logs)) {
        throw new Error('Missing successful ordinary settlement receipt in the expected block');
    }

    function findLog(name, address, indexedFields, optional = false) {
        const topic = events.getEvent(name).topicHash;
        const logs = receipt.logs.filter(log => log.address?.toLowerCase() === address &&
            log.topics?.[0]?.toLowerCase() === topic && indexedFields.every(([index, value]) =>
                log.topics[index]?.toLowerCase() === value));
        if (!logs.length && optional) return null;
        if (logs.length !== 1) throw new Error('Expected one ' + name + ' in ordinary settlement receipt');
        const [log] = logs;
        const index = quantity(log.logIndex) ? Number(BigInt(log.logIndex)) : NaN;
        if (log.removed === true || log.blockHash?.toLowerCase() !== proof.blockHash ||
            log.transactionHash?.toLowerCase() !== transactionHash || log.blockNumber !== receipt.blockNumber ||
            log.transactionIndex !== receipt.transactionIndex || !Number.isSafeInteger(index)) throw new Error('Invalid ordinary settlement log position');
        const args = events.decodeEventLog(name, log.data, log.topics);
        const canonical = events.encodeEventLog(name, args);
        if (canonical.data !== log.data.toLowerCase() || canonical.topics.length !== log.topics.length ||
            canonical.topics.some((word, i) => word !== log.topics[i].toLowerCase())) {
            throw new Error('Invalid ordinary settlement event encoding');
        }
        return { args, index };
    }

    const auction = [[1, toBeHex(BigInt(auctionId), 32)]];
    const settled = findLog('AuctionSettled', proof.coreAddress, auction);
    const issued = findLog('SettledArtworkIssued', proof.nftAddress, auction);
    const { artworkId, tokenId, price } = settled.args;
    const { creator, firstCollector } = issued.args;
    const mint = findLog('Transfer', proof.nftAddress, [[1, toBeHex(0, 32)], [3, toBeHex(tokenId, 32)]]);
    if (artworkId === 0n || tokenId === 0n || price === 0n || creator === ZeroAddress || firstCollector === ZeroAddress ||
        issued.args.artworkId !== artworkId || issued.args.tokenId !== tokenId || mint.args.to !== firstCollector ||
        !(issued.index < mint.index && mint.index < settled.index)) {
        throw new Error('Ordinary settlement and mint disagree');
    }
    const offer = findLog('RunnerUpOfferAccepted', proof.coreAddress, auction, true);
    if (offer && (offer.index >= issued.index || offer.args.bidder !== firstCollector || offer.args.price !== price)) {
        throw new Error('Runner-up acceptance and settlement disagree');
    }
    return {
        ...proof, transactionHash, logIndex: settled.index, auctionId, artworkId: artworkId.toString(),
        tokenId: tokenId.toString(), priceWei: price.toString(), creator: creator.toLowerCase(),
        firstCollector: firstCollector.toLowerCase(), runnerUpAccepted: Boolean(offer)
    };
}
