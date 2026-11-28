import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, ZeroAddress } from 'ethers';
import { catalogMintOrigin, withCatalogMintOrigins } from '../src/api/catalog-mint-origin.js';
import { projectedArtworkAura } from '../src/ui/components/aura-frame.js';

test('a designated publication is marked only after its exact registration is confirmed', async t => {
    const core = '0x43368f7e2d5f11f4b7e11928d66d3f4a5a4e4cef';
    const author = '0x' + '1'.repeat(40);
    const card = {source:'v41_projection',chain_id:84532,artwork_id:'31',creator:author,minted:false,
        transaction_hash:'0x'+'2'.repeat(64),block_number:45,registration_log_index:3,metadata_uri:'ipfs://example'};
    const registration = {chain_id:84532,contract_address:core,event_name:'ArtworkRegistered',artwork_id:'31',
        transaction_hash:card.transaction_hash,block_number:45,log_index:3,
        event_data:{artworkId:'31',creator:author,metadataURI:card.metadata_uri}};
    t.mock.property(process, 'env', {...process.env, ARTSOUL_AURA_SOURCES_ENABLED:'true',
        ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:core, ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA:'0xf061f70503c37cf2196a28f4785e524d0fb32538',
        SUPABASE_URL:'https://fixture.test', SUPABASE_SERVICE_ROLE_KEY:'fixture'});
    let enabled = true, height = 45, events = [registration];
    t.mock.method(globalThis, 'fetch', async url => {
        switch (new URL(url).pathname.split('/').at(-1)) {
            case 'publisher_frame_states': return Response.json([{address:author,kind:'platform',enabled}]);
            case 'read_aura_border_setting': return Response.json([{enabled:true,revision:1}]);
            case 'indexer_state': return Response.json([{last_confirmed_block:height}]);
            case 'contract_events': return Response.json(events);
            default: throw Error('Unexpected publisher read');
        }
    });
    async function frame() { return projectedArtworkAura((await withCatalogMintOrigins([card]))[0]); }
    assert.equal((await frame()).label,'Published by ArtSoul');
    events = [{...registration,contract_address:'0x'+core.slice(2).toUpperCase()}];
    assert.equal((await frame()).label,'Published by ArtSoul');
    for (const change of [{artwork_id:'30'}, {log_index:4}, {block_number:46}, {contract_address:author},
        {event_data:{...registration.event_data,creator:core}}, {event_data:{...registration.event_data,metadataURI:'other'}}]) {
        events = [{...registration,...change}]; assert.equal(await frame(),null);
    }
    events = [registration,registration]; assert.equal(await frame(),null);
    events = [registration]; height = 44; assert.equal(await frame(),null);
    height = 45; enabled = false; assert.equal(await frame(),null);
});

test('Moon 2026 retains publication provenance only for its confirmed registration and authorized publisher', async t => {
    const creator = '0x6ec8c121043357ac231e36d403edabf90ae6989b';
    const work = {
        source:'v41_projection',chain_id:84532,artwork_id:'31',creator,minted:false,block_number:45793219,
        transaction_hash:'0x3ef3d37df40c22ad9c7063b87159e47c9aae57045cf08582d84a38410c55114d',registration_log_index:34,
        metadata_uri:'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/metadata/' +
            creator + '/1787354719294-3d0965a7-17e5-4062-bb12-1267f299af6a-moon-2026.json'
    };
    t.mock.property(process, 'env', {...process.env, ARTSOUL_AURA_SOURCES_ENABLED:'true',
        ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:'0x43368f7e2d5f11f4b7e11928d66d3f4a5a4e4cef',
        ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA:'0xf061f70503c37cf2196a28f4785e524d0fb32538',
        SUPABASE_URL:'https://fixture.test', SUPABASE_SERVICE_ROLE_KEY:'fixture'});
    let enabled = true;
    t.mock.method(globalThis,'fetch',async url => {
        if (String(url).endsWith('/read_aura_border_setting')) return Response.json([{enabled:true,revision:1}]);
        assert.equal(String(url),'https://fixture.test/rest/v1/rpc/publisher_frame_states');
        return Response.json([{address:creator,kind:'platform',enabled}]);
    });
    const [verified, wrongEvent, wrongArt, wrongUri] = await withCatalogMintOrigins([work,
        {...work,registration_log_index:2}, {...work,artwork_id:'32'}, {...work,metadata_uri:'ipfs://different'}]);
    assert.equal(verified.platform_publication_verified, true);
    assert.equal(verified.platform_origin_verified, undefined);
    assert.equal(verified.minted, false);
    for (const mismatch of [wrongEvent,wrongArt,wrongUri]) assert.equal(mismatch.platform_publication_verified,undefined);
    enabled = false;
    assert.equal((await withCatalogMintOrigins([work]))[0].platform_publication_verified,undefined);
});

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
        assert.equal(String(url), 'https://fixture.test/rest/v1/rpc/publisher_frame_states');
        assert.deepEqual(JSON.parse(init.body), {p_chain:84532,p_scope:core,p_addresses:[creator]});
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

test('an archived mint follows the token across owners and still requires a current issuer designation', async t => {
    const core = '0x43368f7e2d5f11f4b7e11928d66d3f4a5a4e4cef';
    const creator = '0x6ec8c121043357ac231e36d403edabf90ae6989b';
    const card = {
        source:'v41_projection', chain_id:84532, artwork_id:'14', token_id:'8', creator, minted:true,
        mint_transaction_hash:'0xc3166f53beb86f309469a1a6d74c46cddf32a44884bcd7541cc82f5119813007',
        metadata_uri:'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/metadata/' +
            creator + '/1782326793872-1d575c0d-6112-460c-94ec-beb5e0657c9a-base-logo.json'
    };
    t.mock.property(process, 'env', { ...process.env, ARTSOUL_AURA_SOURCES_ENABLED:'true',
        ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:core, ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA:'0xf061f70503c37cf2196a28f4785e524d0fb32538',
        SUPABASE_URL:'https://fixture.test', SUPABASE_SERVICE_ROLE_KEY:'fixture' });
    let enabled = true, kind = 'platform';
    t.mock.method(globalThis, 'fetch', async url => {
        if (String(url) === 'https://fixture.test/rest/v1/rpc/publisher_frame_states') return Response.json([{address:creator,kind,enabled}]);
        assert.equal(String(url), 'https://fixture.test/rest/v1/rpc/read_aura_border_setting');
        return Response.json([{enabled:true,revision:1}]);
    });
    const [original, transferred, otherToken, otherWork, otherUri] = await withCatalogMintOrigins([
        card, {...card,current_owner_address:'0x'+'7'.repeat(40)}, {...card,token_id:'9'},
        {...card,artwork_id:'13'}, {...card,metadata_uri:card.metadata_uri+'?changed'}
    ]);
    for (const verified of [original,transferred]) {
        assert.equal(verified.platform_origin_verified, true);
        assert.equal(verified.aura_border_text, true);
    }
    for (const unmatched of [otherToken, otherWork, otherUri]) assert.equal(unmatched.aura_kind, undefined);
    kind = 'founder';
    const [personal] = await withCatalogMintOrigins([card]);
    assert.equal(personal.founder_origin_verified,true);
    assert.equal(personal.aura_kind,'founder');
    assert.equal(personal.platform_origin_verified,undefined);
    for (kind of ['artist_partner','artist_genesis','artist_founder']) {
        const [assigned,invalid] = await withCatalogMintOrigins([card,{...card,token_id:'9'}]);
        assert.equal(assigned.aura_kind,kind);
        assert.equal(assigned.artist_frame_verified,true);
        assert.equal(assigned.platform_origin_verified,undefined);
        assert.equal(invalid.aura_kind,undefined);
    }
    enabled = false;
    assert.equal((await withCatalogMintOrigins([card]))[0].aura_kind, undefined);
});
