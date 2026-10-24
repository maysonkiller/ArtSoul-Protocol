import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import handler from '../src/api/routes/upload/file.js';
import { setWalletSession } from '../src/api/backend.js';
import * as uploadPolicy from '../src/config/upload-policy.js';

const wallet='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
const env={SESSION_SECRET:'profile-cover-unit-only',SUPABASE_URL:'https://storage.example',
 SUPABASE_SERVICE_ROLE_KEY:`x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`,
 ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:'0x'+'a'.repeat(40),ARTSOUL_PROFILE_LAYOUT_ENABLED:'true'};
let old,fetchBefore,requests;
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){}});
test.beforeEach(()=>{old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);fetchBefore=globalThis.fetch;requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});return new Response(JSON.stringify({url:'/object/upload/sign/artworks/fixture?token=fixture'}),{status:200});};});
test.afterEach(()=>{globalThis.fetch=fetchBefore;for(const[k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;});
async function call(body,owner=wallet,intended=wallet){const res=response(),cookie=response();if(owner)setWalletSession(cookie,owner);
 await handler({method:'POST',body,headers:{'x-artsoul-wallet':intended,...(owner?{cookie:cookie.headers['Set-Cookie'].split(';')[0]}:{})}},res);return res;}
const cover=(extra={})=>({kind:'profile-cover',file_name:'../../untrusted-name.svg',content_type:'image/png',size:100,...extra});

test('cover authorization is wallet-scoped, raster-only and independent of the filename',async()=>{
 for(const [mime,extension]of Object.entries(uploadPolicy.PROFILE_COVER_MIME_EXTENSIONS)){
  const res=await call(cover({content_type:mime,size:uploadPolicy.MAX_PROFILE_COVER_BYTES}));assert.equal(res.statusCode,200);
  assert.match(res.body.path,new RegExp(`^profile-covers/${wallet}/[0-9a-f-]{36}\\.${extension}$`));
  assert.equal(res.body.kind,'profile-cover');assert.equal(res.body.max_size,5*1024*1024);
  assert.equal(res.body.content_type,mime);assert.equal(requests.at(-1).options.headers['x-upsert'],'false');
 }
});
test('cover upload denies missing sessions and a different intended wallet before storage authorization',async()=>{
 assert.equal((await call(cover(),null)).statusCode,401);assert.equal((await call(cover(),wallet,other)).body.error,'SESSION_WALLET_MISMATCH');
 assert.equal((await call(cover(),wallet,'')).statusCode,401);assert.equal(requests.length,0);
});
test('cover upload rejects oversized, empty, fractional or unsupported media and stays disabled until rollout',async()=>{
 for(const size of [0,-1,0.5,5*1024*1024+1,Infinity])assert.equal((await call(cover({size}))).statusCode,400);
 for(const content_type of ['image/svg+xml','text/html','video/mp4','audio/mpeg','application/json'])assert.equal((await call(cover({content_type}))).statusCode,400);
 process.env.ARTSOUL_PROFILE_LAYOUT_ENABLED='false';assert.equal((await call(cover())).body.error,'PROFILE_LAYOUT_DISABLED');assert.equal(requests.length,0);
});
test('existing media and metadata upload boundaries remain unchanged',async()=>{
 const media=await call({kind:'media',content_type:'video/mp4',file_name:'video.mp4',size:50*1024*1024});
 assert.equal(media.statusCode,200);assert.equal(media.body.max_size,50*1024*1024);assert.match(media.body.path,/^uploads\//);
 const metadata=await call({kind:'metadata',content_type:'application/json',file_name:'metadata.json',size:256*1024});
 assert.equal(metadata.statusCode,200);assert.equal(metadata.body.max_size,256*1024);assert.match(metadata.body.path,/^metadata\//);
});
test('the cover client binds its wallet and carries cancellation through authorization and storage',async()=>{
 const source=fs.readFileSync('supabase-client.js','utf8');
 const write=source.slice(source.indexOf('async function backendWrite('),source.indexOf('function disabledLegacyWrite'));
 const uploads=source.slice(source.indexOf('async function uploadSignedBlob('),source.indexOf('function requestPublication('));
 const client=source.slice(source.indexOf('async function uploadProfileCover('),source.indexOf('async function uploadMetadata('))
  .replace("await import('./src/config/upload-policy.js')",'uploadPolicy');
 const calls=[],controller=new AbortController();
 const context=vm.createContext({File,Blob,FormData,AbortSignal,uploadPolicy,fetch:async(url,options)=>{
  calls.push({url,options});if(calls.length===1)return new Response(JSON.stringify({signed_upload_url:'https://storage.example/signed',public_url:'https://storage.example/cover'}),{status:200});
  return new Response('{}',{status:200});
 }});
 vm.runInContext(write+uploads+client,context);
 const file=new File(['image'],'cover.png',{type:'image/png'});
 assert.equal(await context.uploadProfileCover(file,wallet,{signal:controller.signal}),'https://storage.example/cover');
 assert.equal(calls.length,2);assert.equal(calls[0].options.headers['X-ArtSoul-Wallet'],wallet);
 assert.equal(JSON.parse(calls[0].options.body).kind,'profile-cover');
 assert(calls.every(call=>call.options.signal===controller.signal));assert.equal(calls[1].options.headers['x-upsert'],'false');
 await assert.rejects(context.uploadProfileCover(new File(['x'],'x.svg',{type:'image/svg+xml'}),wallet));assert.equal(calls.length,2);
 await assert.rejects(context.uploadProfileCover(file,other.slice(1)));assert.equal(calls.length,2);
});
