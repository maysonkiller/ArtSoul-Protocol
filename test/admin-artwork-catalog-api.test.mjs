import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env,{
  NODE_ENV:'test',SESSION_SECRET:'catalog-wallet-test',SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'catalog-test-only',ARTSOUL_PROTOCOL_ADMIN_ENABLED:'true',
  ARTSOUL_MODERATION_PASSKEY_ENABLED:'true',ARTSOUL_WEBAUTHN_RP_ID:'example.com',
  ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN:'https://example.com',ARTSOUL_WEBAUTHN_RP_NAME:'ArtSoul',ARTSOUL_MODERATION_SESSION_SECRET:'catalog-factor-test'
});
const [{default:catalog},{default:visibility},backend,passkeys]=await Promise.all([
  import('../src/api/routes/moderation/artwork-catalog.js'),import('../src/api/routes/moderation/artwork-visibility.js'),
  import('../src/api/backend.js'),import('../src/api/moderation-passkey.js')
]);
const STAFF=`0x${'1'.repeat(40)}`;
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){}};}
function req({cookie='',query={},body,method='GET'}={}){return {method,query,body,headers:{cookie,'user-agent':'catalog-test'},socket:{remoteAddress:'127.0.0.1'}};}
function cookie(stepUp=true){const res=response();backend.setWalletSession(res,STAFF);const cookies=[res.headers['Set-Cookie'].split(';')[0]];
  if(stepUp){const factor=response();passkeys.setModerationSession(factor,STAFF,'catalog-key',undefined,'passkey',req());cookies.push(factor.headers['Set-Cookie'].split(';')[0]);}return cookies.join('; ');}
const json=(data,status=200)=>({ok:status<400,status,text:async()=>JSON.stringify(data)});
const row=id=>({chain_id:84532,artwork_id:String(id),hidden:id===1,visibility_updated_at:null,
  metadata:{name:`Work ${id}`,image:'https://example.supabase.co/storage/v1/object/public/artworks/image.png'},
  report_count:5,pending_count:2,actioned_count:1,donation_report_count:2});
function fixture(t,custom=()=>undefined){const calls=[]; t.mock.method(globalThis,'fetch',async(url,options)=>{
  const parsed=new URL(url),path=parsed.pathname.split('/rest/v1/')[1]+parsed.search;calls.push({path,body:options.body ? JSON.parse(options.body):null});
  const override=await custom(path,options);if(override!==undefined)return override;
  if(path.startsWith('artsoul_staff_roles?'))return json([{role:'team'}]);
  if(path.startsWith('artsoul_staff_passkeys?'))return json([{credential_id:'catalog-key'}]);
  if(path==='rpc/read_admin_artwork_catalog')return json([row(1)]);
  if(path==='rpc/review_artwork_visibility')return json([{...row(1),hidden:JSON.parse(options.body).p_hidden}]);
  throw new Error(`Unexpected test request ${path}`);
});return calls;}
test('catalog requires current wallet, staff role and factor before reading any artwork',async t=>{
  const calls=fixture(t);
  for(const auth of ['',cookie(false)]){const res=response();await catalog(req({cookie:auth}),res);assert.ok([401,403].includes(res.statusCode));assert.equal(res.body.data,undefined);}
  assert.equal(calls.some(call=>call.path==='rpc/read_admin_artwork_catalog'),false);
});
test('catalog keyset pagination retains hidden works and strips metadata and staff identities',async t=>{
  const calls=fixture(t,path=>path==='rpc/read_admin_artwork_catalog'?json(Array.from({length:26},(_,i)=>row(26-i))):undefined);
  const res=response();await catalog(req({cookie:cookie()}),res);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(res.headers['Cache-Control'],'private, no-store');
  assert.equal(res.body.data.artworks.length,25);assert.equal(res.body.data.next,'2');
  assert.equal(res.body.data.artworks[0].metadata,undefined);assert.equal(res.body.data.artworks[0].report_count,5);
  assert.equal(res.body.data.artworks[0].media_url,'https://example.supabase.co/storage/v1/object/public/artworks/image.png');
  assert.deepEqual(calls.find(call=>call.path==='rpc/read_admin_artwork_catalog').body,{p_before:null,p_limit:26,p_ids:null});
});
test('catalog validates cursors and rejects arbitrary media origins',async t=>{
  const calls=fixture(t,path=>path==='rpc/read_admin_artwork_catalog'?json([{...row(1),metadata:{image:'http://127.0.0.1/private',name:'Hidden work'}}]):undefined);
  for(const before of ['0','-1','1 OR true',['1'],String(2n**256n)]){const res=response();await catalog(req({cookie:cookie(),query:{before}}),res);assert.equal(res.statusCode,400);}
  assert.equal(calls.filter(call=>call.path==='rpc/read_admin_artwork_catalog').length,0);
  const res=response();await catalog(req({cookie:cookie(),query:{before:'2'}}),res);
  assert.equal(res.body.data.artworks[0].hidden,true);assert.equal(res.body.data.artworks[0].media_url,'');
});
test('role revocation during catalog loading prevents protected data from returning',async t=>{
  let read=false;
  fixture(t,path=>{if(path==='rpc/read_admin_artwork_catalog'){read=true;return json([row(1)]);}
    if(read&&path.startsWith('artsoul_staff_roles?'))return json([]);});
  const res=response();await catalog(req({cookie:cookie()}),res);assert.equal(res.statusCode,403);assert.equal(res.body.data,undefined);
});
test('manual decisions require reason and exact revision and use only the guarded RPC',async t=>{
  const calls=fixture(t),body={chain_id:84532,artwork_id:'1',hidden:false,reason:'All complaints resolved.',expected_updated_at:'2026-10-26T10:00:00.123456Z'};
  for(const invalid of [{...body,reason:''},{...body,expected_updated_at:undefined},{...body,chain_id:11155111}]){
    const res=response();await visibility(req({cookie:cookie(),method:'POST',body:invalid}),res);assert.equal(res.statusCode,400);
  }
  const res=response();await visibility(req({cookie:cookie(),method:'POST',body}),res);assert.equal(res.statusCode,200);
  const mutation=calls.find(call=>call.path==='rpc/review_artwork_visibility');
  assert.equal(mutation.body.p_reason,body.reason);assert.equal(mutation.body.p_expected_updated_at,body.expected_updated_at);
  assert.equal(mutation.body.p_actor_wallet,STAFF);assert.equal(calls.some(call=>call.path==='rpc/set_artwork_moderation_visibility'),false);
});
test('active complaint and stale visibility errors are actionable conflicts',async t=>{
  let code='ARTWORK_ACTIVE_REPORTS';fixture(t,path=>path==='rpc/review_artwork_visibility'?json({message:code},400):undefined);
  for(const value of ['ARTWORK_ACTIVE_REPORTS','VISIBILITY_REVIEW_CONFLICT','VISIBILITY_ALREADY_SET']){
    code=value;const res=response();await visibility(req({cookie:cookie(),method:'POST',body:{chain_id:84532,artwork_id:'1',hidden:false,reason:'Review complete',expected_updated_at:null}}),res);
    assert.equal(res.statusCode,409);assert.equal(res.body.error,value);
  }
});
