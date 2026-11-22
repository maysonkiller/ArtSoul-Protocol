// ArtSoul Protocol first-party UI copy audit
// Run: node scripts/check-ui-copy-punctuation.mjs
// Source-only; no network, writes, environment access, or production operations
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = [];
const firstPartyDirs = ['src/entries', 'src/ui', 'src/features', 'src/content'];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const abs = join(directory, name);
    if (statSync(abs).isDirectory()) {
      walk(abs);
    } else if (/\.(?:html|js|jsx|ts|tsx)$/i.test(name)) {
      paths.push(abs);
    }
  }
}
for (const dir of firstPartyDirs) walk(join(root, dir));
for (const name of readdirSync(root)) {
  const abs = join(root, name);
  if (statSync(abs).isFile() && /\.(?:html|js|jsx)$/i.test(name)) paths.push(abs);
}

const errors = [];
for (const abs of paths) {
  const file = relative(root, abs).replaceAll('\\', '/');
  const source = readFileSync(abs, 'utf8');
  // The centered dot was an ad-hoc visual delimiter, not meaningful prose
  if (source.includes('\u00b7')) errors.push(file + ': centered dot in source UI copy');
  // A separated bullet is decorative. The three-dot playback options control
  // ("•••") in src/ui/components/artwork-player.js is a meaningful icon.
  if (/\s\u2022\s/u.test(source)) errors.push(file + ': decorative spaced bullet');
  for (const match of source.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const visible = match[2].replace(/<[^>]+>/g, ' ').replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
    if (visible && /\.(?:\s*)$/.test(visible)) {
      errors.push(file + ': heading ends with a decorative full stop (' + visible.slice(0, 90) + ')');
    }
  }
}
const required = [
  ['index.html', 'Art first — ownership next'],
  ['index.html', 'Discover a work — start its next chapter'],
  ['gallery.html', 'Art worth discovering</h1>'],
  ['collection-builder.html', 'Local draft — unpublished']
];
for (const [file, expected] of required) {
  if (!readFileSync(join(root, file), 'utf8').includes(expected)) {
    errors.push(file + ': expected approved copy missing: ' + expected);
  }
}
const homepage = readFileSync(join(root, 'index.html'), 'utf8');
if (/<h1\b[^>]*>[^<]*Discover a work[^<]*<br\b/i.test(homepage)) {
  errors.push('index.html: forced line break inside homepage headline');
}
const responsiveCSS = readFileSync(join(root, 'unified-styles.css'), 'utf8');
if (!responsiveCSS.includes('Owner copy review 2026-11-22')
  || !responsiveCSS.includes('#homeSection .home-hero-copy h1')
  || !responsiveCSS.includes('text-wrap: balance')) {
  errors.push('unified-styles.css: natural headline wrap rules are missing');
}

if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('ArtSoul UI punctuation gate PASS: ' + paths.length + ' source files scanned\n');
}
