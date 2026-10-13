import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import profile from '../src/api/routes/profile.js';
import {setWalletSession} from '../src/api/backend.js';

const A='0x'+'1'.repeat(40), B='0x'+'2'.repeat(40);
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){}});
const source=fs.readFileSync(new URL('../supabase-client.js',import.meta.url),'utf8');
function client(fetch, backendRead = async () => ({profile: null})){
  const context=vm.createContext({fetch,backendRead,Date,JSON,Error,Map});
  const code=source.slice(source.indexOf('async function backendWrite('),source.indexOf('function disabledLegacyWrite('))+
    source.slice(source.indexOf('const profileReadCache ='),source.indexOf('// Artwork Functions'));
  vm.runInContext(code+'\nthis.updateProfile=updateProfile;this.getProfile=getProfile;this.cached=wallet=>profileReadCache.get(wallet);',context);
  return context;
}

test('a profile save cannot follow a different wallet cookie from another tab',async t=>{
  const previous={...process.env},oldFetch=global.fetch;
  Object.assign(process.env,{SESSION_SECRET:'isolation-fixture-only',SUPABASE_URL:'https://isolation.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'});
  t.after(()=>{global.fetch=oldFetch;for(const key of ['SESSION_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  const signed=response();setWalletSession(signed,B);
  const cookie=signed.headers['Set-Cookie'].split(';')[0];
  let databaseCalls=0;
  global.fetch=async(_url,options)=>{databaseCalls++;return Response.json(JSON.parse(options.body));};
  for(const expectedWallet of [A,undefined,'invalid',[B]]){
    const res=response();
    await profile({method:'PUT',headers:{cookie,...(expectedWallet===undefined?{}:{'x-artsoul-wallet':expectedWallet})},body:{bio:'Draft belonging to A'}},res);
    assert.equal(res.statusCode,401,'reject before saving to the cookie wallet');
    assert.equal(res.body.error,'SESSION_WALLET_MISMATCH');
    assert.equal(res.headers['Cache-Control'],'private, no-store');
  }
  assert.equal(databaseCalls,0,'mismatched drafts must not reach storage');
  const valid=response();await profile({method:'PUT',headers:{cookie,'x-artsoul-wallet':B},body:{bio:'B own draft',wallet_address:A}},valid);
  assert.equal(valid.statusCode,200);assert.equal(valid.body.profile.wallet_address,B);
  assert.equal(valid.body.profile.bio,'B own draft');assert.equal(databaseCalls,1);
});

test('the browser sends the intended profile wallet independently of session cookies',async()=>{
  let sent;
  const db=client(async(url,options)=>{sent={url,options};return Response.json({profile:{wallet_address:A,bio:'A draft'}});});
  await db.updateProfile(A,{bio:'A draft'});
  assert.equal(sent.url,'/api/profile');assert.equal(sent.options.headers['X-ArtSoul-Wallet'],A);
  assert.equal(db.cached(A).data.wallet_address,A);
});

test('a mismatched or absent save response cannot poison another profile cache',async()=>{
  for(const result of [{profile:{wallet_address:B,bio:'B data'}},{},{profile:{wallet_address:7}},null]){
    const db=client(async()=>Response.json(result));
    await assert.rejects(db.updateProfile(A,{bio:'A draft'}),/wallet|profile/i);
    assert.equal(db.cached(A),undefined);assert.equal(db.cached(B),undefined);
  }
});

test('a rejected cross-tab save preserves the confirmed profile and its draft can be retried', async()=>{
  let matched=false;
  const saved={wallet_address:A,bio:'A saved'};
  const db=client(async()=>matched?Response.json({profile:{...saved,bio:'A new draft'}}):Response.json({error:'SESSION_WALLET_MISMATCH',message:'Sign in with the wallet for this profile, then save again.'},{status:401}),async()=>({profile:saved}));
  await db.getProfile(A);
  await assert.rejects(db.updateProfile(A,{bio:'A new draft'}),error=>error.status===401 && error.code==='SESSION_WALLET_MISMATCH');
  assert.equal((await db.getProfile(A)).bio,'A saved');
  matched=true;
  await db.updateProfile(A,{bio:'A new draft'});
  assert.equal((await db.getProfile(A)).bio,'A new draft');
  assert.equal(db.cached(B),undefined);
});

test('a read started before saving cannot restore stale data or cross profile caches',async()=>{
  let release;
  const db=client(async()=>Response.json({profile:{wallet_address:A,bio:'A updated'}}),async path=>path.includes(B)?{profile:{wallet_address:B,bio:'B saved'}}:new Promise(resolve=>{release=resolve;}));
  const oldRead=db.getProfile(A);
  await db.getProfile(B);
  await db.updateProfile(A,{bio:'A updated'});
  release({profile:{wallet_address:A,bio:'A old'}});
  await oldRead;
  assert.equal((await db.getProfile(A)).bio,'A updated');
  assert.equal((await db.getProfile(B)).bio,'B saved');
});
