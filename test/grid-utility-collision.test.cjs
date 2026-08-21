const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Every stylesheet the product ships, excluding the Tailwind build itself.
const STYLESHEETS = fs.readdirSync('.')
  .filter((name) => name.endsWith('.css') && name !== 'tailwind-build.css');

// Yields every { selector, body } in a stylesheet at ANY nesting depth.
//
// The first version of this used one regex over the whole file, which could
// only ever see top-level rules. mobile-responsive.css declared the same
// override inside @media blocks, so the test passed while production stayed
// broken for weeks. A depth-aware scan is the only honest way to check this.
function eachRule(css) {
  const out = [];
  let depth = 0;
  let selectorStart = 0;
  const stack = [];
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === '{') {
      const head = css.slice(selectorStart, i).trim();
      stack.push({ head, bodyStart: i + 1 });
      depth += 1;
      selectorStart = i + 1;
    } else if (c === '}') {
      const frame = stack.pop();
      depth -= 1;
      if (frame && !frame.head.startsWith('@')) {
        out.push({ selector: frame.head, body: css.slice(frame.bodyStart, i) });
      }
      selectorStart = i + 1;
    } else if (c === ';') {
      selectorStart = i + 1;
    }
  }
  return out;
}

// Rules whose selector IS a bare Tailwind display utility, and therefore apply
// to every element on the page carrying it.
//
// Only the unqualified form is a defect. `header > .container > .flex` targets
// one known element through a path and wins on specificity deliberately; that
// is styling, not shadowing. A selector that is nothing but `.grid` or `.flex`
// silently reaches everything, which is what broke production.
//
// Token comparison rather than a built regex: the first attempt constructed one
// with `new RegExp`, the escapes collapsed inside the template literal, and the
// resulting pattern matched `.profile-artwork-grid` too.
function utilityRules(css, utility) {
  const target = `.${utility}`;
  return eachRule(css)
    .filter((rule) => rule.selector
      .split(',')
      .map((s) => s.trim())
      .some((s) => s === target))
    .map((rule) => rule.body);
}

function bareGridRules(css) {
  return utilityRules(css, 'grid');
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

test('no product stylesheet declares spacing on the bare Tailwind flex utility', () => {
  // Same defect class as above, in the same file. `.flex { gap: 8px }` under
  // 380px reached every flex container. Measured live at 375px it changed
  // nothing visible, because the only unqualified gap-* on those pages was
  // gap-2, which already wants 8px - so this guards a latent trap, not a
  // reported symptom.
  for (const file of STYLESHEETS) {
    const css = fs.readFileSync(file, 'utf8');
    for (const body of utilityRules(css, 'flex')) {
      assert.doesNotMatch(body, /(^|;|\s)gap\s*:/,
        `${file}: .flex must not declare gap`);
      assert.doesNotMatch(body, /flex-direction/,
        `${file}: .flex must not declare flex-direction`);
    }
  }
});

test('the depth-aware scan actually reaches inside a media query', () => {
  // Pins the fix for the blind spot above: without this, the two tests before
  // it would pass on any stylesheet that nests its overrides.
  const nested = '@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }';
  assert.deepEqual(bareGridRules(nested).length, 1);
  assert.match(bareGridRules(nested)[0], /grid-template-columns/);
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
