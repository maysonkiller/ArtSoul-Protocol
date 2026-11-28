import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// All repository inputs are committed public blobs. Read the API key only on the host.
const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, 'artifacts', 'astra-development');
const statePath = path.join(local, 'session.json');
const skills = path.join(homedir(), '.codex', 'skills', 'artsoul-protocol-atlas');
const bundlePaths = [
  'AGENTS.md', 'package.json', 'docs/canon/12_IMPLEMENTATION_BACKLOG.md',
  'docs/canon/17_ROADMAP_PHASES.md', 'docs/audits/PHASE_C_D_READINESS_2026-11-27.md',
  'docs/audits/LIVE_VOICE_LOCAL_PILOT_2026-11-27.md',
  'src/ai/live-voice-client.js', 'src/ai/live-voice-capture.js', 'src/ai/live-voice-session.mjs',
  'test/live-voice-client.test.mjs', 'test/live-voice-session.test.mjs',
  'src/features/admin', 'src/ui/components/aura-frame.js', 'test/aura-frame.test.mjs'
];
const firstTask = 'Implement actionable startup errors for the localhost live voice assistant. Read the current client and tests. Distinguish an unsupported 24 kHz AudioContext and microphone permission denial from bridge failures. Consider constructor failures and a missing microphone device. Keep the existing PCM format (480 samples at 24 kHz), user gesture requirement, cancellation, and cleanup. Add focused tests to the existing test file using browser mocks. Only change src/ai/live-voice-client.js and test/live-voice-client.test.mjs. Run the silent Node test; never access a real microphone or speaker.';
const sessionLimitCents = 1500;
const developmentPaths = [
  'src', 'contracts', 'api', 'test', 'scripts', 'package.json', 'package-lock.json',
  'AGENTS.md', 'README.md', 'public/brand/artsoul-audio-cover-384.webp',
  'docs/audits/PHASE_C_D_READINESS_2026-11-27.md',
  'docs/canon/12_IMPLEMENTATION_BACKLOG.md', 'docs/canon/17_ROADMAP_PHASES.md',
  ':(top,glob)*.html', ':(top,glob)*.css', ':(top,glob)*.js', ':(top,glob)*.cjs'
];
const backlogTask = 'Select and implement up to two independent, evidenced improvements from the current Phase C preparation backlog or Phase D offline readiness, starting with the public preview/detail playback or display issues. Prefer an actual user-visible defect or a missed realistic regression in a frequently used path. Read the relevant existing implementation and tests first; skip already-fixed issues. For each, reproduce using offline fixtures, implement, and test. Do not touch release gates, permissions, legal decisions, operator approvals, accounts, write-network activation or financial rules. Make no phase-completion claims. Keep one combined reviewable patch and a short handoff listing any genuinely blocked items. Stop when the two fixes are tested or further progress depends on missing evidence.';
const instructions = [
  'You develop ArtSoul Protocol in the isolated copy provided by the owner.',
  'Unzip /workspace/source.zip into /workspace/project on first use. Run from that directory. Initialize a local Git baseline if needed before making edits.',
  'Use AGENTS.md, the scoped ArtSoul Atlas materials under /workspace/skills, the roadmap and backlog. Work on the assigned task. Treat the dated readiness document as historical evidence; never infer release acceptance from a test or report.',
  'Use existing components. Make minimal real changes, preserve unrelated changes, and run focused offline tests. Product UI and artifacts are in English.',
  'Use only the provided sources. No external services, deployments, wallet actions, production data, paid calls, grant decisions or changes of economic/security policy.',
  'For each assignment write /workspace/outputs/changes.patch (git diff --binary against the baseline for this assignment) and /workspace/outputs/result.md (changed paths, exact tests, outcomes and limitations). Keep files in the project for follow-up turns. Commit the finished change locally in the sandbox to separate successive diffs. Stop when the assignment is done.'
].join('\n');
const git = (...args) => execFileSync('git', args, {cwd: root, maxBuffer: 8 * 1024 * 1024});
const inline = (name, bytes) => ({type: 'inline', path: '/workspace/' + name, data: bytes.toString('base64')});
const usage = 'Usage: node scripts/develop-with-astra.mjs check | start | sync | status | collect [turn_id] | work | followup | next "development task"';

async function prepare() {
  const revision = git('rev-parse', '--verify', 'refs/remotes/origin/main').toString().trim();
  const archive = git('-c', 'core.autocrlf=false', 'archive', '--format=zip', revision, '--', ...bundlePaths);
  const files = [inline('source.zip', archive)];
  for (const name of ['SKILL.md', 'references/router.md', 'references/catalog.md']) {
    files.push(inline('skills/' + name, await readFile(path.join(skills, name))));
  }
  return {revision, files};
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!['check', 'start', 'sync', 'status', 'collect', 'work', 'followup', 'next'].includes(action)) throw Error(usage);
  if (action === 'next' ? args.length !== 1 || !args[0].trim() || args[0].length > 4000 :
    action === 'collect' ? args.length > 1 || (args.length && !/^turn_[\w-]+$/.test(args[0])) : args.length !== 0) throw Error(usage);
  if (action === 'check') {
    const {revision, files} = await prepare();
    console.log('Source revision:', revision, '\nPublic source paths:', bundlePaths.join(', '),
      '\nSandbox inputs:', files.map(f => f.path).join(', '));
    return;
  }
  const key = parseEnv(await readFile(path.join(root, '.env.local'), 'utf8')).OPENAI_API_KEY;
  if (!key) throw Error('The project API key is unavailable.');
  async function api(route, body, idempotencyKey) {
    const response = await fetch('https://api.openai.com/v1/agents' + route, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(90000),
      headers: {Authorization: 'Bearer ' + key, 'OpenAI-Beta': 'agents=v1',
        ...(body && {'Content-Type': 'application/json'}), ...(idempotencyKey && {'Idempotency-Key': idempotencyKey})},
      ...(body && {body: JSON.stringify(body)})
    });
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      throw Error('Agents API HTTP ' + response.status + ' (' + (e.error?.code || e.error?.type || 'request_error') + ').');
    }
    return response;
  }
  await mkdir(local, {recursive: true});
  let state = await readFile(statePath, 'utf8').then(JSON.parse).catch(e => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (action === 'start') {
    if (state?.session) { console.log('Already created:', state.session); return; }
    const {revision, files} = await prepare();
    if (state) throw Error('A previous creation is unconfirmed. Check the Agents dashboard before starting another session.');
    state = {revision, request: randomUUID()};
    await writeFile(statePath, JSON.stringify(state), {flag: 'wx'});
    const session = await (await api('/sessions', {agent: {model: 'gpt-6.2-astra', instructions},
      spend_control: {limit: sessionLimitCents},
      environment: {type: 'openai_hosted', network: {access: 'disabled'}, files},
      input: firstTask, stream: false}, state.request)).json();
    if (!/^[\w-]+$/.test(session.id || '')) throw Error('No valid hosted session ID returned.');
    state.session = session.id;
    await writeFile(statePath + '.tmp', JSON.stringify(state));
    await rename(statePath + '.tmp', statePath);
    console.log('Hosted session:', state.session, 'at', revision);
    return;
  }
  if (!state?.session || !/^[\w-]+$/.test(state.session)) throw Error('No confirmed session. Use check and start first.');
  const route = '/sessions/' + state.session;
  const session = await (await api(route)).json();
  const turns = (await (await api(route + '/turns?limit=100')).json()).data;
  const latest = action === 'collect' && args[0] ? await (await api(route + '/turns/' + args[0])).json() :
    [...turns].sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest) throw Error('The session has not published a turn yet.');
  console.log('Session:', state.session, 'turn:', latest.id, 'status:', latest.status);
  console.log('Session spend (USD cents):', JSON.stringify(session.spend_control));
  if (latest.usage) console.log('Usage:', JSON.stringify(latest.usage));
  if (action === 'status') {
    if (state.followup) console.log('Scheduled follow-up:', state.followup.id, new Date(state.followup.at * 1000).toISOString());
    return;
  }
  if (action === 'followup') {
    if (state.followup) { console.log('Follow-up already registered:', state.followup.id); return; }
    if (!state.synced || !session.spend_control?.limit || session.spend_control.limit > sessionLimitCents) {
      throw Error('Sync the development context and confirm the session budget first.');
    }
    const runAt = Math.floor(Date.now() / 1000) + 45 * 60;
    const target = {type: 'existing_session', session_id: state.session, instructions:
      'Continue development autonomously in the same session. Read previous results so you do not duplicate pending fixes. Use the uploaded public-development-' +
      state.synced + '.zip revision and ArtSoul skills. Select a different offline-testable Phase C or D readiness issue, preferably a genuine missing case in the rehearsal or recovery tooling. Implement and verify one bounded fix in a clean snapshot. No external data, transactions, credentials, releases or changes to financial or permission rules. Publish changes.patch and result.md as before. If no defect can be evidenced, publish the test evidence and an empty diff. Stop after this task.'};
    const schedule = await (await api('/automations', {type: 'once', name: 'ArtSoul release rehearsal follow-up',
      run_at: runAt, target}, createHash('sha256').update(state.session + '/release-followup').digest('hex'))).json();
    if (!schedule.id || schedule.target?.session_id !== state.session || schedule.type !== 'once') throw Error('Unexpected schedule response. Check the Agents dashboard.');
    await writeFile(statePath + '.tmp', JSON.stringify({...state, followup: {id: schedule.id, at: runAt}}));
    await rename(statePath + '.tmp', statePath);
    console.log('One follow-up registered:', schedule.id, new Date(runAt * 1000).toISOString());
    return;
  }
  if (['sync', 'next', 'work'].includes(action)) {
    if (turns.some(t => !['completed', 'failed', 'cancelled', 'canceled', 'incomplete'].includes(t.status))) throw Error('A turn is still active.');
    if (session.spend_control?.limit == null || session.spend_control.limit > sessionLimitCents) {
      const capped = await (await api(route, {spend_control: {limit: sessionLimitCents}})).json();
      if (capped.spend_control?.limit !== sessionLimitCents) throw Error('The session spending limit was not confirmed.');
    }
    if (action === 'sync') {
      const env = session.environment?.id;
      if (!env || !/^[\w-]+$/.test(env)) throw Error('The hosted environment is unavailable.');
      const revision = git('rev-parse', '--verify', 'refs/remotes/origin/main').toString().trim();
      const archive = git('-c', 'core.autocrlf=false', 'archive', '--format=zip', revision, '--', ...developmentPaths);
      const files = [inline('public-development-' + revision + '.zip', archive),
        inline('skills/references/library.zip', await readFile(path.join(skills, 'references/library.zip')))];
      for (const file of files) {
        if (file.data.length > 6990508) throw Error('File exceeds the hosted inline-file limit: ' + file.path);
        const saved = await (await api('/environments/' + env + '/files', file)).json();
        if (saved.path !== file.path || saved.size_bytes !== Buffer.byteLength(file.data, 'base64')) throw Error('Incomplete context upload.');
        console.log(saved.path, saved.size_bytes, 'bytes');
      }
      await writeFile(statePath + '.tmp', JSON.stringify({...state, synced: revision}));
      await rename(statePath + '.tmp', statePath);
      return;
    }
    if (action === 'work' && !state.synced) throw Error('Run sync before selecting a broader backlog assignment.');
    const context = state.synced
      ? ' The public development snapshot is /workspace/public-development-' + state.synced + '.zip. Extract it to a separate clean directory, using this revision as the baseline. Refer to prior turn results to avoid repeating pending changes. The complete ArtSoul skills including Classic are in /workspace/skills/references/library.zip. Read only relevant sections. '
      : '';
    const task = (action === 'work' ? backlogTask : args[0]) + context;
    const submission = createHash('sha256').update(JSON.stringify([state.session, latest.id, task])).digest('hex');
    await api(route + '/events', {events: [{type: 'agent.session.input.message', input: [
      {role: 'user', content: [{type: 'input_text', text: task}]}
    ]}]}, submission);
    console.log('Task submitted.');
    return;
  }
  if (latest.status !== 'completed') throw Error('Collect requires a completed turn.');
  if (!/^[\w-]+$/.test(latest.id)) throw Error('Unexpected turn ID.');
  const artifacts = (await (await api(route + '/artifacts?limit=100')).json()).data;
  const dir = path.join(local, latest.id);
  await mkdir(dir, {recursive: true});
  for (const name of ['result.md', 'changes.patch']) {
    const item = artifacts.find(a => a.turn_id === latest.id && a.path === '/workspace/outputs/' + name);
    if (!item || !/^[\w-]+$/.test(item.id)) throw Error('Missing turn artifact: ' + name);
    const bytes = Buffer.from(await (await api(route + '/artifacts/' + item.id + '/content')).arrayBuffer());
    await writeFile(path.join(dir, name), bytes);
    console.log(path.join(dir, name), bytes.length, 'bytes');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
