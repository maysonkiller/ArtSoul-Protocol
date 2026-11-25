'use strict';

// Run against a clean npm ci installation of the candidate lock.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');

const install = path.resolve(process.argv[2] || '.');
const load = createRequire(path.join(install, 'package.json'));
const hardhat = createRequire(load.resolve('hardhat/package.json'));
const mocha = createRequire(hardhat.resolve('mocha/package.json'));
const sentry = createRequire(load.resolve('@sentry/node/package.json'));
assert.equal(sentry('cookie/package.json').version, '0.7.2');
assert.equal(mocha('glob/package.json').version, '14.0.6');
assert.equal(mocha('minimatch/package.json').version, '11.0.9');
const report = mocha('./lib/reporters/base.js');
for (const inline of [false, true]) {
    report.inlineDiffs = inline;
    const diff = report.generateDiff('old value', 'new value');
    assert.doesNotMatch(diff, /failed to generate/i);
    assert.match(diff, /old/);
    assert.match(diff, /new/);
}

const req = { method: 'GET', url: '/test', headers: { cookie: 'art=blue; theme=classic' } };
const event = load('@sentry/node').Handlers.parseRequest({}, req, {
    request: ['cookies'], version: false, serverName: false, user: false, transaction: false
});
assert.deepEqual({ ...event.request.cookies }, { art: 'blue', theme: 'classic' });
const headers = [];
load('express').response.cookie.call({
    req: {}, append(name, value) { headers.push([name, value]); }
}, 'art', 'blue', { httpOnly: true, sameSite: 'lax' });
assert.deepEqual(headers, [['Set-Cookie', 'art=blue; Path=/; HttpOnly; SameSite=Lax']]);
console.log('Sentry cookie intake, Express cookie output, unified and inline Mocha diffs passed.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'artsoul-npm-'));
const fixtures = path.join(temp, 'spec');
fs.mkdirSync(fixtures);
const keep = path.join(fixtures, 'keep.spec.cjs');
const skip = path.join(fixtures, 'skip.spec.cjs');
const network = path.join(temp, 'network.cjs');
const config = path.join(temp, 'hardhat.config.cjs');
const manifest = path.join(temp, 'package.json');
try {
    fs.writeFileSync(keep, "it('runs in a worker', () => require('node:assert/strict').ok(process.env.MOCHA_WORKER_ID));");
    fs.writeFileSync(skip, "throw Error('Ignored file was loaded');");
    const output = execFileSync(process.execPath, [
        mocha.resolve('./bin/mocha.js'), 'spec/**/*.spec.cjs', '--ignore', '**/skip.spec.cjs',
        '--parallel', '--jobs', '2', '--reporter', 'json'
    ], { cwd: temp, encoding: 'utf8' });
    const run = JSON.parse(output);
    assert.equal(run.stats.tests, 1);
    assert.equal(run.stats.passes, 1);
    console.log('Mocha file globs, ignored paths and a parallel worker passed.');

    fs.writeFileSync(manifest, '{}');
    fs.writeFileSync(config, "module.exports = {defaultNetwork: 'hardhat', solidity: '0.8.24'};");
    fs.writeFileSync(network, [
        "const assert = require('node:assert/strict');",
        "it('reads a disposable chain', async function () {",
        "    const hre = require(process.env.ARTSOUL_TEST_HARDHAT);",
        "    assert.equal(await hre.network.provider.send('eth_chainId'), '0x7a69');",
        "    assert.equal(await hre.network.provider.send('eth_blockNumber'), '0x0');",
        "});"
    ].join('\n'));
    const chain = execFileSync(process.execPath, [
        hardhat.resolve('./internal/cli/bootstrap.js'), '--config', config,
        'test', '--no-compile', network
    ], { cwd: install, encoding: 'utf8', env: {
        ...process.env, ARTSOUL_TEST_HARDHAT: load.resolve('hardhat'), HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true'
    }});
    assert.match(chain, /1 passing/);
    console.log('Hardhat test runner and disposable EDR network reads passed.');
} finally {
    for (const file of [keep, skip, network, config, manifest]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(fixtures);
    fs.rmdirSync(temp);
}
