import { Interface, ZeroAddress } from 'ethers';
import { createHash } from 'node:crypto';
import finalizedMints from './catalog-finalized-mints.json' with { type: 'json' };
import historicalPublications from './catalog-finalized-publications.json' with { type: 'json' };
import { normalizeWallet } from './backend.js';
import { readAuraBorderSetting } from './aura-border-setting.js';
import { confirmedPublisherWorks, publisherFrameStates } from './platform-artwork-aura.js';
import { createRegistrationReaders } from './upload-registration-evidence.js';

// The historical catalog issued all three events in the purchase transaction.
// These events identify the issuer even after an NFT leaves the original buyer.
const abi = new Interface([
    'event ArtworkRegistered(uint256 indexed artworkId,address indexed creator,string metadataURI)',
    'event CanonicalArtworkMinted(uint256 indexed tokenId,uint256 indexed artworkId,address indexed creator,address owner,string tokenURI)',
    'event SettlementCompleted(uint256 indexed auctionId,uint256 indexed artworkId,address indexed winner,uint256 finalPrice,uint256 tokenId)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
]);
const core = '0x43368f7e2d5f11f4b7e11928d66d3f4a5a4e4cef';
const nft = '0xf061f70503c37cf2196a28f4785e524d0fb32538';
const readers = createRegistrationReaders(['https://base-sepolia.drpc.org','https://base-sepolia.gateway.tenderly.co']);
const cache = new Map(), inFlight = new Map();
const hashPattern = /^0x[0-9a-f]{64}$/;

export function catalogMintOrigin(receipt, hash) {
    if (!hashPattern.test(hash) || receipt?.transactionHash !== hash || receipt.status !== '0x1' ||
        !hashPattern.test(receipt.blockHash) || !Array.isArray(receipt.logs)) return null;
    const events = [];
    for (const log of receipt.logs) {
        const emitter = log.address?.toLowerCase();
        if (emitter !== core && emitter !== nft) continue;
        if (log.removed || log.transactionHash !== hash || log.blockHash !== receipt.blockHash ||
            log.blockNumber !== receipt.blockNumber) return null;
        const event = abi.parseLog(log);
        if (event) events.push({emitter, event});
    }
    const one = (address, name) => {
        const found = events.filter(e => e.emitter === address && e.event.name === name);
        return found.length === 1 ? found[0].event.args : null;
    };
    const mint = one(nft,'CanonicalArtworkMinted'), paid = one(core,'SettlementCompleted'), transfer = one(nft,'Transfer');
    if (!mint || !paid || !transfer || paid.finalPrice <= 0n || paid.tokenId !== mint.tokenId ||
        paid.artworkId !== mint.artworkId || paid.winner !== mint.owner || transfer.tokenId !== mint.tokenId ||
        transfer.from !== ZeroAddress || transfer.to !== mint.owner || mint.creator === ZeroAddress) return null;
    return {artworkId: String(mint.artworkId), tokenId: String(mint.tokenId), creator: mint.creator.toLowerCase(), uri: mint.tokenURI};
}

export function catalogOriginDigest(hash, origin) {
    const fields = [84532, core, nft, hash, origin.artworkId, origin.tokenId, origin.creator, origin.uri];
    return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export function catalogRegistration(receipt, hash) {
    if (receipt?.status !== '0x1' || receipt.transactionHash !== hash || !Array.isArray(receipt.logs)) return null;
    const records = [];
    for (const log of receipt.logs) {
        if (log.address?.toLowerCase() !== core || log.topics?.[0] !== abi.getEvent('ArtworkRegistered').topicHash) continue;
        if (log.removed || log.transactionHash !== hash || log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber) return null;
        const {artworkId, creator, metadataURI} = abi.parseLog(log).args;
        const index = Number(BigInt(log.logIndex));
        if (!Number.isSafeInteger(index) || index < 0 || creator === ZeroAddress) return null;
        records.push({artworkId:String(artworkId),creator:creator.toLowerCase(),uri:metadataURI,logIndex:index});
    }
    return records.length === 1 ? records[0] : null;
}

export function publicationDigest(hash, origin) {
    return createHash('sha256').update(JSON.stringify([84532, core, hash, origin.artworkId, origin.creator,
        origin.uri, origin.logIndex])).digest('hex');
}

export async function readFinalizedCatalogMint(hash, providers = readers, timeout = 3200, parseOrigin = catalogMintOrigin) {
    if (!hashPattern.test(hash)) throw new Error('Expected a public transaction hash.');
    const signal = AbortSignal.timeout(timeout);
    const results = await Promise.all(providers.map(async rpc => {
        const [chain, finalized, receipt] = await Promise.all([rpc('eth_chainId',[],{signal}),
            rpc('eth_getBlockByNumber',['finalized',false],{signal}), rpc('eth_getTransactionReceipt',[hash],{signal})]);
        if (chain !== '0x14a34' || !receipt || BigInt(receipt.blockNumber) > BigInt(finalized.number)) return null;
        const block = await rpc('eth_getBlockByNumber',[receipt.blockNumber,false],{signal});
        if (block?.hash !== receipt.blockHash || block.number !== receipt.blockNumber || !block.transactions.includes(hash)) return null;
        const origin = parseOrigin(receipt,hash);
        return origin && {origin, blockHash:block.hash, blockNumber:Number(BigInt(block.number))};
    }));
    return results[0] && JSON.stringify(results[0]) === JSON.stringify(results[1]) ? results[0] : null;
}

function originFor(hash) {
    const entry = cache.get(hash);
    if (entry && entry.until > Date.now()) return entry.value;
    if (inFlight.has(hash)) return inFlight.get(hash);
    if (inFlight.size >= 4) return null;
    const read = readFinalizedCatalogMint(hash).then(record => record?.origin).catch(() => null).then(value => {
        cache.set(hash,{value,until: Date.now() + (value ? 86400000 : 15000)});
        if (cache.size > 256) cache.delete(cache.keys().next().value);
        return value;
    }).finally(() => inFlight.delete(hash));
    inFlight.set(hash,read);
    return read;
}

export async function withCatalogMintOrigins(cards) {
    if (process.env.ARTSOUL_AURA_SOURCES_ENABLED !== 'true' ||
        normalizeWallet(process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA) !== core ||
        normalizeWallet(process.env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA ?? nft) !== nft) return cards;
    const candidates = cards.filter(c => c.source === 'v41_projection' && c.chain_id === 84532 && c.minted === true &&
        !c.aura_kind && hashPattern.test(c.mint_transaction_hash) && normalizeWallet(c.creator));
    const publications = cards.filter(c => c.source === 'v41_projection' && c.chain_id === 84532 &&
        c.minted === false && normalizeWallet(c.creator) && hashPattern.test(c.transaction_hash));
    const addresses = [...new Set([...candidates, ...publications].map(c => normalizeWallet(c.creator)))];
    if (!addresses.length || addresses.length > 200) return cards;
    try {
        const states = await publisherFrameStates(addresses,84532,core);
        const publishers = new Map(states.filter(s=>s.enabled).map(s=>[s.address,s.kind]));
        const eligible = publications.filter(c=>publishers.has(normalizeWallet(c.creator)));
        const archivedWorks = eligible.filter(c=>{
            const entry = historicalPublications[c.transaction_hash];
            return entry && c.block_number === entry.blockNumber && entry.digest === publicationDigest(c.transaction_hash,
                {artworkId:String(c.artwork_id),creator:normalizeWallet(c.creator),uri:c.metadata_uri,logIndex:c.registration_log_index});
        });
        const registered = confirmedPublisherWorks(eligible.filter(c=>!historicalPublications[c.transaction_hash]), core).catch(()=>new Set());
        const marked = new Set();
        await Promise.all(candidates.filter(c=>publishers.has(normalizeWallet(c.creator))).map(async card=>{
            const hash = card.mint_transaction_hash;
            const archived = finalizedMints[hash];
            if (archived) {
                const digest = catalogOriginDigest(hash, {artworkId:String(card.artwork_id), tokenId:String(card.token_id),
                    creator:normalizeWallet(card.creator), uri:card.metadata_uri});
                if (digest === archived.digest) marked.add(card);
                return;
            }
            const proof = await originFor(hash);
            if (proof?.creator === normalizeWallet(card.creator) && proof.artworkId === String(card.artwork_id) &&
                proof.tokenId === String(card.token_id) && proof.uri === card.metadata_uri) marked.add(card);
        }));
        const credited = await registered;
        for (const work of archivedWorks) credited.add(work);
        if (!marked.size && !credited.size) return cards;
        const labels = await readAuraBorderSetting().then(s=>s.enabled,()=>false);
        return cards.map(card=>{
            if (!marked.has(card) && !credited.has(card)) return card;
            const kind = publishers.get(normalizeWallet(card.creator));
            const origin = kind === 'founder' ? {founder_origin_verified:true} :
                marked.has(card) ? {platform_origin_verified:true} : {platform_publication_verified:true};
            return {...card,...origin,...(marked.has(card) || kind === 'founder' ? {aura_kind:kind} : {}),
                ...(labels ? {aura_border_text:true} : {})};
        });
    } catch { return cards; }
}
