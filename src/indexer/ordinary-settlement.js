import { Interface, ZeroAddress, toBeHex } from 'ethers';
import { checkReceipt, decodeReceiptLog } from './settlement-receipt.js';

const events = new Interface([
    'event AuctionSettled(uint256 indexed auctionId, uint256 indexed artworkId, uint256 tokenId, uint256 price)',
    'event RunnerUpOfferAccepted(uint256 indexed auctionId, address indexed bidder, uint256 price)',
    'event SettledArtworkIssued(uint256 indexed auctionId, uint256 indexed artworkId, uint256 indexed tokenId, address creator, address firstCollector)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event ResalePurchased(uint256 indexed tokenId, uint256 version, address indexed seller, address indexed buyer, uint256 price)',
    'event ResaleCredited(uint256 indexed tokenId, uint256 indexed version, address protocol, address ecosystem, uint256 sellerAmount, uint256 creatorAmount, uint256 protocolAmount, uint256 ecosystemAmount)'
]);

export function parseOrdinarySettlement(receipt, proof, transactionHash, auctionId) {
    checkReceipt(receipt, proof, transactionHash);
    function findLog(name, address, indexedFields, optional = false) {
        const topic = events.getEvent(name).topicHash;
        const logs = receipt.logs.filter(log => log.address?.toLowerCase() === address &&
            log.topics?.[0]?.toLowerCase() === topic && indexedFields.every(([index, value]) =>
                log.topics[index]?.toLowerCase() === value));
        if (!logs.length && optional) return null;
        if (logs.length !== 1) throw new Error('Expected one ' + name + ' in ordinary settlement receipt');
        return decodeReceiptLog(events, name, logs[0], receipt);
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

export function parseOrdinaryResale(receipt, proof, transactionHash, logIndex) {
    checkReceipt(receipt, proof, transactionHash);
    // buyResale emits the credit and purchase immediately before the ERC-721
    // transfer. The receiver can transfer it again in its callback.
    function at(index, address, name) {
        const position = '0x' + index.toString(16);
        const logs = receipt.logs.filter(log => log.logIndex?.toLowerCase() === position);
        if (logs.length !== 1 || logs[0].address?.toLowerCase() !== address ||
            logs[0].topics?.[0]?.toLowerCase() !== events.getEvent(name).topicHash) {
            throw new Error('Missing or ambiguous ordinary resale ' + name);
        }
        return decodeReceiptLog(events, name, logs[0], receipt).args;
    }
    const purchase = at(logIndex, proof.coreAddress, 'ResalePurchased');
    const credit = at(logIndex - 1, proof.coreAddress, 'ResaleCredited');
    const delivery = at(logIndex + 1, proof.nftAddress, 'Transfer');
    const { tokenId, version, seller, buyer, price } = purchase;
    if (!tokenId || !version || !price || seller === buyer || seller === ZeroAddress || buyer === ZeroAddress ||
        delivery.tokenId !== tokenId || delivery.from !== seller || delivery.to !== buyer ||
        credit.tokenId !== tokenId || credit.version !== version) throw new Error('Ordinary resale events disagree');

    const weights = [185n, 11n, 2n, 2n];
    const shares = weights.map(weight => price * weight / 200n);
    const extras = Number(price - shares.reduce((total, share) => total + share, 0n));
    const priority = weights.map((w, role) => ({ role, remainder: price * w % 200n }))
        .sort((a, b) => Number(b.remainder - a.remainder) || a.role - b.role);
    for (const { role } of priority.slice(0, extras)) shares[role]++;
    const amounts = [credit.sellerAmount, credit.creatorAmount, credit.protocolAmount, credit.ecosystemAmount];
    if (amounts.some((amount, i) => amount !== shares[i]) || credit.protocol === ZeroAddress ||
        credit.ecosystem === ZeroAddress || credit.protocol === credit.ecosystem) throw new Error('Invalid ordinary resale credits');

    return { ...proof, transactionHash, logIndex, tokenId: tokenId.toString(), version: version.toString(),
        seller: seller.toLowerCase(), buyer: buyer.toLowerCase(), priceWei: price.toString(),
        protocol: credit.protocol.toLowerCase(), ecosystem: credit.ecosystem.toLowerCase(),
        sellerWei: credit.sellerAmount.toString(), creatorWei: credit.creatorAmount.toString(),
        protocolWei: credit.protocolAmount.toString(), ecosystemWei: credit.ecosystemAmount.toString() };
}
