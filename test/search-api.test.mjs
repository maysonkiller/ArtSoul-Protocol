import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { allowMethods, normalizeWallet, sendError, supabaseRest } from '../src/api/backend.js';
import { PUBLIC_PROFILE_FIELDS, publicProfile } from '../src/api/profile-fields.js';
import { readVisibleArtworkCards } from '../src/api/routes/public/artworks.js';
import { readWithNftOwnershipResponse } from '../src/api/nft-ownership.js';

const A=`0x${'1'.repeat(40)}`,B=`0x${'2'.repeat(40)}`,CORE=`0x${'3'.repeat(40)}`;
const env={SUPABASE_URL:'https://search.example.test',SUPABASE_SERVICE_ROLE_KEY:'local-search-service-fixture',
  ARTSOUL_SEARCH_ENABLED:'true',ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:CORE};
const source=fs.readFileSync('src/api/routes/public/search.js','utf8').replace(/^import .*;\r?$/gm,'')
  .replace('export default async function searchHandler','return async function searchHandler');
function handler(hydrate){return new Function('createHash','allowMethods','normalizeWallet','sendError','supabaseRest',
  'PUBLIC_PROFILE_FIELDS','publicProfile','readVisibleArtworkCards','readWithNftOwnershipResponse',source)(createHash,allowMethods,normalizeWallet,sendError,supabaseRest,
    PUBLIC_PROFILE_FIELDS,publicProfile,hydrate,readWithNftOwnershipResponse);}
function response(){return{statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){}};}
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function card(id,extra={}){return{artwork_id:id,chain_id:84532,title:'Public title',status:'auction',auction_end_time:'2099-01-01T00:00:00Z',...extra};}

test('global search API bounds queries, groups and public data',async t=>{
  const originalFetch=globalThis.fetch,previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  Object.assign(process.env,env);
  t.after(()=>{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(previous)){
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }});
  const call=async({query={q:'Art'},method='GET',hydrate=async(_chain,ids)=>ids.map(id=>card(id))}={})=>{
    const res=response();await handler(hydrate)({query,method,headers:{}},res);return res;
  };
  await t.test('disabled flag, absent Core, malformed and oversized queries do not touch storage',async()=>{
    globalThis.fetch=()=>{throw new Error('Unexpected storage access');};
    for(const query of [{},{q:['art']},{q:'a'},{q:'a'.repeat(101)},{q:'\u0000hidden'},{q:'Art',category:'collections'},
      {q:'#0'},{q:`#${2n**256n}`},{q:'Art',cursor:'abc'},{q:'Art',category:'artists',cursor:'{' }]){
      assert.equal((await call({query})).statusCode,400);
    }
    process.env.ARTSOUL_SEARCH_ENABLED='false';assert.equal((await call()).statusCode,503);
    delete process.env.ARTSOUL_SEARCH_ENABLED;assert.equal((await call()).statusCode,503);
    process.env.ARTSOUL_SEARCH_ENABLED='true';process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA='';assert.equal((await call()).statusCode,503);
    process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA=CORE;
    assert.equal((await call({method:'POST'})).statusCode,405);assert.equal((await call({method:'OPTIONS'})).statusCode,204);
  });
  await t.test('All returns five per group, batches duplicate artwork hydration and strips private profile fields',async()=>{
    const calls=[],batches=[];
    globalThis.fetch=async(url,options)=>{
      const parsed=new URL(url);calls.push(parsed);
      if(parsed.pathname.endsWith('/rpc/search_public_artworks')){
        const body=JSON.parse(options.body);assert.equal(body.p_limit,6);assert.equal(body.p_query,'Art work');assert.equal(body.p_core_address,CORE);
        return json((body.p_category==='artists'?[B,A]:['9','8','7','6','5','4']).map(result_key=>({result_key})));
      }
      assert.ok(parsed.pathname.endsWith('/profiles'));
      assert.ok(!parsed.searchParams.get('select').includes('email'));
      return json([{wallet_address:A,username:'Alice',twitter_id:'private-provider-id',discord_id:'12345678',email:'private@example.test',role:'admin'},
        {wallet_address:B,username:'Богдан',avatar_url:'https://media.test/avatar.png'}]);
    };
    const result=await call({query:{q:'  Art   work '},hydrate:async(...args)=>{batches.push(args);return args[1].map(id=>card(id));}});
    assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'private, no-store');
    assert.equal(result.body.query,'Art work');assert.equal(result.body.nextCursor,null);
    assert.equal(result.body.groups.artworks.items.length,5);assert.equal(result.body.groups.auctions.items.length,5);
    assert.equal(result.body.groups.artworks.hasMore,true);assert.equal(result.body.groups.artists.hasMore,false);
    assert.deepEqual(batches.map(args=>args.slice(0,3)),[[84532,['9','8','7','6','5'],CORE]]);assert.equal(calls.length,4);
    const alice=result.body.groups.artists.items.find(item=>item.wallet_address===A);
    assert.equal(alice.twitter_connected,true);assert.equal(alice.discord_profile_url,'https://discord.com/users/12345678');
    assert.ok(!('twitter_id'in alice));assert.ok(!('discord_id'in alice));assert.ok(!('email'in alice));assert.ok(!('role'in alice));
  });
  await t.test('category cursor binds query and category, preserves exact IDs and advances past hidden hydration',async()=>{
    const base=2n**200n,keys=Array.from({length:21},(_,i)=>String(base-BigInt(i)));let before;
    globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);before=body.p_before;assert.equal(body.p_limit,21);return json(keys.map(result_key=>({result_key})));};
    const first=await call({query:{q:'Art',category:'artworks'},hydrate:async(_chain,ids)=>ids.filter(id=>id!==keys[0]).map(id=>card(id))});
    assert.equal(first.statusCode,200);assert.equal(first.body.groups.artworks.items.length,19);assert.ok(first.body.nextCursor);assert.equal(before,null);
    await call({query:{q:'Art',category:'artworks',cursor:first.body.nextCursor}});assert.equal(before,keys[19]);
    assert.equal((await call({query:{q:'Different',category:'artworks',cursor:first.body.nextCursor}})).statusCode,400);
    assert.equal((await call({query:{q:'Art',category:'artists',cursor:first.body.nextCursor}})).statusCode,400);
    const emptyArtistCursor=Buffer.from(JSON.stringify({v:1,q:createHash('sha256').update(JSON.stringify(['Art','artists'])).digest('hex').slice(0,24),k:''})).toString('base64url');
    assert.equal((await call({query:{q:'Art',category:'artists',cursor:emptyArtistCursor}})).statusCode,400);
  });
  await t.test('expired or closed auctions disappear without inventing a new lifecycle',async()=>{
    globalThis.fetch=async()=>json(['3','2','1'].map(result_key=>({result_key})));
    const result=await call({query:{q:'Art',category:'auctions'},hydrate:async()=>[
      card('3'),card('2',{auction_end_time:'2020-01-01T00:00:00Z'}),card('1',{status:'settled'})]});
    assert.deepEqual(result.body.groups.auctions.items.map(item=>item.artwork_id),['3']);
    assert.deepEqual(result.body.groups.artworks.items,[]);
  });
  await t.test('search syntax is transported as JSON data, never a PostgREST operator',async()=>{
    const input="Искусство %_') | !";
    globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).search,'');assert.equal(JSON.parse(options.body).p_query,input);return json([]);};
    const result=await call({query:{q:input}});assert.equal(result.statusCode,200);assert.deepEqual(result.body.groups.artworks.items,[]);
  });
  await t.test('database, ordering and hydration failures are explicit sanitized errors',async()=>{
    globalThis.fetch=async()=>new Response('secret service database details',{status:500});
    const failed=await call();assert.equal(failed.statusCode,503);assert.doesNotMatch(JSON.stringify(failed.body),/secret|database details/);
    globalThis.fetch=async()=>json([{result_key:'1'},{result_key:'2'}]);assert.equal((await call({query:{q:'Art',category:'artworks'}})).statusCode,503);
    globalThis.fetch=async()=>json([{result_key:'1'}]);
    assert.equal((await call({query:{q:'Art',category:'artworks'},hydrate:async()=>{throw new Error('private backend detail');}})).statusCode,503);
  });
});

test('batch projection uses one lifecycle RPC and public serializer, with final visibility and URI/reorg fencing',async t=>{
  const originalFetch=globalThis.fetch,previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
  t.after(()=>{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const artwork=id=>({chain_id:84532,artwork_id:id,creator:A,metadata_uri:`ipfs://metadata-${id}`,minted:id==='2',
    token_id:id==='2'?'9007199254740993':null,canonical_floor:'1234567890123456789',transaction_hash:`0xtx${id}`});
  const data={artworks:[artwork('1'),artwork('2')],metadata:[{name:'One',image:'https://media.test/1.png'},{name:'Two',image:'https://media.test/2.png'}],
    auctions:[],settlements:[{chain_id:84532,artwork_id:'2',settlement_status:'completed',winner:B,token_id:'9007199254740993'}],
    listings:[],resales:[],signals:[{like:2,would_buy:0,watching:1},{like:0,would_buy:0,watching:0}]};
  let hidden=[],existing=data.artworks,profileFails=false,calls=[];
  globalThis.fetch=async(url,options)=>{
    const parsed=new URL(url);calls.push(parsed.pathname);
    if(parsed.pathname.endsWith('/rpc/read_public_search_cards')){assert.deepEqual(JSON.parse(options.body),{p_artwork_ids:['2','1'],p_core_address:CORE});return json(data);}
    if(parsed.pathname.endsWith('/profiles'))return profileFails?new Response('failure',{status:503}):json([{wallet_address:A,username:'Alice'}]);
    if(parsed.pathname.endsWith('/artwork_moderation_visibility'))return json(hidden);
    if(parsed.pathname.endsWith('/v41_artworks'))return json(existing);
    throw new Error('Unexpected metadata or other fetch: '+parsed.pathname);
  };
  let cards=await readVisibleArtworkCards(84532,['2','1'],CORE);
  assert.deepEqual(cards.map(item=>item.artwork_id),['2','1']);assert.equal(cards[0].title,'Two');assert.equal(cards[0].creator_name,'Alice');
  assert.equal(cards[0].auction_winner_address,B);assert.equal(cards[0].current_owner_address,B);assert.equal(cards[0].token_id,'9007199254740993');
  assert.equal(cards[0].canonical_floor,'1.234567890123456789');assert.equal(cards[1].like_count,2);assert.equal(calls.length,4);
  hidden=[{artwork_id:'2',hidden:true}];cards=await readVisibleArtworkCards(84532,['2','1'],CORE);assert.deepEqual(cards.map(item=>item.artwork_id),['1']);
  hidden=[];existing=[{...artwork('1'),metadata_uri:'changed'},artwork('2')];cards=await readVisibleArtworkCards(84532,['2','1'],CORE);assert.deepEqual(cards.map(item=>item.artwork_id),['2']);
  existing=[];assert.deepEqual(await readVisibleArtworkCards(84532,['2','1'],CORE),[]);
  profileFails=true;await assert.rejects(readVisibleArtworkCards(84532,['2','1'],CORE),/unavailable/);
  await assert.rejects(readVisibleArtworkCards(11155111,['1'],CORE),/Invalid search page/);
  await assert.rejects(readVisibleArtworkCards(84532,Array(21).fill('1'),CORE),/Invalid search page/);
});

test('indexer search hook is opt-in, leader-bound, non-overlapping and independent of chain success',async()=>{
  const runner=fs.readFileSync('src/indexer/production-runner.js','utf8');
  const method=runner.slice(runner.indexOf('    _refreshSearchMetadata() {'),runner.indexOf('    async _catchUpToSafeBlock('));
  let calls=0,resolve;
  const Fixture=new Function('refreshSearchMetadata','console',`return class {${method}}`)(()=>{calls++;return new Promise(done=>{resolve=done;});},{warn(){}});
  const instance=new Fixture();Object.assign(instance,{config:{searchIndexEnabled:false,chainId:84532,contractAddress:CORE},isLeader:true,isRunning:true,lastSearchMetadataAt:0,searchMetadataInFlight:null});
  instance._refreshSearchMetadata();assert.equal(calls,0);
  instance.config.searchIndexEnabled=true;instance.isLeader=false;instance._refreshSearchMetadata();assert.equal(calls,0);
  instance.isLeader=true;instance._refreshSearchMetadata();instance._refreshSearchMetadata();assert.equal(calls,1);
  const pending=instance.searchMetadataInFlight;resolve({checked:0});await pending;assert.equal(instance.searchMetadataInFlight,null);
  instance._refreshSearchMetadata();assert.equal(calls,1);
  assert.match(runner,/await this\._processConfirmations\(checkpoint\.currentBlock\);[\s\S]*?this\._refreshSearchMetadata\(\);/);
  assert.doesNotMatch(runner,/await this\._refreshSearchMetadata/);
  assert.match(runner,/if \(this\.searchMetadataInFlight\) await this\.searchMetadataInFlight/);
});
