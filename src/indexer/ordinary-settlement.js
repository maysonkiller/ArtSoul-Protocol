import { Interface, ZeroAddress, toBeHex, toQuantity } from 'ethers';
import { checkReceipt, decodeReceiptLog, verifyTransactionPosition } from './settlement-receipt.js';

const events = new Interface([
    'event ProceedsCredited(uint256 indexed auctionId,address indexed creator,address indexed treasury,uint256 creatorAmount,uint256 protocolAmount)',
    'event AuctionSettled(uint256 indexed auctionId, uint256 indexed artworkId, uint256 tokenId, uint256 price)',
    'event RunnerUpOfferAccepted(uint256 indexed auctionId, address indexed bidder, uint256 price)',
    'event SettledArtworkIssued(uint256 indexed auctionId, uint256 indexed artworkId, uint256 indexed tokenId, address creator, address firstCollector)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event ResalePurchased(uint256 indexed tokenId, uint256 version, address indexed seller, address indexed buyer, uint256 price)',
    'event ResaleCredited(uint256 indexed tokenId, uint256 indexed version, address protocol, address ecosystem, uint256 sellerAmount, uint256 creatorAmount, uint256 protocolAmount, uint256 ecosystemAmount)'
]);

export function auctionForIssuedToken(receipt, proof, transactionHash, tokenId) {
    checkReceipt(receipt, proof, transactionHash);
    const topics = events.encodeFilterTopics('SettledArtworkIssued', [null, null, BigInt(tokenId)]);
    const matches = receipt.logs.filter(log => log.address?.toLowerCase() === proof.nftAddress &&
        topics.every((topic, index) => topic === null || log.topics?.[index]?.toLowerCase() === topic));
    if (matches.length !== 1) throw new Error('Missing or ambiguous ordinary token issuance');
    return decodeReceiptLog(events, 'SettledArtworkIssued', matches[0], receipt).args.auctionId.toString();
}

// A sale requires a matching Core purchase, credit and adjacent delivery. A wallet
// transfer in the same transaction is still only a transfer unless its own log matches.
export async function discoverOrdinaryResales(send, proof, fromBlock, transfers, headers) {
    const topic = events.getEvent('ResalePurchased').topicHash;
    const logs = await send('eth_getLogs', [{ address: proof.coreAddress, topics: [topic],
        fromBlock: toQuantity(fromBlock), toBlock: toQuantity(proof.blockNumber) }]);
    if (!Array.isArray(logs) || logs.length > transfers.length) throw new Error('Ordinary resale range has missing deliveries');
    const movements = transfers.filter(event => event.eventData.from !== ZeroAddress);
    const deliveries = new Map(movements.map(event => [event.transactionHash + ':' + (event.logIndex - 1), event]));
    const candidates = new Map();
    for (const log of logs) {
        const pos = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(log?.logIndex) ? Number(BigInt(log.logIndex)) : -1;
        const tx = log?.transactionHash?.toLowerCase(), key = tx + ':' + pos;
        const entry = deliveries.get(key);
        if (!entry || candidates.has(key) || log.removed !== false || log.address?.toLowerCase() !== proof.coreAddress) {
            throw new Error('Ordinary resale range has no matching token delivery');
        }
        const position = { blockHash: entry.blockHash, blockNumber: toQuantity(entry.blockNumber),
            transactionHash: tx, transactionIndex: toQuantity(entry.transactionIndex) };
        const decoded = decodeReceiptLog(events, 'ResalePurchased', log, position).args;
        if (decoded.seller.toLowerCase() !== entry.eventData.from || decoded.buyer.toLowerCase() !== entry.eventData.to ||
            decoded.tokenId.toString() !== entry.eventData.tokenId) throw new Error('Ordinary resale delivery differs from the purchase');
        candidates.set(key,{
            location: { blockNumber: entry.blockNumber, blockHash: entry.blockHash, transactionHash: tx, logIndex: pos },
            data: log.data.toLowerCase(), topics: log.topics.map(value => value.toLowerCase()), checked: false
        });
    }
    const transactions = new Map();
    for (const event of transfers) {
        if (!transactions.has(event.transactionHash)) transactions.set(event.transactionHash,new Map());
        transactions.get(event.transactionHash).set(event.logIndex,event);
    }
    let matched = 0;
    for (const [tx, txEvents] of transactions) {
        const event = txEvents.values().next().value;
        const receipt = await send('eth_getTransactionReceipt', [tx]);
        checkReceipt(receipt,event,tx,'secondary transfer');
        verifyTransactionPosition(receipt, headers.get(event.blockNumber), tx);
        const transferTopic = events.getEvent('Transfer').topicHash;
        for (const log of receipt.logs.filter(item => item.address?.toLowerCase() === proof.nftAddress &&
            item.topics?.[0]?.toLowerCase() === transferTopic)) {
            const { index, args } = decodeReceiptLog(events,'Transfer',log,receipt);
            const indexed = txEvents.get(index)?.eventData;
            if (!indexed || indexed.from !== args.from.toLowerCase() || indexed.to !== args.to.toLowerCase() ||
                indexed.tokenId !== args.tokenId.toString()) throw new Error('Ordinary transfer discovery differs from the receipt');
            txEvents.delete(index);
        }
        if (txEvents.size) throw new Error('Ordinary transfer discovery includes a missing receipt log');
        for (const log of receipt.logs.filter(item => item.address?.toLowerCase() === proof.coreAddress &&
            item.topics?.[0]?.toLowerCase() === topic)) {
            const { index } = decodeReceiptLog(events,'ResalePurchased',log,receipt);
            const key = tx + ':' + index;
            const candidate = candidates.get(key);
            if (!candidate || candidate.checked || log.data.toLowerCase() !== candidate.data ||
                log.topics.length !== candidate.topics.length ||
                log.topics.some((value,i) => value.toLowerCase() !== candidate.topics[i])) {
                throw new Error('Ordinary resale discovery differs from the transfer receipt');
            }
            candidate.checked = true;
            matched++;
        }
    }
    if (matched !== candidates.size) throw new Error('Ordinary resale discovery has no matching receipt');
    return [...candidates.values()].map(candidate => candidate.location)
        .sort((a,b) => a.blockNumber-b.blockNumber || a.logIndex-b.logIndex);
}

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
    // A default can credit proceeds for the same auction in this transaction.
    // Only the credit immediately before issuance belongs to the paid sale.
    const beforeMint = receipt.logs.filter(log => log.logIndex?.toLowerCase() === '0x' + (issued.index - 1).toString(16));
    const creditLog = beforeMint[0];
    if (beforeMint.length !== 1 || creditLog.address?.toLowerCase() !== proof.coreAddress ||
        creditLog.topics?.[0]?.toLowerCase() !== events.getEvent('ProceedsCredited').topicHash) {
        throw new Error('Missing or ambiguous ordinary primary sale credit');
    }
    const credit = decodeReceiptLog(events, 'ProceedsCredited', creditLog, receipt);
    const protocolShare = price / 40n + (price % 40n > 20n ? 1n : 0n);
    if (credit.args.auctionId !== BigInt(auctionId) || credit.args.creator !== creator || credit.args.treasury === ZeroAddress ||
        credit.args.protocolAmount !== protocolShare || credit.args.creatorAmount !== price - protocolShare) {
        throw new Error('Ordinary primary sale credit disagrees with settlement');
    }
    return {
        ...proof, transactionHash, logIndex: settled.index, auctionId, artworkId: artworkId.toString(),
        tokenId: tokenId.toString(), priceWei: price.toString(), creator: creator.toLowerCase(),
        protocol: credit.args.treasury.toLowerCase(), protocolWei: credit.args.protocolAmount.toString(),
        creatorWei: credit.args.creatorAmount.toString(), creditLogIndex: credit.index,
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
