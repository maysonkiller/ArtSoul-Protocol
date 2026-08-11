import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verifier = join(repositoryRoot, 'scripts', 'verify-tailwind.mjs');

test('the Tailwind build guard works when deployment sources contain no Git metadata', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'artsoul-tailwind-guard-'));

  try {
    writeFileSync(join(fixture, 'index.html'), '<div class="p-4">ArtSoul</div>');
    writeFileSync(join(fixture, 'tailwind-build.css'), '.p-4{padding:1rem}');

    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixture,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Verified 1 Tailwind utilities/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
