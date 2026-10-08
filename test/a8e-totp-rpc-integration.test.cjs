// Actual SQL on a disposable PostgreSQL 17 container; never a project database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {execFileSync, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const container = `artsoul-a8e-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const root = path.join(__dirname, '..');
const wallet = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
const q = value => value == null ? 'NULL' : "'" + String(value).replace(/'/g, "''") + "'";
const args = query => ['exec', container, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', query];
const sql = query => execFileSync('docker', args(query), {encoding:'utf8', stdio:['ignore','pipe','pipe'],timeout:20000}).trim();
const parallel = async query => (await run('docker', args(query), {timeout:20000})).stdout.trim();
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let available = false;
try {available = execFileSync('docker', ['version','--format','{{.Server.Os}}'], {encoding:'utf8', stdio:['ignore','pipe','pipe'],timeout:15000}).trim()==='linux';} catch {}

test('A8e TOTP persistence uses actual PostgreSQL transactions', {skip:available ? false : 'Docker unavailable'}, async t => {
  execFileSync('docker', ['run','-d','--name',container,'-e','POSTGRES_PASSWORD=postgres','-e','POSTGRES_DB=artsoul','postgres:17'], {stdio:'ignore',timeout:120000});
  t.after(() => execFileSync('docker', ['rm','-f',container], {stdio:'ignore',timeout:30000}));
  let ready = false;
  for(let attempt=0;attempt<60;attempt++) {
    try {sql('SELECT 1');await delay(300);sql('SELECT 1');ready=true;break;} catch {await delay(500);}
  }
  assert(ready, 'disposable PostgreSQL is ready');
  sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const name of ['phase18_artwork_moderation_visibility.sql','a8a_moderation_passkey_foundation.sql','a8d_moderation_safe_recovery.sql','a8e_moderation_totp_persistence.sql']) {
    execFileSync('docker', ['exec','-i',container,'psql','-U','postgres','-d','artsoul','-v','ON_ERROR_STOP=1','-f','-'],
      {input:fs.readFileSync(path.join(root,'sql/migrations',name)),stdio:['pipe','ignore','pipe'],timeout:30000});
  }
  const totp = await import('../src/api/moderation-totp-crypto.js');
  const key = Buffer.alloc(32,19), secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const policy = () => sql(`INSERT INTO artsoul_staff_totp_policy(max_attempts,window_seconds,attempt_lifetime_seconds) VALUES(20,600,120)`);
  // These numbers are test fixtures only; the migration installs NO policy row.
  async function reset() {
    sql(`TRUNCATE artsoul_staff_totp_attempts,artsoul_staff_totp_factors,artsoul_staff_totp_grants,
      artsoul_staff_totp_policy,artsoul_staff_auth_events,artsoul_staff_roles RESTART IDENTITY;
      INSERT INTO artsoul_staff_roles(wallet_address,role) VALUES('${wallet}','admin'),('${other}','moderator');`);
    policy();
  }
  const dbTime = () => Number(sql('SELECT floor(extract(epoch FROM clock_timestamp()))::BIGINT'));
  const currentStep = () => Math.floor(dbTime()/30);
  const match = (factor, offset=0) => {
    const time=dbTime(),plain=totp.decryptTotpSecret(factor.envelope,key,{wallet:factor.wallet,factorId:factor.id,keyVersion:1});
    return totp.matchTotpStep(plain,totp.calculateTotp(plain,time+offset*30),time);
  };
  function grant(target=wallet) {
    const factor={id:crypto.randomUUID(),grantId:crypto.randomUUID(),tokenHash:crypto.randomBytes(32).toString('hex'),wallet:target};
    factor.envelope=totp.encryptTotpSecret(secret,key,{wallet:target,factorId:factor.id,keyVersion:1});
    // No production issuer exists. Only the isolated test owner seeds grants.
    sql(`INSERT INTO artsoul_staff_totp_grants(id,factor_id,target_wallet,role_version,token_hash,authority_policy,authorization_digest,expires_at)
      VALUES('${factor.grantId}','${factor.id}','${target}',(SELECT authorization_version FROM artsoul_staff_roles WHERE wallet_address='${target}'),'${factor.tokenHash}','founder-dual-wallet-2026-10-07',
      '${crypto.randomBytes(32).toString('hex')}',clock_timestamp()+INTERVAL '10 minutes')`);
    return factor;
  }
  const beginSql = factor => `SELECT a8e_begin_totp_enrollment('${factor.wallet}','${factor.grantId}','${factor.tokenHash}',${q(JSON.stringify(factor.envelope))}::JSONB)`;
  function pending(target=wallet) {const factor=grant(target);assert.equal(sql(beginSql(factor)),'OK');return factor;}
  const claimSql = (factor,purpose='authentication') => `SELECT result,attempt_id FROM a8e_begin_totp_attempt('${factor.wallet}','${factor.id}','${purpose}')`;
  function claim(factor,purpose='authentication') {const [result,id]=sql(claimSql(factor,purpose)).split('|');assert.equal(result,'OK');assert.match(id,/^[a-f0-9-]{36}$/);return id;}
  const completeSql = (factor,attempt,step) => `SELECT a8e_complete_totp_attempt('${factor.wallet}','${attempt}',${step==null?'NULL':step})`;
  function active(target=wallet) {const factor=pending(target);assert.equal(sql(completeSql(factor,claim(factor,'enrollment'),match(factor,-1))),'OK');return factor;}
  async function holdWrite(query,name,seconds=1) {
    const finished=parallel(`SET application_name='${name}'; BEGIN; ${query}; SELECT pg_sleep(${seconds}); COMMIT;`);
    for(let i=0;i<40;i++) {
      if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep')`)==='t')return {finished};
      await delay(20);
    }
    await finished;throw Error('Fixture did not observe the held write lock');
  }
  const auditFailure = event => sql(`CREATE OR REPLACE FUNCTION _a8e_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN IF NEW.event_type='${event}' THEN RAISE EXCEPTION 'FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $f$;
    CREATE TRIGGER _a8e_fail_audit BEFORE INSERT ON artsoul_staff_auth_events FOR EACH ROW EXECUTE FUNCTION _a8e_fail_audit()`);
  const dropAuditFailure = () => sql('DROP TRIGGER _a8e_fail_audit ON artsoul_staff_auth_events');

  await t.test('migration leaves configuration and authority grants absent',()=>{
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_policy'),'0');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_grants'),'0');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_factors'),'0');
  });
  await t.test('absent policy fails closed for setup, claims and completion',async()=>{
    await reset();const factor=active(),attempt=claim(factor),pendingGrant=grant();sql('DELETE FROM artsoul_staff_totp_policy');
    assert.equal(sql(beginSql(pendingGrant)),'TOTP_POLICY_REQUIRED');
    assert.equal(sql(claimSql(factor)),'TOTP_POLICY_REQUIRED|');
    assert.equal(sql(completeSql(factor,attempt,match(factor))),'TOTP_POLICY_REQUIRED');
  });
  await t.test('typed activation consumes the exact grant and first code in one commit',async()=>{
    await reset();const factor=pending(),step=match(factor),attempt=claim(factor,'enrollment');
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_totp_grants WHERE id='${factor.grantId}'`),'t');
    assert.equal(sql(completeSql(factor,attempt,step)),'OK');
    assert.equal(sql(`SELECT factor_type,last_consumed_step,activated_at IS NOT NULL FROM artsoul_staff_totp_factors WHERE id='${factor.id}'`),`totp|${step}|t`);
    assert.equal(sql(`SELECT consumed_at IS NOT NULL FROM artsoul_staff_totp_grants WHERE id='${factor.grantId}'`),'t');
    assert.equal(sql(`SELECT string_agg(event_type,',' ORDER BY id) FROM artsoul_staff_auth_events`),'grant_consumed,totp_enrolled');
    assert.equal(sql(`SELECT bool_and(credential_id IS NULL AND details->>'factor_type'='totp' AND details->>'factor_id'='${factor.id}') FROM artsoul_staff_auth_events`),'t');
    assert.equal(sql(completeSql(factor,claim(factor),step)),'STEP_REPLAYED');
    assert.equal(sql(beginSql(factor)),'GRANT_INVALID');
  });
  await t.test('concurrent activation cannot consume the same grant twice',async()=>{
    await reset();const factor=pending(),step=match(factor),one=claim(factor,'enrollment'),two=claim(factor,'enrollment');
    const results=await Promise.all([parallel(completeSql(factor,one,step)),parallel(completeSql(factor,two,step))]);
    assert.deepEqual(results.sort(),['FACTOR_INELIGIBLE','OK']);
    assert.equal(sql(`SELECT count(*) FROM artsoul_staff_auth_events WHERE event_type='totp_enrolled'`),'1');
  });
  await t.test('concurrent use of one matched step permits exactly one login',async()=>{
    await reset();const factor=active(),step=match(factor),one=claim(factor),two=claim(factor);
    const results=await Promise.all([parallel(completeSql(factor,one,step)),parallel(completeSql(factor,two,step))]);
    assert.deepEqual(results.sort(),['OK','STEP_REPLAYED']);
    assert.equal(sql(`SELECT count(*) FROM artsoul_staff_auth_events WHERE event_type='totp_auth_success'`),'1');
  });
  await t.test('one reservation cannot be completed twice',async()=>{
    await reset();const factor=active(),step=match(factor),attempt=claim(factor);
    const results=await Promise.all([parallel(completeSql(factor,attempt,step)),parallel(completeSql(factor,attempt,step))]);
    assert.deepEqual(results.sort(),['ATTEMPT_INVALID','OK']);
  });
  await t.test('wrong codes and out-of-window steps consume reservations without advancing the factor',async()=>{
    await reset();const factor=active(),before=sql(`SELECT last_consumed_step FROM artsoul_staff_totp_factors WHERE id='${factor.id}'`);
    for(const step of [null,-1,currentStep()+2]) {
      const attempt=claim(factor);assert.equal(sql(completeSql(factor,attempt,step)),'CODE_NOT_VERIFIED');
      assert.equal(sql(completeSql(factor,attempt,currentStep())),'ATTEMPT_INVALID');
    }
    assert.equal(sql(`SELECT last_consumed_step FROM artsoul_staff_totp_factors WHERE id='${factor.id}'`),before);
  });
  await t.test('durable rolling throttle includes failed and abandoned attempts across factor IDs',async()=>{
    await reset();const one=pending(),two=pending();sql('UPDATE artsoul_staff_totp_policy SET max_attempts=2');
    assert.equal(sql(completeSql(one,claim(one,'enrollment'),null)),'CODE_NOT_VERIFIED');
    claim(two,'enrollment');assert.equal(sql(claimSql(one,'enrollment')),'TOTP_THROTTLED|');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_attempts'),'2');
    sql(`UPDATE artsoul_staff_totp_attempts SET created_at=clock_timestamp()-INTERVAL '601 seconds'`);
    assert.equal(sql(claimSql(one,'enrollment')).split('|')[0],'OK');
  });
  await t.test('parallel claimers cannot exceed the configured wallet attempt limit',async()=>{
    await reset();const factor=pending();sql('UPDATE artsoul_staff_totp_policy SET max_attempts=1');
    const results=await Promise.all([parallel(claimSql(factor,'enrollment')),parallel(claimSql(factor,'enrollment'))]);
    assert.equal(results.filter(value=>value.startsWith('OK|')).length,1);
    assert.equal(results.filter(value=>value==='TOTP_THROTTLED|').length,1);
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_attempts'),'1');
  });
  await t.test('foreign wallet cannot claim or complete an existing factor attempt',async()=>{
    await reset();const factor=active(),attempt=claim(factor),foreign={...factor,wallet:other};
    assert.equal(sql(claimSql(foreign)),'FACTOR_INELIGIBLE|');
    assert.equal(sql(completeSql(foreign,attempt,match(factor))),'ATTEMPT_INVALID');
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_totp_attempts WHERE id='${attempt}'`),'t');
  });
  await t.test('revoked factor prevents claim and an already matched login completion',async()=>{
    await reset();const factor=active(),attempt=claim(factor);sql(`UPDATE artsoul_staff_totp_factors SET revoked_at=clock_timestamp() WHERE id='${factor.id}'`);
    assert.equal(sql(claimSql(factor)),'FACTOR_INELIGIBLE|');
    assert.equal(sql(completeSql(factor,attempt,match(factor))),'FACTOR_INELIGIBLE');
  });
  await t.test('completion sees a factor revocation committed while it waits for the row',async()=>{
    await reset();const factor=active(),attempt=claim(factor),step=match(factor);
    const {finished}=await holdWrite(`UPDATE artsoul_staff_totp_factors SET revoked_at=clock_timestamp() WHERE id='${factor.id}'`,'a8e-factor-revocation');
    const result=await parallel(completeSql(factor,attempt,step));await finished;
    assert.equal(result,'FACTOR_INELIGIBLE');
  });
  await t.test('role revocation is checked again at completion and serialized with role writes',async()=>{
    await reset();const factor=active(),attempt=claim(factor),step=match(factor);
    const {finished}=await holdWrite(`UPDATE artsoul_staff_roles SET active=FALSE WHERE wallet_address='${wallet}'`,'a8e-role-revocation');
    const result=await parallel(completeSql(factor,attempt,step));await finished;
    assert.equal(result,'STAFF_INACTIVE');assert.equal(sql(claimSql(factor)),'STAFF_INACTIVE|');
  });
  await t.test('expired reservation cannot authorize a fresh valid code',async()=>{
    await reset();const factor=active(),attempt=claim(factor);
    sql(`UPDATE artsoul_staff_totp_attempts SET created_at=clock_timestamp()-INTERVAL '2 minutes',expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id='${attempt}'`);
    assert.equal(sql(completeSql(factor,attempt,match(factor))),'ATTEMPT_EXPIRED');
  });
  await t.test('revoke and regrant cannot revive an old factor or matched attempt',async()=>{
    await reset();const factor=active(),attempt=claim(factor);
    sql(`UPDATE artsoul_staff_roles SET active=FALSE WHERE wallet_address='${wallet}';
      UPDATE artsoul_staff_roles SET active=TRUE WHERE wallet_address='${wallet}'`);
    assert.equal(sql(completeSql(factor,attempt,match(factor))),'ROLE_CHANGED');
    assert.equal(sql(claimSql(factor)),'ROLE_CHANGED|');
  });
  await t.test('role deletion and recreation cannot revive enrollment approval',async()=>{
    await reset();const factor=grant();
    sql(`DELETE FROM artsoul_staff_roles WHERE wallet_address='${wallet}';
      INSERT INTO artsoul_staff_roles(wallet_address,role) VALUES('${wallet}','admin')`);
    assert.equal(sql(beginSql(factor)),'GRANT_INVALID');
  });
  await t.test('a role replacement invalidates pending setup and old factors but allows newly approved setup',async()=>{
    await reset();const pendingFactor=pending(),oldFactor=active(),attempt=claim(pendingFactor,'enrollment');
    sql(`UPDATE artsoul_staff_roles SET role='moderator' WHERE wallet_address='${wallet}'`);
    assert.equal(sql(completeSql(pendingFactor,attempt,match(pendingFactor))),'ROLE_CHANGED');
    assert.equal(sql(claimSql(oldFactor)),'ROLE_CHANGED|');
    assert.equal(sql(`SELECT activated_at IS NULL FROM artsoul_staff_totp_factors WHERE id='${pendingFactor.id}'`),'t');
    active();
  });
  await t.test('completion observes a concurrent revoke and regrant before issuing access',async()=>{
    await reset();const factor=active(),attempt=claim(factor),step=match(factor);
    const {finished}=await holdWrite(`UPDATE artsoul_staff_roles SET active=FALSE WHERE wallet_address='${wallet}';
      UPDATE artsoul_staff_roles SET active=TRUE WHERE wallet_address='${wallet}'`,'a8e-role-regrant');
    assert.equal(await parallel(completeSql(factor,attempt,step)),'ROLE_CHANGED');await finished;
    assert.equal(sql(`SELECT consumed_at IS NOT NULL FROM artsoul_staff_totp_attempts WHERE id='${attempt}'`),'t');
    assert.equal(sql(`SELECT details->>'result' FROM artsoul_staff_auth_events WHERE event_type='totp_auth_failure' ORDER BY id DESC LIMIT 1`),'ROLE_CHANGED');
  });
  await t.test('authorization versions cannot rewind through row replacement, metadata or a supplied old value',async()=>{
    await reset();const readVersion=()=>BigInt(sql(`SELECT authorization_version FROM artsoul_staff_roles WHERE wallet_address='${wallet}'`));
    const first=readVersion();
    sql(`UPDATE artsoul_staff_roles SET updated_at=clock_timestamp() WHERE wallet_address='${wallet}'`);
    assert.equal(readVersion(),first);
    sql(`UPDATE artsoul_staff_roles SET active=FALSE WHERE wallet_address='${wallet}'`);
    const revoked=readVersion();assert(revoked>first);
    sql(`UPDATE artsoul_staff_roles SET active=TRUE,authorization_version=${first} WHERE wallet_address='${wallet}'`);
    assert(readVersion()>revoked);
    const beforeReset=readVersion();await reset();assert(readVersion()>beforeReset);
    for(const role of ['anon','authenticated','service_role']) {
      for(const permission of ['USAGE','UPDATE'])assert.equal(sql(`SELECT has_sequence_privilege('${role}','artsoul_staff_authorization_version_seq','${permission}')`),'f');
      assert.throws(()=>sql(`SET ROLE ${role}; SELECT setval('artsoul_staff_authorization_version_seq',1)`),/permission denied/);
    }
  });
  await t.test('revoked or expired enrollment grant is rechecked during activation',async()=>{
    for(const change of ['revoked_at=clock_timestamp()',"issued_at=clock_timestamp()-INTERVAL '11 minutes',expires_at=clock_timestamp()-INTERVAL '1 minute'"]) {
      await reset();const factor=pending(),attempt=claim(factor,'enrollment');
      sql(`UPDATE artsoul_staff_totp_grants SET ${change} WHERE id='${factor.grantId}'`);
      assert.equal(sql(completeSql(factor,attempt,match(factor))),'GRANT_INVALID');
      assert.equal(sql(`SELECT activated_at IS NULL FROM artsoul_staff_totp_factors WHERE id='${factor.id}'`),'t');
    }
  });
  await t.test('grant expiry is evaluated after waiting for a concurrent grant lock',async()=>{
    await reset();const factor=pending(),attempt=claim(factor,'enrollment'),step=match(factor);
    sql(`UPDATE artsoul_staff_totp_grants SET expires_at=clock_timestamp()+INTERVAL '1 second' WHERE id='${factor.grantId}'`);
    const {finished}=await holdWrite(`UPDATE artsoul_staff_totp_grants SET token_hash=token_hash WHERE id='${factor.grantId}'`,'a8e-grant-expiry',2);
    assert.equal(await parallel(completeSql(factor,attempt,step)),'GRANT_INVALID');await finished;
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_totp_grants WHERE id='${factor.grantId}'`),'t');
  });
  await t.test('factor key rotation or encrypted material change invalidates an in-flight result',async()=>{
    for(const change of ["key_version=2,encrypted_secret=jsonb_set(encrypted_secret,'{keyVersion}','2')","encrypted_secret=jsonb_set(encrypted_secret,'{iv}','\"AAAAAAAAAAAAAAAA\"')"]) {
      await reset();const factor=active(),attempt=claim(factor);
      sql(`UPDATE artsoul_staff_totp_factors SET ${change} WHERE id='${factor.id}'`);
      assert.equal(sql(completeSql(factor,attempt,match(factor))),'FACTOR_CHANGED');
    }
  });
  await t.test('audit failure rolls activation, grant consumption and code consumption back together',async()=>{
    await reset();const factor=pending(),attempt=claim(factor,'enrollment');auditFailure('totp_enrolled');
    try {assert.throws(()=>sql(completeSql(factor,attempt,match(factor))),/FORCED_AUDIT_FAILURE/);} finally {dropAuditFailure();}
    assert.equal(sql(`SELECT activated_at IS NULL AND last_consumed_step IS NULL FROM artsoul_staff_totp_factors WHERE id='${factor.id}'`),'t');
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_totp_grants WHERE id='${factor.grantId}'`),'t');
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_totp_attempts WHERE id='${attempt}'`),'t');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_auth_events'),'0');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_attempts'),'1','the separately committed attempt still consumes throttle budget');
  });
  await t.test('audit failure cannot issue login success or lose the consumed-step fence',async()=>{
    await reset();const factor=active(),attempt=claim(factor),before=sql(`SELECT last_consumed_step FROM artsoul_staff_totp_factors WHERE id='${factor.id}'`);auditFailure('totp_auth_success');
    try {assert.throws(()=>sql(completeSql(factor,attempt,match(factor))),/FORCED_AUDIT_FAILURE/);} finally {dropAuditFailure();}
    assert.equal(sql(`SELECT last_consumed_step FROM artsoul_staff_totp_factors WHERE id='${factor.id}'`),before);
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_totp_attempts WHERE id='${attempt}'`),'t');
  });
  await t.test('untyped, plaintext or mismatched encrypted envelopes are rejected',async()=>{
    await reset();for(const change of [envelope=>secret,envelope=>({...envelope,secret}),envelope=>({...envelope,version:'1'}),envelope=>({...envelope,keyVersion:0})]) {
      const factor=grant();factor.envelope=change(factor.envelope);assert.throws(()=>sql(beginSql(factor)));
    }
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_totp_factors'),'0');
  });
  await t.test('legacy passkey registration cannot consume a TOTP grant',async()=>{
    await reset();const factor=pending();
    assert.equal(sql(`SELECT a8a_complete_registration(1,'${factor.tokenHash}','${wallet}','additional','none','none','none',0,NULL,NULL,NULL)`),'GRANT_INVALID');
    assert.equal(sql('SELECT count(*) FROM artsoul_staff_enrollment_grants'),'0');
    assert.equal(sql(`SELECT consumed_at IS NULL FROM artsoul_staff_totp_grants WHERE id='${factor.grantId}'`),'t');
  });
  await t.test('RLS and privileges deny public access and runtime grant/config mutation',async()=>{
    for(const table of ['artsoul_staff_totp_policy','artsoul_staff_totp_grants','artsoul_staff_totp_factors','artsoul_staff_totp_attempts']) {
      assert.equal(sql(`SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='${table}'::regclass`),'t');
      for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_table_privilege('${role}','${table}','SELECT')`),'f');
      for(const permission of ['INSERT','UPDATE','DELETE'])assert.equal(sql(`SELECT has_table_privilege('service_role','${table}','${permission}')`),'f');
    }
    for(const signature of ['a8e_begin_totp_enrollment(text,uuid,text,jsonb)','a8e_begin_totp_attempt(text,uuid,text)','a8e_complete_totp_attempt(text,uuid,bigint)']) {
      for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_function_privilege('${role}','${signature}','EXECUTE')`),'f');
      assert.equal(sql(`SELECT has_function_privilege('service_role','${signature}','EXECUTE')`),'t');
    }
    assert.throws(()=>sql('SET ROLE anon; SELECT * FROM artsoul_staff_totp_factors'),/permission denied/);
    assert.throws(()=>sql('SET ROLE service_role; DELETE FROM artsoul_staff_totp_grants'),/permission denied/);
  });
});
