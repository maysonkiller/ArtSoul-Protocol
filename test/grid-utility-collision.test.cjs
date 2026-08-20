const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Every stylesheet the product ships, excluding the Tailwind build itself.
const STYLESHEETS = fs.readdirSync('.')
  .filter((name) => name.endsWith('.css') && name !== 'tailwind-build.css');

function bareGridRules(css) {
  // A rule whose selector list contains the standalone `.grid` class.
  const rules = [];
  const re = /(^|\})([^{}]*?)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selectors = m[2].split(',').map((s) => s.trim());
    if (selectors.some((s) => /(^|\s)\.grid$/.test(s))) rules.push(m[3]);
  }
  return rules;
}

test('no product stylesheet declares layout on the bare Tailwind grid utility', () => {
  // A-55. `grid` is Tailwind's display utility. Declaring columns or gap on it
  // overrode every grid-cols-* and gap-* in production, because the build emits
  // performance-optimizations.css after tailwind-build.css and both selectors
  // weigh one class, so source order decided and the utility lost.
  for (const file of STYLESHEETS) {
    const css = fs.readFileSync(file, 'utf8');
    for (const body of bareGridRules(css)) {
      assert.doesNotMatch(body, /grid-template-columns/,
        `${file}: .grid must not declare grid-template-columns`);
      assert.doesNotMatch(body, /(^|;|\s)gap\s*:/,
        `${file}: .grid must not declare gap`);
    }
  }
});

test('the one element that relied on the removed rule keeps its own columns', () => {
  // The artwork fallback facts panel was the only bare `grid` user without
  // grid-cols-*, so removing the rule would have silently restacked it.
  const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
  const styles = fs.readFileSync('unified-styles.css', 'utf8');
  assert.match(artwork, /className="artwork-fallback-facts grid gap-3/);
  assert.match(styles, /\.artwork-fallback-facts \{\s*\n\s*grid-template-columns: repeat\(auto-fill, minmax\(250px, 1fr\)\);/);
  assert.match(styles, /@media \(max-width: 640px\) \{\s*\n\s*\.artwork-fallback-facts \{\s*\n\s*grid-template-columns: 1fr;/);
});

test('every other grid in the product declares its own columns', () => {
  // Guard the invariant rather than the single file: any element using the
  // display utility without columns would silently depend on a global default
  // again, which is the shape of the defect.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.playwright-cli', 'brand'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(html|jsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      const re = /class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\})/g;
      let m;
      while ((m = re.exec(source)) !== null) {
        const tokens = (m[1] || m[2] || '').split(/\s+/);
        if (!tokens.includes('grid')) continue;
        const hasColumns = tokens.some((t) => t.includes('grid-cols-'));
        const hasOwnClass = tokens.some((t) => /-(grid|facts)$/.test(t));
        if (!hasColumns && !hasOwnClass) offenders.push(`${full}: ${tokens.join(' ')}`);
      }
    }
  };
  walk('.');
  assert.deepEqual(offenders, []);
});
