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
  for(const name of ['phase18_artwork_moderation_visibility.sql','a8a_moderation_passkey_foundation.sql','a8d_moderation_safe_recovery.sql','a8e_moderation_totp_persistence.sql','a8f_moderation_dual_wallet_authority.sql','a8g_staff_factor_setup.sql']) {
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
    sql(`TRUNCATE artsoul_staff_authority_events,artsoul_staff_authority_requests,artsoul_staff_authority_policy,artsoul_staff_roles,
      artsoul_staff_auth_events,artsoul_webauthn_challenges,artsoul_staff_passkeys,artsoul_staff_setup_permissions,
      artsoul_staff_totp_attempts,artsoul_staff_totp_factors,artsoul_staff_totp_grants,artsoul_staff_totp_policy RESTART IDENTITY;
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

  const setup=()=>JSON.parse(sql(`SELECT row_to_json(p) FROM artsoul_staff_setup_permissions p
    WHERE target_wallet=${q(target)} ORDER BY issued_at DESC LIMIT 1`));
  const setupChallenge=permission=>{
    const challenge=crypto.randomBytes(32).toString('base64url');
    sql(`INSERT INTO artsoul_webauthn_challenges(challenge,wallet_address,purpose,setup_permission_id,authorization_version,expires_at)
      VALUES(${q(challenge)},${q(target)},'registration',${q(permission.id)},${permission.role_version},clock_timestamp()+INTERVAL '5 minutes')`);
    return challenge;
  };
  const passkeySetupSql=(permission,challenge,credential='setup-fixture-key',wallet=target)=>
    `SELECT a8g_complete_passkey_setup(${q(wallet)},${q(permission.id)},${q(challenge)},${q(credential)},'fixture-public-key',0,'[]',NULL,'Test device')`;
  const totpCrypto=await import('../src/api/moderation-totp-crypto.js');
  const setupKey=Buffer.alloc(32,42);
  function totpSetup(permission) {
    const id=crypto.randomUUID(),secret=totpCrypto.generateTotpSecret();
    const envelope=totpCrypto.encryptTotpSecret(secret,setupKey,{wallet:target,factorId:id,keyVersion:1});
    return {id,secret,envelope,query:`SELECT a8g_begin_totp_setup(${q(target)},${q(permission.id)},${q(id)},${q(JSON.stringify(envelope))}::JSONB)`};
  }
  function totpSetupAttempt(factor) {
    const [result,id]=sql(`SELECT result,attempt_id FROM a8e_begin_totp_attempt(${q(target)},${q(factor.id)},'enrollment')`).split('|');
    assert.equal(result,'OK');return id;
  }
  const totpCompletion=(factor,attempt)=>{
    const now=Number(sql('SELECT floor(extract(epoch FROM clock_timestamp()))::BIGINT'));
    const step=totpCrypto.matchTotpStep(factor.secret,totpCrypto.calculateTotp(factor.secret,now),now);
    return `SELECT a8e_complete_totp_attempt(${q(target)},${q(attempt)},${step})`;
  };
  const installTotpPolicy=()=>sql('INSERT INTO artsoul_staff_totp_policy(max_attempts,window_seconds,attempt_lifetime_seconds) VALUES(5,300,120)');

  await t.test('both role approvals issue one exact 15-minute setup permission atomically',async()=>{
    reset();const p=request(),approval=await proof(p);assert.equal(sql(completeSql(p,approval)),'OK');
    const permission=setup();assert.equal(permission.authority_request_id,p.requestId);
    assert.equal(permission.role_version,roleState().authorization_version);
    assert.equal(Date.parse(permission.expires_at)-Date.parse(permission.issued_at),900000);
    assert.equal(permission.consumed_at,null);
    assert.equal(sql(completeSql(p,approval)),'REQUEST_INVALID');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_setup_permissions'),'1');
    assert.equal(sql("SELECT count(*) FROM artsoul_staff_auth_events WHERE event_type='grant_issued'"),'1');
  });
  await t.test('passkey setup commits one credential and consumes its exact challenge and permission',async()=>{
    reset();assert.equal(await apply(request()),'OK');const permission=setup(),challenge=setupChallenge(permission);
    assert.equal(sql(passkeySetupSql(permission,challenge)),'OK');
    assert.equal(setup().factor_type,'passkey');assert.equal(setup().factor_reference,'setup-fixture-key');
    assert.equal(sql('SELECT authorization_version FROM artsoul_staff_passkeys'),String(permission.role_version));
    assert.equal(sql(passkeySetupSql(permission,challenge,'second-key')),'SETUP_PERMISSION_INVALID');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_passkeys'),'1');
    assert.equal(sql(`SELECT consumed_at IS NOT NULL FROM artsoul_webauthn_challenges WHERE challenge=${q(challenge)}`),'t');
  });
  await t.test('foreign wallet, foreign challenge and expired permission cannot enroll a passkey',async()=>{
    reset();assert.equal(await apply(request()),'OK');const permission=setup(),challenge=setupChallenge(permission);
    assert.equal(sql(passkeySetupSql(permission,challenge,'foreign',addresses[0])),'STAFF_INACTIVE');
    assert.equal(sql(passkeySetupSql(permission,'another-challenge')),'CHALLENGE_INVALID');
    sql(`UPDATE artsoul_staff_setup_permissions SET issued_at=statement_timestamp()-INTERVAL '20 minutes',expires_at=statement_timestamp()-INTERVAL '5 minutes' WHERE id=${q(permission.id)}`);
    assert.equal(sql(passkeySetupSql(permission,challenge)),'SETUP_PERMISSION_INVALID');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_passkeys'),'0');
    assert.equal(setup().consumed_at,null);
  });
  await t.test('TOTP setup resumes one encrypted factor then consumes permission only after a valid code',async()=>{
    reset();installTotpPolicy();assert.equal(await apply(request()),'OK');const permission=setup(),factor=totpSetup(permission);
    const prepared=JSON.parse(sql(factor.query)),resumed=JSON.parse(sql(totpSetup(permission).query));
    assert.equal(prepared.id,factor.id);assert.deepEqual(resumed.encrypted_secret,prepared.encrypted_secret);
    assert.equal(totpCrypto.decryptTotpSecret(prepared.encrypted_secret,setupKey,{wallet:target,factorId:factor.id,keyVersion:1}),factor.secret);
    assert.equal(setup().consumed_at,null);
    assert.equal(sql(`SELECT a8e_complete_totp_attempt(${q(target)},${q(totpSetupAttempt(factor))},NULL)`),'CODE_NOT_VERIFIED');
    assert.equal(setup().consumed_at,null);
    assert.equal(sql(totpCompletion(factor,totpSetupAttempt(factor))),'OK');
    assert.equal(setup().factor_type,'totp');assert.equal(setup().factor_reference,factor.id);
    assert.throws(()=>sql(factor.query),/SETUP_PERMISSION_INVALID/);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_factors'),'1');
  });
  await t.test('concurrent passkey and TOTP completions cannot enroll both with one permission',async()=>{
    reset();installTotpPolicy();assert.equal(await apply(request()),'OK');const permission=setup(),factor=totpSetup(permission);
    sql(factor.query);const attempt=totpSetupAttempt(factor),challenge=setupChallenge(permission);
    const results=await Promise.all([parallel(passkeySetupSql(permission,challenge)),parallel(totpCompletion(factor,attempt))]);
    assert.deepEqual(results.sort(),['OK','SETUP_PERMISSION_INVALID']);
    assert.equal(sql('SELECT (SELECT count(*) FROM artsoul_staff_passkeys)+(SELECT count(*) FROM artsoul_staff_totp_factors WHERE activated_at IS NOT NULL)'),'1');
    assert.ok(setup().consumed_at);
  });
  await t.test('two-wallet recovery replaces the role version and denies old setup and active factors',async()=>{
    reset();installTotpPolicy();assert.equal(await apply(request()),'OK');const old=setup(),factor=totpSetup(old);
    sql(factor.query);assert.equal(sql(totpCompletion(factor,totpSetupAttempt(factor))),'OK');
    const renew=request('renew_setup');assert.equal(renew.roleVersion,String(old.role_version));
    assert.match(buildAuthorityApprovalMessage(renew),/Reset staff sign-in methods/);
    assert.equal(await apply(renew),'OK');const replacement=setup();
    assert(replacement.role_version>old.role_version);assert.notEqual(replacement.id,old.id);
    assert.equal(sql(`SELECT result FROM a8e_begin_totp_attempt(${q(target)},${q(factor.id)},'authentication')`),'ROLE_CHANGED');
    assert.equal(sql(passkeySetupSql(old,setupChallenge(old))),'SETUP_PERMISSION_INVALID');
    assert.equal(sql(passkeySetupSql(replacement,setupChallenge(replacement))),'OK');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_setup_permissions'),'2');
  });
  await t.test('passkey audit failure rolls back permission, challenge and credential together',async()=>{
    reset();assert.equal(await apply(request()),'OK');const permission=setup(),challenge=setupChallenge(permission);
    sql(`CREATE FUNCTION _a8g_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'FORCED_SETUP_AUDIT_FAILURE';END;$f$;
      CREATE TRIGGER _a8g_fail_audit BEFORE INSERT ON artsoul_staff_auth_events FOR EACH ROW EXECUTE FUNCTION _a8g_fail_audit()`);
    try{assert.throws(()=>sql(passkeySetupSql(permission,challenge)),/FORCED_SETUP_AUDIT_FAILURE/);}finally{sql('DROP TRIGGER _a8g_fail_audit ON artsoul_staff_auth_events');}
    assert.equal(setup().consumed_at,null);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_passkeys'),'0');
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_webauthn_challenges WHERE challenge=${q(challenge)}`),'t');
    assert.equal(sql(passkeySetupSql(permission,challenge)),'OK');
  });
  await t.test('runtime cannot fabricate setup permission and browser roles cannot execute setup consumers',()=>{
    for(const role of ['anon','authenticated','service_role'])for(const permission of ['INSERT','UPDATE','DELETE','TRUNCATE'])
      assert.equal(sql(`SELECT has_table_privilege(${q(role)},'artsoul_staff_setup_permissions',${q(permission)})`),'f');
    for(const fn of ['a8g_complete_passkey_setup(text,uuid,text,text,text,bigint,text,text,text)','a8g_begin_totp_setup(text,uuid,uuid,jsonb)']) {
      for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_function_privilege(${q(role)},${q(fn)},'EXECUTE')`),'f');
      assert.equal(sql(`SELECT has_function_privilege('service_role',${q(fn)},'EXECUTE')`),'t');
    }
  });

  // Real handler, SIWE cookie code, EOA verifier and SQL. Only the PostgREST
  // HTTP transport is a fixture translating the allowlisted calls into psql.
  const {default:handler}=await import('../src/api/routes/moderation/authority.js');
  const {setWalletSession}=await import('../src/api/backend.js');
  const env={ARTSOUL_MODERATION_DUAL_WALLET_ENABLED:'true',ARTSOUL_MODERATION_PASSKEY_ENABLED:'true',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
    ARTSOUL_WEBAUTHN_RP_ID:'artsoulprotocol.com',ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN:'https://artsoulprotocol.com',
    ARTSOUL_WEBAUTHN_RP_NAME:'ArtSoul',ARTSOUL_MODERATION_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
    SUPABASE_URL:'https://authority-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'isolated-fixture-not-a-key',
    ARTSOUL_MODERATION_TOTP_KEY:crypto.randomBytes(32).toString('hex'),ARTSOUL_MODERATION_TOTP_KEY_VERSION:'1'};
  const previousEnv=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]])),previousFetch=global.fetch;
  Object.assign(process.env,env);let calls=[];
  const where=params=>[...params].filter(([field])=>!['select','limit','order'].includes(field)).map(([field,value])=>{
    assert(/^[a-z_]+$/.test(field));
    if(value==='is.null')return `${field} IS NULL`;
    if(value==='not.is.null')return `${field} IS NOT NULL`;
    assert(/^(eq|gt)\./.test(value));return `${field}${value.startsWith('eq.')?'=':'>'}${q(value.slice(3))}`;
  }).join(' AND ')||'TRUE';
  t.after(()=>{global.fetch=previousFetch;for(const [key,value]of Object.entries(previousEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  global.fetch=async(url,options={})=>{
    const parsed=new URL(url);assert.equal(parsed.origin,env.SUPABASE_URL,'no external network');
    const route=parsed.pathname.replace('/rest/v1/',''),body=options.body?JSON.parse(options.body):null;
    calls.push({route,body});let data;
    if(route==='artsoul_staff_authority_policy')data=JSON.parse(sql(`SELECT COALESCE(json_agg(p),'[]'::JSON) FROM artsoul_staff_authority_policy p WHERE singleton`));
    else if(route==='artsoul_staff_authority_requests') {
      const id=parsed.searchParams.get('id').slice(3);
      data=JSON.parse(sql(`SELECT COALESCE(json_agg(r),'[]'::JSON) FROM artsoul_staff_authority_requests r WHERE id=${q(id)} AND consumed_at IS NULL`));
    } else if(route==='artsoul_staff_roles') {
      const wallet=parsed.searchParams.get('wallet_address').slice(3);
      data=JSON.parse(sql(`SELECT COALESCE(json_agg(r),'[]'::JSON) FROM artsoul_staff_roles r WHERE wallet_address=${q(wallet)} AND active`));
    } else if(route==='artsoul_staff_passkeys') {
      const wallet=parsed.searchParams.get('wallet_address').slice(3),credential=parsed.searchParams.get('credential_id')?.slice(3),version=parsed.searchParams.get('authorization_version')?.slice(3);
      data=JSON.parse(sql(`SELECT COALESCE(json_agg(k),'[]'::JSON) FROM artsoul_staff_passkeys k WHERE wallet_address=${q(wallet)}
        ${credential ? `AND credential_id=${q(credential)}` : ''} ${version ? `AND authorization_version=${q(version)}` : ''} AND revoked_at IS NULL`));
    } else if(route==='artsoul_webauthn_challenges') {
      // Exercise the real module's PostgREST predicates against PostgreSQL,
      // including concurrent PATCHes. No WebAuthn verification is simulated here.
      const fields=['challenge','wallet_address','purpose','authorization_version','expires_at','setup_permission_id'];
      if(options.method==='POST') {
        const row=body[0];assert.equal(body.length,1);
        assert(Object.keys(row).every(key=>fields.includes(key)));
        sql(`INSERT INTO artsoul_webauthn_challenges(${fields.join(',')}) VALUES(${fields.map(key=>q(row[key])).join(',')})`);
        data=[];
      } else if(options.method==='GET') {
        data=JSON.parse(sql(`SELECT COALESCE(json_agg(c),'[]'::JSON) FROM artsoul_webauthn_challenges c WHERE ${where(parsed.searchParams)}`));
      } else {
        assert.equal(options.method,'PATCH');
        assert.deepEqual(Object.keys(body),['consumed_at']);
        const conditions=[...parsed.searchParams].map(([field,value])=>{
          assert([...fields,'consumed_at'].includes(field));
          if(value==='is.null')return `${field} IS NULL`;
          assert(/^(eq|gt)\./.test(value));
          return `${field}${value.startsWith('eq.')?'=':'>'}${q(value.slice(3))}`;
        });
        data=JSON.parse(await parallel(`WITH changed AS (UPDATE artsoul_webauthn_challenges SET consumed_at=${q(body.consumed_at)}
          WHERE ${conditions.join(' AND ')} RETURNING *) SELECT COALESCE(json_agg(changed),'[]'::JSON) FROM changed`));
      }
    } else if(route==='rpc/a8f_create_authority_request') {
      data=JSON.parse(sql(`SET ROLE service_role;SELECT a8f_create_authority_request(${[body.p_wallet,body.p_action,body.p_target,body.p_role,body.p_next_wallet_a,body.p_next_wallet_b].map(q).join(',')})`));
    } else if(route==='rpc/a8f_complete_authority_request') {
      data=sql(`SET ROLE service_role;SELECT a8f_complete_authority_request(${q(body.p_wallet)},${q(body.p_request_id)},${array(body.p_verified_signers)},${array(body.p_signatures)},${q(body.p_message_digest)})`);
    } else if(['artsoul_staff_setup_permissions','artsoul_staff_totp_grants','artsoul_staff_totp_factors','artsoul_staff_totp_attempts'].includes(route)) {
      assert.equal(options.method,'GET');
      data=JSON.parse(sql(`SELECT COALESCE(json_agg(r),'[]'::JSON) FROM ${route} r WHERE ${where(parsed.searchParams)}`));
    } else if(route==='artsoul_staff_auth_events') {
      assert.equal(options.method,'POST');const row=body[0];
      sql(`INSERT INTO artsoul_staff_auth_events(wallet_address,event_type,credential_id,details) VALUES(${q(row.wallet_address)},${q(row.event_type)},${q(row.credential_id)},${q(JSON.stringify(row.details))})`);data=[];
    } else if(route==='rpc/a8g_begin_totp_setup') {
      data=JSON.parse(sql(`SET ROLE service_role;SELECT a8g_begin_totp_setup(${q(body.p_wallet)},${q(body.p_permission_id)},${q(body.p_factor_id)},${q(JSON.stringify(body.p_envelope))})`));
    } else if(route==='rpc/a8e_begin_totp_attempt') {
      data=JSON.parse(sql(`SET ROLE service_role;SELECT json_agg(a) FROM a8e_begin_totp_attempt(${q(body.p_wallet)},${q(body.p_factor_id)},${q(body.p_purpose)}) a`));
    } else if(route==='rpc/a8e_complete_totp_attempt') {
      data=sql(`SET ROLE service_role;SELECT a8e_complete_totp_attempt(${q(body.p_wallet)},${q(body.p_attempt_id)},${q(body.p_matched_step)})`);
    } else if(route==='rpc/a8g_complete_passkey_setup') {
      data=sql(`SET ROLE service_role;SELECT a8g_complete_passkey_setup(${['wallet','permission_id','challenge','credential_id','public_key','sign_count','transports','aaguid','label'].map(key=>q(body['p_'+key])).join(',')})`);
    } else if(route==='rpc/a8a_complete_authentication') {
      data=sql(`SET ROLE service_role;SELECT a8a_complete_authentication(${q(body.p_wallet)},${q(body.p_credential_id)},${q(body.p_new_counter)})`);
    } else throw Error('Unexpected fixture route: '+route);
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const response=()=>({statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){return this;}});
  async function invoke(body,{wallet=addresses[0],origin=env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN,method='POST',query={},routeHandler=handler}={}) {
    const session=response();if(wallet)setWalletSession(session,wallet);
    const req={method,query,body,headers:{cookie:session.headers['Set-Cookie']?.split(';')[0]||'',origin}};
    const res=response();await routeHandler(req,res);if(routeHandler===handler)assert.equal(res.headers['Cache-Control'],'private, no-store');return res;
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

  await t.test('real authority revoke and regrant cannot revive a previously issued session',async()=>{
    const {setModerationSession}=await import('../src/api/moderation-passkey.js');
    const {getModerationAccess}=await import('../src/api/moderation-access.js');
    reset();assert.equal(await apply(request()),'OK');
    const initial=roleState();
    sql(`INSERT INTO artsoul_staff_passkeys(wallet_address,credential_id,public_key,enrolled_via,authorization_version)
      VALUES(${q(target)},'session-fixture-key','fixture-public-key','additional',${initial.authorization_version})`);
    const base=response(),elevated=response();setWalletSession(base,target);
    setModerationSession(elevated,target,'session-fixture-key',initial.authorization_version);
    const req={headers:{cookie:[base,elevated].map(r=>r.headers['Set-Cookie'].split(';')[0]).join('; ')}};
    assert.equal((await getModerationAccess(req,{strict:true})).canModerate,true);
    assert.equal(await apply(request('revoke_role')),'OK');
    await assert.rejects(getModerationAccess(req,{strict:true}),e=>e.code==='ADMIN_REQUIRED');
    assert.equal(await apply(request()),'OK');
    assert(roleState().authorization_version>initial.authorization_version);
    await assert.rejects(getModerationAccess(req,{strict:true}),e=>e.code==='STEP_UP_REQUIRED');
    assert.equal((await getModerationAccess(req)).canModerate,false);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_authority_events'),'3');
  });

  await t.test('real authority regrant rejects old challenges and concurrent consumers accept a fresh one only once',async()=>{
    const {storeAuthenticationChallenge,consumeAuthenticationChallenge}=await import('../src/api/moderation-passkey.js');
    reset();assert.equal(await apply(request()),'OK');const before=roleState().authorization_version;
    const challenge=crypto.randomBytes(32).toString('base64url');
    await storeAuthenticationChallenge(challenge,target,before);
    assert.equal(await apply(request('revoke_role')),'OK');assert.equal(await apply(request()),'OK');
    const current=roleState().authorization_version;
    assert(current>before);
    assert.equal(await consumeAuthenticationChallenge(challenge,target,current),false);
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_webauthn_challenges WHERE challenge=${q(challenge)}`),'t');
    const fresh=crypto.randomBytes(32).toString('base64url');
    await storeAuthenticationChallenge(fresh,target,current);
    const results=await Promise.all([consumeAuthenticationChallenge(fresh,target,current),consumeAuthenticationChallenge(fresh,target,current)]);
    assert.deepEqual(results.sort(),[false,true]);
    assert.equal(await consumeAuthenticationChallenge(fresh,target,current),false);
  });
  await t.test('activation rejects legacy challenges without rewriting them and invalid versions make no database calls',async()=>{
    const {storeAuthenticationChallenge,consumeAuthenticationChallenge}=await import('../src/api/moderation-passkey.js');
    reset();assert.equal(await apply(request()),'OK');const version=roleState().authorization_version;
    const legacy=crypto.randomBytes(32).toString('base64url');
    process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='false';
    try {await storeAuthenticationChallenge(legacy,target);}finally{process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='true';}
    assert.equal(await consumeAuthenticationChallenge(legacy,target,version),false);
    assert.equal(sql(`SELECT authorization_version IS NULL AND consumed_at IS NULL FROM artsoul_webauthn_challenges WHERE challenge=${q(legacy)}`),'t');
    calls=[];
    for(const invalid of [undefined,null,0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'01',true]) {
      await assert.rejects(storeAuthenticationChallenge('unused',target,invalid),e=>e.statusCode===503);
      assert.equal(await consumeAuthenticationChallenge(legacy,target,invalid),false);
    }
    assert.equal(calls.length,0);
    assert.throws(()=>sql(`UPDATE artsoul_webauthn_challenges SET authorization_version=0 WHERE challenge=${q(legacy)}`),/check constraint/);
  });

  const {default:factorHandler}=await import('../src/api/routes/moderation/factor-setup.js');
  const {default:accessHandler}=await import('../src/api/routes/moderation/access.js');
  const {default:registerOptions}=await import('../src/api/routes/moderation/passkey-register-options.js');
  const {default:registerVerify}=await import('../src/api/routes/moderation/passkey-register-verify.js');
  const {default:authOptions}=await import('../src/api/routes/moderation/passkey-auth-options.js');
  const {default:authVerify}=await import('../src/api/routes/moderation/passkey-auth-verify.js');
  const {getModerationAccess}=await import('../src/api/moderation-access.js');
  const {calculateTotp}=await import('../src/api/moderation-totp-crypto.js');
  const {isoCBOR}=await import('@simplewebauthn/server/helpers');
  const asStaff=(routeHandler,body,options={})=>invoke(body,{wallet:target,routeHandler,...options});
  const factorCall=(operation,extra={},options={})=>asStaff(factorHandler,{operation,expectedWallet:target,...extra},options);
  const factorStatus=()=>asStaff(factorHandler,null,{method:'GET',query:{expectedWallet:target}});
  const ok=res=>{assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.body;};
  const privilegedRequest=res=>{
    const base=response();setWalletSession(base,target);
    return {headers:{cookie:[base,res].map(r=>r.headers['Set-Cookie']?.split(';')[0]).filter(Boolean).join('; ')}};
  };
  // Real P-256/WebAuthn cryptography from an ephemeral software authenticator.
  // This proves API validation; it is not physical device/user-presence evidence.
  function authenticator() {
    const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const jwk=publicKey.export({format:'jwk'}),id=crypto.randomBytes(32),rpHash=crypto.createHash('sha256').update(env.ARTSOUL_WEBAUTHN_RP_ID).digest();
    const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
    const client=(type,challenge)=>Buffer.from(JSON.stringify({type,challenge,origin:env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN}));
    const base=()=>({id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',clientExtensionResults:{}});
    return {
      id:id.toString('base64url'),
      registration(challenge) {
        const len=Buffer.alloc(2);len.writeUInt16BE(id.length);
        const authData=Buffer.concat([rpHash,Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),len,id,cose]);
        return {...base(),response:{clientDataJSON:client('webauthn.create',challenge).toString('base64url'),
          attestationObject:Buffer.from(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]]))).toString('base64url'),transports:['internal']}};
      },
      assertion(challenge,counter=1) {
        const count=Buffer.alloc(4);count.writeUInt32BE(counter);
        const authData=Buffer.concat([rpHash,Buffer.from([5]),count]),clientData=client('webauthn.get',challenge);
        const signature=crypto.sign('sha256',Buffer.concat([authData,crypto.createHash('sha256').update(clientData).digest()]),privateKey);
        return {...base(),response:{clientDataJSON:clientData.toString('base64url'),authenticatorData:authData.toString('base64url'),signature:signature.toString('base64url')}};
      }
    };
  }
  async function enrollPasskey(device=authenticator()) {
    const permission=setup(),body={mode:'authority-setup',expectedWallet:target,permissionId:permission.id};
    const options=ok(await asStaff(registerOptions,body)).options;
    const response=device.registration(options.challenge);
    ok(await asStaff(registerVerify,{...body,response}));
    return {device,body,response};
  }
  await t.test('authority discovery exposes staff controls without granting complaint access or a staff role',async()=>{
    reset();
    const result=ok(await asStaff(accessHandler,null,{wallet:addresses[0],method:'GET',query:{expectedWallet:addresses[0]}}));
    assert.equal(result.authorityEligible,true);assert.equal(result.eligible,false);assert.equal(result.access.role,null);
    const outsider=ok(await asStaff(accessHandler,null,{method:'GET',query:{expectedWallet:target}}));
    assert.equal(outsider.authorityEligible,false);assert.equal(outsider.eligible,false);
    const session=response();setWalletSession(session,addresses[0]);
    await assert.rejects(getModerationAccess({headers:{cookie:session.headers['Set-Cookie'].split(';')[0]}},{strict:true}),e=>e.code==='ADMIN_REQUIRED');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_roles'),'0');
  });
  await t.test('factor endpoints deny disabled, anonymous, nonstaff, stale-wallet and cross-origin requests',async()=>{
    reset();calls=[];process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='false';
    assert.equal((await factorCall('totp-setup')).statusCode,404);assert.equal(calls.length,0);
    process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='true';
    assert.equal((await factorCall('totp-setup',{}, {wallet:null})).statusCode,401);
    assert.equal((await factorCall('totp-setup')).statusCode,403);
    assert.equal(await apply(request()),'OK');calls=[];
    assert.equal((await factorCall('totp-setup',{expectedWallet:addresses[0]})).statusCode,403);
    assert.equal((await factorCall('totp-setup',{}, {origin:'https://evil.invalid'})).statusCode,403);
    assert.equal(calls.some(c=>c.route.startsWith('rpc/')),false);
    const status=await factorStatus();assert.equal(status.headers['Cache-Control'],'private, no-store');assert(ok(status).setup);
  });
  await t.test('real WebAuthn registration and login consume approved setup; reset makes that credential unusable',async()=>{
    reset();assert.equal(await apply(request()),'OK');
    const {device,body,response:attestation}=await enrollPasskey();
    assert.equal(sql('SELECT factor_type FROM artsoul_staff_setup_permissions'),'passkey');
    assert.equal((await asStaff(registerVerify,{...body,response:attestation})).statusCode,403);
    const options=ok(await asStaff(authOptions,{})).options;
    const signed=device.assertion(options.challenge);
    const verified=await asStaff(authVerify,{response:signed});ok(verified);
    assert.equal((await getModerationAccess(privilegedRequest(verified),{strict:true})).canModerate,true);
    assert.equal((await asStaff(authVerify,{response:signed})).statusCode,401);
    assert.equal(await apply(request('renew_setup')),'OK');
    assert.equal((await asStaff(authVerify,{response:device.assertion(options.challenge,2)})).body.error,'CREDENTIAL_NOT_ELIGIBLE');
    await assert.rejects(getModerationAccess(privilegedRequest(verified),{strict:true}),e=>e.code==='STEP_UP_REQUIRED');
    await enrollPasskey();
    const {default:keys}=await import('../src/api/routes/moderation/passkeys.js');
    const revoked=await asStaff(keys,{action:'revoke',credential_id:device.id});
    assert.equal(revoked.body.error,'BOTH_AUTHORITY_SIGNATURES_REQUIRED');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_passkeys WHERE revoked_at IS NOT NULL'),'0');
  });
  await t.test('legacy registration, self-grant and Safe recovery cannot bypass paired setup',async()=>{
    reset();assert.equal(await apply(request()),'OK');calls=[];
    for(const mode of ['token','approved-bootstrap']) {
      const body={mode,expectedWallet:target,token:'old-approval'};
      assert.equal((await asStaff(registerOptions,body)).statusCode,400);
      assert.equal((await asStaff(registerVerify,{...body,response:{id:'untrusted'}})).statusCode,400);
    }
    for(const file of ['passkey-grant','passkey-recovery']) {
      const {default:route}=await import(`../src/api/routes/moderation/${file}.js`);
      assert.equal((await asStaff(route,{})).body.error,'BOTH_AUTHORITY_SIGNATURES_REQUIRED');
    }
    assert.equal(calls.some(c=>c.route.startsWith('rpc/')),false);
  });
  await t.test('authenticator setup and a real code issue a typed session without revealing the active secret again',async()=>{
    reset();installTotpPolicy();assert.equal(await apply(request()),'OK');const permission=setup();
    const prepared=ok(await factorCall('totp-setup',{permissionId:permission.id}));
    assert.match(prepared.secret,/^[A-Z2-7]{32}$/);assert.match(prepared.uri,/^otpauth:\/\/totp\//);
    const resumed=ok(await factorCall('totp-setup',{permissionId:permission.id}));
    assert.equal(resumed.secret,prepared.secret);assert.equal(resumed.factorId,prepared.factorId);
    assert(!sql('SELECT encrypted_secret::TEXT FROM artsoul_staff_totp_factors').includes(prepared.secret));
    assert.equal(sql('SELECT activated_at IS NULL FROM artsoul_staff_totp_factors'),'t');
    const attempt=ok(await factorCall('totp-begin',{factorId:prepared.factorId,purpose:'enrollment'}));
    const verified=await factorCall('totp-verify',{attemptId:attempt.attemptId,code:calculateTotp(prepared.secret,Math.floor(Date.now()/1000))});
    assert.equal(ok(verified).expires_in_seconds,900);
    const elevated=privilegedRequest(verified);
    assert.equal((await getModerationAccess(elevated,{strict:true})).canModerate,true);
    const status=ok(await factorStatus());assert.equal(status.setup,null);assert.equal(status.totpFactorId,prepared.factorId);
    assert(!JSON.stringify(status).includes(prepared.secret));
    assert.equal((await factorCall('totp-setup',{permissionId:permission.id})).statusCode,403);
    assert.equal((await factorCall('totp-verify',{attemptId:attempt.attemptId,code:'000000'})).statusCode,403);
    const login=ok(await factorCall('totp-begin',{factorId:prepared.factorId,purpose:'authentication'}));
    const replay=await factorCall('totp-verify',{attemptId:login.attemptId,code:calculateTotp(prepared.secret,Math.floor(Date.now()/1000))});
    // Reusing a consumed time step is denied; a rollover legitimately permits a newer code.
    assert([200,403].includes(replay.statusCode));if(replay.statusCode===403)assert.equal(replay.body.error,'STEP_REPLAYED');
    assert.equal(await apply(request('renew_setup')),'OK');
    await assert.rejects(getModerationAccess(elevated,{strict:true}),e=>e.code==='STEP_UP_REQUIRED');
    assert.equal((await factorCall('totp-begin',{factorId:prepared.factorId,purpose:'authentication'})).statusCode,403);
  });
  await t.test('abandoned attempts count, caller-matched steps are rejected and wrong codes consume the reservation',async()=>{
    reset();installTotpPolicy();assert.equal(await apply(request()),'OK');
    const prepared=ok(await factorCall('totp-setup',{permissionId:setup().id}));
    const attempts=[];
    for(let i=0;i<5;i++) attempts.push(ok(await factorCall('totp-begin',{factorId:prepared.factorId,purpose:'enrollment'})).attemptId);
    assert.equal((await factorCall('totp-begin',{factorId:prepared.factorId,purpose:'enrollment'})).statusCode,429);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_attempts'),'5');
    assert.equal((await factorCall('totp-verify',{attemptId:attempts[0],code:'000000',matchedStep:123})).statusCode,400);
    const wrong=await factorCall('totp-verify',{attemptId:attempts[0],code:'invalid-code'});
    assert.equal(wrong.statusCode,403);assert.equal(wrong.headers['Set-Cookie'],undefined);
    assert.equal(sql(`SELECT consumed_at IS NOT NULL FROM artsoul_staff_totp_attempts WHERE id=${q(attempts[0])}`),'t');
    assert.equal(setup().consumed_at,null);
    assert.equal((await factorCall('totp-verify',{attemptId:attempts[0],code:calculateTotp(prepared.secret,Math.floor(Date.now()/1000))})).statusCode,403);
  });
});
