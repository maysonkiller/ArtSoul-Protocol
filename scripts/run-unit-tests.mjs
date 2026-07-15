import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const contractSuite = 'ArtSoulV41.test.cjs';
const unitTests = readdirSync('test')
    .filter(file => file.endsWith('.test.cjs') && file !== contractSuite)
    .sort()
    .map(file => join('test', file));

const result = spawnSync(process.execPath, ['--test', ...unitTests], {
    stdio: 'inherit'
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
