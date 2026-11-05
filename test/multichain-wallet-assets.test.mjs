import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../src/api/routes/wallet-nfts.js';
import { setWalletSession } from '../src/api/backend.js';

const A = '0x' + '1'.repeat(40), B = '0x' + '2'.repeat(40), C = '0x' + '3'.repeat(40);
const KEY = 'synthetic-provider-key-only';
const ENV = { SESSION_SECRET: 'synthetic-read-only-session', ARTSOUL_MULTICHAIN_ASSETS_ENABLED: 'true',
  ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED: 'true', ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY: KEY };
let id = 0;
async function fresh() { return (await import('../src/api/multichain-wallet-assets.js?fixture=' + (++id))).readMultichainWalletAssets; }
function setup(t) {
  const env = Object.fromEntries(Object.keys(ENV).map(k => [k, process.env[k]]));
  const prior = globalThis.fetch, now = Date.now;
  Object.assign(process.env, ENV);
  globalThis.fetch = () => { throw Error('Unauthorized network attempt'); };
  t.after(() => { globalThis.fetch = prior; Date.now = now; for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  } });
}
function sampleNft(extra = {}) {
  return { network: 'base-mainnet', address: A, contract: { address: C, name: 'Collection' },
    tokenId: '42', tokenType: 'ERC721', name: 'Artwork', balance: '1',
    image: { cachedUrl: 'https://nft2-cdn.alchemy.com/abc/xyz', contentType: 'image/png' }, ...extra };
}
function nftResponse(extra = {}) {
  return { data: { ownedNfts: [sampleNft()], totalCount: 1, pageKey: null }, ...extra };
}
const err = (code,status=503) => e => { assert.equal(e.code,code);assert.equal(e.statusCode,status);assert.doesNotMatch(e.message,/synthetic-provider/);return true; };
function response() { return {statusCode:200, headers:{},body:null,setHeader(k,v){this.headers[k]=v;},
  status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){}}; }
function session(wallet=A) {const r=response();setWalletSession(r,wallet);return {cookie:r.headers['Set-Cookie'].split(';')[0],'x-artsoul-wallet':wallet};}

test('all network+mode calls are disabled by default, while Base legacy endpoint stays independent', async t => {
  setup(t);const read=await fresh();
  process.env.ARTSOUL_MULTICHAIN_ASSETS_ENABLED='false';
  await assert.rejects(read(A,{view:'multichain-nfts',network:'base-mainnet'}),err('WALLET_ASSETS_DISABLED'));
  const config = readFileSync('src/api/routes/public/config.js','utf8');
  assert.match(config,/multichainWalletAssetsEnabled: process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED === 'true' && process.env.ARTSOUL_MULTICHAIN_ASSETS_ENABLED === 'true'/);
  assert.match(readFileSync('.env.example','utf8'),/ARTSOUL_MULTICHAIN_ASSETS_ENABLED=false/);
  assert.match(readFileSync('src/features/profile/wallet-nfts.jsx','utf8'),/if \(multichainEnabled\) return <MultiChainWalletAssets wallet=\{wallet\} \/>/);
});

test('rejects invalid network, wrong type and forged cursor before upstream', async t => {
  setup(t);const read=await fresh();
  for(const options of [{view:'multichain-nfts',network:'rialo-mainnet'}, {view:'multichain-nfts',network:'eth-sepolia'},
    {view:'multichain-nfts',network:['eth-mainnet']}, {view:'multi-token',network:'all'},
    {view:'multichain-tokens',network:'__proto__'},
    {view:'multichain-nfts',network:'all',cursor:'raw-provider-cursor'}]) {
    await assert.rejects(read(A,options),e => { assert.ok(['INVALID_WALLET_ASSET_QUERY','INVALID_WALLET_ASSET_CURSOR'].includes(e.code));return true; });
  }
});

test('one explicit portfolio call yields chain-specific items, exact IDs, raster artwork and safe marketplace links', async t => {
  setup(t);const read=await fresh();let calls=0;
  globalThis.fetch=async (url,opts) => {
    calls++;assert.equal(opts.method,'POST'); assert.match(String(url),/api\.g\.alchemy\.com\/data\/v1\/synthetic-provider-key-only\/assets\/nfts\/by-address/);
    const body=JSON.parse(opts.body);assert.deepEqual(body.addresses,[{address:A,networks:['base-mainnet','eth-mainnet','arb-mainnet','opt-mainnet','matic-mainnet']}]);
    assert.equal(body.pageSize,12);assert.deepEqual(body.excludeFilters,['SPAM']);
    return Response.json(nftResponse({data:{ownedNfts:[sampleNft(),sampleNft({network:'eth-mainnet',tokenId:'340282366920938463463374607431768211456'}),
      sampleNft({network:'base-mainnet',tokenId:'43',contract:{address:C,isSpam:true}})],totalCount:3,pageKey:'next-encoded'}}));
  };
  const page=await read(A,{view:'multichain-nfts',network:'all'});assert.equal(calls,1);
  assert.equal(page.items.length,2);assert.equal(page.networks.length,5);
  assert.match(page.items[1].id,/^1:0x/);assert.equal(page.items[1].tokenId,'340282366920938463463374607431768211456');
  assert.equal(page.items[0].imageUrl,'https://nft2-cdn.alchemy.com/abc/xyz');
  assert.match(page.items[1].openseaUrl,/^https:\/\/opensea\.io\/assets\/ethereum\//);
  assert.match(page.items[1].explorerUrl,/^https:\/\/etherscan\.io\//);
  assert.equal(page.omittedCount,1);assert.ok(page.nextCursor);
  const again=await read(A,{view:'multichain-nfts',network:'all'});assert.equal(calls,1);assert.equal(again.items[0].id,page.items[0].id);
  await assert.rejects(read(B,{view:'multichain-nfts',network:'all',cursor:page.nextCursor}),err('INVALID_WALLET_ASSET_CURSOR',400));
  await assert.rejects(read(A,{view:'multichain-nfts',network:'eth-mainnet',cursor:page.nextCursor}),err('INVALID_WALLET_ASSET_CURSOR',400));
  await assert.rejects(read(A,{view:'multichain-tokens',network:'all',cursor:page.nextCursor}),err('INVALID_WALLET_ASSET_CURSOR',400));
});

test('partial network errors retain successful items and make missing networks explicit',async t => {
  setup(t);const read=await fresh();
  globalThis.fetch=async()=>Response.json(nftResponse({error:{message:'private provider failure',partialErrors:[{network:'eth-mainnet',message:'private provider failure'}]}}));
  const page=await read(A,{view:'multichain-nfts',network:'all'});
  assert.equal(page.items.length,1);assert.deepEqual(page.partialNetworks,['eth-mainnet']);
  assert.doesNotMatch(JSON.stringify(page),/private provider failure|synthetic-provider-key/);
});

test('hostile image URLs and metadata do not become executable, and false token types are omitted',async t => {
  setup(t);const read=await fresh();
  globalThis.fetch=async()=>Response.json(nftResponse({data:{ownedNfts:[
    sampleNft({image:{cachedUrl:'https://evil.test/bad.svg',contentType:'image/png'},name:'\u202e Spoof name'}),
    sampleNft({tokenId:'43',image:{cachedUrl:'https://nft2-cdn.alchemy.com/abc/xyz',contentType:'image/svg+xml'}}),
    sampleNft({tokenId:'44',tokenType:'ERC20'}),
    sampleNft({tokenId:'45',contract:{address:C,isSpam:true}})
  ],totalCount:4}}));
  const page=await read(A,{view:'multichain-nfts',network:'base-mainnet'});
  assert.equal(page.items.length,2);assert.equal(page.items[0].imageUrl,null);
  assert.equal(page.items[1].imageUrl,null);assert.ok(!page.items[0].name.includes('\u202e'));
});

test('token balances use decimals without floating-point balance loss',async t => {
  setup(t);const read=await fresh();
  globalThis.fetch=async (_,opts)=> {
    const body=JSON.parse(opts.body);assert.deepEqual(body.addresses[0].networks,['eth-mainnet']);
    assert.equal('pageSize' in body, false, 'Tokens By Wallet does not support pageSize');
    assert.equal(body.withMetadata, true);assert.equal(body.withPrices, true);
    assert.equal(body.includeNativeTokens, true);assert.equal(body.includeErc20Tokens, true);
    return Response.json({data:{tokens:[{network:'eth-mainnet',address:A,tokenAddress:C,
      tokenBalance:'0x152d02c7e14af6800000',tokenMetadata:{symbol:'TEST',name:'Test token',decimals:18},
      tokenPrices:[{currency:'usd',value:'0.1234'}]}],pageKey:null}});
  };
  const page=await read(A,{view:'multichain-tokens',network:'eth-mainnet'});
  assert.equal(page.items.length,1);assert.equal(page.items[0].balance,'100000');
  assert.equal(page.items[0].priceUsd,'0.1234');assert.equal(page.items[0].symbol,'TEST');
});

test('GET route remains owner-bound; no arbitrary wallet, URL or freeform networks',async t => {
  setup(t);const h=session(A);
  for(const q of [{view:'multichain-nfts',network:'eth-mainnet',owner:B},
    {view:'multichain-nfts',network:['base-mainnet']},
    {view:'multichain-nfts',network:'eth-mainnet',pageSize:'500'},
    {view:'multichain-nfts',network:'eth-mainnet',url:'https://evil.test'}]) {
    const r=response();await handler({method:'GET',headers:h,query:q},r);
    assert.equal(r.statusCode,400);
  }
  const mismatch=response();await handler({method:'GET',headers:{...h,'x-artsoul-wallet':B},
    query:{view:'multichain-nfts',network:'all'}},mismatch);assert.equal(mismatch.statusCode,401);
});

test('repeated explicit reads are deduplicated, bounded and never fall back to other credentials',async t=>{
  setup(t);const read=await fresh();let calls=0,release;
  globalThis.fetch=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const options={view:'multichain-nfts',network:'eth-mainnet'};
  const first=read(A,options),second=read(A,options);assert.equal(calls,1);
  release(Response.json(nftResponse({data:{ownedNfts:[sampleNft({network:'eth-mainnet'})],totalCount:1}})));
  const both=await Promise.all([first,second]);assert.equal(both[0].items[0].id,both[1].items[0].id);assert.equal(calls,1);
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY=KEY+'rotated';
  globalThis.fetch=async()=>{throw new Error('new provider unavailable');};
  await assert.rejects(read(A,options),err('WALLET_ASSETS_UNAVAILABLE'));
});


test('cached reads also have a bounded Vercel invocation budget without extra provider work',async t=>{
  setup(t);const read=await fresh();let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json(nftResponse());};
  for(let i=0;i<60;i++) {
    const p=await read(A,{view:'multichain-nfts',network:'base-mainnet'});
    assert.equal(p.items.length,1);
  }
  assert.equal(calls,1);
  await assert.rejects(read(A,{view:'multichain-nfts',network:'base-mainnet'}),err('WALLET_ASSETS_RATE_LIMITED',429));
  assert.equal(calls,1);
});


test('unknown ERC20 decimals preserve exact raw units without inventing a human balance',async t=>{
  setup(t);const read=await fresh();
  globalThis.fetch=async()=>Response.json({data:{tokens:[{network:'eth-mainnet',address:A,
    tokenAddress:C,tokenBalance:'0xffffffffffffffffff',tokenMetadata:{symbol:'UNK',name:'Unknown unit',decimals:null}}],pageKey:null}});
  const page=await read(A,{view:'multichain-tokens',network:'eth-mainnet'});
  assert.equal(page.items.length,1);assert.equal(page.items[0].balance,null);
  assert.equal(page.items[0].balanceRaw,BigInt('0xffffffffffffffffff').toString());
  assert.equal(page.items[0].symbol,'UNK');
});


test('eight network badges use local bundled vector marks instead of remote images or text approximations', () => {
  const jsx=readFileSync('src/features/profile/multichain-wallet-assets.jsx','utf8');
  const marks=['arbitrum-one','optimism','polygon','linea','binance-smart-chain','avalanche'];
  for(const name of marks) {
    const path='public/brand/wallet-networks/'+name+'.svg';
    const svg=readFileSync(path,'utf8');
    assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg,/<script|<foreignObject|<iframe|onload=|javascript:/i);
    assert.ok(jsx.includes('/brand/wallet-networks/'+name+'.svg'));
  }
  assert.match(jsx,/wallet-asset-quick-networks/);
  const css=readFileSync('unified-styles.css','utf8');
  assert.match(css,/\.wallet-asset-quick-networks[\s\S]*?overflow-x: auto/);
});
