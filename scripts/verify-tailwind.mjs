// Every Tailwind utility the pages use must exist in the compiled stylesheet.
//
// The Play CDN generated utilities in the browser, so an unknown class simply
// appeared. A compiled build only contains what the content globs matched, so a
// class in a file Tailwind does not scan silently loses its styling. This check
// fails the build instead.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CSS = 'tailwind-build.css';
const CLASS_ATTR = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

// Utility shapes the project actually uses. Anything else is a project class.
const UTILITY = new RegExp('^-?(?:sm:|md:|lg:|xl:|hover:|focus:|active:|disabled:)*(?:'
  + 'flex|grid|block|inline|inline-flex|inline-block|hidden|'
  + 'items-|justify-|self-|gap-|space-[xy]-|'
  + 'p[xytblrse]?-\\d|m[xytblrse]?-\\d|w-|h-|min-w-|min-h-|max-w-|max-h-|'
  + 'text-|font-|leading-|tracking-|truncate|uppercase|whitespace-|break-|'
  + 'bg-|border|rounded|shadow|opacity-\\d|ring|'
  + 'relative|absolute|fixed|sticky|top-|right-|bottom-|left-|inset-|z-\\d|'
  + 'overflow-|object-|cursor-|pointer-events-|select-|resize|'
  + 'transition|duration-\\d|ease-|delay-\\d|animate-|'
  + 'order-\\d|col-|row-|basis-|grow|shrink|flex-|aspect-|list-|float-|'
  + 'visible|invisible|sr-only|mx-auto|my-auto'
  + ')');

const SOURCE_FILE = /\.(html|jsx?|mjs)$/;
const SKIPPED_DIRECTORIES = new Set(['.git', '.vercel', 'dist', 'node_modules', 'scripts', 'test']);

function collectSourceFiles(directory = '.') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...collectSourceFiles(path.join(directory, entry.name)));
      }
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

let files;
try {
  files = execSync('git ls-files', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .filter(file => SOURCE_FILE.test(file) && !file.startsWith('test/') && !file.startsWith('scripts/'));
} catch {
  // Direct Vercel CLI uploads intentionally omit .git. Scanning the uploaded
  // source tree keeps this build guard available instead of making Git
  // metadata an accidental production-build dependency.
  files = collectSourceFiles();
}

const used = new Set();
for (const file of files) {
  let source;
  try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const match of source.matchAll(CLASS_ATTR)) {
    const blob = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const token of blob.split(/\s+/)) {
      if (token && UTILITY.test(token)) used.add(token);
    }
  }
}

const css = fs.readFileSync(CSS, 'utf8');
const escapeForSelector = token => token.replace(/[.:/[\]()%#!,+*~='"^$|{}]/g, ch => `\\${ch}`);
// Classes Tailwind cannot generate can never appear in the output, so they are
// excluded from the check rather than failing it forever. They are inert in the
// markup and were equally inert under the CDN.
const NOT_A_TAILWIND_UTILITY = new Set([
  // v3 has no opacity modifier for the `current` border colour; this rendered
  // as a plain `border` before this change too.
  'border-current/20'
]);

const missing = [...used]
  .filter(token => !NOT_A_TAILWIND_UTILITY.has(token))
  .filter(token => !css.includes('.' + escapeForSelector(token)));

if (missing.length) {
  console.error(`\n${CSS} is missing ${missing.length} utility class(es) the pages use:`);
  for (const token of missing.sort()) console.error('  ' + token);
  console.error('\nAdd the file to the content globs in tailwind.config.cjs, then rebuild.\n');
  process.exit(1);
}

console.log(`Verified ${used.size} Tailwind utilities are present in ${CSS} (${(fs.statSync(CSS).size / 1024).toFixed(1)} kB).`);
