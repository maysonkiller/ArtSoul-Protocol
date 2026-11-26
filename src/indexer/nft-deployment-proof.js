import { AbiCoder, Interface, keccak256 } from 'ethers';
import { parseOrdinaryResale, parseOrdinarySettlement } from './ordinary-settlement.js';
import { checkReceipt, decodeReceiptLog, receiptLogIndex, verifyTransactionPosition } from './settlement-receipt.js';

const getters = new Interface([
    'function nftContract() view returns (address)',
    'function nft() view returns (address)',
    'function core() view returns (address)',
    'function totalSupply() view returns (uint256)',
    'function protocolTreasury() view returns (address)',
    'function ecosystemTreasury() view returns (address)',
    'function refundProgress(uint256) view returns (uint256 cursor,uint256 total)',
    'event OutbidRefundQueued(uint256 indexed auctionId,uint256 indexed index,address indexed creditor,uint256 amount)',
    'event OutbidRefundProcessed(uint256 indexed auctionId,uint256 indexed index,address indexed creditor,uint256 amount,bool paid)',
    // Solidity strings use the same ABI representation as bytes.
    'function works(uint256) view returns (address creator, bytes metadata, uint256 activeAuction, uint256 floor)',
    'event ArtworkRegistered(uint256 indexed artworkId,address indexed creator,string metadataURI)',
    'function getActiveResale(uint256 tokenId) view returns (bool active, address seller, uint256 price, uint256 version)',
    'function auctions(uint256 id) view returns (uint256 artworkId, uint256 startPrice, uint256 originalEnd, uint256 end, uint256 paymentDeadline, address highestBidder, uint256 price, uint256 deposit, uint8 state, address firstCollector)',
    'function runnerUpOffers(uint256 id) view returns (address bidder, uint256 price, uint256 deadline)'
]);
const transfers = new Interface(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']);
const token = new Interface([
    'function supportsInterface(bytes4) view returns (bool)',
    'function ownerOf(uint256) view returns (address)',
    'function tokenToArtwork(uint256) view returns (uint256)',
    'function artworkToToken(uint256) view returns (uint256)',
    'function tokenCreator(uint256) view returns (address)',
    'function firstCollector(uint256) view returns (address)',
    'function tokenURI(uint256) view returns (string)',
    'function royaltyInfo(uint256,uint256) view returns (address,uint256)'
]);
const transferTopic = transfers.getEvent('Transfer').topicHash;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const nonzero = value => !/^0x0+$/i.test(value);
const positiveUint256 = value => matches(/^[1-9]\d{0,77}$/, value) && BigInt(value) < 2n ** 256n;

// This proves reciprocal deployment bindings at one block, never historical
// transfer coverage. It does not configure a listener or authorize ingestion.
export async function readNftDeploymentProof(listener, options) {
    return readAtNftDeployment(listener, options);
}

async function readAtNftDeployment(listener, options, read, coreGetter = 'nftContract') {
    const ordinaryPair = coreGetter === 'nft';
    const supportedChain = options?.chainId === 84532 || (ordinaryPair && options?.chainId === 8453);
    if (!supportedChain ||
        !Number.isSafeInteger(options.blockNumber) || options.blockNumber < 0 ||
        !matches(hashPattern, options.blockHash) || !nonzero(options.blockHash) ||
        typeof options.isCurrent !== 'function' ||
        ['coreAddress', 'nftAddress'].some(key =>
            !matches(addressPattern, options[key]) || !nonzero(options[key])) ||
        ['expectedCoreCodeHash', 'expectedNftCodeHash'].some(key =>
            !matches(hashPattern, options[key]) || !nonzero(options[key])) ||
        options.coreAddress.toLowerCase() === options.nftAddress.toLowerCase()) {
        throw new Error('Invalid NFT deployment proof inputs');
    }
    const snapshot = Object.freeze({ chainId: options.chainId, blockNumber: options.blockNumber,
        blockHash: options.blockHash.toLowerCase(), coreAddress: options.coreAddress.toLowerCase(),
        nftAddress: options.nftAddress.toLowerCase(), coreCodeHash: options.expectedCoreCodeHash.toLowerCase(),
        nftCodeHash: options.expectedNftCodeHash.toLowerCase(), isCurrent: options.isCurrent });
    let active = true, generation = 0;
    const check = attempt => {
        if (!active || attempt !== generation) throw new Error('NFT deployment proof superseded');
        if (snapshot.isCurrent() !== true || listener?.chainId !== snapshot.chainId ||
            typeof listener?.contractAddress !== 'string' || listener.contractAddress.toLowerCase() !== snapshot.coreAddress ||
            ((ordinaryPair || (listener.nftAddress != null && listener.nftAddress !== '')) &&
                (typeof listener.nftAddress !== 'string' || listener.nftAddress.toLowerCase() !== snapshot.nftAddress)) ||
            typeof listener?._readRpcCall !== 'function') throw new Error('NFT deployment proof authority changed');
    };
    try {
        check(generation);
        const proof = await listener._readRpcCall(async provider => {
            const attempt = ++generation;
            const send = async (method, params) => {
                check(attempt);
                const result = await provider.send(method, params);
                check(attempt);
                return result;
            };
            const checkChain = async () => {
                const chain = await send('eth_chainId', []);
                if (!matches(quantityPattern, chain) || BigInt(chain) !== BigInt(snapshot.chainId)) {
                    throw new Error('NFT deployment proof RPC chain mismatch');
                }
            };
            const checkHeader = async () => {
                const header = await send('eth_getBlockByNumber', [`0x${snapshot.blockNumber.toString(16)}`, false]);
                if (!matches(quantityPattern, header?.number) || BigInt(header.number) !== BigInt(snapshot.blockNumber) ||
                    !matches(hashPattern, header?.hash) || header.hash.toLowerCase() !== snapshot.blockHash) {
                    throw new Error('NFT deployment proof canonical block mismatch');
                }
                return header;
            };
            const block = Object.freeze({ blockHash: snapshot.blockHash, requireCanonical: true });
            await checkChain();
            const header = await checkHeader();
            for (const [address, expectedHash] of [[snapshot.coreAddress, snapshot.coreCodeHash],
                [snapshot.nftAddress, snapshot.nftCodeHash]]) {
                const code = await send('eth_getCode', [address, block]);
                if (!matches(/^0x(?:[0-9a-f]{2})+$/i, code) || keccak256(code) !== expectedHash) {
                    throw new Error('NFT deployment proof runtime code mismatch');
                }
            }
            const bindings = [[snapshot.coreAddress, coreGetter, snapshot.nftAddress]];
            // A later setCore on the prototype cannot invalidate transfers of tokens already minted.
            // Bootstrap and the immutable ordinary pair both require the reciprocal binding.
            if (!read || ordinaryPair) bindings.push([snapshot.nftAddress, 'core', snapshot.coreAddress]);
            for (const [address, getter, expectedAddress] of bindings) {
                const result = await send('eth_call', [{ to: address, data: getters.encodeFunctionData(getter) }, block]);
                if (!matches(hashPattern, result) ||
                    getters.decodeFunctionResult(getter, result)[0].toLowerCase() !== expectedAddress) {
                    throw new Error('NFT deployment proof reciprocal binding mismatch');
                }
            }
            const identity = Object.freeze({ chainId: snapshot.chainId, coreAddress: snapshot.coreAddress,
                nftAddress: snapshot.nftAddress, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash,
                coreCodeHash: snapshot.coreCodeHash, nftCodeHash: snapshot.nftCodeHash });
            if (ordinaryPair) {
                const finalized = await send('eth_getBlockByNumber', ['finalized', false]);
                if (!matches(quantityPattern, finalized?.number) || !matches(hashPattern, finalized?.hash) || !nonzero(finalized.hash) ||
                    BigInt(finalized.number) < BigInt(identity.blockNumber) ||
                    (BigInt(finalized.number) === BigInt(identity.blockNumber) && finalized.hash.toLowerCase() !== identity.blockHash)) {
                    throw new Error('Ordinary deployment block is not finalized');
                }
            }
            const result = read ? await read(send, identity, block, header) : identity;
            await checkHeader();
            await checkChain();
            return result;
        }, 'NFT deployment proof');
        check(generation);
        return proof;
    } finally {
        active = false;
    }
}

async function readOrdinaryAuctionField(send, proof, block, auctionId, method) {
    const data = getters.encodeFunctionData(method, [auctionId]);
    const raw = await send('eth_call', [{ to: proof.coreAddress, data }, block]);
    const words = getters.getFunction(method).outputs.length;
    if (typeof raw !== 'string' || raw.length !== 2 + 64 * words || !/^0x[0-9a-f]+$/i.test(raw)) {
        throw new Error('Invalid ordinary offer response');
    }
    const result = getters.decodeFunctionResult(method, raw);
    if (getters.encodeFunctionResult(method, result) !== raw.toLowerCase()) throw new Error('Invalid ordinary offer encoding');
    return result;
}

// Read one sale on the reviewed replacement pair without modifying the prototype cursor.
export async function readOrdinarySettlement(listener, options) {
    const tx = options?.transactionHash;
    if (!matches(hashPattern, tx) || !nonzero(tx) || !positiveUint256(options?.auctionId)) {
        throw new Error('Invalid ordinary settlement request');
    }
    const transactionHash = tx.toLowerCase(), auctionId = options.auctionId;
    return readAtNftDeployment(listener, options, async (send, proof, block, header) => {
        const receipt = await send('eth_getTransactionReceipt', [transactionHash]);
        const sale = parseOrdinarySettlement(receipt, proof, transactionHash, auctionId);
        verifyTransactionPosition(receipt, header, transactionHash);
        const auction = await readOrdinaryAuctionField(send, proof, block, auctionId, 'auctions');
        const offer = await readOrdinaryAuctionField(send, proof, block, auctionId, 'runnerUpOffers');
        // A prior losing bid can leave a price in this mapping even when no offer ever opened.
        const accepted = offer.deadline !== 0n;
        const buyer = accepted ? offer.bidder : auction.highestBidder;
        const price = accepted ? offer.price : auction.price;
        if (auction.state !== 4n || auction.artworkId.toString() !== sale.artworkId ||
            auction.firstCollector.toLowerCase() !== sale.firstCollector || buyer.toLowerCase() !== sale.firstCollector ||
            price.toString() !== sale.priceWei || sale.runnerUpAccepted !== accepted ||
            (accepted && (!matches(quantityPattern, header.timestamp) || BigInt(header.timestamp) > offer.deadline))) {
            throw new Error('Ordinary settlement receipt and finalized auction state disagree');
        }
        return sale;
    }, 'nft');
}

async function readField(send, address, block, abi, name, args) {
    const data = abi.encodeFunctionData(name, args);
    const raw = await send('eth_call', [{ to: address, data }, block]);
    const result = abi.decodeFunctionResult(name, raw);
    if (abi.encodeFunctionResult(name, result) !== raw.toLowerCase()) throw new Error('Invalid ordinary token encoding');
    return result;
}

export async function readOrdinaryRefundEntry(listener, options) {
    const { event, auctionId, entry, transactionHash } = options;
    const processed = event === 'OutbidRefundProcessed';
    if ((!processed && event !== 'OutbidRefundQueued') || !positiveUint256(auctionId) ||
        (entry !== '0' && !positiveUint256(entry)) || !matches(hashPattern, transactionHash) || !nonzero(transactionHash)) {
        throw new Error('Invalid ordinary refund entry request');
    }
    const hash = transactionHash.toLowerCase();
    return readAtNftDeployment(listener, options, async (send, proof, block, header) => {
        const receipt = await send('eth_getTransactionReceipt', [hash]);
        checkReceipt(receipt, proof, hash, event);
        verifyTransactionPosition(receipt, header, hash);
        const topics = getters.encodeFilterTopics(event, [auctionId, entry]);
        const logs = receipt.logs.filter(log => log.address?.toLowerCase() === proof.coreAddress &&
            topics.every((topic, index) => log.topics?.[index]?.toLowerCase() === topic));
        if (logs.length !== 1) throw new Error('Expected one matching ordinary refund event');
        const {args, index} = decodeReceiptLog(getters, event, logs[0], receipt);
        const [cursor, total] = await readOrdinaryAuctionField(send, proof, block, auctionId, 'refundProgress');
        if (!nonzero(args.creditor) || args.amount === 0n || cursor > total || BigInt(entry) >= total ||
            (processed && BigInt(entry) >= cursor)) throw new Error('Refund event disagrees with finalized queue');
        return { ...proof, transactionHash: hash, logIndex: index, auctionId, entry, creditor: args.creditor.toLowerCase(),
            amountWei: args.amount.toString(), ...(processed && { paid: args.paid }) };
    }, 'nft');
}

export async function readOrdinaryRegistration(listener, options) {
    const tx = options?.transactionHash, logIndex = options?.logIndex;
    if (!matches(hashPattern, tx) || !nonzero(tx) || !Number.isSafeInteger(logIndex) || logIndex < 0) {
        throw new Error('Invalid ordinary registration location');
    }
    const transactionHash = tx.toLowerCase();
    return readAtNftDeployment(listener, options, async (send, proof, block, header) => {
        const receipt = await send('eth_getTransactionReceipt', [transactionHash]);
        checkReceipt(receipt, proof, transactionHash, 'ordinary registration');
        verifyTransactionPosition(receipt, header, transactionHash);
        const logs = receipt.logs.filter(log => log.logIndex?.toLowerCase() === '0x' + logIndex.toString(16));
        const event = getters.getEvent('ArtworkRegistered');
        if (logs.length !== 1 || logs[0].address?.toLowerCase() !== proof.coreAddress ||
            logs[0].topics?.[0]?.toLowerCase() !== event.topicHash) throw new Error('Missing or ambiguous ordinary registration');
        const [log] = logs;
        receiptLogIndex(log, receipt);
        // Two ABI words precede the padded URI. Bound the payload before decoding it.
        if (typeof log.data !== 'string' || log.data.length > 2 + 2 * (64 + 2048) || log.topics.length !== 3) {
            throw new Error('Invalid ordinary registration event');
        }
        const { artworkId, creator } = getters.decodeEventLog(event, log.data, log.topics);
        const topics = getters.encodeFilterTopics(event, [artworkId, creator]);
        // The contract accepts up to 2048 URI bytes, including non-UTF-8 and NUL.
        const coder = AbiCoder.defaultAbiCoder();
        const [metadataUriHex] = coder.decode(['bytes'], log.data);
        if (!artworkId || !nonzero(creator) ||
            topics.some((topic, i) => topic !== log.topics[i].toLowerCase()) ||
            metadataUriHex.length <= 2 || metadataUriHex.length > 2 + 2048 * 2 ||
            coder.encode(['bytes'], [metadataUriHex]) !== log.data.toLowerCase()) throw new Error('Invalid ordinary registration event');
        const work = await readField(send, proof.coreAddress, block, getters, 'works', [artworkId]);
        if (work.creator !== creator || work.metadata !== metadataUriHex) throw new Error('Registration and finalized work disagree');
        return { ...proof, transactionHash, logIndex, artworkId: artworkId.toString(), creator: creator.toLowerCase(), metadataUriHex };
    }, 'nft');
}

export async function readOrdinaryResalePurchase(listener, options) {
    const tx = options?.transactionHash, logIndex = options?.logIndex;
    if (!matches(hashPattern, tx) || !nonzero(tx) || !Number.isSafeInteger(logIndex) ||
        logIndex < 1 || logIndex >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid ordinary resale receipt location');
    const transactionHash = tx.toLowerCase();
    return readAtNftDeployment(listener, options, async (send, proof, block, header) => {
        const receipt = await send('eth_getTransactionReceipt', [transactionHash]);
        const sale = parseOrdinaryResale(receipt, proof, transactionHash, logIndex);
        verifyTransactionPosition(receipt, header, transactionHash);
        const nftField = name => readField(send, proof.nftAddress, block, token, name, [sale.tokenId]);
        const treasury = name => readField(send, proof.coreAddress, block, getters, name, []);
        const [[artworkId], [creator], [firstCollector], [protocol], [ecosystem]] = await Promise.all([
            nftField('tokenToArtwork'), nftField('tokenCreator'), nftField('firstCollector'),
            treasury('protocolTreasury'), treasury('ecosystemTreasury')
        ]);
        if (!artworkId || !nonzero(creator) || !nonzero(firstCollector) ||
            protocol.toLowerCase() !== sale.protocol || ecosystem.toLowerCase() !== sale.ecosystem) {
            throw new Error('Ordinary resale credits and deployment disagree');
        }
        return { ...sale, artworkId: artworkId.toString(), creator: creator.toLowerCase(),
            firstCollector: firstCollector.toLowerCase() };
    }, 'nft');
}

// Read the same interface a wallet can use, pinned to one reviewed issuer and finalized block.
export async function readOrdinaryToken(listener, options) {
    const tokenId = options?.tokenId;
    if (!positiveUint256(tokenId)) throw new Error('Invalid ordinary token ID');
    return readAtNftDeployment(listener, options, async (send, proof, block) => {
        const field = (name, args) => readField(send, proof.nftAddress, block, token, name, args);
        const interfaces = [['0x01ffc9a7', true], ['0xffffffff', false],
            ['0x80ac58cd', true], ['0x5b5e139f', true], ['0x2a55205a', true]];
        await Promise.all(interfaces.map(async ([id, expected]) => {
            const [supported] = await field('supportsInterface', [id]);
            if (supported !== expected) throw new Error('Ordinary token interfaces differ from the reviewed standard');
        }));
        const [[owner], [creator], [firstCollector], [metadataURI], [recipient, royalty], [artworkId]] = await Promise.all([
            field('ownerOf', [tokenId]), field('tokenCreator', [tokenId]), field('firstCollector', [tokenId]),
            field('tokenURI', [tokenId]), field('royaltyInfo', [tokenId, 10_000n]), field('tokenToArtwork', [tokenId])
        ]);
        if (![owner, creator, firstCollector].every(nonzero) || !metadataURI.trim() ||
            recipient !== creator || royalty !== 550n) throw new Error('Invalid ordinary token provenance or royalty');
        if (artworkId === 0n) throw new Error('Ordinary token has no registered artwork');
        const [issuedToken] = await field('artworkToToken', [artworkId]);
        if (issuedToken !== BigInt(tokenId)) throw new Error('Ordinary token and artwork mappings disagree');
        return Object.freeze({ ...proof, tokenId, artworkId: artworkId.toString(), owner: owner.toLowerCase(), creator: creator.toLowerCase(),
            firstCollector: firstCollector.toLowerCase(), metadataURI, royaltyRecipient: recipient.toLowerCase(),
            royaltyBps: Number(royalty) });
    }, 'nft');
}

// Quotes describe the requested finalized block. The Core rechecks the terms when a buyer submits.
export async function readOrdinaryResaleQuote(listener, options) {
    const tokenId = options?.tokenId;
    if (!positiveUint256(tokenId)) throw new Error('Invalid ordinary resale token ID');
    return readAtNftDeployment(listener, options, async (send, proof, block) => {
        const method = 'getActiveResale';
        const data = getters.encodeFunctionData(method, [tokenId]);
        const raw = await send('eth_call', [{ to: proof.coreAddress, data }, block]);
        if (!matches(/^0x[0-9a-f]{256}$/i, raw)) throw new Error('Invalid ordinary resale quote');
        const quote = getters.decodeFunctionResult(method, raw);
        const [active, seller, price, version] = quote;
        if (getters.encodeFunctionResult(method, quote) !== raw.toLowerCase() ||
            (active ? !nonzero(seller) || price === 0n || version === 0n : nonzero(seller) || price !== 0n)) {
            throw new Error('Invalid ordinary resale quote');
        }
        return Object.freeze({ ...proof, tokenId, active, seller: active ? seller.toLowerCase() : null,
            priceWei: price.toString(), version: version.toString() });
    }, 'nft');
}

// The runner-up mapping remembers bids before an offer and retains its terms after closure.
// Only the auction state and timestamp of the same finalized block establish a purchase right.
export async function readOrdinaryRunnerUpOffer(listener, options) {
    const auctionId = options?.auctionId;
    if (!positiveUint256(auctionId)) throw new Error('Invalid ordinary auction ID');
    const page = await readOrdinaryRunnerUpOffers(listener, options, [auctionId]);
    return page.offers[0];
}

// Share deployment and block verification across a bounded page of known auctions.
export async function readOrdinaryRunnerUpOffers(listener, options, ids) {
    if (!Array.isArray(ids) || ids.length > 16 || !ids.every(positiveUint256) || new Set(ids).size !== ids.length) {
        throw new Error('Invalid ordinary auction page');
    }
    const auctionIds = [...ids];
    return readAtNftDeployment(listener, options, async (send, proof, block, header) => {
        if (!matches(quantityPattern, header.timestamp)) throw new Error('Invalid ordinary offer block timestamp');
        const offers = [];
        for (const auctionId of auctionIds) {
            const auction = await readOrdinaryAuctionField(send, proof, block, auctionId, 'auctions');
            if (auction.artworkId === 0n || auction.state === 0n) throw new Error('Unknown ordinary auction');
            const offer = await readOrdinaryAuctionField(send, proof, block, auctionId, 'runnerUpOffers');
            const offered = offer.deadline !== 0n;
            const settled = 4n, defaulted = 5n, runnerUpOffer = 6n; // OrdinaryArtAuctions.State
            if (auction.state > runnerUpOffer || (auction.state === runnerUpOffer && !offered) ||
                (offered && (auction.state < settled || !nonzero(offer.bidder) || offer.price === 0n ||
                    (auction.state === settled && auction.firstCollector !== offer.bidder)))) {
                throw new Error('Inconsistent ordinary runner-up offer');
            }
            let status = 'not_offered';
            if (offered) {
                if (auction.state === settled) status = 'accepted';
                else if (auction.state === defaulted) status = 'closed';
                else status = BigInt(header.timestamp) <= offer.deadline ? 'open' : 'expired';
            }
            const bidder = offered ? offer.bidder.toLowerCase() : null;
            offers.push(Object.freeze({ ...proof, auctionId, artworkId: auction.artworkId.toString(), status, bidder,
                eligibleBuyer: status === 'open' ? bidder : null, priceWei: offered ? offer.price.toString() : null,
                deadline: offered ? offer.deadline.toString() : null }));
        }
        return { ...proof, offers };
    }, 'nft');
}

// A bounded, read-only batch. Persistence must independently require this range
// to follow the same deployment's committed coverage; a read is not a cursor.
export function readNftTransferRange(listener, options) {
    return readTransferRange(listener, options, 'nftContract');
}

export function readOrdinaryTransferRange(listener, options) {
    return readTransferRange(listener, options, 'nft');
}

async function readTransferRange(listener, options, coreGetter) {
    // Normal catch-up stays at 1,000 blocks. A reviewed historical replay may
    // request larger sparse windows, with the same log, source and fork checks.
    // This bounds RPC work without repeating deployment reads for every empty
    // 1,000-block window across months of history.
    const maxBlocks = options?.maxBlocks ?? 1000;
    if (!options || !Number.isSafeInteger(options.fromBlock) || options.fromBlock < 1 ||
        !Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 100000 ||
        !Number.isSafeInteger(options.blockNumber) || options.blockNumber < options.fromBlock ||
        options.blockNumber - options.fromBlock >= maxBlocks ||
        !matches(hashPattern, options.previousBlockHash) || !nonzero(options.previousBlockHash) ||
        typeof options.bootstrap !== 'boolean') throw new Error('Invalid NFT transfer range');
    const fromBlock = options.fromBlock;
    const toBlock = options.blockNumber;
    const previousBlockHash = options.previousBlockHash.toLowerCase();
    const bootstrap = options.bootstrap;
    return readAtNftDeployment(listener, options, async (send, proof) => {
        const previous = await send('eth_getBlockByNumber', [`0x${(fromBlock - 1).toString(16)}`, false]);
        if (!matches(quantityPattern, previous?.number) || BigInt(previous.number) !== BigInt(fromBlock - 1) ||
            !matches(hashPattern, previous?.hash) || previous.hash.toLowerCase() !== previousBlockHash) {
            throw new Error('NFT transfer predecessor changed');
        }
        if (bootstrap) {
            const atOrigin = { blockHash: previousBlockHash, requireCanonical: true };
            const code = await send('eth_getCode', [proof.nftAddress, atOrigin]);
            if (!matches(/^0x(?:[0-9a-f]{2})+$/i, code) || keccak256(code) !== proof.nftCodeHash) {
                throw new Error('NFT transfer origin runtime mismatch');
            }
            // The pinned NFT's supply is monotonic and has no reset/burn path.
            // Zero proves no token transfer can predate the first covered block.
            const supply = await send('eth_call', [{ to: proof.nftAddress,
                data: getters.encodeFunctionData('totalSupply') }, atOrigin]);
            if (!matches(hashPattern, supply) || getters.decodeFunctionResult('totalSupply', supply)[0] !== 0n) {
                throw new Error('NFT transfer origin already has minted tokens');
            }
        }
        const logs = await send('eth_getLogs', [{ address: proof.nftAddress, topics: [transferTopic],
            fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }]);
        if (!Array.isArray(logs) || logs.length > 10000) throw new Error('NFT transfer log result exceeds its bound');
        const seen = new Set(), positions = new Set(), blockHashes = new Map(), transactionPositions = new Map(), transactionsAtPosition = new Map();
        const events = logs.map(log => {
            if (!log || typeof log !== 'object' || log.removed !== false ||
                !matches(addressPattern, log.address) || log.address.toLowerCase() !== proof.nftAddress ||
                !matches(quantityPattern, log.blockNumber) || !matches(quantityPattern, log.logIndex) ||
                !matches(quantityPattern, log.transactionIndex) ||
                !matches(hashPattern, log.blockHash) || !nonzero(log.blockHash) ||
                !matches(hashPattern, log.transactionHash) || !nonzero(log.transactionHash) ||
                !Array.isArray(log.topics) || log.topics.length !== 4 ||
                log.topics.some(topic => !matches(hashPattern, topic)) ||
                log.topics[0].toLowerCase() !== transferTopic || log.data !== '0x') {
                throw new Error('Invalid NFT Transfer log');
            }
            const blockNumber = Number(BigInt(log.blockNumber)), logIndex = Number(BigInt(log.logIndex));
            const transactionIndex = Number(BigInt(log.transactionIndex));
            if (![blockNumber, logIndex, transactionIndex].every(Number.isSafeInteger) ||
                blockNumber < fromBlock || blockNumber > toBlock) throw new Error('NFT Transfer log outside range');
            const transactionHash = log.transactionHash.toLowerCase(), blockHash = log.blockHash.toLowerCase();
            const key = `${transactionHash}:${logIndex}`, position = `${blockNumber}:${logIndex}`;
            const transactionPosition = `${blockNumber}:${transactionIndex}`;
            if (seen.has(key) || positions.has(position) ||
                (blockHashes.has(blockNumber) && blockHashes.get(blockNumber) !== blockHash) ||
                (transactionPositions.has(transactionHash) && transactionPositions.get(transactionHash) !== transactionPosition) ||
                (transactionsAtPosition.has(transactionPosition) && transactionsAtPosition.get(transactionPosition) !== transactionHash) ||
                (blockNumber === toBlock && blockHash !== proof.blockHash)) throw new Error('Conflicting NFT Transfer logs');
            seen.add(key); positions.add(position); blockHashes.set(blockNumber, blockHash);
            transactionPositions.set(transactionHash, transactionPosition);
            transactionsAtPosition.set(transactionPosition, transactionHash);
            // Canonical ABI round-trip rejects nonzero address padding and coercion.
            const parsed = transfers.parseLog(log);
            const encoded = transfers.encodeEventLog('Transfer', parsed.args);
            if (encoded.topics.some((topic, index) => topic !== log.topics[index].toLowerCase()) ||
                parsed.args.tokenId === 0n || /^0x0+$/i.test(parsed.args.to)) throw new Error('Invalid NFT Transfer payload');
            return Object.freeze({ eventName: 'Transfer', contractAddress: proof.nftAddress, blockNumber,
                blockHash, transactionHash, transactionIndex, logIndex,
                eventData: Object.freeze({ from: parsed.args.from.toLowerCase(), to: parsed.args.to.toLowerCase(),
                    tokenId: parsed.args.tokenId.toString() }) });
        }).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
        for (let index = 1; index < events.length; index++) {
            if (events[index].blockNumber === events[index - 1].blockNumber &&
                events[index].transactionIndex < events[index - 1].transactionIndex) {
                throw new Error('Conflicting NFT Transfer transaction order');
            }
        }
        // Validate each represented block, not only the range endpoint. An RPC
        // cannot mix an orphan log into a batch with a canonical endpoint.
        const timestamps = new Map();
        for (const [number, expectedHash] of blockHashes) {
            const header = await send('eth_getBlockByNumber', [`0x${number.toString(16)}`, false]);
            if (!matches(quantityPattern, header?.number) || BigInt(header.number) !== BigInt(number) ||
                !matches(hashPattern, header?.hash) || header.hash.toLowerCase() !== expectedHash ||
                !matches(quantityPattern, header?.timestamp) ||
                !Number.isSafeInteger(Number(BigInt(header.timestamp)) * 1000)) {
                throw new Error('NFT Transfer log is not canonical');
            }
            timestamps.set(number, Number(BigInt(header.timestamp)) * 1000);
        }
        return Object.freeze({ ...proof, fromBlock, previousBlockHash, bootstrap,
            events: Object.freeze(events.map(event => Object.freeze({ ...event, timestamp: timestamps.get(event.blockNumber) }))) });
    }, coreGetter);
}
