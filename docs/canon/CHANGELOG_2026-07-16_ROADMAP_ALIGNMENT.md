# Roadmap Alignment — 2026-07-16

Authority: founder approval after review of the proposed 2026-07-16 planning files.

## Adopted

- One canonical A–D model: Stabilize Public Testnet, Public Beta, Mainnet Preparation, Staged Mainnet Launch.
- Base commitments are explicit Phase A work, including cached aggregate metrics that follow the existing projection-cache discipline.
- Snapshot A is a durable, exportable community record that must survive the destructive migration and database reset.
- Genesis administration requires public eligibility categories, durable grant records, an audit log, and multisig-authorized controls.
- Losing-bidder refunds use deterministic obligations, bounded batches, and withdrawable-credit fallback.
- Genesis activation is a separate bounded pilot after Core launch stability, not part of a single launch event.

## Explicitly Not Canonized

- Any numeric Genesis grant cadence.
- Any date, count, or percentage that activates pool-funded contests.
- Any specific legal entity type or jurisdiction.
- Any fixed Core stability-window duration.
- Any promoted-banner slot-auction reserve until the existing v1.2 planning delta is consolidated into the full Bible.

These remain tunable or undecided planning inputs until separately approved. A roadmap estimate must never silently become a contract parameter or treasury rule.

## Phase Mapping

The repository already used A–D as its authoritative roadmap. Earlier informal A–G planning is retired rather than preserved as parallel authority:

- stabilization and testnet work → A;
- beta and cohort validation → B;
- contracts, Genesis, Collections, security, legal readiness, and final visual work → C;
- migration, deployment, and staged activation → D;
- historical token or multichain phases → no mapping; out of scope.

## Economics

No economic value changed. Primary remains `97.5 / 2.5`; resale remains `92.5 / 5.5 / 1 / 1`; defaulted-winner, deposit, increment, duration, and settlement rules remain governed by Bible §3.

## Follow-up Pull Request

`AGENTS.md` and `CLAUDE.md` are aligned separately so repository instructions can be reviewed without hiding the canon and roadmap changes in the same diff. The roadmap/canon PR must merge first.
