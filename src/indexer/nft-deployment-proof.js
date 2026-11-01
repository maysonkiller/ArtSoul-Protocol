import { Interface, keccak256 } from 'ethers';

const getters = new Interface([
    'function nftContract() view returns (address)',
    'function core() view returns (address)'
]);
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const nonzero = value => !/^0x0+$/i.test(value);

// This proves reciprocal deployment bindings at one block, never historical
// transfer coverage. It does not configure a listener or authorize ingestion.
export async function readNftDeploymentProof(listener, options) {
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
            for (const [address, getter, expectedAddress] of [[snapshot.coreAddress, 'nftContract', snapshot.nftAddress],
                [snapshot.nftAddress, 'core', snapshot.coreAddress]]) {
                const result = await send('eth_call', [{ to: address, data: getters.encodeFunctionData(getter) }, block]);
                if (!matches(hashPattern, result) ||
                    getters.decodeFunctionResult(getter, result)[0].toLowerCase() !== expectedAddress) {
                    throw new Error('NFT deployment proof reciprocal binding mismatch');
                }
            }
            await checkHeader();
            await checkChain();
            return Object.freeze({ chainId: snapshot.chainId, coreAddress: snapshot.coreAddress,
                nftAddress: snapshot.nftAddress, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash,
                coreCodeHash: snapshot.coreCodeHash, nftCodeHash: snapshot.nftCodeHash });
        }, 'NFT deployment proof');
        check(generation);
        return proof;
    } finally {
        active = false;
    }
}
