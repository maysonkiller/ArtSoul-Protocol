import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import handler from '../src/api/routes/upload/publication.js';
import { setWalletSession, getPublicStorageUrl } from '../src/api/backend.js';
import { buildStoragePath, buildMetadataStoragePath } from '../src/api/routes/upload/file.js';
import { uploadedMediaUrl } from '../src/api/upload-media-identity.js';
import { validatePublicationMetadata } from '../src/api/upload-publication.js';
import { MAX_METADATA_BYTES, ALLOWED_ARTWORK_MIME_TYPES } from '../src/config/upload-policy.js';

const wallet = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20), core = '0x' + 'aa'.repeat(20);
const id = '9dc84ef0-1271-4b28-a576-f14535e709e5';
const bytes = Buffer.from('original stored media');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const env = { SESSION_SECRET: 'publication-test-only-secret', SUPABASE_URL: 'https://storage.example',
  SUPABASE_SERVICE_ROLE_KEY: `x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`,
  ARTSOUL_MEDIA_PREPARATION_ENABLED: 'true', ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: core };
let previous, originalFetch;
test.beforeEach(() => {
  previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env); originalFetch = globalThis.fetch;
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(previous)) v === undefined ? delete process.env[k] : process.env[k] = v;
});
const response = () => ({headers:{}, statusCode:200, body:null,
  setHeader(k,v){this.headers[k]=v;}, status(v){this.statusCode=v;return this;}, json(v){this.body=v;return this;}, end(){}});
const session = owner => {const res=response();setWalletSession(res,owner);return res.headers['Set-Cookie'].split(';')[0];};
async function call(body, owner = wallet) {
  const res=response();
  await handler({method:'POST', headers:{'content-type':'application/json',...(owner ? {cookie:session(owner)} : {})}, body},res);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
  return res;
}
function metadata(row, type = row.declared_content_type) {
  const context = vm.createContext({window:{},console:{log(){}},btoa:s=>Buffer.from(s).toString('base64')});
  vm.runInContext(fs.readFileSync('ipfs-client.js','utf8'), context);
  return JSON.parse(JSON.stringify(context.window.IPFSClient.createMetadata({
    title:'夜 🎨', description:'An original test artwork.', imageUrl:uploadedMediaUrl(wallet,row.media_path),
    mediaType:type, creator:wallet, creatorValue:'0.0001', createdAt:'2026-10-23T00:00:00.000Z',
    aiGuidance:{estimated_value_min_eth:0.0001,estimated_value_max_eth:0.001,explanation:'Preserve the accepted guidance.'}
  })));
}

function backend(options = {}) {
  let row = options.row === null ? null : options.row || {
    publication_id:id, chain_id:84532, core_address:core, creator_wallet:wallet,
    media_path:buildStoragePath(wallet,'IMG_1234.png','image/png'),
    metadata_path:buildMetadataStoragePath(wallet,'metadata.json'), declared_content_type:'image/png', declared_size:bytes.length
  };
  let stored = null;
  const seen=[];
  globalThis.fetch = async (raw, init={}) => {
    const url=String(raw), body=init.body ? JSON.parse(init.body) : undefined;
    seen.push({url,init,body});
    if (url.includes('/rpc/issue_artwork_media_upload')) {
      if (options.issueError) return Response.json({message:options.issueError},{status:400});
      row ??= {publication_id:body.p_publication_id,chain_id:body.p_chain_id,core_address:body.p_core_address,
        creator_wallet:body.p_creator_wallet,media_path:body.p_media_path,metadata_path:body.p_metadata_path,
        declared_content_type:body.p_content_type,declared_size:body.p_declared_size};
      return Response.json(row);
    }
    if (url.includes('/object/upload/sign/artworks/')) {
      assert.equal(init.headers['x-upsert'],'false');
      if (options.signError) throw Error('private signed-url diagnostics');
      return Response.json({url:'/object/upload/sign/artworks/'+row.media_path+'?token=test-only'});
    }
    if (url.includes('/rest/v1/artwork_media_preparations?')) {
      assert.match(url,/creator_wallet=eq\.0x[0-9a-f]{40}/);
      return Response.json(row && url.includes(`creator_wallet=eq.${row.creator_wallet}`) ? [row] : []);
    }
    if (url.includes('/rpc/prepare_artwork_media_upload')) {
      if (options.pinError) return Response.json({message:options.pinError},{status:400});
      row = {...row,media_sha256:body.p_media_sha256,byte_size:body.p_byte_size,content_type:body.p_content_type,
        metadata_json:body.p_metadata_json};
      return Response.json(row);
    }
    if (url.includes('/storage/v1/object/artworks/metadata/')) {
      assert.equal(init.method,'POST');assert.equal(init.headers['x-upsert'],'false');
      assert.equal(init.headers['Content-Type'],'application/json');
      stored=options.storedMetadata || body;
      if (options.noStoredObject) stored=null;
      if (options.storageError) throw Error('private service token or storage diagnostics');
      return Response.json({Key:row.metadata_path});
    }
    if (url.includes('/storage/v1/object/public/artworks/metadata/')) {
      assert.equal(init.redirect,'error');
      return stored ? Response.json(stored) : new Response('',{status:404});
    }
    if (url.includes('/storage/v1/object/public/artworks/uploads/')) {
      assert.equal(init.redirect,'error');
      if (options.rawAbsent) return new Response('',{status:404});
      return new Response(options.bytes || bytes,{headers:{'content-type':options.type || 'image/png'}});
    }
    if (url.includes('/rpc/claim_artwork_media_publication')) return Response.json(options.claim || 'CLAIMED');
    throw Error('Unexpected network request: '+url);
  };
  return {seen,get row(){return row;}};
}

test('preparation denies guests and is disabled by default before any network request', async () => {
  const state=backend();
  assert.equal((await call({action:'issue'},null)).statusCode,401);
  delete process.env.ARTSOUL_MEDIA_PREPARATION_ENABLED;
  assert.equal((await call({action:'issue'})).body.error,'MEDIA_PREPARATION_DISABLED');
  assert.equal(state.seen.length,0);
});

test('preparation requires JSON requests and rejects malformed JSON without storage access', async () => {
  const state=backend(), res=response();
  await handler({method:'POST',headers:{cookie:session(wallet),'content-type':'text/plain'},body:'{}'},res);
  assert.equal(res.statusCode,415);
  const malformed=await call('{');
  assert.equal(malformed.statusCode,400);assert.equal(state.seen.length,0);
});

test('issuance is durable before signing and repeated issuance returns the original owned path', async () => {
  const state=backend({row:null});
  const input={action:'issue',publication_id:id,file_name:'IMG_1234.png',content_type:'image/png',size:bytes.length};
  const first=await call({...input,creator_wallet:other,chain_id:1,media_path:'foreign',core_address:other});
  const second=await call({...input,file_name:'renamed.png'});
  assert.equal(first.statusCode,200); assert.equal(second.statusCode,200);
  assert.equal(first.body.upload.path,second.body.upload.path);
  assert.equal(first.body.can_submit,false);
  const issued=state.seen[0].body;
  assert.equal(issued.p_chain_id,84532);assert.equal(issued.p_core_address,core);assert.equal(issued.p_creator_wallet,wallet);
  assert.match(issued.p_media_path,new RegExp('^uploads/'+wallet+'/'));
  assert.ok(state.seen[1].url.includes('/object/upload/sign/'));
  assert.ok(state.seen.filter(r=>r.url.includes('/object/upload/sign/')).every(r=>r.url.includes('/uploads/')));
});

test('invalid operation ids, MIME types, sizes and missing deployment never reach storage', async () => {
  const state=backend();
  for (const change of [{publication_id:'x&creator_wallet=eq.'+other},{size:0},{size:NaN},{size:1.5},{size:52428801},{content_type:'image/svg+xml'}]) {
    const res=await call({action:'issue',publication_id:id,content_type:'image/png',size:bytes.length,...change});
    assert.equal(res.statusCode,400);
  }
  delete process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA;
  assert.equal((await call({action:'issue',publication_id:id,content_type:'image/png',size:bytes.length})).statusCode,503);
  assert.equal(state.seen.length,0);
});

test('lost signed URL response leaves issuance intact and never exposes diagnostics', async () => {
  const state=backend({row:null,signError:true,rawAbsent:true});
  const res=await call({action:'issue',publication_id:id,content_type:'image/png',size:bytes.length});
  assert.equal(res.statusCode,503);assert.ok(state.row);
  assert.deepEqual(res.body,{error:'MEDIA_PREPARATION_UNAVAILABLE'});
});

test('reissuing after a lost PUT response recovers the stored bytes without enabling overwrite', async () => {
  const state=backend({signError:true});
  const res=await call({action:'issue',publication_id:id,content_type:'image/png',size:bytes.length});
  assert.equal(res.statusCode,200);assert.equal(res.body.upload_complete,true);assert.equal(res.body.upload,null);
  assert.equal(res.body.media.sha256,sha256);assert.equal(res.body.can_submit,false);
  assert.ok(!state.seen.some(r=>r.url.includes('/rpc/claim_')));
});

test('a recovered raw object with changed bytes cannot replace its issued declaration', async () => {
  const state=backend({signError:true,bytes:Buffer.from('changed')});
  const res=await call({action:'issue',publication_id:id,content_type:'image/png',size:bytes.length});
  assert.equal(res.statusCode,409);assert.equal(res.body.error,'MEDIA_PREPARATION_MISMATCH');
  assert.ok(!state.seen.some(r=>r.url.includes('/rpc/claim_')));
});

test('preparation verifies actual bytes and stored metadata before claiming', async () => {
  const state=backend(); const value=metadata(state.row);
  const res=await call({action:'prepare',publication_id:id,metadata:value,media_sha256:'forged',media_path:'foreign',chain_id:1});
  assert.equal(res.statusCode,200); assert.equal(res.body.can_submit,false);
  assert.equal(res.body.media_sha256,sha256);assert.equal(res.body.claim_status,'CLAIMED');
  assert.equal(res.body.metadata_uri,getPublicStorageUrl('artworks',state.row.metadata_path));
  const pin=state.seen.findIndex(r=>r.url.includes('/rpc/prepare_'));
  const write=state.seen.findIndex(r=>r.url.includes('/object/artworks/metadata/'));
  const read=state.seen.findIndex(r=>r.url.includes('/object/public/artworks/metadata/'));
  const claim=state.seen.findIndex(r=>r.url.includes('/rpc/claim_'));
  assert.ok(pin<write && write<read && read<claim);
  assert.deepEqual(state.seen[pin].body.p_metadata_json.ai_value_guidance,value.ai_value_guidance);
  assert.equal(state.seen[claim].body.p_media_sha256,sha256);
});

test('a foreign wallet or obsolete deployment cannot read or prepare another operation', async () => {
  let state=backend();
  assert.equal((await call({action:'prepare',publication_id:id,metadata:{}},other)).statusCode,404);
  assert.equal(state.seen.length,1);
  state=backend({row:{...state.row,core_address:other}});
  assert.equal((await call({action:'prepare',publication_id:id,metadata:{}})).statusCode,404);
  assert.equal(state.seen.length,1);
});

test('declared and measured byte length and MIME must match before pinning', async () => {
  for (const options of [{bytes:Buffer.from('altered size')},{type:'video/mp4'}]) {
    const state=backend(options);
    const res=await call({action:'prepare',publication_id:id,metadata:metadata(state.row)});
    assert.equal(res.body.error,'MEDIA_PREPARATION_MISMATCH');
    assert.ok(!state.seen.some(r=>r.url.includes('/rpc/prepare_')));
  }
});

test('every consumed media alias and creator alias is bound to the issued original', () => {
  const state=backend(), value=metadata(state.row);
  const media={mediaUrl:uploadedMediaUrl(wallet,state.row.media_path),contentType:'image/png'};
  for (const scope of ['root','properties']) {
    for (const field of ['image','image_url','animation_url','media_url','file_url','poster_url','thumbnail_url','creator','creator_address','creator_wallet','media_type','mime_type','file_type','files']) {
      const altered=structuredClone(value), target=scope==='root'?altered:altered.properties;
      target[field]=field==='files'?[{uri:'https://foreign.invalid/file'}]:'foreign';
      assert.throws(()=>validatePublicationMetadata(altered,state.row,media),e=>e.code==='PUBLICATION_METADATA_MISMATCH',scope+'.'+field);
    }
  }
  const altered=structuredClone(value);altered.attributes.push({trait_type:'Creator',value:other});
  assert.throws(()=>validatePublicationMetadata(altered,state.row,media),e=>e.code==='PUBLICATION_METADATA_MISMATCH');
});

test('existing metadata builder is accepted for every supported format and ordinary title', () => {
  const state=backend();
  for (const type of ALLOWED_ARTWORK_MIME_TYPES) {
    const value=metadata(state.row,type);
    assert.deepEqual(validatePublicationMetadata(value,state.row,{mediaUrl:uploadedMediaUrl(wallet,state.row.media_path),contentType:type}),value);
  }
});

test('invalid or oversized JSON is rejected without pinning or writing metadata', async () => {
  for (const value of [null,[],{name:'x'}, {name:'x',description:'a'.repeat(MAX_METADATA_BYTES)}]) {
    const state=backend();
    assert.equal((await call({action:'prepare',publication_id:id,metadata:value})).statusCode,400);
    assert.ok(!state.seen.some(r=>r.url.includes('/rpc/prepare_')));
  }
});

test('pin conflict fails before storage and cannot overwrite an earlier preparation', async () => {
  const state=backend({pinError:'MEDIA_PREPARATION_MISMATCH'});
  assert.equal((await call({action:'prepare',publication_id:id,metadata:metadata(state.row)})).body.error,'MEDIA_PREPARATION_MISMATCH');
  assert.ok(!state.seen.some(r=>r.url.includes('/object/artworks/metadata/')));
});

test('an uncertain storage write succeeds only when the stored object equals its durable pin', async () => {
  const state=backend({storageError:true,claim:'RESUME'});
  const res=await call({action:'prepare',publication_id:id,metadata:metadata(state.row)});
  assert.equal(res.statusCode,200);assert.equal(res.body.claim_status,'RESUME');assert.equal(res.body.can_submit,false);
});

test('an unavailable or conflicting metadata object cannot obtain a claim', async () => {
  for (const [options,expected] of [[{storageError:true,noStoredObject:true},'PUBLICATION_METADATA_UNAVAILABLE'],
    [{storedMetadata:{image:'foreign'}},'PUBLICATION_METADATA_CONFLICT']]) {
    const state=backend(options);
    const res=await call({action:'prepare',publication_id:id,metadata:metadata(state.row)});
    assert.equal(res.body.error,expected);assert.ok(!state.seen.some(r=>r.url.includes('/rpc/claim_')));
  }
});

test('duplicate, changed or conflicting claims stay blocked without competing wallet details', async () => {
  for (const claim of ['DUPLICATE_MEDIA','PUBLICATION_BLOCKED','PUBLICATION_MISMATCH']) {
    const state=backend({claim});const res=await call({action:'prepare',publication_id:id,metadata:metadata(state.row)});
    assert.equal(res.statusCode,409);assert.deepEqual(res.body,{error:claim});
  }
});

test('a registered or resumed preparation does not grant another submission', async () => {
  for (const claim of ['REGISTERED','RESUME']) {
    const state=backend({claim});const res=await call({action:'prepare',publication_id:id,metadata:metadata(state.row)});
    assert.equal(res.statusCode,200);assert.equal(res.body.can_submit,false);
  }
});

test('long extensionless filenames generated by the existing issuer remain valid', () => {
  const path=buildStoragePath(wallet,'a'.repeat(96),'image/webp');
  assert.ok(path.endsWith('a'.repeat(96)+'.webp'));
  assert.ok(uploadedMediaUrl(wallet,path));
  assert.throws(()=>uploadedMediaUrl(wallet,path+'x'),e=>e.code==='INVALID_UPLOAD_PATH');
});
