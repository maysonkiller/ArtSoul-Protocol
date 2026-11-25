'use strict';

// Run at a clean project installation with Node 22. Each installed CLI starts its own worker.
const assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const {runInNewContext} = require('node:vm');

const load = createRequire(path.join(process.cwd(), 'package.json'));

if (require.main === module && process.argv[2] === '--smt-input') {
    const location = process.argv[3];
    process.stdout.write(JSON.stringify({location, query: readFileSync(location, 'utf8')}));
} else if (require.main === module) {
    // --fixture runs one minimal compatibility installation without the rest of ArtSoul.
    const consumers = [load.resolve('mocha/package.json')];
    if (process.argv[2] !== '--fixture') {
        assert.ok(load.resolve('solc/package.json'));
        const hardhat = createRequire(load.resolve('hardhat/package.json'));
        consumers.push(hardhat.resolve('mocha/package.json'));
        assert.equal(new Set(consumers).size, 2);
    }
    for (const [index, manifest] of consumers.entries()) {
        const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
        if (process.argv[2] === '--fixture') assert.ok(['10.8.2', '11.8.0'].includes(version));
        else assert.equal(version, index === 0 ? '10.8.2' : '11.8.0');
        const cli = path.join(path.dirname(manifest), 'bin', 'mocha.js');
        const runSolc = index === 0 && existsSync(path.join(process.cwd(), 'node_modules/solc'));
        const result = spawnSync(process.execPath, [cli, '--no-config', '--no-package',
            '--parallel', '--jobs', '2', '--timeout', '10000', __filename], {
            stdio: 'inherit',
            env: {...process.env, ARTSOUL_COMPAT_MOCHA: manifest, ARTSOUL_COMPAT_SOLC: runSolc ? '1' : '0'}
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, 'Mocha ' + version + ' compatibility result');
    }
} else {
    describe('patched tooling compatibility', function () {
        it('carries Mocha options through its serializer in a real worker', function () {
            assert.ok(process.env.MOCHA_WORKER_ID);
            const parent = createRequire(process.env.ARTSOUL_COMPAT_MOCHA);
            assert.equal(parent('serialize-javascript/package.json').version, '7.1.4');
            const {BufferedWorkerPool} = parent('./lib/nodejs/buffered-worker-pool.js');
            const opts = {timeout: 2500, grep: /art/i, reporter: 'spec', list: ['ok'], callback() {}};
            const encoded = BufferedWorkerPool.serializeOptions(opts);
            const received = runInNewContext('(' + encoded + ')', Object.create(null), {timeout: 2000});
            assert.equal(received.timeout, 2500);
            assert.equal(received.reporter, 'spec');
            assert.ok(received.grep.test('ART'));
            assert.deepEqual(Array.from(received.list), ['ok']);
            assert.equal(received.callback, undefined);
        });
        if (process.env.ARTSOUL_COMPAT_SOLC !== '1') return;
        it('reads and removes the temporary file used by the solc SMT adapter', function () {
            const parent = createRequire(load.resolve('solc/package.json'));
            assert.equal(parent('tmp/package.json').version, '0.2.7');
            const {smtSolver} = parent('./smtsolver.js');
            const output = smtSolver('(check-sat)', {
                command: '"' + process.execPath + '"', params: '"' + __filename + '" --smt-input'
            });
            const marker = JSON.parse(output);
            assert.equal(marker.query, '(check-sat)');
            assert.equal(path.extname(marker.location), '.smt2');
            assert.equal(existsSync(marker.location), false);
        });
        it('compiles a simple contract with the pinned npm solc', function () {
            const solc = load('solc');
            assert.match(solc.version(), /^0\.8\.26\+/);
            const source = 'pragma solidity 0.8.26; contract Smoke { function value() external pure returns (uint) { return 3; } }';
            const input = {language: 'Solidity', sources: {'Smoke.sol': {content: source}},
                settings: {outputSelection: {'*': {'*': ['evm.bytecode.object']}}}};
            const output = JSON.parse(solc.compile(JSON.stringify(input)));
            assert.deepEqual((output.errors ?? []).filter(error => error.severity === 'error'), []);
            assert.match(output.contracts['Smoke.sol'].Smoke.evm.bytecode.object, /^[a-f0-9]+$/);
        });
    });
}
