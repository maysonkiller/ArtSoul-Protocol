#!/usr/bin/env node

/**
 * Stability Test Suite Runner
 *
 * Runs all stability tests:
 * 1. Graceful shutdown test
 * 2. Crash simulation test
 * 3. Memory leak test (30 min)
 */

import { spawn } from 'child_process';

const tests = [
    {
        name: 'Graceful Shutdown Test',
        command: 'node',
        args: ['scripts/graceful-shutdown-test.js'],
        timeout: 60000 // 1 minute
    },
    {
        name: 'Crash Simulation Test',
        command: 'node',
        args: ['scripts/crash-simulation-test.js'],
        timeout: 120000 // 2 minutes
    },
    {
        name: 'Crash Recovery Verification',
        command: 'node',
        args: ['scripts/crash-simulation-test.js', 'verify'],
        timeout: 60000 // 1 minute
    },
    {
        name: 'Memory Leak Test (30 min)',
        command: 'node',
        args: ['scripts/memory-leak-test.js'],
        timeout: 1900000, // 31 minutes (30 min test + 1 min buffer)
        optional: true // Can be skipped for quick runs
    }
];

async function runTest(test) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${test.name}`);
    console.log(`${'='.repeat(60)}\n`);

    return new Promise((resolve, reject) => {
        const proc = spawn(test.command, test.args, {
            stdio: 'inherit',
            shell: true
        });

        const timeoutId = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error(`Test timeout after ${test.timeout}ms`));
        }, test.timeout);

        proc.on('exit', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                console.log(`\n ${test.name} PASSED\n`);
                resolve();
            } else {
                console.log(`\n ${test.name} FAILED (exit code: ${code})\n`);
                reject(new Error(`Test failed with exit code ${code}`));
            }
        });

        proc.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(error);
        });
    });
}

async function runAllTests() {
    console.log('🛡️ STABILITY TEST SUITE');
    console.log('='.repeat(60));

    const results = {
        passed: 0,
        failed: 0,
        skipped: 0,
        tests: []
    };

    const startTime = Date.now();

    // Check if quick mode (skip long tests)
    const quickMode = process.argv.includes('--quick');

    for (const test of tests) {
        if (quickMode && test.optional) {
            console.log(`\n⏭️  Skipping: ${test.name} (quick mode)\n`);
            results.skipped++;
            results.tests.push({
                name: test.name,
                status: 'skipped'
            });
            continue;
        }

        try {
            await runTest(test);
            results.passed++;
            results.tests.push({
                name: test.name,
                status: 'passed'
            });
        } catch (error) {
            console.error(`Error: ${error.message}`);
            results.failed++;
            results.tests.push({
                name: test.name,
                status: 'failed',
                error: error.message
            });
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('STABILITY TEST SUITE RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${tests.length}`);
    console.log(`Passed: ${results.passed} `);
    console.log(`Failed: ${results.failed} `);
    console.log(`Skipped: ${results.skipped} ⏭️`);
    console.log(`Duration: ${elapsed} minutes`);
    console.log('='.repeat(60));

    results.tests.forEach(test => {
        const icon = test.status === 'passed' ? '' : test.status === 'failed' ? '' : '⏭️';
        console.log(`${icon} ${test.name}: ${test.status.toUpperCase()}`);
        if (test.error) {
            console.log(`   Error: ${test.error}`);
        }
    });

    console.log('='.repeat(60));

    if (results.failed > 0) {
        console.log('\n STABILITY TEST SUITE FAILED\n');
        process.exit(1);
    } else {
        console.log('\n STABILITY TEST SUITE PASSED\n');
        process.exit(0);
    }
}

// Run tests
runAllTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
