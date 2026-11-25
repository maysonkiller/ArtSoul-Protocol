const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {readFileSync}=require('node:fs');

test('R2 batch plan is deterministic, offline, complete and never proposes paid calls',()=>{
 const args=['scripts/plan-assistant-audio.mjs','10'];
 const a=spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000});
 const b=spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000});
 assert.equal(a.status,0,a.stderr);
 assert.equal(b.status,0,b.stderr);
 assert.equal(a.stdout,b.stdout,'no random ordering or current-time-dependent values');
 const plan=JSON.parse(a.stdout);
 assert.equal(plan.mode,'OFFLINE_ONLY_NO_API_CALLS');
 assert.equal(plan.phraseBank,188);
 assert.equal(plan.verifiedRecorded+plan.pending,188);
 assert.equal(plan.batches.length,Math.ceil(plan.pending/10));
 const ids=plan.batches.flatMap(b=>b.ids);
 assert.equal(ids.length,plan.pending);
 assert.equal(new Set(ids).size,ids.length);
 assert.ok(plan.batches.every(batch=>batch.count<=10));
 for(const batch of plan.batches){
   assert.match(batch.dryRunCommand,/^node scripts\/generate-assistant-audio\.mjs --only /);
   assert.doesNotMatch(batch.dryRunCommand,/--generate|--sync-bank/);
 }
 assert.doesNotMatch(a.stdout,/sk-proj-|OPENAI_API_KEY|\.env\.local/);
});

test('batch-size bounds reject unsafe arguments before any calls',()=>{
 const src=readFileSync('scripts/plan-assistant-audio.mjs','utf8');
 assert.doesNotMatch(src,/https?:\/\/|new WebSocket|fetch\s*\(|OPENAI_API_KEY/);
 for(const arg of ['0','31','999','hello','1.5']){
  const r=spawnSync(process.execPath,['scripts/plan-assistant-audio.mjs',arg],
    {encoding:'utf8',timeout:15000});
  assert.notEqual(r.status,0,arg);
  assert.equal(r.stdout.trim(),'');
 }
});
