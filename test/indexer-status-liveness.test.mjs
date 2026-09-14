// B-03: the public status endpoint reported a dead indexer as healthy.
//
// `lag_to_observed_block` measures the projection against its own newest row.
// When the indexer stops writing, nothing new arrives, nothing is behind
// anything, and the number reads 0. Verified on production 2026-09-14: the
// Ethereum Sepolia chain, stopped since 19 June, reported
// `status: "stopped", lag: 0, stale_projection: false`.
//
// A public beta needs one number that goes wrong when the indexer goes wrong.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVENESS,
  describeLiveness,
  buildChainStatus
} from '../src/api/routes/public/indexer-status.js';

const NOW = Date.parse('2026-09-14T16:00:00Z');
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

const verdict = (state) => describeLiveness(state, NOW).liveness;

test('a live indexer reads healthy', () => {
  // The poll interval is 15 seconds and this response is edge-cached for 60,
  // so a healthy reading has to tolerate both.
  assert.equal(verdict({ status: 'running', last_indexed_at: ago(15) }), 'healthy');
  assert.equal(verdict({ status: 'running', last_indexed_at: ago(90) }), 'healthy');
  assert.equal(verdict({ status: 'running', last_indexed_at: ago(LIVENESS.HEALTHY_MAX_SECONDS) }), 'healthy');
});

test('an indexer that stopped writing does not read healthy', () => {
  // The whole point of the row. Before this, every one of these was healthy.
  assert.equal(verdict({ status: 'running', last_indexed_at: ago(LIVENESS.HEALTHY_MAX_SECONDS + 1) }), 'degraded');
  assert.equal(verdict({ status: 'running', last_indexed_at: ago(LIVENESS.DEGRADED_MAX_SECONDS) }), 'degraded');
  assert.equal(verdict({ status: 'running', last_indexed_at: ago(LIVENESS.DEGRADED_MAX_SECONDS + 1) }), 'stalled');
  assert.equal(verdict({ status: 'running', last_indexed_at: ago(86400) }), 'stalled');
});

test('a chain stopped on purpose is not an incident', () => {
  // Ethereum Sepolia is read-only legacy under canon 13 and its indexer is
  // meant to be off. Paging somebody about it every day would teach them to
  // ignore the signal.
  assert.equal(verdict({ status: 'stopped', last_indexed_at: ago(7569304) }), 'stopped_by_design');
  assert.equal(verdict({ status: 'stopped', last_indexed_at: ago(10) }), 'stopped_by_design');
});

test('a missing timestamp is unknown rather than healthy', () => {
  // Fail closed: an answer nobody can compute must not look like a good one.
  for (const state of [{ status: 'running' }, { status: 'running', last_indexed_at: 'not a date' }, {}]) {
    assert.equal(verdict(state), 'unknown', JSON.stringify(state));
  }
});

test('the thresholds travel with the answer', () => {
  // So a reader is not comparing against a number they had to find in the
  // source, and so the runbook and the code cannot drift apart.
  const detail = describeLiveness({ status: 'running', last_indexed_at: ago(30) }, NOW);
  assert.equal(detail.seconds_since_last_indexed, 30);
  assert.equal(detail.healthy_within_seconds, LIVENESS.HEALTHY_MAX_SECONDS);
  assert.equal(detail.degraded_within_seconds, LIVENESS.DEGRADED_MAX_SECONDS);
  assert.equal(detail.response_max_age_seconds, 60);
});

test('a clock skew that puts the timestamp ahead does not read as stale', () => {
  const detail = describeLiveness({ status: 'running', last_indexed_at: ago(-30) }, NOW);
  assert.equal(detail.seconds_since_last_indexed, 0);
  assert.equal(detail.liveness, 'healthy');
});

test('the chain rows carry the verdict beside the numbers that hid the problem', () => {
  const chains = buildChainStatus(
    [
      { chain_id: 84532, status: 'running', last_indexed_block: 100, last_confirmed_block: 100, last_indexed_at: ago(20) },
      { chain_id: 11155111, status: 'stopped', last_indexed_block: 5, last_confirmed_block: 5, last_indexed_at: ago(7569304) }
    ],
    { contract_events: [], v41_artworks: [], v41_auctions: [], v41_bids: [], v41_settlements: [], v41_resale_listings: [] },
    NOW
  );

  const base = chains.find((chain) => chain.chain_id === 84532);
  const legacy = chains.find((chain) => chain.chain_id === 11155111);

  assert.equal(base.liveness, 'healthy');
  assert.equal(legacy.liveness, 'stopped_by_design');
  // The old numbers still read 0 for both, which is why the verdict had to be
  // added rather than the numbers reinterpreted.
  assert.equal(base.lag_to_observed_block, 0);
  assert.equal(legacy.lag_to_observed_block, 0);
  assert.equal(legacy.stale_projection, false);
});

test('a stalled indexer is distinguishable from one that is merely behind', () => {
  // Two different incidents with two different responses: a stalled process is
  // restarted, a lagging one is usually an RPC problem.
  const behind = buildChainStatus(
    [{ chain_id: 84532, status: 'running', last_indexed_block: 100, last_confirmed_block: 100, last_indexed_at: ago(20) }],
    {
      contract_events: [{ chain_id: 84532, block_number: 180 }],
      v41_artworks: [], v41_auctions: [], v41_bids: [], v41_settlements: [], v41_resale_listings: []
    },
    NOW
  ).find((chain) => chain.chain_id === 84532);

  assert.equal(behind.liveness, 'healthy', 'it is running');
  assert.equal(behind.stale_projection, true, 'and it is behind its own rows');
  assert.equal(behind.lag_to_observed_block, 80);
});

test('the runbook and the endpoint name the same verdicts', async () => {
  // The runbook tells somebody what to do for each value. A verdict the code
  // can produce and the runbook does not mention is an incident with no
  // instructions; one the runbook mentions and the code cannot produce is a
  // step nobody will ever take.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');

  const root = path.dirname(url.fileURLToPath(import.meta.url));
  const runbook = fs.readFileSync(path.join(root, '..', 'docs', 'runbooks', 'B3_INCIDENT_RESPONSE.md'), 'utf8');

  const produced = new Set([
    describeLiveness({ status: 'running', last_indexed_at: ago(10) }, NOW).liveness,
    describeLiveness({ status: 'running', last_indexed_at: ago(300) }, NOW).liveness,
    describeLiveness({ status: 'running', last_indexed_at: ago(99999) }, NOW).liveness,
    describeLiveness({ status: 'stopped', last_indexed_at: ago(10) }, NOW).liveness,
    describeLiveness({ status: 'running' }, NOW).liveness
  ]);

  assert.deepEqual(
    [...produced].sort(),
    ['degraded', 'healthy', 'stalled', 'stopped_by_design', 'unknown'],
    'these are the five answers the endpoint can give'
  );

  for (const verdictName of produced) {
    assert.ok(runbook.includes(`\`${verdictName}\``), `the runbook must say what to do about ${verdictName}`);
  }

  // And it must warn against the number that hid the problem.
  assert.match(runbook, /Do not read `lag_to_observed_block` as a health signal/);
});
