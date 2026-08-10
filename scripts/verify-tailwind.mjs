// Every Tailwind utility the pages use must exist in the compiled stylesheet.
//
// The Play CDN generated utilities in the browser, so an unknown class simply
// appeared. A compiled build only contains what the content globs matched, so a
// class in a file Tailwind does not scan silently loses its styling. This check
// fails the build instead.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const CSS = 'tailwind-build.css';
const CLASS_ATTR = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

// Utility shapes the project actually uses. Anything else is a project class.
const UTILITY = new RegExp('^-?(?:sm:|md:|lg:|xl:|hover:|focus:|active:|disabled:)*(?:'
  + 'flex|grid|block|inline|inline-flex|inline-block|hidden|'
  + 'items-|justify-|self-|gap-|space-[xy]-|'
  + 'p[xytblrse]?-\d|m[xytblrse]?-\d|w-|h-|min-w-|min-h-|max-w-|max-h-|'
  + 'text-|font-|leading-|tracking-|truncate|uppercase|whitespace-|break-|'
  + 'bg-|border|rounded|shadow|opacity-\d|ring|'
  + 'relative|absolute|fixed|sticky|top-|right-|bottom-|left-|inset-|z-\d|'
  + 'overflow-|object-|cursor-|pointer-events-|select-|resize|'
  + 'transition|duration-\d|ease-|delay-\d|animate-|'
  + 'order-\d|col-|row-|basis-|grow|shrink|flex-|aspect-|list-|float-|'
  + 'visible|invisible|sr-only|mx-auto|my-auto'
  + ')');

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(f => /\.(html|jsx?|mjs)$/.test(f) && !f.startsWith('test/') && !f.startsWith('scripts/'));

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
