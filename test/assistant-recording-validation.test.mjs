import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as audio from '../scripts/generate-assistant-audio.mjs';

const phrase = {lang:'en', id:'r2Greeting', text:'Hello there.', url:'/audio/assistant/v1/phrases/en-r2Greeting.wav'};
const header = {version:1, voice:'marin', model:'gpt-realtime-2.1-mini', sample_rate:24000};
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artsoul-recording-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const target = path.join(root, phrase.url);
  await fs.mkdir(path.dirname(target), {recursive:true});
  const wav = audio.wavFile(Buffer.alloc(4800));
  await fs.writeFile(target, wav);
  const entry = {...phrase, model:header.model, voice:header.voice, bytes:wav.length, duration_seconds:0.1,
    transcript:'Hello there!', sha256:createHash('sha256').update(wav).digest('hex')};
  const check = (overrides={}, clips=[phrase], meta={}) =>
    audio.verifyRecordingInventory({...header, ...meta, clips:[{...entry, ...overrides}]}, clips, root);
  return {root, target, wav, entry, check};
}
test('bank identity, transcript, recording metadata and byte count must all agree', async t => {
  const {check} = await fixture(t);
  assert.equal((await check()).size, 1);
  for (const changed of [{id:'r2Other'}, {lang:'ru'}, {voice:'other'}, {model:'other'}, {text:'Changed.'},
    {transcript:'Changed.'}, {duration_seconds:null}, {duration_seconds:99}, {bytes:1}, {sha256:'0'.repeat(64)},
    {url:'/audio/assistant/v1/phrases/../en-r2Greeting.wav'}]) await assert.rejects(() => check(changed));
  await assert.rejects(() => check({}, [phrase], {voice:'other'}));
});
test('a matching digest cannot certify malformed audio; orphan files block a paid retry', async t => {
  const {root,target,wav,check} = await fixture(t);
  wav.writeUInt16LE(2,22);
  await fs.writeFile(target,wav);
  await assert.rejects(() => check({sha256:createHash('sha256').update(wav).digest('hex')}));
  await assert.rejects(() => audio.verifyRecordingInventory({...header, clips:[]}, [phrase], root), /orphan/);
});
test('linked recording directories cannot supply files for the public index', async t => {
  const {target,check} = await fixture(t);
  const folder = path.dirname(target);
  await fs.rename(folder,folder+'-other');
  await fs.symlink(folder+'-other',folder,process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => check(), /unsafe_audio_path/);
});
test('previously reserved attempts cannot buy the same missing clip twice', () => {
  const plan = [phrase];
  assert.equal(audio.checkGenerationLedger({version:1,attempts:[]},plan,1),undefined);
  for (const status of ['started','received','failed','completed']) {
    assert.throws(() => audio.checkGenerationLedger({version:1, attempts:[
      {id:'en-r2Greeting',status,reservedUsd:.025}]},plan,1), /previous_attempt/);
  }
  for (const reservedUsd of [-1, null, '0', Number.NaN]) {
    assert.throws(() => audio.checkGenerationLedger({version:1, attempts:[
      {id:'en-r2Other',status:'started',reservedUsd}]},plan,1), /invalid_ledger/);
  }
});

test('offline recovery only publishes a fully written clip with a matching reserved receipt', async t => {
  const {root,target,entry} = await fixture(t);
  const ledger = {version:1, attempts:[{id:'en-r2Greeting',status:'received',reservedUsd:.025,recording:entry}]};
  const manifest = {...header, clips:[]};
  const recovered = await audio.reconcileReceived(manifest,ledger,[phrase],root);
  assert.deepEqual(recovered.manifest.clips,[entry]);
  assert.equal(recovered.ledger.attempts[0].status,'completed');
  assert.equal(ledger.attempts[0].status,'received');
  const replay = await audio.reconcileReceived(recovered.manifest,recovered.ledger,[phrase],root);
  assert.deepEqual(replay,recovered);
  await fs.unlink(target);
  await assert.rejects(() => audio.reconcileReceived(manifest,ledger,[phrase],root), /invalid_recording/);
});
test('paid mode requires explicit clip IDs, a batch limit and a budget before any request', () => {
  for (const flags of [[],['--only','ru-r2Greeting'],['--max-new','1','--budget-usd','1']]) {
    assert.throws(() => audio.checkGenerationScope(flags,flags.includes('--only') ? new Set(['ru-r2Greeting']) : null),
      /explicit_generation_limits_required/);
  }
});

test('recovery requires identical journal and published records even when their WAV hashes agree', async t => {
  const {root,entry} = await fixture(t);
  const published = {...entry, usage:{input_tokens:8, output_tokens:30}, estimated_usd:0.0006048};
  const manifest = {...header, clips:[published]};
  const received = {id:'en-r2Greeting', status:'received', reservedUsd:0.025};
  const replay = recording => audio.reconcileReceived(manifest, {version:1, attempts:[{...received, recording}]}, [phrase], root);
  for (const change of [{id:'r2Other'}, {lang:'ru'}, {voice:'other'}, {text:'Different phrase.'},
    {estimated_usd:0}, {usage:{input_tokens:8, output_tokens:300}}]) {
    const recording = {...published, ...change};
    await assert.rejects(() => audio.reconcileReceived(manifest, {version:1, attempts:[{
      ...received, id:recording.lang+'-'+recording.id, recording
    }]}, [phrase], root), /conflicting_recording/);
  }
  const recovered = await replay({...published, usage:{output_tokens:30, input_tokens:8}});
  assert.equal(recovered.ledger.attempts[0].status, 'completed');
  assert.deepEqual(recovered.manifest, manifest);
});
