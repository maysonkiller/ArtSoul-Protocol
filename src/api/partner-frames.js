import { supabaseRest } from './backend.js';
import { readAuraBorderSetting } from './aura-border-setting.js';
import { createRegistrationReaders } from './upload-registration-evidence.js';
import { verifiedArtworkAura } from './verified-artwork-aura.js';

const networks = {
    8453:['https://mainnet.base.org','https://base-rpc.publicnode.com'],
    84532:['https://sepolia.base.org','https://base-sepolia-rpc.publicnode.com']
};
const txHash = /^0x[0-9a-f]{64}$/;
const blockNumber = value => typeof value === 'string' && /^0x[0-9a-f]{1,13}$/.test(value) ? Number(BigInt(value)) : NaN;

export async function hasPartnerContract(chain, address, readers = createRegistrationReaders(networks[chain])) {
    const signal = AbortSignal.timeout(4500);
    if (readers.length !== 2) throw new Error('Two collection observations are required');
    const heads = await Promise.all(readers.map(async rpc => {
        const [network, head] = await Promise.all([rpc('eth_chainId', [], {signal}),
            rpc('eth_getBlockByNumber', ['finalized',false], {signal})]);
        if (blockNumber(network) !== chain || !Number.isSafeInteger(blockNumber(head?.number)) || !txHash.test(head?.hash)) {
            throw new Error('Invalid collection network or finalized block');
        }
        return head;
    }));
    const head = blockNumber(heads[0].number) <= blockNumber(heads[1].number) ? heads[0] : heads[1];
    const at = {blockHash:head.hash,requireCanonical:true};
    const codes = await Promise.all(readers.map(rpc=>rpc('eth_getCode',[address,at],{signal})));
    if (codes.some(code=>typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(code)) ||
        codes[0].toLowerCase() !== codes[1].toLowerCase()) throw new Error('Contract observations differ');
    if (codes[0] === '0x' || /^0xef0100[0-9a-f]{40}$/i.test(codes[0])) return false;

    const support = await Promise.all(readers.map(rpc=>Promise.all(['01ffc9a7','ffffffff','80ac58cd'].map(id=>
        rpc('eth_call',[{to:address,gas:'0xf000',data:'0x01ffc9a7'+id.padEnd(64,'0')},at],{signal})))));
    if (support[0].some((answer,i)=>answer !== support[1][i])) throw new Error('Collection interfaces differ');
    const encoded = value=>'0x'+String(value).padStart(64,'0');
    return support[0].every((answer,i)=>answer === encoded(i === 1 ? 0 : 1));
}

export function mintTransactionHint(mint) {
    return txHash.test(mint?.transactionHash) ? {mintTransactionHash:mint.transactionHash} : {};
}

// Inventory supplies a transaction locator. The receipt, finality and canonical
// mint block come from chain readers. Ownership changes do not change the mint.
export async function receiptPartnerFrames(items,chainId,readers,signal) {
    const verified = new Set();
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
            for (const item of items.filter(row=>row.mintTransactionHash===hash)) {
                const address = item.contractAddress;
                if (verifiedArtworkAura({chainId,nftAddress:address,tokenId:item.tokenId},{
                    receipt,partnerReview:{approved:true,chainId,address},
                    canonicalMintBlock:{chainId,number:blockNumber(block.number),hash:block.hash,finalizedThrough}
                }) === 'partner') verified.add(item.id);
            }
        }));
    }
    return verified;
}

export async function walletPartnerFrames(page,wallet) {
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
    const verified = new Set();
    await Promise.all([...groups].map(async ([chain,items]) => {
        try {
            const addresses = [...new Set(items.map(i=>i.contractAddress))];
            const rows = await supabaseRest('rpc/aura_source_states',{method:'POST',signal,body:{
                p_kind:'partner',p_chain:chain,p_scope:'',p_addresses:addresses
            }});
            if (!Array.isArray(rows) || rows.length > addresses.length) return;
            const sources = new Set(rows.filter(r=>r.enabled === true).map(r=>r.address));
            const eligible = items.filter(i=>sources.has(i.contractAddress));
            if (!eligible.length) return;
            const ids = await receiptPartnerFrames(eligible,chain,createRegistrationReaders(networks[chain]),signal);
            for (const id of ids) verified.add(id);
        } catch { /* Keep the inventory visible when optional frame evidence is unavailable. */ }
    }));
    if (!verified.size) return page;
    const enabled = await readAuraBorderSetting().then(s=>s.enabled,()=>false);
    return {...page,items:page.items.map(item=>verified.has(item.id) ? {...item,aura_kind:'partner',aura_border_text:enabled} : item)};
}
