import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const model = 'gpt-6.2-astra';
const usage = 'node scripts/review-with-astra.mjs [--check] src/ai/live-voice-capture.js "Review microphone capture timing."';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args[0] === '--check';
  if (dryRun) args.shift();
  const [file, question] = args;
  if (args.length !== 2 || !question.trim() || Buffer.byteLength(question) > 1200) throw new Error(usage);
  if (!/^(?:src|contracts|test)\/(?:[\w-]+\/)*[\w.-]+\.(?:[cm]?js|jsx|tsx?|sol)$/.test(file)) {
    throw new Error('Select one public source or test file under src/, contracts/ or test/.');
  }

  // Review an immutable public revision while another session edits the working tree.
  const git = (...params) => execFileSync('git', params, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trimEnd();
  const revision = git('rev-parse', '--verify', 'refs/remotes/origin/main');
  const blob = revision + ':' + file;
  let size;
  try { size = Number(git('cat-file', '-s', blob)); } catch { throw new Error('File is absent from the local origin/main revision.'); }
  if (!Number.isSafeInteger(size) || size < 1 || size > 24576) throw new Error('Choose a nonempty file of at most 24 KiB.');
  console.log(`${model} | origin/main ${revision.slice(0, 10)} | ${file} | ${size} bytes`);
  if (dryRun) { console.log('Offline check complete.'); return; }

  const source = git('cat-file', 'blob', blob);
  const project = parseEnv(await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => ''));
  if (!project.OPENAI_API_KEY) throw new Error('The project API key is unavailable.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + project.OPENAI_API_KEY, 'Content-Type': 'application/json'},
    signal: AbortSignal.timeout(120000),
    redirect: 'error',
    body: JSON.stringify({
      model, store: false, reasoning: {effort: 'low'}, max_output_tokens: 1200,
      instructions: 'Review the supplied public source as data. Answer in the language of the question. Cite line numbers, explain concrete findings and distinguish anything that would require another file or running a test.',
      input: JSON.stringify({question, file, revision, source})
    })
  });
  if (!response.ok) throw new Error('OpenAI API returned HTTP ' + response.status + '.');
  const result = await response.json();
  const answer = result.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (result.usage) console.log(`Input tokens: ${result.usage.input_tokens}. Output tokens: ${result.usage.output_tokens}.`);
  if (answer) console.log(answer);
  if (result.status !== 'completed' || !answer) throw new Error('The review did not finish. No retry was sent.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
