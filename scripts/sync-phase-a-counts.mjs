#!/usr/bin/env node
// A-81: recompute the Phase A counts from the backlog table and write them into
// the documents that restate them.
//
// The counts were being retyped by hand in three files. Every branch that
// touched a Phase A row therefore conflicted with every other branch in exactly
// those files, and the resolution - pick a number - is the kind of edit a human
// gets wrong quietly. All four open pull requests on 2026-09-03 conflicted this
// way, and not one line of application code collided between them.
//
// `docs/BACKLOG.md` is the source. This script never edits it.
//
//   node scripts/sync-phase-a-counts.mjs           write the counts
//   node scripts/sync-phase-a-counts.mjs --check   fail if they are stale
//
// The existing suites still assert the sentences independently, so this script
// is a convenience for getting them right, never the thing that proves them.

import { readFileSync, writeFileSync } from 'node:fs';

const BACKLOG = 'docs/BACKLOG.md';
const ROW = /^\| (A-(\d{2})) \|[^\n]*\| (done|in progress|planned|blocked-on-founder) \| A \|/gm;

function readCounts() {
    const rows = [...readFileSync(BACKLOG, 'utf8').replace(/\r\n/g, '\n').matchAll(ROW)];
    if (!rows.length) throw new Error(`No Phase A rows found in ${BACKLOG}`);

    const totals = rows.reduce((all, row) => {
        all[row[3]] = (all[row[3]] || 0) + 1;
        return all;
    }, {});
    const last = String(Math.max(...rows.map(row => Number(row[2])))).padStart(2, '0');
    return {
        done: totals.done || 0,
        inProgress: totals['in progress'] || 0,
        planned: totals.planned || 0,
        last
    };
}

// Each entry rewrites one sentence in place. The pattern must match only the
// sentence, so a document can say anything it likes around it.
function replacements({ done, inProgress, planned, last }) {
    return [
        {
            file: 'docs/PHASE_A_CLOSE_OUT.md',
            pattern: /Phase A stands at \*\*\d+ done, \d+ in progress, \d+ planned\*\* across A-01 to A-\d+\./,
            text: `Phase A stands at **${done} done, ${inProgress} in progress, ${planned} planned** across A-01 to A-${last}.`
        },
        {
            file: 'docs/HANDOFF.md',
            pattern: /Phase A stands at \*\*\d+ done, \d+ in progress, \d+ planned\*\* across A-01 to A-\d+\./,
            text: `Phase A stands at **${done} done, ${inProgress} in progress, ${planned} planned** across A-01 to A-${last}.`
        },
        {
            file: 'docs/PROJECT_STATE.md',
            pattern: /current position is \d+ `done`, \d+ `in progress`, \d+ `planned` across A-01 to A-\d+/,
            text: `current position is ${done} \`done\`, ${inProgress} \`in progress\`, ${planned} \`planned\` across A-01 to A-${last}`
        }
    ];
}

const check = process.argv.includes('--check');
const counts = readCounts();
const stale = [];

for (const { file, pattern, text } of replacements(counts)) {
    const before = readFileSync(file, 'utf8');
    const match = before.match(pattern);
    if (!match) {
        console.error(`${file}: the Phase A count sentence is missing or reworded; fix it by hand.`);
        process.exit(1);
    }
    if (match[0] === text) continue;

    stale.push(`${file}: ${match[0].trim()}`);
    if (!check) writeFileSync(file, before.replace(pattern, text), 'utf8');
}

if (check && stale.length) {
    console.error('Phase A counts are stale:\n  ' + stale.join('\n  '));
    console.error(`\nExpected: ${counts.done} done, ${counts.inProgress} in progress, ${counts.planned} planned (A-01 to A-${counts.last})`);
    console.error('Run: npm run sync:phase-a');
    process.exit(1);
}

console.log(stale.length
    ? `Phase A counts updated in ${stale.length} file(s): ${counts.done} done, ${counts.inProgress} in progress, ${counts.planned} planned (A-01 to A-${counts.last}).`
    : `Phase A counts already correct: ${counts.done} done, ${counts.inProgress} in progress, ${counts.planned} planned (A-01 to A-${counts.last}).`);
