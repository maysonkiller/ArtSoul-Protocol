const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');

const stylesheet = postcss.parse(fs.readFileSync('unified-styles.css', 'utf8'));
const selectors = ['.profile-social-links > *', '.profile-social-links .truncate'];

function mobileRule(selector) {
  let result;
  stylesheet.walkRules(selector, rule => {
    if (rule.parent.type === 'atrule' && rule.parent.name === 'media' &&
        rule.parent.params === '(max-width: 768px)') result = rule;
  });
  assert.ok(result, `The mobile social rule for ${selector} must exist`);
  return result;
}

function declaration(rule, name) {
  let value;
  rule.walkDecls(name, node => { value = node.value; });
  return value;
}

test('mobile provider labels wrap the complete connected and self-reported qualifiers', () => {
  // Both raw-text verified links and the existing .truncate spans must wrap:
  // fixing only the parent still leaves Tailwind's nowrap on the nested span.
  for (const selector of selectors) {
    const rule = mobileRule(selector);
    assert.equal(declaration(rule, 'white-space'), 'normal', `${selector} must allow multi-line labels`);
    assert.equal(declaration(rule, 'overflow-wrap'), 'anywhere', `${selector} must fit an unbroken long handle`);
    assert.notEqual(declaration(rule, 'text-overflow'), 'ellipsis', 'Identity verification qualifiers must remain readable');
  }
});

test('mobile social badges stay inside their grid cells without changing desktop theme styles', () => {
  const badge = mobileRule(selectors[0]);
  assert.equal(declaration(badge, 'max-width'), '100%');
  assert.equal(declaration(badge, 'box-sizing'), 'border-box');
  for (const selector of selectors) {
    const rule = mobileRule(selector);
    assert.equal(rule.selector, selector, 'The wrapping rule applies equally in Classic and Future');
    assert.equal(rule.parent.params, '(max-width: 768px)', 'Desktop composition is outside the mobile override');
    rule.walkDecls(node => assert.doesNotMatch(node.prop, /^(?:color|background|border-color)$/, 'A layout fix must not introduce theme colors'));
  }
});
