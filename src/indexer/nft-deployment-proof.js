import { Interface, keccak256 } from 'ethers';

const getters = new Interface([
    'function nftContract() view returns (address)',
    'function core() view returns (address)',
    'function totalSupply() view returns (uint256)'
]);
const transfers = new Interface(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']);
const transferTopic = transfers.getEvent('Transfer').topicHash;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const nonzero = value => !/^0x0+$/i.test(value);

// This proves reciprocal deployment bindings at one block, never historical
// transfer coverage. It does not configure a listener or authorize ingestion.
export async function readNftDeploymentProof(listener, options) {
    return readAtNftDeployment(listener, options);
}

async function readAtNftDeployment(listener, options, readRange) {
    if (!options || options.chainId !== 84532 ||
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
            (listener.nftAddress != null && listener.nftAddress !== '' &&
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
            };
            const block = Object.freeze({ blockHash: snapshot.blockHash, requireCanonical: true });
            await checkChain();
            await checkHeader();
            for (const [address, expectedHash] of [[snapshot.coreAddress, snapshot.coreCodeHash],
                [snapshot.nftAddress, snapshot.nftCodeHash]]) {
                const code = await send('eth_getCode', [address, block]);
                if (!matches(/^0x(?:[0-9a-f]{2})+$/i, code) || keccak256(code) !== expectedHash) {
                    throw new Error('NFT deployment proof runtime code mismatch');
                }
            }
            const bindings = [[snapshot.coreAddress, 'nftContract', snapshot.nftAddress]];
            // A later setCore cannot invalidate transfers of already minted tokens.
            // The standalone bootstrap proof still checks the reciprocal binding.
            if (!readRange) bindings.push([snapshot.nftAddress, 'core', snapshot.coreAddress]);
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
            const result = readRange ? await readRange(send, identity) : identity;
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

// A bounded, read-only batch. Persistence must independently require this range
// to follow the same deployment's committed coverage; a read is not a cursor.
export async function readNftTransferRange(listener, options) {
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
    });
}
