import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import handler, {createSignedArtworkUpload} from '../src/api/routes/upload/file.js';
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

test('the retired cover route returns 410 for all previously supported images without issuing storage tokens',async()=>{
 for(const mime of Object.keys(uploadPolicy.PROFILE_COVER_MIME_EXTENSIONS)){
  const res=await call(cover({content_type:mime,size:uploadPolicy.MAX_PROFILE_COVER_BYTES}));
  assert.equal(res.statusCode,410);assert.equal(res.body.error,'PROFILE_COVER_RETIRED');
  assert.equal(res.body.signed_upload_url,undefined);assert.equal(res.body.token,undefined);
 }
 assert.equal(requests.length,0);
});

test('cover retirement applies to aliases and rollout settings while unauthenticated requests stay denied',async()=>{
 assert.equal((await call(cover(),null)).statusCode,401);
 process.env.ARTSOUL_PROFILE_LAYOUT_ENABLED='false';delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 for(const body of [cover(),cover({kind:' PROFILE-COVER '}),{upload_kind:'profile-cover'},cover({size:0,content_type:'text/html'})]){
  const res=await call(body,wallet,other);assert.equal(res.statusCode,410);assert.equal(res.body.error,'PROFILE_COVER_RETIRED');
 }
 assert.equal(requests.length,0);
});

test('the shared signing helper cannot recreate a retired cover upload',async()=>{
 await assert.rejects(createSignedArtworkUpload('profile-covers/old/path.png','image/png','profile-cover'),{code:'PROFILE_COVER_RETIRED',statusCode:410});
 assert.equal(requests.length,0);
});

test('existing artwork, avatar and metadata upload boundaries remain unchanged',async()=>{
 const media=await call({kind:'media',content_type:'video/mp4',file_name:'video.mp4',size:50*1024*1024});
 assert.equal(media.statusCode,200);assert.equal(media.body.max_size,50*1024*1024);assert.match(media.body.path,/^uploads\//);
 const avatar=await call({content_type:'image/png',file_name:'avatar.png',size:1024});
 assert.equal(avatar.statusCode,200);assert.equal(avatar.body.kind,'media');assert.match(avatar.body.path,/^uploads\//);
 const metadata=await call({kind:'metadata',content_type:'application/json',file_name:'metadata.json',size:256*1024});
 assert.equal(metadata.statusCode,200);assert.equal(metadata.body.max_size,256*1024);assert.match(metadata.body.path,/^metadata\//);
 assert.equal((await call({kind:'media',content_type:'image/svg+xml',size:1024})).statusCode,400);
 assert.equal((await call({kind:'media',content_type:'image/png',size:50*1024*1024+1})).statusCode,400);
 assert.equal((await call({kind:'metadata',content_type:'application/json',size:256*1024+1})).statusCode,400);
 assert.equal(requests.length,3);assert(requests.every(request=>request.options.headers['x-upsert']==='false'));
});

test('the standard file client still uploads profile avatars after the cover client is retired',async()=>{
 const source=fs.readFileSync('supabase-client.js','utf8');
 assert.doesNotMatch(source,/uploadProfileCover/);
 const write=source.slice(source.indexOf('async function backendWrite('),source.indexOf('function disabledLegacyWrite'));
 const uploads=source.slice(source.indexOf('async function uploadSignedBlob('),source.indexOf('function requestPublication('));
 const client=source.slice(source.indexOf('async function uploadFile('),source.indexOf('async function uploadMetadata('));
 const calls=[];
 const context=vm.createContext({File,Blob,FormData,AbortSignal,fetch:async(url,options)=>{
  calls.push({url,options});if(calls.length===1)return new Response(JSON.stringify({signed_upload_url:'https://storage.example/signed',public_url:'https://storage.example/avatar'}),{status:200});
  return new Response('{}',{status:200});
 }});
 vm.runInContext(write+uploads+client,context);
 const file=new File(['image'],'avatar.png',{type:'image/png'});
 assert.equal(await context.uploadFile(file,'avatar.png'),'https://storage.example/avatar');
 assert.equal(calls.length,2);assert.equal(JSON.parse(calls[0].options.body).kind,'media');
 assert.equal(calls[1].options.headers['x-upsert'],'false');
});
