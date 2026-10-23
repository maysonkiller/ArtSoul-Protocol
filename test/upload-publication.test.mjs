import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { Interface, keccak256 } from 'ethers';
import { V41_CORE_ABI } from '../src/indexer/v4-1-event-schema.js';
import handler from '../src/api/routes/upload/publication.js';
import { setWalletSession, getPublicStorageUrl } from '../src/api/backend.js';
import { buildStoragePath, buildMetadataStoragePath } from '../src/api/routes/upload/file.js';
import { uploadedMediaUrl } from '../src/api/upload-media-identity.js';
import { validatePublicationMetadata, recoverPublication } from '../src/api/upload-publication.js';
import { MAX_METADATA_BYTES, ALLOWED_ARTWORK_MIME_TYPES } from '../src/config/upload-policy.js';

const wallet = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20), core = '0x' + 'aa'.repeat(20);
const id = '9dc84ef0-1271-4b28-a576-f14535e709e5';
const bytes = Buffer.from('original stored media');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const env = { SESSION_SECRET: 'publication-test-only-secret', SUPABASE_URL: 'https://storage.example',
  SUPABASE_SERVICE_ROLE_KEY: `x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`,
  ARTSOUL_MEDIA_PREPARATION_ENABLED: 'true', ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: core,
  ARTSOUL_MEDIA_SUBMISSION_ENABLED: 'false',
  ARTSOUL_MEDIA_RECOVERY_ENABLED: 'false', ARTSOUL_MEDIA_RECOVERY_CORE_CODE_HASH: keccak256('0x6001600055'),
  ARTSOUL_MEDIA_RECOVERY_START_BLOCK: '50', ARTSOUL_MEDIA_RECOVERY_RPC_PRIMARY: 'https://rpc-one.example',
  ARTSOUL_MEDIA_RECOVERY_RPC_SECONDARY: 'https://rpc-two.example' };
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
async function call(body, owner = wallet, intendedWallet = owner) {
  const res=response();
  await handler({method:'POST', headers:{'content-type':'application/json', 'x-artsoul-wallet':intendedWallet,
    ...(owner ? {cookie:session(owner)} : {})}, body},res);
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
  if (options.prepared) row = {...row,media_sha256:sha256,byte_size:bytes.length,
    content_type:'image/png',metadata_json:metadata(row)};
  let stored = options.prepared ? structuredClone(row.metadata_json) : null;
  if (options.changeMetadata) stored.name='Unexpected replacement';
  const seen=[];
  globalThis.fetch = async (raw, init={}) => {
    const url=String(raw), body=init.body ? JSON.parse(init.body) : undefined;
    seen.push({url,init,body});
    if (url.includes('/rpc/consume_launch_service_quota')) return Response.json(!options.quotaDenied);
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
    if (url.includes('/rest/v1/artwork_media_publications?')) {
      return Response.json([{publication_id:id,chain_id:84532,core_address:core,creator_wallet:wallet,
        metadata_uri:getPublicStorageUrl('artworks',row.metadata_path),claim_status:'claimed',
        reported_transaction_hash:options.noHash ? null : '0x'+'dd'.repeat(32)}]);
    }
    if (url.includes('/rpc/read_artwork_media_revision')) {
      assert.equal(new URL(url).searchParams.get('p_chain_id'),'84532');
      assert.ok(!init.method || init.method==='GET');
      if (options.revisionError) return Response.json({message:'private database error'},{status:503});
      return Response.json(Object.hasOwn(options,'revision') ? options.revision : '0');
    }
    if (url.includes('/rpc/read_artwork_media_registration_candidates')) {
      const query=new URL(url).searchParams;
      assert.equal(query.get('p_publication_id'),id);assert.equal(query.get('p_chain_id'),'84532');
      assert.equal(query.get('p_core_address'),core);assert.equal(query.get('p_creator_wallet'),wallet);
      assert.ok(!init.method || init.method==='GET');
      if (options.indexError) return Response.json({message:'private database error'},{status:503});
      return Response.json(Object.hasOwn(options,'candidates') ? options.candidates : []);
    }
    if (url.includes('/rpc/reconcile_artwork_media_registration')) {
      if (options.reconcileError) return Response.json({message:'private database error'},{status:500});
      return Response.json(options.reconciled || {publication_id:id,claim_status:'registered',registered_artwork_id:'36',can_submit:false});
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

function recoveryFixture(options = {}) {
  const backendState=backend({prepared:true,...options}), code='0x6001600055';
  const deployment={chainId:84532,core,coreCodeHash:keccak256(code),startBlock:'50'};
  const uri=getPublicStorageUrl('artworks',backendState.row.metadata_path);
  const iface=new Interface(V41_CORE_ABI),tx='0x'+'dd'.repeat(32),blockHash='0x'+'bb'.repeat(32),anchorHash='0x'+'cc'.repeat(32);
  const log={...iface.encodeEventLog(iface.getEvent('ArtworkRegistered'),[36n,wallet,uri]),address:core,
    transactionHash:tx,blockNumber:'0x64',blockHash,transactionIndex:'0x0',logIndex:'0x0'};
  const receipt={transactionHash:tx,blockNumber:'0x64',blockHash,transactionIndex:'0x0',status:'0x1',logs:[log]};
  const calls=[];
  const rpcs=[0,1].map(index=>async(method,params)=>{
    options.onChainRead?.(backendState.seen);
    calls.push({index,method,params});
    switch(method) {
      case 'eth_chainId':return '0x14a34';
      case 'eth_getCode':return code;
      case 'eth_getBlockByNumber':return params[0]==='0x64' ? {number:'0x64',hash:blockHash} : {number:'0xc8',hash:anchorHash};
      case 'eth_getTransactionReceipt':return options.absentReceipt ? null : receipt;
      case 'eth_getLogs':return [log];
      default:assert.fail('Unexpected recovery method '+method);
    }
  });
  return {...backendState,calls,rpcs,run:(scan=null,signal)=>recoverPublication(wallet,id,deployment,{rpcs,scan,signal})};
}

function enableRecovery(f) {
  process.env.ARTSOUL_MEDIA_RECOVERY_ENABLED='true';
  const storage=globalThis.fetch;
  globalThis.fetch=async(raw,init)=>{
    const index=['https://rpc-one.example/','https://rpc-two.example/'].indexOf(String(raw));
    if(index<0)return storage(raw,init);
    const body=JSON.parse(init.body);
    assert(init.signal instanceof AbortSignal);assert.equal(init.redirect,'error');
    return Response.json({jsonrpc:'2.0',id:body.id,result:await f.rpcs[index](body.method,body.params)});
  };
}

test('recovery reads actual pinned bytes and metadata before atomically saving verified chain evidence', async () => {
  const f=recoveryFixture(),result=await f.run();
  assert.equal(result.state,'registered');assert.equal(result.registered_artwork_id,'36');assert.equal(result.can_submit,false);
  const writes=f.seen.filter(c=>c.init.method==='POST');assert.equal(writes.length,1);
  const write=writes[0];assert.match(write.url,/rpc\/reconcile_artwork_media_registration$/);
  assert.equal(write.body.p_media_sha256,sha256);assert.equal(write.body.p_byte_size,bytes.length);
  assert.equal(write.body.p_evidence.finalized_anchor.number,'200');
  assert.equal(write.body.p_expected_revision,'0');
  assert.equal(write.body.p_evidence.registrations[0].block_hash,'0x'+'bb'.repeat(32));
  assert.ok(!f.seen.some(c=>c.url.includes('/object/artworks/')),'recovery never writes storage');
});

test('recovery captures an exact revision before chain verification and never repairs a missing revision', async () => {
  const revision='9007199254740993123456789';
  const f=recoveryFixture({revision,onChainRead:seen=>{
    assert.equal(seen.filter(c=>c.url.includes('/rpc/read_artwork_media_revision')).length,1);
    assert.ok(!seen.some(c=>c.url.includes('/rpc/reconcile_artwork_media_registration')));
  }});
  await f.run();
  assert.equal(f.seen.find(c=>c.body?.p_evidence).body.p_expected_revision,revision);
  for(const options of [{revision:null},{revision:1},{revision:'01'},{revision:'-1'},
    {revision:'1\n'},{revision:'1'.repeat(79)},{revisionError:true}]) {
    const denied=recoveryFixture(options);
    await assert.rejects(denied.run());
    assert.equal(denied.calls.length,0);
    assert.equal(denied.seen.filter(c=>c.init.method==='POST').length,0);
  }
});

test('recovery without a reported hash or indexer hints needs an explicit server scan and keeps coverage', async () => {
  const f=recoveryFixture({noHash:true});
  const unresolved=await f.run();assert.equal(unresolved.reason,'NO_TRANSACTION_OR_SCAN');assert.equal(f.calls.length,0);
  const result=await f.run({fromBlock:'99',toBlock:'101'});
  assert.equal(result.state,'registered');assert.equal(result.coverage.proves_absence,false);
  assert.equal(result.coverage.next_block,'102');
  assert.ok(!f.seen.some(c=>/begin_artwork|report_artwork/.test(c.url)));
});

test('indexed registration recovers a missing or replaced browser hash through verified bounded logs', async () => {
  for(const noHash of [false,true]) {
    const f=recoveryFixture({noHash,candidates:[{artwork_id:'36',block_number:'100',transaction_hash:'0x'+'dd'.repeat(32)}]});
    const result=await f.run();
    assert.equal(result.state,'registered');assert.equal(result.can_submit,false);
    assert.equal(result.coverage.from_block,'100');assert.equal(result.coverage.to_block,'100');
    assert.equal(result.coverage.proves_absence,false);
    assert.ok(f.calls.some(call=>call.method==='eth_getLogs'));
    assert.ok(!f.seen.some(call=>/begin_artwork|report_artwork/.test(call.url)));
  }
});

test('indexer candidates are hints and cannot certify a missing canonical registration', async () => {
  const current={artwork_id:'36',block_number:'100',transaction_hash:'0x'+'dd'.repeat(32)};
  for(const extra of [{...current,artwork_id:'37'}, {...current,transaction_hash:'0x'+'ee'.repeat(32)},
    {...current,block_number:'101'}]) {
    const f=recoveryFixture({candidates:[current,extra]});
    const result=await f.run();
    assert.equal(result.state,'unresolved');assert.equal(result.reason,'INDEXER_REGISTRATION_MISMATCH');
    assert.equal(result.can_submit,false);assert.ok(!f.seen.some(call=>call.body?.p_evidence));
  }
});

test('indexer overflow and wide ranges stay unresolved rather than truncating registration evidence', async () => {
  const candidate={artwork_id:'36',block_number:'100',transaction_hash:'0x'+'dd'.repeat(32)};
  for(const [candidates,reason] of [
    [Array.from({length:9},(_,i)=>({...candidate,artwork_id:String(i+1)})),'INDEXED_REGISTRATION_LIMIT'],
    [[candidate,{...candidate,artwork_id:'37',block_number:'2100'}],'INDEXED_REGISTRATION_RANGE']
  ]) {
    const f=recoveryFixture({candidates}), result=await f.run();
    assert.equal(result.reason,reason);assert.equal(result.can_submit,false);
    assert.equal(f.calls.length,0);assert.ok(!f.seen.some(call=>call.body?.p_evidence));
  }
});

test('malformed or unavailable indexer hints fail closed without writes or chain requests', async () => {
  const candidate={artwork_id:'36',block_number:'100',transaction_hash:'0x'+'dd'.repeat(32)};
  for(const options of [{indexError:true},{candidates:null},{candidates:{}},{candidates:[{}]},
    {candidates:[{...candidate,artwork_id:36}]},{candidates:[{...candidate,block_number:100}]},
    {candidates:[{...candidate,transaction_hash:'invalid'}]},{candidates:Array(10).fill(candidate)}]) {
    const f=recoveryFixture(options);await assert.rejects(f.run());
    assert.equal(f.calls.length,0);assert.ok(!f.seen.some(call=>call.body?.p_evidence));
  }
});

test('missing receipt, changed bytes and replaced metadata never reach persistence', async () => {
  for(const options of [{absentReceipt:true},{bytes:Buffer.from('changed original')},{changeMetadata:true}]) {
    const f=recoveryFixture(options);
    if(options.absentReceipt) {const result=await f.run();assert.equal(result.state,'unresolved');assert.equal(result.can_submit,false);}
    else {await assert.rejects(f.run(),/MEDIA_PREPARATION_MISMATCH|PUBLICATION_METADATA_CONFLICT/);assert.equal(f.calls.length,0);}
    assert.equal(f.seen.filter(c=>c.init.method==='POST').length,0);
  }
});

test('recovery retains a conflict returned by atomic reconciliation and never claims success after a database failure', async () => {
  const f=recoveryFixture({reconciled:{publication_id:id,claim_status:'conflict',registered_artwork_id:null,can_submit:false}});
  const result=await f.run();assert.equal(result.state,'conflict');assert.equal(result.can_submit,false);
  await assert.rejects(recoveryFixture({reconcileError:true}).run());
  for(const reconciled of [{publication_id:other,claim_status:'registered',can_submit:false},
    {publication_id:id,claim_status:'registered',registered_artwork_id:null,can_submit:false},
    {publication_id:id,claim_status:'registered',registered_artwork_id:'36',can_submit:true}]) {
    await assert.rejects(recoveryFixture({reconciled}).run(),/MEDIA_PREPARATION_UNAVAILABLE/);
  }
});

test('recovery remains separately disabled even when preparation is enabled', async () => {
  const state=backend();
  assert.equal((await call({action:'recover',publication_id:id})).body.error,'MEDIA_RECOVERY_DISABLED');
  assert.equal(state.seen.length,0);
});

test('authenticated recovery uses only server pins, durable quotas and owned immutable evidence',async()=>{
  const f=recoveryFixture();enableRecovery(f);
  const config=await call({action:'config'});assert.equal(config.body.recovery_enabled,true);assert.equal(f.seen.length,0);
  const res=await call({action:'recover',publication_id:id});
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(res.body.state,'registered');
  assert.equal(res.body.registered_artwork_id,'36');assert.equal(res.body.can_submit,false);
  const quotas=f.seen.filter(c=>c.url.includes('/consume_launch_service_quota'));
  assert.equal(quotas.length,2);assert.deepEqual(quotas.map(c=>[c.body.p_max,c.body.p_seconds]),[[4,60],[1,30]]);
  assert(quotas.every(c=>c.init.signal instanceof AbortSignal && /^[0-9a-f]{64}$/.test(c.body.p_key)));
  assert.notEqual(quotas[0].body.p_key,quotas[1].body.p_key);
  assert(!JSON.stringify(res.body).includes('rpc-one'));
  assert(!f.seen.some(c=>/begin_artwork|report_artwork|issue_artwork|prepare_artwork/.test(c.url)));
});

test('recovery rejects caller scan, deployment, evidence and receipt hints before any request',async()=>{
  const f=recoveryFixture();enableRecovery(f);
  for(const extra of [{scan:{fromBlock:'1',toBlock:'2'}},{deployment:{chainId:1}},{rpcs:['https://attacker.example']},
    {evidence:{state:'verified'}},{transaction_hash:'0x'+'ee'.repeat(32)},{creator_wallet:other}]) {
    assert.equal((await call({action:'recover',publication_id:id,...extra})).body.error,'INVALID_RECOVERY_REQUEST');
  }
  for(const publication_id of [undefined,id+'\n',id+'&select=*']) {
    assert.equal((await call({action:'recover',publication_id})).body.error,'INVALID_PUBLICATION_ID');
  }
  assert.equal(f.seen.length,0);assert.equal(f.calls.length,0);
});

test('missing or malformed recovery pins fail closed without trusting client replacements',async()=>{
  const f=recoveryFixture();enableRecovery(f);
  for(const [key,bad] of [['ARTSOUL_MEDIA_RECOVERY_CORE_CODE_HASH','0x'+'00'.repeat(32)],
    ['ARTSOUL_MEDIA_RECOVERY_START_BLOCK','-1'],['ARTSOUL_MEDIA_RECOVERY_START_BLOCK',(2n**256n).toString()],
    ['ARTSOUL_MEDIA_RECOVERY_RPC_PRIMARY','http://localhost'],['ARTSOUL_MEDIA_RECOVERY_RPC_SECONDARY','https://rpc-one.example/path']]) {
    const previous=process.env[key];process.env[key]=bad;
    assert.equal((await call({action:'recover',publication_id:id})).body.error,'MEDIA_RECOVERY_UNAVAILABLE');
    assert.equal((await call({action:'config'})).body.error,'MEDIA_RECOVERY_UNAVAILABLE');
    process.env[key]=previous;
  }
  assert.equal(f.seen.length,0);
});

test('durable quota denial and foreign ownership stop recovery before raw storage or chain reads',async()=>{
  let f=recoveryFixture({quotaDenied:true});enableRecovery(f);
  const denied=await call({action:'recover',publication_id:id});
  assert.equal(denied.statusCode,429);assert.equal(denied.headers['Retry-After'],'60');
  assert.equal(f.seen.length,1);assert.equal(f.calls.length,0);
  f=recoveryFixture();enableRecovery(f);
  const foreign=await call({action:'recover',publication_id:id},other);
  assert.equal(foreign.statusCode,404);assert.equal(foreign.body.error,'MEDIA_UPLOAD_NOT_FOUND');
  assert.equal(f.calls.length,0);assert(!f.seen.some(c=>c.url.includes('/storage/v1/')));
});

test('one recovery deadline aborts stalled quota, storage, chain and reconciliation requests',async()=>{
  const timeout=AbortSignal.timeout;
  try {
    AbortSignal.timeout=ms=>timeout(ms===25000?20:ms);
    for(const step of ['consume_launch_service_quota','artwork_media_preparations?',
      '/public/artworks/uploads/','/public/artworks/metadata/','rpc-one.example','reconcile_artwork_media_registration']) {
      const f=recoveryFixture();enableRecovery(f);const fetch=globalThis.fetch;
      globalThis.fetch=async(raw,init)=>String(raw).includes(step)?new Promise((resolve,reject)=>{
        assert(init.signal instanceof AbortSignal);
        if(init.signal.aborted)reject(init.signal.reason);
        else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
      }):fetch(raw,init);
      const keepAlive=setTimeout(()=>{},1000);
      try {
        const result=await call({action:'recover',publication_id:id});assert.equal(result.statusCode,503,step);
        assert(!JSON.stringify(result.body).includes('rpc-one'));
        assert(!f.seen.some(c=>/begin_artwork|report_artwork/.test(c.url)));
      } finally {clearTimeout(keepAlive);}
    }
  } finally {AbortSignal.timeout=timeout;}
});

test('preparation denies guests and is disabled by default before any network request', async () => {
  const state=backend();
  for (const action of ['config','issue','prepare','begin','report-transaction','status','recover']) {
    assert.equal((await call({action},null)).statusCode,401);
  }
  delete process.env.ARTSOUL_MEDIA_PREPARATION_ENABLED;
  assert.deepEqual((await call({action:'config'})).body,{success:true,enabled:false});
  for (const action of ['issue','prepare','begin','report-transaction','status','recover']) {
    assert.equal((await call({action})).body.error,'MEDIA_PREPARATION_DISABLED');
  }
  assert.equal(state.seen.length,0);
});

test('uncached publication config requires the intended signed-in wallet and exact deployment', async () => {
  const state=backend();
  assert.deepEqual((await call({action:'config'})).body,
    {success:true,enabled:true,chain_id:84532,core_address:core,can_submit:false});
  for(const intended of [null,other,{},wallet+'\n']) {
    for(const action of ['config','issue','prepare','begin','report-transaction','status','recover']) {
      assert.equal((await call({action,publication_id:id},wallet,intended)).body.error,'SESSION_WALLET_MISMATCH');
    }
  }
  assert.equal((await call({action:'config'},wallet,wallet.toUpperCase())).statusCode,200);
  delete process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA;
  assert.equal((await call({action:'config'})).body.error,'MEDIA_PREPARATION_UNAVAILABLE');
  assert.equal(state.seen.length,0);
});

test('journal rejects invalid IDs, hashes and client release actions before a database request', async () => {
  const state=backend();
  for (const action of ['begin','report-transaction','status']) {
    for (const publication_id of [undefined,id+'\n',id+'&creator_wallet=not.is.null',{},null]) {
      const result=await call({action,publication_id});
      assert.equal(result.statusCode,400);assert.equal(result.body.error,'INVALID_PUBLICATION_ID');
    }
  }
  for (const transaction_hash of [undefined,null,{},'0x'+'dd'.repeat(31),'0x'+'dd'.repeat(32)+'\n']) {
    assert.equal((await call({action:'report-transaction',publication_id:id,transaction_hash})).body.error,'INVALID_TRANSACTION_HASH');
  }
  for (const action of ['cancel','release','retry','confirm','mark-reverted']) {
    assert.equal((await call({action,publication_id:id})).body.error,'INVALID_PUBLICATION_ACTION');
  }
  assert.equal(state.seen.length,0);
});

test('journal status enforces wallet and deployment scope and never leaks a foreign backend row', async () => {
  let seen;
  globalThis.fetch=async (raw,init)=>{
    seen=new URL(raw);
    assert.equal(init.method,'GET');
    return Response.json([{publication_id:id,creator_wallet:other,chain_id:84532,core_address:core,
      metadata_uri:'https://storage.example/private-other.json',reported_transaction_hash:'0x'+'dd'.repeat(32)}]);
  };
  const result=await call({action:'status',publication_id:id,creator_wallet:other,core_address:other,chain_id:1});
  assert.equal(seen.searchParams.get('creator_wallet'),'eq.'+wallet);
  assert.equal(seen.searchParams.get('chain_id'),'eq.84532');assert.equal(seen.searchParams.get('core_address'),'eq.'+core);
  assert.equal(result.statusCode,404);assert.deepEqual(result.body,{error:'MEDIA_PUBLICATION_NOT_FOUND'});
});

test('journal database failures return a bounded public error without backend details', async () => {
  process.env.ARTSOUL_MEDIA_SUBMISSION_ENABLED='true';process.env.ARTSOUL_MEDIA_RECOVERY_ENABLED='true';
  globalThis.fetch=async()=>Response.json({message:'private database connection diagnostics',hint:'private details'},{status:500});
  for (const action of ['begin','report-transaction','status']) {
    const result=await call({action,publication_id:id,...(action==='report-transaction'?{transaction_hash:'0x'+'dd'.repeat(32)}:{})});
    assert.equal(result.statusCode,503);assert.deepEqual(result.body,{error:'MEDIA_PREPARATION_UNAVAILABLE'});
  }
});

function submissionBackend(options={}) {
  process.env.ARTSOUL_MEDIA_SUBMISSION_ENABLED='true';process.env.ARTSOUL_MEDIA_RECOVERY_ENABLED='true';
  const f=backend({prepared:true,...options}),fetch=globalThis.fetch;
  let started=null;
  globalThis.fetch=async(raw,init)=>{
    if(!String(raw).includes('/rpc/begin_artwork_media_submission'))return fetch(raw,init);
    f.seen.push({url:String(raw),init,body:JSON.parse(init.body)});
    const fresh=!started;started||='2026-10-23T01:00:00Z';
    return Response.json({publication_id:id,creator_wallet:wallet,chain_id:84532,core_address:core,
      metadata_uri:getPublicStorageUrl('artworks',f.row.metadata_path),claim_status:'claimed',
      submission_started_at:started,reported_transaction_hash:null,submission_created:fresh,...options.result});
  };
  return f;
}

test('submission requires its own flag and valid recovery pins before accessing a draft',async()=>{
  const f=backend({prepared:true});
  assert.equal((await call({action:'begin',publication_id:id})).body.error,'MEDIA_SUBMISSION_DISABLED');
  process.env.ARTSOUL_MEDIA_SUBMISSION_ENABLED='true';
  assert.equal((await call({action:'config'})).body.error,'MEDIA_RECOVERY_DISABLED');
  assert.equal((await call({action:'begin',publication_id:id})).body.error,'MEDIA_RECOVERY_DISABLED');
  process.env.ARTSOUL_MEDIA_RECOVERY_ENABLED='true';process.env.ARTSOUL_MEDIA_RECOVERY_CORE_CODE_HASH='';
  assert.equal((await call({action:'begin',publication_id:id})).body.error,'MEDIA_RECOVERY_UNAVAILABLE');
  assert.equal(f.seen.length,0);
});

test('only a fresh owned begin grants submission after rechecking original bytes and metadata',async()=>{
  const f=submissionBackend(),body={action:'begin',publication_id:id};
  const config=await call({action:'config'});assert.equal(config.body.submission_enabled,true);assert.equal(config.body.can_submit,false);
  const first=await call(body),retry=await call(body);
  assert.equal(first.statusCode,200,JSON.stringify(first.body));assert.equal(first.body.can_submit,true);
  assert.equal(first.body.chain_id,84532);assert.equal(first.body.core_address,core);
  assert.equal(retry.body.can_submit,false);assert.equal(retry.body.submission_created,false);
  assert.equal(retry.body.submission_started_at,first.body.submission_started_at);
  const started=f.seen.findIndex(r=>r.url.includes('/rpc/begin_artwork'));
  assert(started>f.seen.findIndex(r=>r.url.endsWith(f.row.metadata_path)));
  assert(started>f.seen.findIndex(r=>r.url.endsWith(f.row.media_path)));
  assert.equal((await call({action:'status',publication_id:id})).body.can_submit,false);
});

test('submission rejects browser overrides, foreign drafts, unavailable originals and quota exhaustion before begin',async()=>{
  let f=submissionBackend();
  for(const extra of [{chain_id:1},{core_address:other},{creator_wallet:other},{metadata_uri:'https://attacker.example'},
    {can_submit:true},{transaction_hash:'0x'+'dd'.repeat(32)}]) {
    assert.equal((await call({action:'begin',publication_id:id,...extra})).body.error,'INVALID_SUBMISSION_REQUEST');
  }
  assert.equal(f.seen.length,0);
  for(const options of [{changeMetadata:true},{quotaDenied:true},{rawAbsent:true}]) {
    f=submissionBackend(options);
    const res=await call({action:'begin',publication_id:id});assert.notEqual(res.statusCode,200);
    assert(!f.seen.some(r=>r.url.includes('/rpc/begin_artwork')));
  }
  f=submissionBackend();assert.equal((await call({action:'begin',publication_id:id},other)).statusCode,404);
  assert(!f.seen.some(r=>r.url.includes('/rpc/begin_artwork')));
});

test('malformed or mismatched begin results cannot become submission authorization',async()=>{
  for(const result of [{creator_wallet:other},{core_address:other},{chain_id:1},{publication_id:other},
    {metadata_uri:'https://attacker.example'},{submission_created:'true'},{submission_started_at:null},
    {claim_status:'registered'},{claim_status:'conflict'},{reported_transaction_hash:'0x'+'dd'.repeat(32)}]) {
    submissionBackend({result});const res=await call({action:'begin',publication_id:id});
    assert.notEqual(res.statusCode,200,JSON.stringify(result));assert.notEqual(res.body.can_submit,true);
  }
});

test('lost committed begin response never restores permission on retry',async()=>{
  submissionBackend();const fetch=globalThis.fetch;let drop=true;
  globalThis.fetch=async(raw,init)=>{
    const res=await fetch(raw,init);
    if(String(raw).includes('/rpc/begin_artwork')&&drop){drop=false;throw Error('lost after commit');}
    return res;
  };
  assert.equal((await call({action:'begin',publication_id:id})).statusCode,503);
  const retry=await call({action:'begin',publication_id:id});
  assert.equal(retry.statusCode,200);assert.equal(retry.body.can_submit,false);assert.equal(retry.body.submission_created,false);
});

test('submission deadline covers quotas, original bytes, metadata and the atomic begin response',async()=>{
  const timeout=AbortSignal.timeout;
  try {
    AbortSignal.timeout=ms=>timeout(ms===25000?20:ms);
    for(const step of ['consume_launch_service_quota','artwork_media_preparations?',
      '/public/artworks/uploads/','/public/artworks/metadata/','begin_artwork_media_submission']) {
      const f=submissionBackend(),fetch=globalThis.fetch;
      globalThis.fetch=async(raw,init)=>{
        if(!String(raw).includes(step))return fetch(raw,init);
        await new Promise((resolve,reject)=>{
          const keepAlive=setTimeout(resolve,1000);
          init.signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(init.signal.reason);},{once:true});
        });
        assert.fail('deadline must interrupt stalled submission request');
      };
      const res=await call({action:'begin',publication_id:id});assert.equal(res.statusCode,503);assert.notEqual(res.body.can_submit,true);
      assert(!f.seen.some(c=>c.url.includes('/rpc/begin_artwork')));
    }
  }finally{AbortSignal.timeout=timeout;}
});

test('preparation requires JSON requests and rejects malformed JSON without storage access', async () => {
  const state=backend(), res=response();
  await handler({method:'POST',headers:{cookie:session(wallet),'x-artsoul-wallet':wallet,'content-type':'text/plain'},body:'{}'},res);
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
