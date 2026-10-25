// Session ownership tests use only disposable PostgreSQL and synthetic credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import DistributedLock from '../src/indexer/distributed-lock.js';

const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
let available=false;try{available=docker('version','--format','{{.Server.Os}}')==='linux';}catch{}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const runnerSource=fs.readFileSync('src/indexer/production-runner.js','utf8');
const drainMethod=runnerSource.slice(runnerSource.indexOf('    async _drainOperations() {'),runnerSource.indexOf('    async _initializeState() {'));
// Exercise the real runner method without importing its dotenv/RPC startup graph.
const drainFixture=setTimeout=>Function('setTimeout',`return class {${drainMethod}}`)(setTimeout);

test('shutdown excludes only the pinned session and still waits for real active queries',async()=>{
  const waits=[];let reads=0;
  const Runner=drainFixture((callback,ms)=>{waits.push(ms);queueMicrotask(callback);});
  const snapshots=[{totalCount:3,idleCount:1},{totalCount:3,idleCount:2}];
  const runner=new Runner();runner.db={getPoolMetrics(){assert.ok(reads<2,'drain must not wait on the permanent lock client');return snapshots[reads++];}};
  runner.distributedLock={getPinnedClientCount:()=>1};await runner._drainOperations();assert.equal(reads,2);assert.deepEqual(waits,[1000]);
});

test('known Supavisor transaction endpoints cannot start session-based leadership',()=>{
  for(const options of [{connectionString:'postgresql://fixture:fixture@aws-0-test.pooler.supabase.com:6543/postgres'},
    {host:'aws-0-test.pooler.supabase.com',port:6543}]){
    assert.throws(()=>new DistributedLock({pool:{options}}),/requires Supavisor session mode/);
  }
  assert.doesNotThrow(()=>new DistributedLock({pool:{options:{connectionString:'postgresql://fixture:fixture@aws-0-test.pooler.supabase.com:5432/postgres'}}}));
});

test('distributed leadership pins and releases a physical PostgreSQL session with fencing',{
  skip:available?false:'Disposable PostgreSQL requires Docker',timeout:60000
},async t=>{
  const container=`artsoul-lock-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let created=false,pool;const locks=[];
  t.after(async()=>{await Promise.all(locks.map(lock=>lock.release()));await pool?.end();if(created)docker('rm','-f',container);});
  t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});t.mock.method(console,'error',()=>{});
  docker('run','-d','--name',container,'-e','POSTGRES_PASSWORD=local-lock-fixture','-e','POSTGRES_DB=artsoul','-p','127.0.0.1::5432','postgres:17');created=true;
  const endpoint=docker('port',container,'5432/tcp');assert.match(endpoint,/^127\.0\.0\.1:\d+$/);
  pool=new pg.Pool({host:'127.0.0.1',port:Number(endpoint.split(':')[1]),database:'artsoul',user:'postgres',password:'local-lock-fixture',max:6,connectionTimeoutMillis:1000});
  pool.on('error',()=>{});
  for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');await delay(100);await pool.query('SELECT 1');break;}catch(error){if(attempt>=80)throw error;await delay(250);}}
  await pool.query(fs.readFileSync('src/indexer/migrations/004_distributed_locks.sql','utf8'));
  const db={pool,query:async(sql,values)=>(await pool.query(sql,values)).rows};
  const make=(name,options={},ttl=15000)=>{const lock=new DistributedLock(db,name,ttl,options);locks.push(lock);return lock;};
  const owners=async(lock)=>(await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=$1::oid AND objsubid=1 AND granted",[lock.advisoryLockId])).rows;

  await t.test('the fixture reproduces the former pooled-query unlock on a different session',async()=>{
    const key=123456;
    const acquired=await db.query('SELECT pg_backend_pid() pid,pg_try_advisory_lock($1) acquired',[key]);assert.equal(acquired[0].acquired,true);
    const holder=await pool.connect();
    try{
      assert.equal((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid,acquired[0].pid);
      const wrong=await db.query('SELECT pg_backend_pid() pid,pg_advisory_unlock($1) released',[key]);
      assert.notEqual(wrong[0].pid,acquired[0].pid);assert.equal(wrong[0].released,false);
      assert.equal((await holder.query('SELECT pg_advisory_unlock($1) released',[key])).rows[0].released,true);
    }finally{holder.release();}
  });

  await t.test('acquire, heartbeat, status and release retain one client while a second worker stays fenced',async()=>{
    const first=make('session-affinity'),second=make('session-affinity');
    assert.equal(await first.tryAcquire(),true);const pid=first.session.pid;
    const other=await pool.connect();
    try{
      assert.notEqual((await other.query('SELECT pg_backend_pid() pid')).rows[0].pid,pid);
      assert.deepEqual(await owners(first),[{pid}]);
      assert.equal(await first.renew(),true);assert.equal(first.session.pid,pid);
      assert.equal(first.getPinnedClientCount(),1);
      assert.equal((await first.getLeaderInfo()).isMe,true);
      assert.equal(await second.tryAcquire(),false);assert.equal(second.session,null);assert.equal(second.isLeaderInstance(),false);
      await first.release();assert.deepEqual(await owners(first),[]);
      assert.equal(first.session,null);assert.equal(first.isLeaderInstance(),false);
      assert.equal(first.getPinnedClientCount(),0);
      assert.equal(await second.tryAcquire(),true);await second.release();assert.deepEqual(await owners(first),[]);
    }finally{other.release();}
  });

  await t.test('concurrent acquisition calls never stack reentrant advisory locks',async()=>{
    const lock=make('concurrent-acquire');assert.deepEqual(await Promise.all([lock.tryAcquire(),lock.tryAcquire(),lock.tryAcquire()]),[true,true,true]);
    assert.equal((await owners(lock)).length,1);await lock.release();assert.deepEqual(await owners(lock),[]);
    const next=make('concurrent-acquire');assert.equal(await next.tryAcquire(),true);await next.release();
  });

  await t.test('a stale registry row for this instance cannot grant leadership when another backend holds the advisory lock',async()=>{
    const lock=make('stale-own-row'),holder=await pool.connect();
    try{
      await holder.query('SELECT pg_advisory_lock($1)',[lock.advisoryLockId]);
      await pool.query("INSERT INTO distributed_locks(lock_name,instance_id,expires_at,fencing_token) VALUES($1,$2,now()+interval '1 minute',7)",[lock.lockName,lock.instanceId]);
      assert.equal(await lock.tryAcquire(),false);assert.equal(lock.isLeaderInstance(),false);assert.equal(lock.getFencingToken(),null);assert.equal(lock.session,null);
      await holder.query('SELECT pg_advisory_unlock($1)',[lock.advisoryLockId]);
      assert.equal(await lock.tryAcquire(),true);assert.equal(lock.getFencingToken(),'8');await lock.release();
    }finally{holder.release();}
  });

  await t.test('actual advisory loss fences immediately on renewal even when the registry row still matches',async()=>{
    const lost=[],lock=make('advisory-loss',{onLeadershipLost:reason=>lost.push(reason)});
    assert.equal(await lock.tryAcquire(),true);lock.startHeartbeat();
    await lock.session.client.query('SELECT pg_advisory_unlock($1)',[lock.advisoryLockId]);
    assert.equal(await lock.renew(),false);assert.equal(lock.isLeaderInstance(),false);assert.equal(lock.getFencingToken(),null);
    assert.equal(lock.heartbeatInterval,null);assert.equal(lock.session,null);assert.equal(lost.length,1);
    assert.equal(await lock.renew(),false);assert.equal(lost.length,1);
    const next=make('advisory-loss');assert.equal(await next.tryAcquire(),true);await next.release();
  });

  await t.test('a changed owner or fencing token is preserved while the stale holder releases its advisory lock',async()=>{
    const lost=[],lock=make('fence-loss',{onLeadershipLost:reason=>lost.push(reason)});
    assert.equal(await lock.tryAcquire(),true);
    await pool.query("UPDATE distributed_locks SET instance_id='other-owner',fencing_token=99 WHERE lock_name=$1",[lock.lockName]);
    assert.equal(await lock.renew(),false);assert.equal(lost.length,1);assert.deepEqual(await owners(lock),[]);
    const row=(await pool.query('SELECT instance_id,fencing_token::TEXT FROM distributed_locks WHERE lock_name=$1',[lock.lockName])).rows[0];
    assert.deepEqual(row,{instance_id:'other-owner',fencing_token:'99'});
    const next=make('fence-loss');assert.equal(await next.tryAcquire(),true);assert.equal(next.getFencingToken(),'100');await next.release();
  });

  await t.test('registration failure releases the acquired session lock before returning the client',async()=>{
    await pool.query(`CREATE FUNCTION reject_lock_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.lock_name='registration-failure' THEN RAISE EXCEPTION 'fixture registration failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_lock_fixture BEFORE INSERT ON distributed_locks FOR EACH ROW EXECUTE FUNCTION reject_lock_fixture();`);
    const lock=make('registration-failure');assert.equal(await lock.tryAcquire(),false);assert.equal(lock.session,null);assert.deepEqual(await owners(lock),[]);
    await pool.query('DROP TRIGGER reject_lock_fixture ON distributed_locks; DROP FUNCTION reject_lock_fixture();');
    assert.equal(await lock.tryAcquire(),true);await lock.release();
  });

  await t.test('an uncertain acquisition acknowledgement destroys the client even before the acquired flag is recorded',async()=>{
    let destroyed;
    const uncertain={pool:{options:pool.options,connect:async()=>{
      const client=await pool.connect();
      return {on:client.on.bind(client),removeListener:client.removeListener.bind(client),release:value=>{destroyed=value;client.release(value);},
        query:async(...args)=>{const result=await client.query(...args);
          if(args[0].text.includes('pg_try_advisory_lock'))throw Object.assign(new Error('fixture acquisition acknowledgement lost'),{code:'57014'});
          return result;}};
    }},query:db.query};
    const lock=new DistributedLock(uncertain,'uncertain-acquire');locks.push(lock);
    assert.equal(await lock.tryAcquire(),false);assert.equal(destroyed,true);assert.equal(lock.session,null);assert.deepEqual(await owners(lock),[]);
    const next=make('uncertain-acquire');assert.equal(await next.tryAcquire(),true);await next.release();
  });

  await t.test('loss of the owned local test socket fences before heartbeat and allows a new worker',async()=>{
    let notify;const notification=new Promise(resolve=>{notify=resolve;});const lost=[];
    const lock=make('socket-loss',{onLeadershipLost:reason=>{lost.push(reason);notify();}});assert.equal(await lock.tryAcquire(),true);lock.startHeartbeat();
    const oldToken=BigInt(lock.getFencingToken());
    // This is the dedicated connection to the disposable container, never a live backend.
    lock.session.client.connection.stream.destroy(new Error('fixture socket loss'));
    await Promise.race([notification,delay(2000).then(()=>{throw new Error('Leadership was not fenced on socket loss');})]);
    assert.equal(lock.isLeaderInstance(),false);assert.equal(lock.getFencingToken(),null);assert.equal(lock.heartbeatInterval,null);assert.equal(lock.session,null);assert.equal(lost.length,1);
    const next=make('socket-loss');assert.equal(await next.tryAcquire(),true);assert.ok(BigInt(next.getFencingToken())>oldToken);await next.release();
  });

  await t.test('a blocked heartbeat query times out, fences and destroys the uncertain session',async()=>{
    const lost=[],lock=make('heartbeat-timeout',{onLeadershipLost:reason=>lost.push(reason)},1500);
    assert.equal(await lock.tryAcquire(),true);const blocker=await pool.connect();
    try{
      await blocker.query('BEGIN');await blocker.query('SELECT id FROM distributed_locks WHERE lock_name=$1 FOR UPDATE',[lock.lockName]);
      assert.equal(await lock.renew(),false);assert.equal(lock.isLeaderInstance(),false);assert.equal(lock.session,null);assert.equal(lost.length,1);
      await blocker.query('ROLLBACK');
      for(let attempt=0;attempt<20&&(await owners(lock)).length;attempt++)await delay(10);
      assert.deepEqual(await owners(lock),[]);
      const next=make('heartbeat-timeout');assert.equal(await next.tryAcquire(),true);await next.release();
    }finally{await blocker.query('ROLLBACK');blocker.release();}
  });

  await t.test('release cancels an in-flight acquisition without leaking its pool client',async()=>{
    let started,finish;const connected=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
    const delayed={pool:{options:pool.options,connect:async()=>{const client=await pool.connect();started();await gate;return client;}},query:db.query};
    const lock=new DistributedLock(delayed,'release-during-acquire');locks.push(lock);
    const acquiring=lock.tryAcquire();await connected;const releasing=lock.release();finish();
    assert.equal(await acquiring,false);await releasing;assert.equal(lock.session,null);assert.deepEqual(await owners(lock),[]);
  });

  await t.test('heartbeat uses the pinned client and stops after explicit release',async()=>{
    const lock=make('heartbeat-client',{},1500);assert.equal(await lock.tryAcquire(),true);
    const before=(await lock.getLeaderInfo()).lastHeartbeat;lock.startHeartbeat();await delay(600);
    assert.ok((await lock.getLeaderInfo()).lastHeartbeat>before);const pid=lock.session.pid;
    assert.deepEqual(await owners(lock),[{pid}]);await lock.release();assert.equal(lock.heartbeatInterval,null);assert.deepEqual(await owners(lock),[]);
  });

  await t.test('graceful drain immediately reaches release when the dedicated client is the only active connection',async()=>{
    const lock=make('graceful-drain');assert.equal(await lock.tryAcquire(),true);
    const Runner=drainFixture(()=>assert.fail('the idle leadership session must not delay shutdown'));
    const runner=new Runner();runner.distributedLock=lock;runner.db={getPoolMetrics:()=>({totalCount:pool.totalCount,idleCount:pool.idleCount})};
    await runner._drainOperations();await lock.release();assert.deepEqual(await owners(lock),[]);
    const next=make('graceful-drain');assert.equal(await next.tryAcquire(),true);await next.release();
  });

  await t.test('a status check also fences missing physical advisory ownership',async()=>{
    const lost=[],lock=make('status-loss',{onLeadershipLost:reason=>lost.push(reason)});assert.equal(await lock.tryAcquire(),true);
    await lock.session.client.query('SELECT pg_advisory_unlock($1)',[lock.advisoryLockId]);
    assert.equal(await lock.getLeaderInfo(),null);assert.equal(lock.isLeaderInstance(),false);assert.equal(lock.session,null);assert.equal(lost.length,1);
  });
});
