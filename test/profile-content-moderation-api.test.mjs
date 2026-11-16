import assert from 'node:assert/strict';
import test from 'node:test';

const WALLET=`0x${'1'.repeat(40)}`, PROFILE=`0x${'2'.repeat(40)}`;
const REPORT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', VERSION='2026-11-09T20:00:00.000Z', HASH='a'.repeat(64);
Object.assign(process.env, {NODE_ENV:'test',SESSION_SECRET:'local-profile-report-only',
  SUPABASE_URL:'https://local-profile.example.test',SUPABASE_SERVICE_ROLE_KEY:'local-not-a-key',
  ARTSOUL_REPORTING_ENABLED:'true',ARTSOUL_REPORT_DAILY_LIMIT:'5',ARTSOUL_PROFILE_REPORTS_ENABLED:'true',
  ARTSOUL_PROTOCOL_ADMIN_ENABLED:'true',ARTSOUL_MODERATION_PASSKEY_ENABLED:'true',
  ARTSOUL_WEBAUTHN_RP_ID:'example.test',ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN:'https://example.test',
  ARTSOUL_WEBAUTHN_RP_NAME:'ArtSoul',ARTSOUL_MODERATION_SESSION_SECRET:'local-profile-step-up'});
const [{default:intake},{default:review},{default:queue},{default:notifications},backend,passkeys]=await Promise.all([
  import('../src/api/routes/moderation/reports.js'),import('../src/api/routes/moderation/review-action.js'),
  import('../src/api/routes/moderation/review-queue.js'),import('../src/api/routes/moderation/notifications.js'),
  import('../src/api/backend.js'),import('../src/api/moderation-passkey.js')
]);
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(body){this.body=body;return this;},end(){}};}
function cookie(elevated=false){
  const res=response();backend.setWalletSession(res,WALLET);let value=res.headers['Set-Cookie'].split(';')[0];
  if(elevated){const step=response();passkeys.setModerationSession(step,WALLET,'local-credential',undefined,'passkey',
    {headers:{'user-agent':'profile-test'},socket:{remoteAddress:'127.0.0.1'}});value+=`; ${step.headers['Set-Cookie'].split(';')[0]}`;}
  return value;
}
async function call(handler,body,{session=cookie(),method='POST',query={},wallet=WALLET}={}){
  const res=response();await handler({method,body,query,headers:{cookie:session,'user-agent':'profile-test','x-artsoul-wallet':wallet},socket:{remoteAddress:'127.0.0.1'}},res);return res;
}
function auth(input){
  if(String(input).includes('/artsoul_staff_roles?'))return Response.json([{role:'moderator'}]);
  if(String(input).includes('/artsoul_staff_passkeys?'))return Response.json([{credential_id:'local-credential'}]);
  return null;
}
const complaint={target_type:'profile_content',profile_wallet:PROFILE,category:'impersonation',details:'Public identity evidence.',reference_url:'https://example.test/evidence',good_faith_confirmed:true};
const decision={report_id:REPORT,target_type:'profile_content',expected_updated_at:VERSION,action:'hide',reason:'Reviewed captured content.'};
const stored={id:REPORT,target_type:'profile_content',profile_wallet:PROFILE,chain_id:null,artwork_id:null,
  profile_content_hash:HASH,profile_content_snapshot:{username:'Public name',bio:'<script>reported text</script>'},status:'pending_review',updated_at:VERSION};

test('profile complaint HTTP boundaries reuse authenticated intake and staff review',async t=>{
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  await t.test('intake sends only normalized target and authenticated reporter, never caller-supplied evidence snapshots',async()=>{
    let rpc;
    globalThis.fetch=async(input,options)=>{
      assert.match(String(input),/\/rpc\/submit_profile_content_report$/);rpc=JSON.parse(options.body);
      return Response.json([{report_id:REPORT,report_status:'pending_review',report_created_at:VERSION,already_submitted:false}]);
    };
    const res=await call(intake,{...complaint,profile_wallet:PROFILE.toUpperCase().replace('0X','0x'),reporter_wallet:PROFILE,
      profile_content_snapshot:{bio:'forged'},profile_content_hash:'f'.repeat(64)});
    assert.equal(res.statusCode,201);
    assert.deepEqual(rpc,{p_profile_wallet:PROFILE,p_reporter_wallet:WALLET,p_category:'impersonation',p_details:complaint.details,
      p_reference_url:complaint.reference_url,p_good_faith_confirmed:true,p_daily_limit:5});
    assert.deepEqual(res.body.report,{reference:REPORT,status:'pending_review',created_at:VERSION});
  });
  await t.test('guest, paused intake, invalid profile and mixed content identifiers never reach storage',async()=>{
    globalThis.fetch=()=>{throw new Error('unexpected storage call');};
    assert.equal((await call(intake,complaint,{session:''})).statusCode,401);
    for (const wallet of [null,PROFILE,'not-a-wallet']) {
      const res=await call(intake,complaint,{wallet});assert.equal(res.statusCode,401);assert.equal(res.body.error,'SESSION_WALLET_MISMATCH');
    }
    for(const patch of [{profile_wallet:'bad'},{profile_wallet:`0x${'0'.repeat(40)}`},{chain_id:84532},{artwork_id:'28'},
      {donation_transaction_hash:`0x${'a'.repeat(64)}`},{donation_contract_address:PROFILE},{donation_log_index:0},
      {target_type:'artwork',chain_id:84532,artwork_id:'28'}]){
      const res=await call(intake,{...complaint,...patch});assert.equal(res.statusCode,400);assert.equal(res.body.error,'INVALID_REPORT_TARGET');
    }
    process.env.ARTSOUL_PROFILE_REPORTS_ENABLED='false';
    assert.equal((await call(intake,complaint)).body.error,'PROFILE_REPORTING_DISABLED');
    process.env.ARTSOUL_PROFILE_REPORTS_ENABLED='true';
  });
  await t.test('missing profile, shared cap and duplicate receipts retain bounded API responses',async()=>{
    for(const [message,status] of [['PROFILE_NOT_FOUND',404],['REPORT_DAILY_LIMIT_REACHED',429]]){
      globalThis.fetch=async()=>Response.json({message},{status:400});
      const res=await call(intake,complaint);assert.equal(res.statusCode,status);assert.equal(res.body.error,message);
    }
    globalThis.fetch=async()=>Response.json([{report_id:REPORT,report_status:'pending_review',report_created_at:VERSION,already_submitted:true}]);
    const repeated=await call(intake,complaint);assert.equal(repeated.statusCode,200);assert.equal(repeated.body.alreadySubmitted,true);
  });
  await t.test('review requires existing staff step-up and cannot use caller-selected profile or snapshot',async()=>{
    let rpcCalls=0,rpc;
    globalThis.fetch=async(input,options)=>{
      const authorized=auth(input);if(authorized)return authorized;
      rpcCalls++;assert.match(String(input),/\/rpc\/review_profile_content_report$/);rpc=JSON.parse(options.body);
      return Response.json([{report_id:REPORT,report_status:'actioned',report_updated_at:VERSION,profile_hidden:true}]);
    };
    assert.equal((await call(review,decision)).body.error,'STEP_UP_REQUIRED');assert.equal(rpcCalls,0);
    process.env.ARTSOUL_PROFILE_REPORTS_ENABLED='false';
    const res=await call(review,{...decision,profile_wallet:WALLET,actor_wallet:PROFILE,profile_content_hash:'f'.repeat(64)},{session:cookie(true)});
    process.env.ARTSOUL_PROFILE_REPORTS_ENABLED='true';
    assert.equal(res.statusCode,200);assert.equal(res.body.report.profile_hidden,true);assert.equal(Object.hasOwn(res.body.report,'artwork_hidden'),false);
    assert.deepEqual(rpc,{p_report_id:REPORT,p_expected_updated_at:VERSION,p_action:'hide',p_reason:decision.reason,p_actor_wallet:WALLET});
  });
  await t.test('changed content and review versions return conflicts, not successful hiding',async()=>{
    for(const message of ['PROFILE_CONTENT_CHANGED','REPORT_REVIEW_CONFLICT','REPORT_TARGET_MISMATCH','REPORT_ALREADY_PENDING']){
      globalThis.fetch=async input=>auth(input)||Response.json({message},{status:400});
      const res=await call(review,decision,{session:cookie(true)});assert.equal(res.statusCode,409);assert.equal(res.body.error,message);
    }
  });
  await t.test('staff queue filters the exact profile and resolves current content separately from captured evidence',async()=>{
    let reads=0;
    globalThis.fetch=async input=>{
      const authorized=auth(input);if(authorized)return authorized;
      const url=new URL(input);
      if(url.pathname.endsWith('/artwork_reports')){
        reads++;assert.equal(url.searchParams.get('target_type'),'eq.profile_content');assert.equal(url.searchParams.get('profile_wallet'),`eq.${PROFILE}`);
        assert.equal(url.searchParams.has('chain_id'),false);assert.equal(url.searchParams.has('artwork_id'),false);return Response.json([stored]);
      }
      if(url.pathname.endsWith('/profile_content_visibility'))return Response.json([{profile_wallet:PROFILE,content_hash:'b'.repeat(64),hidden:false}]);
      return Response.json([]);
    };
    const query={target_type:'profile_content',profile_wallet:PROFILE,status:'all'};
    assert.equal((await call(queue,undefined,{method:'GET',session:'',query})).statusCode,401);
    assert.equal((await call(queue,undefined,{method:'GET',query})).statusCode,403);assert.equal(reads,0);
    const res=await call(queue,undefined,{method:'GET',session:cookie(true),query});assert.equal(res.statusCode,200);
    assert.deepEqual(res.body.data.reports[0].profile_content_snapshot,stored.profile_content_snapshot);
    assert.equal(res.body.data.reports[0].profile_content_changed,true);assert.equal(res.body.data.reports[0].profile_content_available,true);
    assert.equal(res.body.data.profiles.length,1);assert.deepEqual(res.body.data.artworks,[]);
    const mixed=await call(queue,undefined,{method:'GET',session:cookie(true),query:{...query,artworkId:'28'}});assert.equal(mixed.statusCode,400);
  });
  await t.test('foreign or malformed current-profile context fails closed in the private queue',async()=>{
    for(const context of [[{profile_wallet:WALLET,content_hash:HASH,hidden:false}],[{profile_wallet:PROFILE,content_hash:HASH,hidden:'false'}],null]){
      globalThis.fetch=async input=>auth(input)||Response.json(String(input).includes('/artwork_reports?')?[stored]:
        String(input).includes('/profile_content_visibility?')?context:[]);
      const res=await call(queue,undefined,{method:'GET',session:cookie(true)});assert.notEqual(res.statusCode,200);
    }
  });
  await t.test('participant notices use profile links without private snapshots and remain readable while intake is paused',async()=>{
    process.env.ARTSOUL_PROFILE_REPORTS_ENABLED='false';process.env.ARTSOUL_REPORTING_ENABLED='false';
    globalThis.fetch=async input=>{
      const url=new URL(input);
      if(url.pathname.endsWith('/artwork_report_notifications')){
        assert.equal(url.searchParams.get('recipient_wallet'),`eq.${WALLET}`);
        return Response.json(['PROFILE_CONTENT_HIDDEN','PROFILE_CONTENT_RESTORED','REPORT_ACTIONED'].map((type,i)=>
          ({id:String(i+1),report_id:REPORT,notification_type:type,created_at:VERSION,details:'private complaint'})));
      }
      return Response.json([stored]);
    };
    const res=await call(notifications,undefined,{method:'GET'});
    process.env.ARTSOUL_PROFILE_REPORTS_ENABLED='true';process.env.ARTSOUL_REPORTING_ENABLED='true';
    assert.equal(res.statusCode,200);assert.equal(res.body.items.length,3);
    for(const item of res.body.items){assert.equal(item.target_type,'profile_content');assert.equal(item.profile_wallet,PROFILE);assert.equal(Object.hasOwn(item,'artwork_id'),false);}
    assert.doesNotMatch(JSON.stringify(res.body.items),/snapshot|content_hash|private complaint|reporter_wallet|report_id/);
  });
});
