import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLiveVoiceController, runReviewedLiveCommand} from '../src/ai/live-voice-client.js';

function browser({gesture = true, hostname = '127.0.0.1', grant} = {}) {
  const env = new EventTarget();
  const contexts = [], sockets = [], captures = [], timers = [];
  let stoppedTracks = 0;
  const stream = {getTracks: () => [{stop: () => stoppedTracks++}]};
  const node = () => ({connect() {}, disconnect() {}, gain: {value: 1}});
  env.location = {hostname, origin: `http://${hostname}:4199`, protocol: 'http:'};
  env.document = new EventTarget(); env.document.hidden = false;
  env.navigator = {userActivation: {isActive: gesture}, mediaDevices: {getUserMedia: async () => grant ? grant : stream}};
  env.setTimeout = (fn, ms) => {const timer = {fn, ms}; timers.push(timer); return timer;};
  env.clearTimeout = timer => {if (timer) timer.cleared = true;};
  env.btoa = value => Buffer.from(value, 'binary').toString('base64');
  env.atob = value => Buffer.from(value, 'base64').toString('binary');
  env.AudioContext = class {
    sampleRate = 24000; currentTime = 0; destination = {}; closed = false; played = [];
    audioWorklet = {addModule: async () => {}};
    constructor() { contexts.push(this); }
    async resume() {} async close() {this.closed = true;}
    createMediaStreamSource() {return node();} createGain() {return node();}
    createBuffer(channels, count, rate) {return {duration: count / rate, getChannelData: () => new Float32Array(count)};}
    createBufferSource() {const speaker = {...node(), start: time => this.played.push(time), stop() {}}; return speaker;}
  };
  env.AudioWorkletNode = class {
    port = {}; constructor() {captures.push(this);} connect() {} disconnect() {}
  };
  env.WebSocket = class {
    readyState = 1; bufferedAmount = 0; sent = [];
    constructor(url) {this.url = url; sockets.push(this);}
    send(value) {this.sent.push(JSON.parse(value));}
    close() {this.readyState = 3; this.onclose?.();}
    async receive(value) {await this.onmessage?.({data: JSON.stringify(value)});}
  };
  return {env, contexts, sockets, captures, timers, stream, get stoppedTracks() {return stoppedTracks;}};
}
const audio = Buffer.alloc(960).toString('base64');

test('pilot never auto-connects and requires an explicit gesture on localhost', async () => {
  for (const options of [{gesture: false}, {hostname: 'artsoulprotocol.com'}]) {
    const b = browser(options), states = [];
    const controller = createLiveVoiceController({environment: b.env, onState: value => states.push(value)});
    assert.equal(b.contexts.length, 0); await controller.start();
    assert.equal(b.contexts.length, 0); assert.equal(b.sockets.length, 0); assert.equal(states.at(-1).name, 'error');
    controller.destroy();
  }
});

test('late microphone permission after Stop cannot leak a track or open a provider bridge', async () => {
  let resolve;
  const b = browser({grant: new Promise(done => {resolve = done;})});
  const controller = createLiveVoiceController({environment: b.env});
  const pending = controller.start(); await Promise.resolve(); controller.stop();
  resolve(b.stream); await pending;
  assert.equal(b.stoppedTracks, 1); assert.equal(b.sockets.length, 0); assert.equal(b.contexts[0].closed, true);
});

test('capture, reply PCM and transcript flow works; stop releases all resources and restarts cleanly', async () => {
  const b = browser(), texts = [];
  const controller = createLiveVoiceController({environment: b.env, onTranscript: text => texts.push(text)});
  await controller.start({language: 'ru'});
  assert.match(b.sockets[0].url, /language=ru$/);
  await b.sockets[0].receive({type: 'ready', durationMs: 60000});
  b.captures[0].port.onmessage({data: new Int16Array(480).buffer});
  assert.equal(b.sockets[0].sent[0].type, 'audio');
  await b.sockets[0].receive({type: 'audio', audio});
  await b.sockets[0].receive({type: 'transcript', text: 'Hello'});
  assert.deepEqual(texts, ['Hello']); assert.equal(b.contexts[0].played.length, 1);
  await b.sockets[0].receive({type: 'listening'});
  b.captures[0].port.onmessage({data: new Int16Array(480).buffer});
  assert.equal(b.sockets[0].sent.length, 1, 'speaker playback suppresses feedback capture');
  controller.stop();
  assert.equal(b.stoppedTracks, 1); assert.equal(b.contexts[0].closed, true); assert.equal(b.sockets[0].readyState, 3);
  await controller.start(); await b.sockets[1].receive({type: 'ready'});
  b.captures[1].port.onmessage({data: new Int16Array(480).buffer});
  assert.equal(b.sockets[1].sent[0].type, 'audio', 'previous audio time must not suppress a fresh session');
  controller.destroy();
});

test('backgrounding, account changes and local expiry all stop microphone and socket', async () => {
  for (const trigger of ['hidden', 'wallet', 'auth', 'expiry']) {
    const b = browser(), controller = createLiveVoiceController({environment: b.env});
    await controller.start(); await b.sockets[0].receive({type: 'ready', durationMs: 60000});
    if (trigger === 'hidden') { b.env.document.hidden = true; b.env.document.dispatchEvent(new Event('visibilitychange')); }
    if (trigger === 'wallet') b.env.dispatchEvent(new Event('artsoul:wallet-state-changed'));
    if (trigger === 'auth') b.env.dispatchEvent(new Event('artsoul:auth-state-changed'));
    if (trigger === 'expiry') b.timers.find(timer => timer.ms === 60000).fn();
    assert.equal(b.stoppedTracks, 1); assert.equal(b.sockets[0].readyState, 3); controller.destroy();
  }
});

test('a tool result completing after Stop is discarded', async () => {
  const b = browser(); let resolve;
  const controller = createLiveVoiceController({environment: b.env, onTool: () => new Promise(done => {resolve = done;})});
  await controller.start(); await b.sockets[0].receive({type: 'ready'});
  const pending = b.sockets[0].receive({type: 'tool', command: 'search art', callId: 'call_1'});
  controller.stop(); resolve({ok: true}); await pending;
  assert.equal(b.sockets[0].sent.some(item => item.type === 'tool_result'), false);
});

test('existing tools require review; financial tools never execute, navigation stops before leaving for the public site', async () => {
  const events = [], controller = new AbortController(); let parsed = {tool: 'buy_artwork', input: {}};
  const win = {location: {assign: url => events.push(url)}, ArtSoulVoice: {parseCommand: () => parsed}, ArtSoulWebMCP: {
    isStaffPage: () => false, browserDependencies: () => ({}),
    createTools: deps => [{name: 'get_artwork', execute: async () => {events.push('read'); return '{"id":31}';}},
      {name: 'open_page', execute: async () => {deps.openPath('/gallery#all'); return '{"opened":true}';}}]
  }};
  const options = {window: win, review: async () => {events.push('review'); return true;}};
  const context = {signal: controller.signal, stop: () => events.push('stop')};
  assert.match((await runReviewedLiveCommand('buy artwork', context, options)).error, /read and navigation/);
  assert.deepEqual(events, []);
  parsed = {tool: 'get_artwork', input: {artwork_id: 31}};
  assert.deepEqual(await runReviewedLiveCommand('artwork 31', context, options), {id: 31});
  assert.deepEqual(events, ['review', 'read']); events.length = 0;
  parsed = {tool: 'open_page', input: {page: 'gallery'}};
  await runReviewedLiveCommand('open gallery', context, options);
  assert.deepEqual(events, ['review', 'stop', 'https://artsoulprotocol.com/gallery#all']); events.length = 0;
  await runReviewedLiveCommand('open gallery', context, {...options, review: async () => false});
  assert.deepEqual(events, []);
});

test('AudioWorklet produces bounded 20ms PCM16 frames with clipping', () => {
  let Processor;
  class Base {port = {postMessage: buffer => frames.push(new Int16Array(buffer))};}
  const frames = [];
  vm.runInNewContext(fs.readFileSync(new URL('../src/ai/live-voice-capture.js', import.meta.url), 'utf8'),
    {AudioWorkletProcessor: Base, registerProcessor: (name, cls) => {assert.equal(name, 'artsoul-live-capture'); Processor = cls;}});
  const processor = new Processor();
  processor.process([[new Float32Array(480).fill(2)]]);
  processor.process([[new Float32Array(480).fill(-2)]]);
  assert.equal(frames.length, 2); assert.equal(frames[0].length, 480);
  assert.equal(frames[0][0], 32767); assert.equal(frames[1][0], -32768);
});
