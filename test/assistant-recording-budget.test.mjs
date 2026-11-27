import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkRecordingBudget, checkRecordingGrant, wavFile} from '../scripts/generate-assistant-audio.mjs';

const phrase = {lang:'ru', id:'r2Greeting'};
const earlier = {id:'en-r2Greeting', status:'completed', reservedUsd:0.025};

test('the recording batch includes previous spending reservations from both languages', () => {
  assert.doesNotThrow(() => checkRecordingBudget([earlier], [phrase], 0.05));
  assert.throws(() => checkRecordingBudget([earlier], [phrase], 0.049), /generation_budget_exceeded/);
  assert.throws(() => checkRecordingBudget([], [phrase], 101), /invalid_recording_budget/);
  assert.throws(() => checkRecordingBudget([{...earlier, reservedUsd:-1}], [], 1), /invalid_ledger/);
});

test('a failed or interrupted clip cannot be charged again automatically', () => {
  for (const status of ['started','failed','completed','received']) {
    assert.throws(() => checkRecordingBudget([{...earlier,id:'ru-r2Greeting',status}], [phrase], 1),
      /previous_attempt_requires_review/);
  }
});

test('new recording requests require the receiving organization and time for a complete response', () => {
  const now = Date.parse('2026-11-01T10:00:00Z');
  assert.doesNotThrow(() => checkRecordingGrant('org-test', '2026-11-01T10:02:00Z', now));
  assert.throws(() => checkRecordingGrant('', '2026-11-01T10:02:00Z', now), /organization/);
  for (const value of [undefined, '', '2026-11-01T09:59:00Z', '2026-11-01T10:00:45Z']) {
    assert.throws(() => checkRecordingGrant('org-test', value, now), /active_grant_window_required/);
  }
});

test('a reviewed single failure gets one budgeted retry and both attempts remain reserved', () => {
  const failed = {...earlier, id:'ru-r2Greeting', status:'failed'};
  assert.doesNotThrow(() => checkRecordingBudget([failed], [phrase], 0.05, true));
  assert.throws(() => checkRecordingBudget([failed], [phrase], 0.025, true), /budget_exceeded/);
  for (const history of [[], [failed, failed], [{...failed,status:'started'}], [{...failed,status:'completed'}]]) {
    assert.throws(() => checkRecordingBudget(history, [phrase], 1, true), /reviewed_failure_required/);
  }
});

test('offline recovery installs the received bytes once and rebuilds the matching voice index', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artsoul-voice-recovery-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const local = file => path.join(root,file);
  const json = (file,data) => fs.writeFile(local(file), JSON.stringify(data));
  for (const dir of ['scripts','docs/audio','docs/private','public/audio/assistant/v1']) {
    await fs.mkdir(local(dir),{recursive:true});
  }
  for (const file of ['generate-assistant-audio.mjs','build-voice-phrase-index.mjs']) {
    await fs.copyFile(new URL('../scripts/'+file,import.meta.url),local('scripts/'+file));
  }
  const clip = lang => ({lang,id:'example',text:lang==='en'?'Example':'Пример',url:'/audio/assistant/v1/'+lang+'-example.wav'});
  const model = 'gpt-realtime-2.1-mini';
  const file = 'public/audio/assistant/v1/manifest.json';
  await json('docs/audio/assistant-phrase-bank.json',{version:1,model,voice:'marin',clips:[clip('en'),clip('ru')]});
  await json(file,{version:1,model,voice:'marin',sample_rate:24000,clips:[]});
  const wav = wavFile(Buffer.from([1,0,2,0]));
  const entry = {...clip('ru'), transcript:'Пример', voice:'marin', model, generated_at:'2026-11-01T12:00:00Z',
    sha256:createHash('sha256').update(wav).digest('hex'), bytes:wav.length, duration_seconds:2/24000, estimated_usd:0.001};
  const ledgerFile = 'docs/private/assistant-audio-generation-ledger.json';
  await json(ledgerFile,{version:1,attempts:[{id:'ru-example',at:entry.generated_at,status:'started',reservedUsd:0.025}]});
  await json('docs/private/assistant-audio-received.json',{entry,wav:wav.toString('base64')});
  const recover = () => JSON.parse(execFileSync(process.execPath,[local('scripts/generate-assistant-audio.mjs'),'--recover'],{encoding:'utf8'}));
  assert.equal(recover().recovered,true);
  assert.equal(recover().recovered,false);
  assert.deepEqual(await fs.readFile(local('public'+entry.url)),wav);
  assert.equal(JSON.parse(await fs.readFile(local(file),'utf8')).clips.length,1);
  assert.equal(JSON.parse(await fs.readFile(local(ledgerFile),'utf8')).attempts[0].status,'completed');
  assert.match(await fs.readFile(local('voice-phrase-bank.js'),'utf8'), /recordingCount: 1/);
});
