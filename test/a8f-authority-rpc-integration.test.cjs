// Actual SQL and EOA signatures on an isolated PostgreSQL fixture, never RPCs or project wallets.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {execFileSync,execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run=promisify(execFile), container=`artsoul-a8f-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const q=value=>value==null?'NULL':"'"+String(value).replace(/'/g,"''")+"'";
const args=query=>['exec',container,'psql','-U','postgres','-d','artsoul','-v','ON_ERROR_STOP=1','-qAt','-c',query];
const sql=query=>execFileSync('docker',args(query),{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim();
const parallel=async query=>(await run('docker',args(query),{timeout:20000})).stdout.trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let available=false;
try {available=execFileSync('docker',['version','--format','{{.Server.Os}}'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim()==='linux';}catch{}

test('A8f atomically consumes reviewed two-wallet application approvals',{skip:available?false:'Docker unavailable'},async t=>{
  execFileSync('docker',['run','-d','--name',container,'-e','POSTGRES_PASSWORD=postgres','-e','POSTGRES_DB=artsoul','postgres:17'],{stdio:'ignore',timeout:120000});
  t.after(()=>execFileSync('docker',['rm','-f',container],{stdio:'ignore',timeout:30000}));
  let ready=false;
  for(let i=0;i<60;i++) {try {sql('SELECT 1');await delay(300);sql('SELECT 1');ready=true;break;}catch{await delay(500);}}
  assert(ready);
  sql('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
  for(const name of ['phase18_artwork_moderation_visibility.sql','a8a_moderation_passkey_foundation.sql','a8d_moderation_safe_recovery.sql','a8e_moderation_totp_persistence.sql','a8f_moderation_dual_wallet_authority.sql']) {
    execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','artsoul','-v','ON_ERROR_STOP=1','-f','-'],
      {input:fs.readFileSync(path.join(__dirname,'../sql/migrations',name)),stdio:['pipe','ignore','pipe'],timeout:30000});
  }
  const {Wallet}=await import('ethers');
  const {buildAuthorityApprovalMessage,verifyAuthorityApprovals}=await import('../src/api/moderation-dual-wallet.js');
  const signers=[Wallet.createRandom(),Wallet.createRandom()].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const addresses=signers.map(w=>w.address.toLowerCase()), target=Wallet.createRandom().address.toLowerCase();
  const replacement=[Wallet.createRandom(),Wallet.createRandom()].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const next=replacement.map(w=>w.address.toLowerCase());
  const readPolicy=()=>{const p=JSON.parse(sql('SELECT row_to_json(p) FROM artsoul_staff_authority_policy p'));return {origin:p.origin,chainId:p.chain_id,version:String(p.version),authorities:[p.wallet_a,p.wallet_b]};};
  const reset=()=>{
    sql(`TRUNCATE artsoul_staff_authority_events,artsoul_staff_authority_requests,artsoul_staff_authority_policy,artsoul_staff_roles RESTART IDENTITY;
      INSERT INTO artsoul_staff_authority_policy(version,origin,chain_id,wallet_a,wallet_b)
      VALUES(1,'https://artsoulprotocol.com',84532,${q(addresses[0])},${q(addresses[1])})`);
  };
  const requestSql=(action='grant_role',wallet=addresses[0],role='moderator',dest=target,rotate=[])=>
    `SELECT a8f_create_authority_request(${q(wallet)},${q(action)},${q(dest)},${q(role)},${q(rotate[0]||'')},${q(rotate[1]||'')})`;
  const request=(...args)=>JSON.parse(sql(requestSql(...args)));
  async function proof(proposal,keys=signers) {
    const signatures=await Promise.all(keys.map(w=>w.signMessage(buildAuthorityApprovalMessage(proposal))));
    return verifyAuthorityApprovals(proposal,signatures,readPolicy());
  }
  const array=items=>`ARRAY[${items.map(q).join(',')}]::TEXT[]`;
  const completeSql=(proposal,approval,wallet=addresses[0])=>`SELECT a8f_complete_authority_request(${q(wallet)},${q(proposal.requestId)},${array(approval.signers)},${array(approval.signatures)},${q(approval.digest)})`;
  const apply=async proposal=>sql(completeSql(proposal,await proof(proposal)));
  const roleState=()=>JSON.parse(sql(`SELECT COALESCE((SELECT row_to_json(r) FROM artsoul_staff_roles r WHERE wallet_address=${q(target)}),'null'::JSON)`));
  async function holdWrite(query,name,seconds=1) {
    const finished=parallel(`SET application_name=${q(name)};BEGIN;${query};SELECT pg_sleep(${seconds});COMMIT;`);
    for(let i=0;i<40;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name)} AND wait_event='PgSleep')`)==='t')return {finished};await delay(20);}
    await finished;throw Error('Fixture did not acquire its lock');
  }

  await t.test('no deployment policy, role or approval is created by migration',()=>{
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_policy'),'0');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_roles'),'0');
    assert.throws(()=>request(),/AUTHORITY_POLICY_REQUIRED/);
  });
  await t.test('only current authorities can propose exact existing staff roles',()=>{
    reset();assert.throws(()=>request('grant_role',target),/AUTHORITY_REQUIRED/);
    assert.throws(()=>request('grant_role',addresses[0],'founder'),/INVALID_ROLE_TARGET/);
    assert.throws(()=>request('execute'),/INVALID_AUTHORITY_ACTION/);
    assert.throws(()=>request('rotate_authority',addresses[0],'','',[addresses[0],addresses[0]]),/INVALID_AUTHORITY_ROTATION/);
    assert.throws(()=>request('revoke_role'),/ROLE_CHANGED/);
  });
  await t.test('server proposal roundtrips the signed message and both signatures grant one role',async()=>{
    reset();const p=request(),approval=await proof(p);assert.equal(p.roleVersion,'0');
    assert.equal(sql(completeSql(p,approval)),'OK');
    assert.equal(roleState().role,'moderator');assert.equal(roleState().active,true);
    const record=JSON.parse(sql('SELECT row_to_json(e) FROM artsoul_staff_authority_events e'));
    assert.equal(record.message_digest,approval.digest);assert.deepEqual(record.signers,addresses);
    assert.deepEqual(record.signatures,approval.signatures);assert.equal(record.before_state,null);
    assert.equal(record.after_state.wallet_address,target);
    assert.equal(sql(completeSql(p,approval)),'REQUEST_INVALID');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_events'),'1');
  });
  await t.test('partial, duplicate, foreign or malformed verified evidence cannot mutate roles',async()=>{
    reset();const p=request(),approval=await proof(p);
    for(const patch of [{signers:[addresses[0]]},{signers:[addresses[0],addresses[0]]},{signers:[addresses[0],target]},
      {signatures:[approval.signatures[0]]},{digest:null}]) {
      assert.equal(sql(completeSql(p,{...approval,...patch})),'BOTH_APPROVALS_REQUIRED');
    }
    assert.equal(sql(completeSql(p,approval,target)),'AUTHORITY_REQUIRED');
    assert.equal(roleState(),null);assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_events'),'0');
  });
  await t.test('concurrent duplicate approval is applied and audited exactly once',async()=>{
    reset();const p=request(),approval=await proof(p);
    assert.deepEqual((await Promise.all([parallel(completeSql(p,approval)),parallel(completeSql(p,approval))])).sort(),['OK','REQUEST_INVALID']);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_events'),'1');
  });
  await t.test('concurrent competing grants cannot silently overwrite each other',async()=>{
    reset();const one=request(),two=request('grant_role',addresses[1],'team');
    const [a,b]=await Promise.all([proof(one),proof(two)]);
    assert.deepEqual((await Promise.all([parallel(completeSql(one,a)),parallel(completeSql(two,b))])).sort(),['OK','ROLE_CHANGED']);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_events'),'1');
  });
  await t.test('both approvals revoke access and later regrant uses a newer role version',async()=>{
    reset();assert.equal(await apply(request()),'OK');const first=roleState().authorization_version;
    const revoke=request('revoke_role');assert.equal(revoke.roleVersion,String(first));assert.equal(await apply(revoke),'OK');
    const revoked=roleState();assert.equal(revoked.active,false);assert(revoked.authorization_version>first);
    assert.equal(await apply(request()),'OK');assert(roleState().authorization_version>revoked.authorization_version);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_events'),'3');
    assert.throws(()=>request(),/ROLE_UNCHANGED/);
  });
  await t.test('a changed target invalidates an outstanding signed request',async()=>{
    reset();assert.equal(await apply(request()),'OK');const p=request('revoke_role'),approval=await proof(p);
    sql(`UPDATE artsoul_staff_roles SET role='admin' WHERE wallet_address=${q(target)}`);
    assert.equal(sql(completeSql(p,approval)),'ROLE_CHANGED');assert.equal(roleState().active,true);
  });
  await t.test('only the old pair can authorize rotation; its other requests become stale',async()=>{
    reset();const oldGrant=request(),oldProof=await proof(oldGrant);
    const rotate=request('rotate_authority',addresses[0],'','',next);
    await assert.rejects(()=>proof(rotate,replacement),/INVALID_AUTHORITY_PROPOSAL/);
    const rotationProof=await proof(rotate);assert.equal(sql(completeSql(rotate,rotationProof)),'OK');
    assert.deepEqual(readPolicy().authorities,next);assert.equal(readPolicy().version,'2');
    assert.equal(sql(completeSql(oldGrant,oldProof)),'AUTHORITY_REQUIRED');
    assert.equal(sql(completeSql(oldGrant,oldProof,next[0])),'POLICY_CHANGED');
    assert.throws(()=>request(),/AUTHORITY_REQUIRED/);
    const newGrant=request('grant_role',next[0]),newProof=await proof(newGrant,replacement);
    assert.equal(sql(completeSql(newGrant,newProof,next[0])),'OK');
  });
  await t.test('expiry is rechecked after waiting on the authority lock',async()=>{
    reset();const p=request(),approval=await proof(p);
    sql(`UPDATE artsoul_staff_authority_requests SET issued_at=clock_timestamp()-INTERVAL '4 minutes',expires_at=clock_timestamp()+INTERVAL '1 second' WHERE id=${q(p.requestId)}`);
    const {finished}=await holdWrite('SELECT * FROM artsoul_staff_authority_policy FOR UPDATE','a8f-expiry',2);
    assert.equal(await parallel(completeSql(p,approval)),'REQUEST_EXPIRED');await finished;
    assert.equal(roleState(),null);
  });
  await t.test('a role write committed while completion waits invalidates the old proof',async()=>{
    reset();assert.equal(await apply(request()),'OK');const p=request('revoke_role'),approval=await proof(p);
    const {finished}=await holdWrite(`UPDATE artsoul_staff_roles SET role='team' WHERE wallet_address=${q(target)}`,'a8f-role-race');
    assert.equal(await parallel(completeSql(p,approval)),'ROLE_CHANGED');await finished;
    assert.equal(roleState().role,'team');assert.equal(roleState().active,true);
  });
  await t.test('audit failure rolls back mutation and nonce consumption together',async()=>{
    reset();const p=request(),approval=await proof(p);
    sql(`CREATE FUNCTION _a8f_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'FORCED_AUDIT_FAILURE';END;$f$;
      CREATE TRIGGER _a8f_fail_audit BEFORE INSERT ON artsoul_staff_authority_events FOR EACH ROW EXECUTE FUNCTION _a8f_fail_audit()`);
    try {assert.throws(()=>sql(completeSql(p,approval)),/FORCED_AUDIT_FAILURE/);}finally{sql('DROP TRIGGER _a8f_fail_audit ON artsoul_staff_authority_events');}
    assert.equal(roleState(),null);
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_authority_requests WHERE id=${q(p.requestId)}`),'t');
    assert.equal(sql(completeSql(p,approval)),'OK');
  });
  await t.test('browser and direct runtime writes cannot bypass the authority consumer',()=>{
    for(const table of ['artsoul_staff_authority_policy','artsoul_staff_authority_requests','artsoul_staff_authority_events']) {
      assert.equal(sql(`SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=${q(table)}::regclass`),'t');
      for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_table_privilege(${q(role)},${q(table)},'SELECT')`),'f');
      for(const permission of ['INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(sql(`SELECT has_table_privilege('service_role',${q(table)},${q(permission)})`),'f');
    }
    for(const permission of ['INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(sql(`SELECT has_table_privilege('service_role','artsoul_staff_roles',${q(permission)})`),'f');
    for(const fn of ['a8f_create_authority_request(text,text,text,text,text,text)','a8f_complete_authority_request(text,uuid,text[],text[],text)']) {
      for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_function_privilege(${q(role)},${q(fn)},'EXECUTE')`),'f');
      assert.equal(sql(`SELECT has_function_privilege('service_role',${q(fn)},'EXECUTE')`),'t');
    }
    assert.throws(()=>sql(`SET ROLE service_role;UPDATE artsoul_staff_roles SET role='admin'`),/permission denied/);
    assert.throws(()=>sql('SET ROLE authenticated;'+requestSql()),/permission denied/);
    reset();const p=JSON.parse(sql('SET ROLE service_role;'+requestSql()));assert.equal(p.targetWallet,target);
  });

  // Real handler, SIWE cookie code, EOA verifier and SQL. Only the PostgREST
  // HTTP transport is a fixture translating the allowlisted calls into psql.
  const {default:handler}=await import('../src/api/routes/moderation/authority.js');
  const {setWalletSession}=await import('../src/api/backend.js');
  const env={ARTSOUL_MODERATION_DUAL_WALLET_ENABLED:'true',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
    ARTSOUL_WEBAUTHN_RP_ID:'artsoulprotocol.com',ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN:'https://artsoulprotocol.com',
    ARTSOUL_WEBAUTHN_RP_NAME:'ArtSoul',ARTSOUL_MODERATION_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
    SUPABASE_URL:'https://authority-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'isolated-fixture-not-a-key'};
  const previousEnv=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]])),previousFetch=global.fetch;
  Object.assign(process.env,env);let calls=[];
  t.after(()=>{global.fetch=previousFetch;for(const [key,value]of Object.entries(previousEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  global.fetch=async(url,options={})=>{
    const parsed=new URL(url);assert.equal(parsed.origin,env.SUPABASE_URL,'no external network');
    const route=parsed.pathname.replace('/rest/v1/',''),body=options.body?JSON.parse(options.body):null;
    calls.push({route,body});let data;
    if(route==='artsoul_staff_authority_policy')data=JSON.parse(sql(`SELECT COALESCE(json_agg(p),'[]'::JSON) FROM artsoul_staff_authority_policy p WHERE singleton`));
    else if(route==='artsoul_staff_authority_requests') {
      const id=parsed.searchParams.get('id').slice(3);
      data=JSON.parse(sql(`SELECT COALESCE(json_agg(r),'[]'::JSON) FROM artsoul_staff_authority_requests r WHERE id=${q(id)} AND consumed_at IS NULL`));
    } else if(route==='rpc/a8f_create_authority_request') {
      data=JSON.parse(sql(`SET ROLE service_role;SELECT a8f_create_authority_request(${[body.p_wallet,body.p_action,body.p_target,body.p_role,body.p_next_wallet_a,body.p_next_wallet_b].map(q).join(',')})`));
    } else if(route==='rpc/a8f_complete_authority_request') {
      data=sql(`SET ROLE service_role;SELECT a8f_complete_authority_request(${q(body.p_wallet)},${q(body.p_request_id)},${array(body.p_verified_signers)},${array(body.p_signatures)},${q(body.p_message_digest)})`);
    } else throw Error('Unexpected fixture route');
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const response=()=>({statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){return this;}});
  async function invoke(body,{wallet=addresses[0],origin=env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN,method='POST',query={}}={}) {
    const session=response();if(wallet)setWalletSession(session,wallet);
    const req={method,query,body,headers:{cookie:session.headers['Set-Cookie']?.split(';')[0]||'',origin}};
    const res=response();await handler(req,res);assert.equal(res.headers['Cache-Control'],'private, no-store');return res;
  }
  const requestBody=()=>({operation:'request',expectedWallet:addresses[0],action:'grant_role',targetWallet:target,role:'moderator',nextAuthorities:[]});
  const completeBody=(p,sigs)=>({operation:'complete',expectedWallet:addresses[0],requestId:p.requestId,signatures:sigs});
  await t.test('disabled, anonymous, stale-wallet and foreign-origin requests make zero database calls',async()=>{
    reset();calls=[];process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='false';
    assert.equal((await invoke(requestBody())).statusCode,404);process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='true';
    assert.equal((await invoke(requestBody(),{wallet:null})).statusCode,401);
    assert.equal((await invoke({...requestBody(),expectedWallet:target})).statusCode,403);
    assert.equal((await invoke(requestBody(),{origin:'https://other.example'})).statusCode,403);
    assert.equal(calls.length,0);
  });
  await t.test('handler verifies both signatures before the one-time SQL mutation',async()=>{
    reset();const prepared=await invoke(requestBody());assert.equal(prepared.statusCode,200);
    const p=prepared.body.request.proposal;assert.equal(prepared.body.request.message,buildAuthorityApprovalMessage(p));
    const sigs=await Promise.all(signers.map(w=>w.signMessage(prepared.body.request.message)));
    calls=[];
    for(const invalid of [[sigs[0]],[sigs[0],sigs[0]],['0x',sigs[1]]])assert.equal((await invoke(completeBody(p,invalid))).statusCode,403);
    assert.equal(calls.filter(c=>c.route==='rpc/a8f_complete_authority_request').length,0);
    assert.equal(roleState(),null);
    const applied=await invoke(completeBody(p,[...sigs].reverse()));assert.equal(applied.statusCode,200);
    const sent=calls.find(c=>c.route==='rpc/a8f_complete_authority_request');assert.deepEqual(sent.body.p_verified_signers,addresses);
    assert.deepEqual(sent.body.p_signatures,sigs);assert.equal(roleState().role,'moderator');
    assert.equal((await invoke(completeBody(p,sigs))).statusCode,409);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_events'),'1');
  });
  await t.test('caller-supplied proposal or verification claims cannot reach the consumer',async()=>{
    reset();const prepared=await invoke(requestBody()),p=prepared.body.request.proposal;
    const sigs=await Promise.all(signers.map(w=>w.signMessage(prepared.body.request.message)));calls=[];
    for(const extra of [{proposal:{...p,role:'admin'}},{verified:true},{signers:addresses},{targetWallet:addresses[0]}]) {
      assert.equal((await invoke({...completeBody(p,sigs),...extra})).statusCode,400);
    }
    assert.equal(calls.filter(c=>c.route==='rpc/a8f_complete_authority_request').length,0);assert.equal(roleState(),null);
  });
  await t.test('either current authority can read the exact proposal without granting access to outsiders',async()=>{
    reset();const prepared=await invoke(requestBody()),p=prepared.body.request.proposal;
    const found=await invoke(null,{wallet:addresses[1],method:'GET',query:{expectedWallet:addresses[1],requestId:p.requestId}});
    assert.equal(found.statusCode,200);assert.equal(found.body.request.message,prepared.body.request.message);
    calls=[];assert.equal((await invoke(null,{wallet:target,method:'GET',query:{expectedWallet:target,requestId:p.requestId}})).statusCode,403);
    assert.equal(calls.some(c=>c.route==='artsoul_staff_authority_requests'),false);
    assert.equal(roleState(),null);
  });
});
