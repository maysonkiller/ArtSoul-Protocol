import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import authority from '../src/api/routes/moderation/authority.js';
import queue from '../src/api/routes/moderation/review-queue.js';
import visibility from '../src/api/routes/moderation/artwork-visibility.js';
import {setWalletSession} from '../src/api/backend.js';
import {setModerationSession} from '../src/api/moderation-passkey.js';

const address = n => '0x' + n.toString(16).padStart(40, '0');
const PAIR = [address(1), address(2)], STAFF = address(3), OTHER = address(4), REPORTER = address(5);
const response = () => ({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){}});

test('staff identity disclosure is limited to verified Team and current authority wallets', async t => {
  const env = {
    NODE_ENV:'test', SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
    ARTSOUL_MODERATION_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
    ARTSOUL_MODERATION_DUAL_WALLET_ENABLED:'true', ARTSOUL_MODERATION_PASSKEY_ENABLED:'true',
    ARTSOUL_PROTOCOL_ADMIN_ENABLED:'true', ARTSOUL_WEBAUTHN_RP_ID:'artsoulprotocol.com',
    ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN:'https://artsoulprotocol.com', ARTSOUL_WEBAUTHN_RP_NAME:'ArtSoul',
    SUPABASE_URL:'https://staff-privacy.invalid', SUPABASE_SERVICE_ROLE_KEY:'fixture-only'
  };
  const prior = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]])), oldFetch = global.fetch;
  Object.assign(process.env, env);
  t.after(() => {global.fetch=oldFetch;for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});

  function fixture(role, {wallet=STAFF, stepUp=true, afterRead}={}) {
    const state = {role,version:1,revoked:false,calls:[],rosterReads:0};
    const records = {
      artwork_reports:[{id:'11111111-1111-4111-8111-111111111111',status:'dismissed',reviewed_by:OTHER,reporter_wallet:REPORTER},
        {id:'22222222-2222-4222-8222-222222222222',status:'resolved',reviewed_by:wallet,reporter_wallet:REPORTER}],
      artwork_moderation_visibility:[{chain_id:84532,artwork_id:'34',hidden:true,hidden_by:OTHER}],
      artwork_moderation_log:[{id:1,actor_wallet:OTHER,action:'HIDE'}, {id:2,actor_wallet:wallet,action:'RESTORE'}],
      artwork_report_events:[{id:3,actor_wallet:OTHER,event_type:'REPORT_HIDDEN'}, {id:4,actor_wallet:wallet,event_type:'REPORT_RESOLVED'},
        {id:6,actor_wallet:REPORTER,event_type:'REPORT_SUBMITTED'}],
      artwork_report_notifications:[{id:5,recipient_wallet:REPORTER,notification_type:'REPORT_RESOLVED'}]
    };
    const before = JSON.stringify(records);
    global.fetch = async (value, options) => {
      const url = new URL(value), name = url.pathname.split('/').at(-1);
      assert.equal(url.origin, env.SUPABASE_URL);
      assert.equal(options.method,'GET','privacy reads must not write storage');
      state.calls.push(url);
      if(name === 'artsoul_staff_authority_policy') return Response.json([{version:1,chain_id:84532,origin:env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN,wallet_a:PAIR[0],wallet_b:PAIR[1]}]);
      if(name === 'artsoul_staff_roles') {
        if(url.searchParams.has('active')) return Response.json(state.role ? [{role:state.role,authorization_version:state.version}] : []);
        state.rosterReads++; afterRead?.(state,'roster');
        return Response.json([{wallet_address:OTHER,role:'moderator',active:true},{wallet_address:address(6),role:'admin',active:false}]);
      }
      if(name === 'artsoul_staff_passkeys') return Response.json(state.revoked ? [] : [{credential_id:'fixture-key'}]);
      if(name === 'profiles') return Response.json([{wallet_address:wallet,twitter_id:'fixture-x',discord_id:'fixture-discord'}]);
      assert.ok(Object.hasOwn(records,name),`Unexpected storage access ${name}`);
      const result = Response.json(records[name]); afterRead?.(state,name); return result;
    };
    const req = {method:'GET',headers:{'user-agent':'privacy-fixture'},socket:{remoteAddress:'127.0.0.1'},query:{}};
    const signed = response(), factor = response(); setWalletSession(signed,wallet);
    const cookies = [signed.headers['Set-Cookie'].split(';')[0]];
    if(stepUp){setModerationSession(factor,wallet,'fixture-key',1,'passkey',req);cookies.push(factor.headers['Set-Cookie'].split(';')[0]);}
    req.headers.cookie = cookies.join('; ');
    return {state, records, async invoke(handler, query={}, body) {
      const res=response(); await handler({...req,method:body?'POST':'GET',query:{expectedWallet:wallet,...query},
        headers:{...req.headers,origin:env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN},body},res);
      assert.equal(res.headers['Cache-Control'],'private, no-store');
      assert.equal(JSON.stringify(records),before,'response filtering must not alter retained evidence');
      return res;
    }};
  }

  for(const role of ['admin','moderator']) {
    await t.test(`${role} cannot enumerate staff or retrieve approval data even with a valid factor`,async()=>{
      const h=fixture(role);
      for(const query of [{view:'staff'}, {}, {requestId:'11111111-1111-4111-8111-111111111111'}, {view:'staff',role:'team'}]) {
        const res=await h.invoke(authority,query);assert.equal(res.statusCode,403);
        assert.equal(res.body.policy,undefined);assert.equal(res.body.staff,undefined);
      }
      assert.equal(h.state.rosterReads,0);
    });
    await t.test(`${role} receives no other staff attribution in any queue or visibility view`,async()=>{
      const h=fixture(role);
      for(const status of ['pending_review','actioned','dismissed','resolved','withdrawn']) {
        const res=await h.invoke(queue,{status});assert.equal(res.statusCode,200);
        assert.equal(res.body.data.reports[0].reviewed_by,null);
        assert.equal(res.body.data.reports[1].reviewed_by,STAFF);
        assert.equal(res.body.data.moderationLog[0].actor_wallet,null);
        assert.equal(res.body.data.moderationLog[1].actor_wallet,STAFF);
        assert.equal(res.body.data.events[0].actor_wallet,null);
        assert.equal(res.body.data.events[1].actor_wallet,STAFF);
        assert.equal(res.body.data.events[2].actor_wallet,REPORTER,'submission attribution belongs to the complaint participant');
        assert.equal(res.body.data.hidden[0].hidden_by,null);
        assert.equal(res.body.data.reports[0].reporter_wallet,REPORTER);
        assert.equal(res.body.data.notifications[0].recipient_wallet,REPORTER);
        assert.ok(!JSON.stringify(res.body).includes(OTHER));
      }
      for(const query of [{view:'hidden'},{chain_id:84532,artwork_id:'34'}]) {
        const res=await h.invoke(visibility,query);assert.equal(res.statusCode,200);
        assert.ok(!JSON.stringify(res.body).includes(OTHER));
      }
    });
  }
  await t.test('verified Team can view the directory but cannot prepare, read or apply approvals',async()=>{
    const h=fixture('team');const res=await h.invoke(authority,{view:'staff'});
    assert.equal(res.statusCode,200);assert.equal(res.body.staff[0].wallet,OTHER);assert.equal(res.body.staff[1].active,false);
    assert.deepEqual(res.body.policy.authorities,PAIR);
    for(const query of [{},{requestId:'11111111-1111-4111-8111-111111111111'}]) assert.equal((await h.invoke(authority,query)).statusCode,403);
    for(const operation of ['request','complete']) assert.equal((await h.invoke(authority,{}, {operation,expectedWallet:STAFF})).statusCode,403);
  });
  await t.test('Team requires a live factor and is rejected if removed during a roster read',async()=>{
    const unverified=fixture('team',{stepUp:false});assert.equal((await unverified.invoke(authority,{view:'staff'})).statusCode,403);assert.equal(unverified.state.rosterReads,0);
    for(const update of [s=>{s.role='admin';s.version++;},s=>{s.revoked=true;},s=>{s.role=null;}]) {
      const h=fixture('team',{afterRead:(s,name)=>{if(name==='roster')update(s);}});
      const res=await h.invoke(authority,{view:'staff'});assert.equal(res.statusCode,403);assert.equal(res.body.staff,undefined);
    }
  });
  await t.test('Team and either verified authority retain full audit identities',async()=>{
    for(const [role,wallet] of [['team',STAFF],['admin',PAIR[0]],['moderator',PAIR[1]]]) {
      const h=fixture(role,{wallet});const res=await h.invoke(queue);assert.equal(res.statusCode,200);
      assert.equal(res.body.data.reports[0].reviewed_by,OTHER);assert.equal(res.body.data.events[0].actor_wallet,OTHER);
      assert.equal(res.body.data.hidden[0].hidden_by,OTHER);assert.equal(res.body.data.moderationLog[0].actor_wallet,OTHER);
      const exact=await h.invoke(visibility,{chain_id:84532,artwork_id:'34'});assert.equal(exact.body.data.hidden_by,OTHER);
    }
  });
  await t.test('authority directory access survives removal of its separate staff role',async()=>{
    for(const wallet of PAIR){const h=fixture(null,{wallet,stepUp:false});assert.equal((await h.invoke(authority,{view:'staff'})).statusCode,200);}
  });
  await t.test('a Team role removed while protected data loads cannot disclose stale identities',async()=>{
    for(const handler of [queue,visibility]) {
      const h=fixture('team',{afterRead:(s,name)=>{if(name==='artwork_moderation_visibility'){s.role='admin';s.version++;}}});
      const res=await h.invoke(handler,{view:'hidden'});assert.equal(res.statusCode,403);assert.equal(res.body.data,undefined);
    }
  });
  await t.test('legacy social access never grants Team visibility of other staff wallets',async()=>{
    process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='false';
    process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED='false';
    try {
      const h=fixture('team',{stepUp:false});
      const res=await h.invoke(visibility,{view:'hidden'});
      assert.equal(res.statusCode,200);assert.equal(res.body.access.canModerate,true);
      assert.equal(res.body.data[0].hidden_by,null);
      assert.ok(!JSON.stringify(res.body).includes(OTHER));
    } finally {
      process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='true';
      process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED='true';
    }
  });
});
