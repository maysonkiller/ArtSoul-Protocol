const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TREES = ['migrations', 'sql/migrations', 'src/indexer/migrations'];
const runbook = fs.readFileSync('docs/security/MIGRATION_RUNBOOK.md', 'utf8');

function everySqlFile() {
  const files = [];
  for (const tree of TREES) {
    for (const name of fs.readdirSync(tree)) {
      if (name.endsWith('.sql')) files.push(`${tree}/${name}`);
    }
  }
  return files.sort();
}

test('every migration in every tree has a recorded disposition', () => {
  // A-35. Three trees, no single ledger: twelve files were named nowhere,
  // including all four A8 migrations that the founder must apply to production
  // as the first step of the only chain gating Phase B. A migration whose
  // status nobody recorded is one somebody re-applies.
  const unledgered = everySqlFile().filter((file) => !runbook.includes(file));
  assert.deepEqual(unledgered, [], 'add these to the per-file disposition table');
});

test('the disposition table never invents a production status', () => {
  // "not recorded" is the honest entry when the repository holds no evidence.
  // It must stay available, because replacing it with a guess is how a ledger
  // becomes worse than none.
  assert.match(runbook, /`not recorded` means exactly that/);
  assert.match(runbook, /It is not a claim that the file was never applied\./);
});

test('the A8 activation order is stated where SQL discipline lives', () => {
  // The order lived only in the A8 rollout runbook while backup and
  // verification discipline lived only here, so an operator following either
  // document alone was missing half the procedure.
  const section = runbook.slice(runbook.indexOf('## A8 Moderation Activation'));
  const order = ['a8a_moderation_passkey_foundation', 'a8b_artwork_report_intake',
                 'a8c_protocol_admin_review', 'a8d_moderation_safe_recovery'];
  let cursor = -1;
  for (const file of order) {
    const at = section.indexOf(file);
    assert.ok(at > cursor, `${file} must appear in activation order`);
    cursor = at;
  }
  assert.match(section, /RESOURCE_GATED_WORK\.md` RG-03/);
  assert.match(section, /A8D_SAFE_RECOVERY\.md` section 6/);
});

test('the indexer runner is never pointed at feature migrations', () => {
  // apply-migrations.js owns the numbered sequence only. Running it over the
  // A8 files would apply them without their reviewed procedure.
  const section = runbook.slice(runbook.indexOf('## A8 Moderation Activation'));
  assert.match(section, /manages the\s*\n\s*indexer sequence only and must not be pointed at them/);
});

test('the numbering collision between the two 001 files stays documented', () => {
  // migrations/001_ai_integration.sql shares a prefix with the indexer 001 and
  // belongs to neither sequence.
  assert.match(runbook, /numbering collision with `sql\/migrations\/001_core_indexer_schema\.sql` is real/);
});

test('superseded security files keep their do-not-apply marking', () => {
  for (const file of ['security_hardening.sql', 'rls_wallet_fix.sql']) {
    const row = runbook.split('\n').find((line) => line.includes(`sql/migrations/${file}`) && line.includes('|'));
    assert.ok(row, `${file} must have a disposition row`);
    assert.match(row, /SUPERSEDED, DO NOT APPLY/);
  }
});
