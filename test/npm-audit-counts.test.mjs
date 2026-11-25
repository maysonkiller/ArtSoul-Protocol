import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const inventory = fileURLToPath(new URL('../scripts/security/npm-audit-inventory.mjs', import.meta.url));
function report() {
  return {
    auditReportVersion: 2,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: { example: { name: 'example', severity: 'high', nodes: ['node_modules/example'] } }
  };
}

test('both npm inventories must reconcile their counts to the recorded packages', t => {
  const dir = mkdtempSync(join(tmpdir(), 'artsoul-advisories-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (full, prod) => {
    writeFileSync(join(dir, 'full.json'), JSON.stringify(full));
    writeFileSync(join(dir, 'prod.json'), JSON.stringify(prod));
    return spawnSync(process.execPath, [inventory, 'full.json', 'prod.json'], { cwd: dir, encoding: 'utf8' });
  };
  assert.equal(run(report(), report()).status, 0);
  const wrongCount = report();
  wrongCount.metadata.vulnerabilities.total = 0;
  assert.notEqual(run(wrongCount, report()).status, 0);
  const wrongSeverity = report();
  wrongSeverity.vulnerabilities.example.severity = 'low';
  assert.notEqual(run(report(), wrongSeverity).status, 0);
  assert.notEqual(run(report(), { error: { code: 'offline' } }).status, 0);
});
