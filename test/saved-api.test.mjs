import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { allowMethods, normalizeWallet, requireWallet, sendError, setWalletSession, supabaseRest } from '../src/api/backend.js';
import { publicOrigin, readBoundedJson, serviceError } from '../src/api/launch-services.js';
import { readSavedConfig } from '../src/api/saved-config.js';

const A = `0x${'1'.repeat(40)}`, B = `0x${'2'.repeat(40)}`, CORE = `0x${'3'.repeat(40)}`, OLD = `0x${'4'.repeat(40)}`;
const env = { SESSION_SECRET: 'local-saved-test-only', SUPABASE_URL: 'https://saved.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-service-fixture', ARTSOUL_SAVED_ENABLED: 'true', ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE,
  ARTSOUL_PUBLIC_ORIGIN: 'https://artsoulprotocol.com', API_ALLOWED_ORIGINS: '' };
const source = fs.readFileSync('src/api/routes/saved.js', 'utf8').replace(/^import .*;\r?$/gm, '')
  .replace('export default async function handler', 'return async function handler');
function response() {
  return { statusCode: 200, headers: {}, body: null, setHeader(key, value) {this.headers[key] = value;},
    status(value) {this.statusCode = value; return this;}, json(value) {this.body = value; return this;}, end() {} };
}
function handler(hydrate = async (chain, id) => ({ id: `v41:${chain}:${id}`, title: 'Public artwork' })) {
  return new Function('allowMethods','normalizeWallet','requireWallet','sendError','supabaseRest','publicOrigin',
    'readBoundedJson','serviceError','readSavedConfig','readVisibleArtworkCard',source)(allowMethods,normalizeWallet,
    requireWallet,sendError,supabaseRest,publicOrigin,readBoundedJson,serviceError,readSavedConfig,hydrate);
}
function row(id, changes = {}) {
  return { id: String(id), wallet_address: A, chain_id: '84532', core_address: CORE, artwork_id: String(id),
    created_at: '2026-10-24T12:00:00.000Z', ...changes };
}

test('Saved API binds private reads and reversible writes to the authenticated wallet and deployment', async t => {
  const originalFetch = globalThis.fetch, originalEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { globalThis.fetch = originalFetch; for (const [key,value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }});
  const session = response(); setWalletSession(session, A);
  const headers = { cookie: session.headers['Set-Cookie'].split(';')[0], 'x-artsoul-wallet': A,
    'content-type': 'application/json', origin: 'https://artsoulprotocol.com' };
  const payload = {chain_id:84532, core_address:CORE, artwork_id:'7', saved:true};
  async function call({method='GET', query={}, body, h=headers, hydrate} = {}) {
    const res = response(); await handler(hydrate)({method,query,body,headers:h},res); return res;
  }
  const noStorage = () => {throw new Error('Unexpected database access');};

  await t.test('guest, invalid cookie, missing/mismatched intended wallet and disabled feature fail before storage', async () => {
    globalThis.fetch = noStorage;
    for (const h of [{}, {...headers,cookie:headers.cookie+'invalid'}, {...headers,'x-artsoul-wallet':undefined}, {...headers,'x-artsoul-wallet':B}]) {
      const result = await call({h}); assert.equal(result.statusCode,401); assert.equal(result.headers['Cache-Control'],'private, no-store');
    }
    assert.equal((await call({method:'POST'})).statusCode,405);
    assert.equal((await call({method:'OPTIONS'})).statusCode,204);
    process.env.ARTSOUL_SAVED_ENABLED = 'false';
    assert.equal((await call()).body.error,'SAVED_DISABLED');
    delete process.env.ARTSOUL_SAVED_ENABLED;
    assert.equal(readSavedConfig().enabled,false);
    process.env.ARTSOUL_SAVED_ENABLED = 'true';
    process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = '0x'+'0'.repeat(40);
    assert.deepEqual(readSavedConfig(),{enabled:false,chainId:84532,coreAddress:null});
    process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = CORE;
  });

  await t.test('origin, JSON size, deployment and identity validation precede database writes', async () => {
    globalThis.fetch = noStorage;
    assert.equal((await call({method:'PUT',body:payload,h:{...headers,origin:'https://other.test'}})).statusCode,401);
    assert.equal((await call({method:'PUT',body:payload,h:{...headers,'content-type':'text/plain'}})).statusCode,415);
    assert.equal((await call({method:'PUT',body:'x'.repeat(2049)})).statusCode,413);
    assert.equal((await call({method:'PUT',body:'{'})).body.error,'INVALID_JSON');
    for (const body of [{...payload,artwork_id:'0'}, {...payload,artwork_id:'01'}, {...payload,artwork_id:'1&wallet_address=eq.other'},
      {...payload,artwork_id:String(2n**256n)}, {...payload,artwork_id:7}, {...payload,saved:'true'}, {...payload,wallet_address:B},
      {...payload,chain_id:[]}, {...payload,core_address:'0x'+'0'.repeat(40)}]) {
      assert.equal((await call({method:'PUT',body})).statusCode,400,JSON.stringify(body));
    }
    for (const body of [{...payload,chain_id:11155111},{...payload,core_address:OLD}]) {
      assert.equal((await call({method:'PUT',body})).body.error,'SAVED_DEPLOYMENT_MISMATCH');
    }
  });

  await t.test('repeated add uses one atomic ignore-duplicate insert without rewriting created time', async () => {
    const writes=[];
    globalThis.fetch = async (input,options) => {
      const url = new URL(input), table=url.pathname.split('/').at(-1);
      if (table==='v41_artworks') return Response.json([{artwork_id:'7'}]);
      if (table==='artwork_moderation_visibility') return Response.json([]);
      assert.equal(table,'saved_artworks'); assert.equal(options.method,'POST');
      assert.equal(url.searchParams.get('on_conflict'),'wallet_address,chain_id,core_address,artwork_id');
      assert.equal(options.headers.Prefer,'resolution=ignore-duplicates,return=minimal');
      writes.push(JSON.parse(options.body)); return new Response(null,{status:201});
    };
    for (let i=0;i<2;i++) assert.deepEqual((await call({method:'PUT',body:payload})).body,{wallet:A,saved:true});
    assert.deepEqual(writes,Array(2).fill([{wallet_address:A,chain_id:84532,core_address:CORE,artwork_id:'7'}]));
  });

  await t.test('missing and currently hidden artworks cannot be added, and visibility outages fail closed', async () => {
    for (const mode of ['missing','hidden','outage']) {
      globalThis.fetch=async input => {
        const table=new URL(input).pathname.split('/').at(-1);
        if (table==='v41_artworks') return Response.json(mode==='missing'?[]:[{artwork_id:'7'}]);
        assert.equal(table,'artwork_moderation_visibility');
        if(mode==='outage') return Response.json({message:'private database details'},{status:500});
        return Response.json([{artwork_id:'7',hidden:true}]);
      };
      const result=await call({method:'PUT',body:payload});
      assert.equal(result.statusCode,mode==='outage'?503:404);
      assert.doesNotMatch(JSON.stringify(result.body),/private database/);
    }
  });

  await t.test('remove is idempotent and still allows unavailable artwork and historical deployment', async () => {
    let deletes=0;
    globalThis.fetch=async (input,options) => {
      const url=new URL(input); assert.equal(url.pathname.split('/').at(-1),'saved_artworks');
      assert.equal(options.method,'DELETE'); assert.equal(url.searchParams.get('wallet_address'),`eq.${A}`);
      assert.equal(url.searchParams.get('core_address'),`eq.${OLD}`); deletes++; return new Response(null,{status:204});
    };
    for(let i=0;i<2;i++) assert.deepEqual((await call({method:'PUT',body:{...payload,core_address:OLD,saved:false}})).body,{wallet:A,saved:false});
    assert.equal(deletes,2);
  });

  await t.test('lookup selects only requested IDs for the session and current registry, with no public hydration', async () => {
    globalThis.fetch=async input => {
      const url=new URL(input); assert.equal(url.pathname.split('/').at(-1),'saved_artworks');
      assert.equal(url.searchParams.get('wallet_address'),`eq.${A}`);
      assert.equal(url.searchParams.get('chain_id'),'eq.84532'); assert.equal(url.searchParams.get('core_address'),`eq.${CORE}`);
      assert.equal(url.searchParams.get('artwork_id'),'in.(7,8)'); assert.equal(url.searchParams.get('limit'),'200');
      return Response.json([{artwork_id:'7',secret:'not public'}]);
    };
    const scope={chain_id:'84532',core_address:CORE};
    assert.deepEqual((await call({query:{...scope,artwork_ids:'7,8,7',wallet_address:B},hydrate:noStorage})).body,
      {wallet:A,chainId:84532,coreAddress:CORE,artworkIds:['7']});
    globalThis.fetch=noStorage;
    for(const query of [{artwork_ids:''},{artwork_ids:['7']},{artwork_ids:Array(201).fill('7').join(',')},{artwork_ids:'7',before:'1'},{artwork_ids:'7,bad'}]) {
      assert.equal((await call({query:{...scope,...query}})).statusCode,400);
    }
    assert.equal((await call({query:{artwork_ids:'7'}})).statusCode,400,'a lookup must name its deployment');
    for(const changed of [{chain_id:'11155111'},{core_address:OLD}]) {
      assert.equal((await call({query:{...scope,...changed,artwork_ids:'7'}})).body.error,'SAVED_DEPLOYMENT_MISMATCH');
    }
  });

  await t.test('page keeps deployment identity, nulls hidden/removed/old work, and hydrates only current public work', async () => {
    const hydrated=[];
    globalThis.fetch=async input => {
      const url=new URL(input),table=url.pathname.split('/').at(-1);
      if(table==='saved_artworks') {
        assert.equal(url.searchParams.get('wallet_address'),`eq.${A}`); assert.equal(url.searchParams.get('limit'),'21');
        return Response.json([row(8),row(7,{core_address:OLD}),row(6),row(5)]);
      }
      assert.equal(url.searchParams.get('artwork_id'),'in.(8,6,5)');
      if(table==='v41_artworks') return Response.json([{artwork_id:'8'},{artwork_id:'6'}]);
      assert.equal(table,'artwork_moderation_visibility');return Response.json([{artwork_id:'6',hidden:true}]);
    };
    const result=await call({hydrate:async(chain,id)=>{hydrated.push([chain,id]);return {id:'public:8'};}});
    assert.equal(result.statusCode,200); assert.deepEqual(hydrated,[[84532,'8']]);
    assert.deepEqual(result.body.items.map(item=>item.artwork),[{id:'public:8'},null,null,null]);
    assert.equal(result.body.items[1].core_address,OLD); assert.equal(result.body.nextCursor,null);
    assert.equal(result.body.wallet,A);
    assert.doesNotMatch(JSON.stringify(result.body),/wallet_address|moderation_hidden|hidden_reason/);
  });

  await t.test('keyset paging keeps bigint precision, includes a sentinel and performs bounded hydration', async () => {
    const top=9007199254741090n, seen=[];let active=0,maximum=0;
    globalThis.fetch=async input=>{
      const url=new URL(input),table=url.pathname.split('/').at(-1);
      if(table==='saved_artworks') {
        assert.equal(url.searchParams.get('id'),`lt.${top}`);assert.equal(url.searchParams.get('order'),'id.desc');
        return Response.json(Array.from({length:21},(_,i)=>row(String(top-1n-BigInt(i)))));
      }
      const ids=url.searchParams.get('artwork_id').slice(4,-1).split(',');assert.equal(ids.length,20);
      return Response.json(table==='v41_artworks'?ids.map(artwork_id=>({artwork_id})):[]);
    };
    const result=await call({query:{before:String(top)},hydrate:async(chain,id)=>{
      active++;maximum=Math.max(maximum,active);seen.push(id);await new Promise(resolve=>setImmediate(resolve));active--;return {id};
    }});
    assert.equal(result.statusCode,200);assert.equal(result.body.items.length,20);assert.equal(result.body.nextCursor,String(top-20n));
    assert.equal(seen.length,20);assert.equal(maximum,4);
    globalThis.fetch=noStorage;
    for(const before of ['',0,'0','-1','9223372036854775808',['1'],'1&wallet_address=eq.other']) assert.equal((await call({query:{before}})).statusCode,400);
  });

  await t.test('unexpected rows and storage failures never expose another wallet or private diagnostics', async()=>{
    for(const reply of [[row(7,{wallet_address:B})],[row(7),row(7)],null]) {
      globalThis.fetch=async()=>Response.json(reply);
      const result=await call();assert.equal(result.statusCode,503);assert.doesNotMatch(JSON.stringify(result.body),new RegExp(B));
    }
    globalThis.fetch=async()=>Response.json({message:'private table secret'},{status:500});
    assert.deepEqual((await call()).body,{error:'SAVED_UNAVAILABLE',message:'Saved is temporarily unavailable. Please try again.'});
    assert.equal((await call({method:'PUT',body:payload})).statusCode,503);
  });
});

test('Saved is routed privately and configuration is additive, with no discovery signal writes',()=>{
  assert.match(fs.readFileSync('api/[...route].js','utf8'),/\['saved', savedHandler\]/);
  assert.match(fs.readFileSync('src/api/routes/public/config.js','utf8'),/saved: readSavedConfig\(\)/);
  assert.doesNotMatch(source,/artwork_social_signals|signal_type|trust_score|watching/);
});

test('Saved projection reuse never grants a staff visibility exception or accepts another identity',async()=>{
  const module=fs.readFileSync('src/api/routes/public/artworks.js','utf8');
  const start=module.indexOf('export async function readVisibleArtworkCard');
  const end=module.indexOf('export default async function handler',start);
  const code=module.slice(start,end).replace(/^export /gm,'');
  const card={chain_id:84532,artwork_id:'7',title:'Public'};
  for(const [snapshot,expected] of [[{cards:[card],warnings:[]},card],
    [{cards:[{...card,moderation_hidden:true}],warnings:[]},null],[{cards:[],warnings:[]},null],
    [{cards:[{...card,chain_id:11155111}],warnings:[]},null]]){
    const read=new Function('getDirectProjectionSnapshot',code+';return readVisibleArtworkCard;')(async lookup=>{
      assert.deepEqual(lookup,{chain:84532,artworkId:'7'});return snapshot;
    });
    assert.deepEqual(await read(84532,'7'),expected);
  }
  const unavailable=new Function('getDirectProjectionSnapshot',code+';return readVisibleArtworkCard;')(
    async()=>({cards:[card],warnings:[{table:'artwork_moderation_visibility',code:'QUERY_FAILED'}]}));
  await assert.rejects(unavailable(84532,'7'),/unavailable/);
});
