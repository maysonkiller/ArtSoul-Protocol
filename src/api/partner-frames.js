import { id, keccak256 } from 'ethers';
import { supabaseRest } from './backend.js';
import { readAuraBorderSetting } from './aura-border-setting.js';
import { createRegistrationReaders } from './upload-registration-evidence.js';
import { verifiedArtworkAura } from './verified-artwork-aura.js';
import { reviewedCollectionRuntime } from './collection-frame-runtime.js';
import { rehearsalNft } from '../../scripts/rehearsal-review/deployment.mjs';
import { profileGenesisDeployment } from './profile-genesis.js';

const networks = {
    8453:['https://mainnet.base.org','https://base-rpc.publicnode.com'],
    84532:['https://sepolia.base.org','https://base-sepolia-rpc.publicnode.com']
};
const txHash = /^0x[0-9a-f]{64}$/;
const creatorSelector = id('creator()').slice(0,10);
const blockNumber = value => typeof value === 'string' && /^0x[0-9a-f]{1,13}$/.test(value) ? Number(BigInt(value)) : NaN;

async function observeCollectionContract(chain, address, issuer, readers) {
    const signal = AbortSignal.timeout(4500);
    if (readers.length !== 2) throw new Error('Two collection observations are required');
    const heads = await Promise.all(readers.map(async rpc => {
        const [network, head] = await Promise.all([rpc('eth_chainId', [], {signal}),
            rpc('eth_getBlockByNumber', ['finalized',false], {signal})]);
        if (blockNumber(network) !== chain || !Number.isSafeInteger(blockNumber(head?.number)) ||
            !txHash.test(head?.hash) || /^0x0{64}$/.test(head.hash)) {
            throw new Error('Invalid collection network or finalized block');
        }
        return head;
    }));
    const head = blockNumber(heads[0].number) <= blockNumber(heads[1].number) ? heads[0] : heads[1];
    if (heads[0].number === heads[1].number && heads[0].hash !== heads[1].hash) {
        throw new Error('Finalized collection blocks differ');
    }
    const at = {blockHash:head.hash,requireCanonical:true};
    const codes = await Promise.all(readers.map(rpc=>rpc('eth_getCode',[address,at],{signal})));
    if (codes.some(code=>typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(code)) ||
        codes[0].toLowerCase() !== codes[1].toLowerCase()) throw new Error('Contract observations differ');
    if (codes[0] === '0x' || /^0xef0100[0-9a-f]{40}$/i.test(codes[0])) return false;
    const runtime = issuer && reviewedCollectionRuntime(codes[0]);
    if (issuer && !runtime) return false;

    const support = await Promise.all(readers.map(rpc=>Promise.all(['01ffc9a7','ffffffff','80ac58cd'].map(id=>
        rpc('eth_call',[{to:address,gas:'0xf000',data:'0x01ffc9a7'+id.padEnd(64,'0')},at],{signal})))));
    if (support[0].some((answer,i)=>answer !== support[1][i])) throw new Error('Collection interfaces differ');
    const encoded = value=>'0x'+String(value).padStart(64,'0');
    if (!support[0].every((answer,i)=>answer === encoded(i === 1 ? 0 : 1))) return false;
    if (!issuer) return true;
    // creator() returns the immutable original issuer. owner() may change.
    const answers = await Promise.all(readers.map(rpc=>rpc('eth_call',[{to:address,data:creatorSelector},at],{signal})));
    if (answers[0] !== answers[1]) throw new Error('Collection issuer observations differ');
    return answers[0]?.toLowerCase() === '0x'+issuer.slice(2).padStart(64,'0') ? runtime : false;
}

export function hasPartnerContract(chain, address, readers = createRegistrationReaders(networks[chain])) {
    if (reservedCollection(chain,address)) return Promise.resolve(false);
    return observeCollectionContract(chain,address,null,readers);
}

function reservedCollection(chain,address) {
    const reserved = chain === 84532 ? [rehearsalNft, '0xf061f70503c37cf2196a28f4785e524d0fb32538',
        process.env.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA,process.env.ARTSOUL_PROJECT_NFT_ADDRESS_BASE_SEPOLIA] :
        [process.env.ARTSOUL_NFT_ADDRESS_BASE_MAINNET,profileGenesisDeployment()?.p_genesis];
    return reserved.some(value=>value && value.toLowerCase() === address.toLowerCase());
}

export function officialCollectionRuntime(chain,address,issuer,readers = createRegistrationReaders(networks[chain])) {
    if (!/^0x[0-9a-f]{40}$/.test(issuer) || /^0x0{40}$/.test(issuer)) return null;
    return observeCollectionContract(chain,address,issuer,readers);
}

export function mintTransactionHint(mint) {
    return txHash.test(mint?.transactionHash) ? {mintTransactionHash:mint.transactionHash} : {};
}

async function officialIssuerAtMint(source, readers, blockHash, signal) {
    if (!/^0x[0-9a-f]{40}$/.test(source.issuer) || !txHash.test(source.runtime_hash)) return false;
    const at = {blockHash,requireCanonical:true};
    const evidence = await Promise.all(readers.map(async rpc => {
        const [code, creator] = await Promise.all([
            rpc('eth_getCode',[source.address,at],{signal}),
            rpc('eth_call',[{to:source.address,data:creatorSelector},at],{signal})
        ]);
        return /^0x(?:[0-9a-f]{2})+$/i.test(code) && keccak256(code) === source.runtime_hash &&
            typeof creator === 'string' && creator.toLowerCase() === '0x' + source.issuer.slice(2).padStart(64,'0');
    }));
    return evidence.every(Boolean);
}

async function externalContractAtMint(address, readers, blockHash, signal) {
    const at = {blockHash,requireCanonical:true};
    const [code,other] = await Promise.all(readers.map(rpc=>rpc('eth_getCode',[address,at],{signal})));
    return typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(code) && code === other &&
        !/^0xef0100[0-9a-f]{40}$/i.test(code) && !reviewedCollectionRuntime(code);
}

// Inventory supplies a locator. Verify the original mint so status follows the
// token across transfers to a new holder.
export async function receiptCollectionFrames(items,chainId,sources,readers,signal) {
    const verified = new Map();
    const [receiptRpc,blockRpc] = readers;
    const [a,b,final] = await Promise.all([receiptRpc('eth_chainId',[],{signal}),blockRpc('eth_chainId',[],{signal}),
        blockRpc('eth_getBlockByNumber',['finalized',false],{signal})]);
    const finalizedThrough = blockNumber(final?.number);
    if (blockNumber(a) !== chainId || blockNumber(b) !== chainId || !Number.isSafeInteger(finalizedThrough)) return verified;
    const hashes = [...new Set(items.map(i=>i.mintTransactionHash))];
    for (let i=0; i<hashes.length; i+=3) {
        await Promise.all(hashes.slice(i,i+3).map(async hash => {
            const receipt = await receiptRpc('eth_getTransactionReceipt',[hash],{signal});
            if (!receipt || receipt.transactionHash !== hash || !txHash.test(receipt.blockHash) ||
                !Number.isSafeInteger(blockNumber(receipt.blockNumber)) || blockNumber(receipt.blockNumber)>finalizedThrough) return;
            const block = await blockRpc('eth_getBlockByNumber',[receipt.blockNumber,false],{signal});
            if (block?.number !== receipt.blockNumber || block.hash !== receipt.blockHash || !block.transactions?.includes(hash)) return;
            const itemsInReceipt = items.filter(row=>row.mintTransactionHash===hash);
            const officialIssuers = new Set();
            const externalCollections = new Map();
            for (const address of new Set(itemsInReceipt.map(row=>row.contractAddress))) {
                const source = sources.get(address);
                if (source?.kind === 'official_collection' && source.address === address &&
                    await officialIssuerAtMint(source,readers,block.hash,signal).catch(()=>false)) officialIssuers.add(address);
            }
            for (const item of itemsInReceipt) {
                const address = item.contractAddress;
                const source = sources.get(address);
                if (source?.address !== address || reservedCollection(chainId,address)) continue;
                const identity = {chainId,nftAddress:address,tokenId:item.tokenId};
                const proof = {
                    receipt,partnerReview:{approved:source.kind === 'partner',chainId,address},
                    officialCollection:{verifiedIssuer:officialIssuers.has(address),chainId,address},
                    canonicalMintBlock:{chainId,number:blockNumber(block.number),hash:block.hash,finalizedThrough}
                };
                let kind = verifiedArtworkAura(identity,proof);
                if (!kind && source.kind === 'partner') {
                    if (!externalCollections.has(address)) {
                        externalCollections.set(address,await externalContractAtMint(address,readers,block.hash,signal).catch(()=>false));
                    }
                    if (externalCollections.get(address)) {
                        proof.partnerReview.standardMint = true;
                        kind = verifiedArtworkAura(identity,proof);
                    }
                }
                if (kind) verified.set(item.id,kind);
            }
        }));
    }
    return verified;
}

export async function walletCollectionFrames(page,wallet) {
    if (process.env.ARTSOUL_AURA_SOURCES_ENABLED !== 'true' || page?.wallet !== wallet || !Array.isArray(page.items) || page.items.length>12) return page;
    const basePage = page.chainId === 8453 && page.network === 'Base' && page.view === undefined;
    const groups = new Map();
    for (const item of page.items) {
        const chain = basePage ? 8453 : item.chainId;
        const network = basePage || page.view === 'nfts' && item.network === (chain === 8453 ? 'base-mainnet' : 'base-sepolia');
        if (!network || !networks[chain] || item.aura_kind || item.tokenType !== 'ERC721' || item.quantity !== '1' || !txHash.test(item.mintTransactionHash)) continue;
        if (!groups.has(chain)) groups.set(chain,[]);
        groups.get(chain).push(item);
    }
    if (!groups.size) return page;
    const signal = AbortSignal.timeout(2500);
    const verified = new Map();
    await Promise.all([...groups].map(async ([chain,items]) => {
        try {
            const addresses = [...new Set(items.map(i=>i.contractAddress))];
            const rows = await supabaseRest('rpc/collection_frame_sources',{method:'POST',signal,body:{
                p_chain:chain,p_addresses:addresses
            }});
            if (!Array.isArray(rows) || rows.length > addresses.length ||
                rows.some(row=>!addresses.includes(row?.address) || !['partner','official_collection'].includes(row.kind))) return;
            const sources = new Map(rows.map(row=>[row.address,row]));
            if (sources.size !== rows.length) return;
            const eligible = items.filter(i=>sources.has(i.contractAddress));
            if (!eligible.length) return;
            const frames = await receiptCollectionFrames(eligible,chain,sources,createRegistrationReaders(networks[chain]),signal);
            for (const [id,kind] of frames) verified.set(id,kind);
        } catch { /* Keep the inventory visible when optional frame evidence is unavailable. */ }
    }));
    if (!verified.size) return page;
    const enabled = await readAuraBorderSetting().then(s=>s.enabled,()=>false);
    return {...page,items:page.items.map(item=>verified.has(item.id) ? {...item,aura_kind:verified.get(item.id),aura_border_text:enabled} : item)};
}
