import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createLivePilotSession, fundingApprovalValid, liveSessionConfiguration, LIVE_PILOT} from '../src/ai/live-voice-session.mjs';
import {localPilotRequestAllowed, localPilotStaticFile} from '../scripts/serve-live-voice-pilot.mjs';

const now = Date.parse('2026-11-27T12:00:00Z');
const approval = () => ({purpose: 'artsoul-local-live-voice-pilot', model: LIVE_PILOT.model,
  organizationId: 'org-offline-test', modelCoverageConfirmed: true, cashOverageDisabled: true,
  promoBalanceVerified: true, promoAvailableUsd: 2, requiredPromoUsd: 0.5,
  promoExpiresAt: new Date(now + 3600000).toISOString(),
  reviewedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString()});
class Socket extends EventEmitter {
  readyState = 1; sent = []; terminated = 0;
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.terminated++; this.close(); }
  receive(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
}
function setup(options = {}) {
  const client = new Socket(), provider = new Socket(), timers = [];
  let opens = 0, reservations = 0, organization;
  const session = createLivePilotSession({client, enabled: true, approval: approval(), now: () => now,
    setTimer: (fn, ms) => { const timer = {fn, ms}; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cleared = true; },
    reserveAttempt: () => { reservations++; },
    openProvider: org => { opens++; organization = org; return provider; }, ...options});
  return {client, provider, session, timers, get opens() {return opens;}, get reservations() {return reservations;},
    get organization() {return organization;}, ready() {provider.emit('open'); provider.receive({type: 'session.updated', session: liveSessionConfiguration()});}};
}
const ended = value => value.client.sent.findLast(item => item.type === 'ended')?.reason;
const responseDone = provider => provider.receive({type: 'response.done', response: {status: 'completed', output: []}});

test('funding is closed by default and stale or unsupported approvals never reserve a paid attempt', () => {
  for (const options of [{enabled: false}, {approval: null}, {approval: {...approval(), reviewedAt: new Date(now - 86400000).toISOString()}},
    {approval: {...approval(), model: 'other'}}, {approval: {...approval(), organizationId: 'not-an-org'}},
    {approval: {...approval(), promoBalanceVerified: false, providerCapVerified: true, providerCapUsd: 0.5}}]) {
    const run = setup(options);
    assert.equal(run.opens, 0); assert.equal(run.reservations, 0); assert.equal(ended(run), 'funding_not_verified');
  }
});

test('verified promo-only protection requires sufficient unexpired credit and no cash overage, never a cap alone', () => {
  const base = {...approval(), providerCapVerified: false, cashOverageDisabled: true, promoBalanceVerified: true,
    promoAvailableUsd: 2, requiredPromoUsd: 0.5, promoExpiresAt: new Date(now + 3600000).toISOString()};
  assert.equal(fundingApprovalValid(base, now), true);
  for (const change of [{cashOverageDisabled: false}, {promoBalanceVerified: false}, {promoAvailableUsd: 0},
    {requiredPromoUsd: 0}, {promoExpiresAt: new Date(now).toISOString()}]) assert.equal(fundingApprovalValid({...base, ...change}, now), false);
});

test('server fixes model, Marin, language, PCM and response settings; wrong provider acknowledgement fails closed', () => {
  const run = setup({language: 'ru'}); run.provider.emit('open');
  const config = run.provider.sent[0].session;
  assert.equal(run.organization, 'org-offline-test'); assert.equal(run.reservations, 1);
  assert.match(config.instructions, /Russian/); assert.equal(config.audio.output.voice, 'marin');
  assert.equal(config.max_output_tokens, 384); assert.equal(config.audio.input.turn_detection.create_response, false);
  run.provider.receive({type: 'session.updated', session: {...config, audio: {...config.audio, output: {...config.audio.output, voice: 'alloy'}}}});
  assert.equal(ended(run), 'provider_configuration_mismatch'); assert.equal(run.provider.terminated, 1);
});

test('PCM is bounded and the browser cannot send arbitrary billable provider events', () => {
  const run = setup(); run.ready();
  run.client.receive({type: 'audio', audio: Buffer.alloc(960).toString('base64')});
  assert.equal(run.provider.sent.at(-1).type, 'input_audio_buffer.append');
  run.client.receive({type: 'session.update', session: {max_output_tokens: 100000}});
  assert.equal(ended(run), 'unsupported_message');
  const invalid = setup(); invalid.ready(); invalid.client.receive({type: 'audio', audio: 'a'});
  assert.equal(ended(invalid), 'invalid_audio');
  const budget = setup(); budget.ready();
  const chunk = Buffer.alloc(9600).toString('base64');
  for (let i = 0; i <= LIVE_PILOT.maxInputBytes / 9600; i++) budget.client.receive({type: 'audio', audio: chunk});
  assert.equal(ended(budget), 'input_limit');
});

test('at most four responses and one active response are possible; extra speech cannot queue requests', () => {
  const run = setup(); run.ready();
  for (let i = 0; i < 4; i++) {
    run.provider.receive({type: 'input_audio_buffer.speech_stopped'});
    run.provider.receive({type: 'input_audio_buffer.speech_stopped'});
    responseDone(run.provider);
  }
  assert.equal(run.provider.sent.filter(item => item.type === 'response.create').length, 4);
  run.provider.receive({type: 'input_audio_buffer.speech_stopped'});
  assert.equal(ended(run), 'response_limit'); assert.equal(run.opens, 1);
});

test('tool continuation requires matching reviewed output and consumes the same response budget', () => {
  const run = setup(); run.ready();
  run.provider.receive({type: 'input_audio_buffer.speech_stopped'});
  run.provider.receive({type: 'response.done', response: {status: 'completed', output: [{type: 'function_call', name: 'artsoul_command', call_id: 'call_1', arguments: '{"command":"open gallery"}'}]}});
  assert.equal(run.client.sent.at(-1).command, 'open gallery');
  run.client.receive({type: 'tool_result', callId: 'call_1', result: '{"approved":false}'});
  assert.equal(run.provider.sent.filter(item => item.type === 'response.create').length, 2);
  run.client.receive({type: 'tool_result', callId: 'call_1', result: '{}'});
  assert.equal(ended(run), 'invalid_tool_result');
});

test('response audio is returned, and stop, expiry or transport failure terminates without retry', () => {
  for (const trigger of ['stop', 'timer', 'disconnect', 'provider']) {
    const run = setup(); run.ready(); run.provider.receive({type: 'input_audio_buffer.speech_stopped'});
    run.provider.receive({type: 'response.output_audio.delta', delta: Buffer.alloc(960).toString('base64')});
    run.provider.receive({type: 'response.output_audio_transcript.done', transcript: 'Hello'});
    assert.equal(run.client.sent.at(-2).type, 'audio'); assert.equal(run.client.sent.at(-1).text, 'Hello');
    if (trigger === 'stop') run.client.receive({type: 'stop'});
    if (trigger === 'timer') run.timers.find(timer => timer.ms === 60000).fn();
    if (trigger === 'disconnect') run.client.close();
    if (trigger === 'provider') run.provider.emit('error', new Error('offline'));
    assert.equal(run.provider.terminated, 1); assert.equal(run.opens, 1);
    const count = run.provider.sent.length; run.provider.receive({type: 'input_audio_buffer.speech_stopped'});
    assert.equal(run.provider.sent.length, count);
  }
});

test('exclusive reservation failure prevents any provider connection', () => {
  const run = setup({reserveAttempt: () => {throw new Error('Already consumed');}});
  assert.equal(run.opens, 0); assert.equal(ended(run), 'unavailable');
});

test('local server permits exact safe assets only and requires same-origin loopback WebSocket requests', () => {
  for (const name of ['/docs/private/live-voice-pilot-approval.json', '/.env.local', '/@fs/C:/secret', '/src/ai/live-voice-session.mjs', '/test/live-voice-session.test.mjs', '/']) {
    assert.equal(localPilotStaticFile(name), null);
  }
  assert.ok(localPilotStaticFile('/src/ai/live-voice-client.js'));
  const origin = 'http://127.0.0.1:4199';
  const req = {socket: {remoteAddress: '127.0.0.1'}, headers: {host: '127.0.0.1:4199', origin}};
  assert.equal(localPilotRequestAllowed(req, origin), true);
  for (const changed of [{socket: {remoteAddress: '192.168.1.1'}}, {headers: {...req.headers, origin: 'https://evil.example'}},
    {headers: {...req.headers, host: 'evil.example'}}, {headers: {...req.headers, 'x-forwarded-for': '127.0.0.1'}}]) {
    assert.equal(localPilotRequestAllowed({...req, ...changed}, origin), false);
  }
});
