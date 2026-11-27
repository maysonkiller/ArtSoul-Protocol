import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { setWalletSession } from '../src/api/backend.js';
import handler from '../src/api/routes/wallet-nfts.js';
import { auraFrameClassName, auraFrameLabels, auraWords, auraCaption } from '../src/ui/components/aura-frame.js';

const wallet = '0x' + '1'.repeat(40);
const collection = '0x' + '2'.repeat(40);
const safe = '0x' + '3'.repeat(40);
const deployment = {chainId:8453, genesis:collection, safe, founder:wallet, genesisCodeHash:'0x' + 'a'.repeat(64)};
const environment = {
  SESSION_SECRET: 'synthetic-test-inventory-frames-session',
  ARTSOUL_MULTICHAIN_ASSETS_ENABLED:'true', ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED:'true',
  ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY:'synthetic-inventory-key',
  ARTSOUL_AURA_SOURCES_ENABLED:'true', ARTSOUL_PROFILE_GENESIS_ENABLED:'true', ARTSOUL_PROFILE_GENESIS_DEPLOYMENT:JSON.stringify(deployment),
  SUPABASE_URL:'https://database.example', SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-service'
};

function response() {
  return { headers:{}, setHeader(k,v) {this.headers[k]=v;}, status(code) {this.code=code;return this;},
    json(data) {this.data=data;}, end() {} };
}
const nft = (tokenId, network='base-mainnet', contract=collection) => ({tokenId, network, address:wallet, contract:{address:contract},
  tokenType:'ERC721', balance:'1', name:'Genesis', aura_kind:'genesis', aura_border_text:true});

test('authenticated Base and multichain NFT pages decorate exact grant serials in one private lookup', async t => {
  const original = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => { for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const ids = ['0','201','202'];
  const baseItems = [...ids.map(id => nft(id)), nft('201','base-mainnet',safe)];
  let reads = 0, answer = [{token_id:0, border_text:true}, {token_id:201, border_text:true}];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const host = new URL(url).hostname;
    if (host === 'base-mainnet.g.alchemy.com') return Response.json({ownedNfts:baseItems, totalCount:4});
    if (host === 'api.g.alchemy.com') {
      const network = JSON.parse(options.body).addresses[0].networks;
      const items = network.includes('base-mainnet') ? [...baseItems,nft('201','eth-mainnet')] : [nft('201','eth-mainnet')];
      return Response.json({data:{ownedNfts:items,totalCount:items.length}});
    }
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/read_designated_wallet_genesis_frames');
    assert.deepEqual(JSON.parse(options.body), {p_genesis:collection, p_code_hash:deployment.genesisCodeHash,
      p_authority:safe, p_founder:wallet, p_wallet:wallet, p_serials:[0,201,202]});
    reads++;
    if (answer === null) throw Error('private fixture failure');
    return Response.json(answer);
  });
  const session = response(); setWalletSession(session,wallet);
  const headers = {cookie:session.headers['Set-Cookie'].split(';')[0], 'x-artsoul-wallet':wallet};
  async function read(query={}) {
    const result=response(); await handler({method:'GET',headers,query},result);
    assert.equal(result.code,200); assert.equal(result.headers['Cache-Control'],'private, no-store');
    return result.data.items;
  }
  const multi = {view:'multichain-nfts',network:'all'};
  for (const query of [{},multi]) {
    const before=reads, items=await read(query);
    assert.equal(reads,before+1);
    assert.deepEqual(items.filter(i => i.aura_kind).map(i => [i.tokenId,i.contractAddress,i.aura_border_text]),
      [['0',collection,true],['201',collection,true]]);
  }
  const before = reads;
  assert.ok((await read({...multi,network:'eth-mainnet'})).every(i => !i.aura_kind));
  process.env.ARTSOUL_PROFILE_GENESIS_ENABLED='false';
  assert.ok((await read()).every(i => !i.aura_kind)); assert.equal(reads,before);
  process.env.ARTSOUL_PROFILE_GENESIS_ENABLED='true';
  for (answer of [null,[{token_id:9999,border_text:true}],[{token_id:0,border_text:true},{token_id:0,border_text:false}]]) {
    assert.ok((await read()).every(i => !i.aura_kind));
  }
});

test('Base preview and dialog and the multichain card with expanded details use the same authenticated frame', async () => {
  async function components(name, symbols, context) {
    const path = '../src/features/profile/' + name + '.jsx';
    const source = (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^import [^;]+;/gm,'').replace(/^export /gm,'');
    const compiled = await transformWithOxc(source, name + '.jsx', { jsx:{runtime:'classic'} });
    return vm.runInNewContext(compiled.code + '\n({' + symbols.join(',') + '})', { React, ...context });
  }
  const frame = await components('wallet-nft-media',['WalletNftMedia','WalletNftName'],{ auraFrameClassName, auraFrameLabels, auraWords, auraCaption });
  const { NftPreview, NftDetails } = await components('wallet-nfts',['NftPreview','NftDetails'], {
    ...frame, document:{body:{}}, createPortal:child=>child
  });
  const { NftCard } = await components('multichain-wallet-assets',['NftCard'],frame);
  for (const component of [NftPreview,NftDetails,NftCard]) {
    const item = { ...nft('1'), name:'Example', contractAddress:collection, traits:[], quantity:'1' };
    const render = () => renderToStaticMarkup(React.createElement(component,{item}));
    assert.match(render(), /artsoul-aura-frame--genesis/);
    assert.match(render(), /artsoul-aura-caption/);
    item.aura_border_text = false;
    assert.match(render(), /artsoul-aura-frame--genesis/);
    assert.doesNotMatch(render(), /artsoul-aura-caption/);
    item.aura_kind = 'partner';
    assert.match(render(), /artsoul-aura-frame--partner/);
    assert.doesNotMatch(render(), /Official ArtSoul NFT/);
    item.aura_kind = 'platform';
    assert.match(render(), /artsoul-aura-frame--platform/);
    if (component !== NftPreview) assert.match(render(), /alt="Official ArtSoul NFT"/);
    delete item.aura_kind;
    assert.doesNotMatch(render(), /artsoul-aura-/);
  }
});
