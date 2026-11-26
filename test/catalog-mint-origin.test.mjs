import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, ZeroAddress } from 'ethers';
import { catalogMintOrigin, withCatalogMintOrigins } from '../src/api/catalog-mint-origin.js';

test('a historical issuer mark binds the mint, transfer and paid settlement to the original pair', () => {
    const abi = new Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
        'event SettlementCompleted(uint256 indexed auctionId,uint256 indexed artworkId,address indexed winner,uint256 finalPrice,uint256 tokenId)',
        'event CanonicalArtworkMinted(uint256 indexed tokenId,uint256 indexed artworkId,address indexed creator,address owner,string tokenURI)']);
    const core='0x43368f7e2d5f11f4b7e11928d66d3f4a5a4e4cef', nft='0xf061f70503c37cf2196a28f4785e524d0fb32538';
    const creator='0x'+'1'.repeat(40), winner='0x'+'2'.repeat(40), hash='0x'+'3'.repeat(64);
    const envelope={transactionHash:hash,blockHash:'0x'+'4'.repeat(64),blockNumber:'0x20'};
    const log=(address,name,args)=>({...envelope,address,...abi.encodeEventLog(name,args)});
    const transfer=log(nft,'Transfer',[ZeroAddress,winner,2n]);
    const mint=log(nft,'CanonicalArtworkMinted',[2n,13n,creator,winner,'ipfs://work']);
    const paid=log(core,'SettlementCompleted',[1n,13n,winner,100n,2n]);
    const observe=logs=>catalogMintOrigin({...envelope,status:'0x1',logs},hash);
    assert.deepEqual(observe([transfer,mint,paid]),{artworkId:'13',tokenId:'2',creator,uri:'ipfs://work'});
    for (const invalid of [[mint,paid],[transfer,mint],[transfer,mint,mint,paid],[transfer,{...mint,address:core},paid],
        [transfer,{...mint,removed:true},paid],[transfer,mint,{...paid,blockHash:hash}],
        [transfer,mint,log(core,'SettlementCompleted',[1n,14n,winner,100n,2n])]]) assert.equal(observe(invalid),null);
});

test('the original catalog can check its pinned mint issuer before ownership tracking is configured', async t => {
    const core = '0x43368f7e2d5f11f4b7e11928d66d3f4a5a4e4cef';
    const creator = '0x' + '1'.repeat(40);
    const settings = { ...process.env, ARTSOUL_AURA_SOURCES_ENABLED: 'true', ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: core,
        SUPABASE_URL: 'https://fixture.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
    delete settings.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA;
    t.mock.property(process, 'env', settings);
    const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(String(url), 'https://fixture.test/rest/v1/rpc/aura_source_states');
        assert.deepEqual(JSON.parse(init.body), {p_kind:'platform',p_chain:84532,p_scope:core,p_addresses:[creator]});
        return Response.json([]);
    });
    const cards = [{source:'v41_projection',chain_id:84532,minted:true,creator,mint_transaction_hash:'0x'+'2'.repeat(64)}];
    assert.equal(await withCatalogMintOrigins(cards), cards);
    assert.equal(fetch.mock.callCount(), 1);
    settings.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA = creator;
    assert.equal(await withCatalogMintOrigins(cards), cards);
    delete settings.ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA;
    settings.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = creator;
    assert.equal(await withCatalogMintOrigins(cards), cards);
    assert.equal(fetch.mock.callCount(), 1);
});
