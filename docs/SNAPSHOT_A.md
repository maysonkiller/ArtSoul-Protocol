# Snapshot A — export schema and capture runbook

Snapshot A is the community record of the public testnet. Bible section 16 point
1 requires it to be versioned, reproducible, machine-readable and durable, to
carry the source cut-off, participating addresses, qualifying public events with
timestamps, aggregate counts and a cryptographic manifest, and to be verified
from at least two independent durable locations. Point 2 requires proving it can
be read and independently validated **after the application database is reset**.

**It creates no entitlement.** Not Genesis, not a token, not points, not an
airdrop. That sentence is written into the manifest itself, because the file will
outlive every document around it.

## Why the format looks like this

Timing was amended by the founder on October 28, 2026: the actual capture follows
the full public testnet of the final contracts in late Phase C, before Phase D
reset and mainnet launch. It is not an exit gate for the current Phase B beta.
Announce the final cut-off at least two weeks ahead; no date is assigned now.
Keep export tooling and rehearsals ready, without calling rehearsal files the
final Snapshot A. See Bible §16 and canonical backlog C16.

Snapshot A is captured once, on an announced date, immediately before a
destructive reset, and it cannot be recaptured afterwards. Its proof of integrity
therefore cannot depend on anything the reset removes. A reader holding only the
directory — no database, no API, no access to this repository — must be able to
decide whether the copy in front of them is intact.

That single constraint produces every design decision below.

## What is exported

| File | Contents |
| --- | --- |
| `artworks.json` | Registered artworks: creator, metadata URI, mint state, token id, canonical floor |
| `auctions.json` | Auctions: creator, start price, duration, end time, status, winner, winning bid |
| `bids.json` | Bids: bidder, amount, deposit, block, transaction hash |
| `auction_endings.json` | Endings: winner, winning bid, settlement deadline, transaction hash |
| `settlements.json` | Settlements: winner, final price, token id, status, transaction hash |
| `resales.json` | Completed resales: seller, buyer, price, transaction hash |
| `floor_history.json` | Canonical floor changes tied to artwork and token ids |
| `participants.json` | Every address that took part, lowercased, deduplicated, sorted |
| `manifest.json` | Schema version, chain, cut-off, entitlement notice, counts, per-file hashes, root hash |

Every row carries `indexed_at`, the projection's indexing timestamp. It is not
a substitute for the original block timestamp.

## What is deliberately excluded

- **Genesis and eligibility tables.** Canon says testnet activity never qualifies
  for Genesis. Shipping a testnet eligibility list inside a snapshot invites
  exactly the reading canon forbids.
- **Profiles.** Usernames, avatars and anything attached to an account. The
  participating addresses canon asks for are public chain facts and come from the
  event tables; a permanent public file has no business carrying the rest.
- **Anything not on the allowlist.** `EXPORTED_TABLES` in
  [`src/snapshot/snapshot-a.js`](../src/snapshot/snapshot-a.js) names every table
  and every column that may be read. A column added to a table later cannot slip
  into the record without someone editing that list, and a test asserts it.

## Integrity

Each file is hashed with SHA-256. The manifest lists those hashes, and a
`root_hash` covers the manifest body itself. Editing a file and its entry breaks
that root. An attacker who rewrites the data, manifest and root together can
make another internally consistent archive. Authenticity therefore requires a
trusted root retained separately from the archive under review; a hash inside
the same archive is not an independent trust anchor.

The verifier checks all eight required data files, section shapes, allowlisted
columns, chain scope, participant derivation, aggregate counts and hashes. Use
`--expected-root` with the separately retained capture hash for durable-copy
acceptance. Without it, a successful result proves internal consistency only.

Output is deterministic for identical input rows: object keys and rows are
sorted and every file ends with a newline. A timestamp cut-off alone does not
freeze mutable auction/artwork projections. Two runs against a changing database
can differ legitimately; this is not proof of tampering. Final capture must use
a consistent, stabilized read view. The current timestamp filter does not
reconstruct historical projection state at an earlier block.

## Capture runbook

Run this on the announced cut-off date, before any destructive step.

**1. Export.**

```bash
node scripts/export-snapshot-a.mjs --out ../snapshot-a --cut-off <ISO-8601 UTC>
```

Needs `DATABASE_URL`, an explicit cut-off and a new output directory inside an
existing parent. Existing directories are refused before connecting; file writes
are exclusive. A failed partial capture remains inspectable and must not be
reused. Tables are read in one repeatable-read, read-only transaction; any failed
read rolls it back. The output goes outside the repository and is never committed.

**2. Retain the capture root independently, then export again from the same
stabilized source to a new directory and compare the root hashes.**
They must be identical. If they differ, stop — the capture is not reproducible
and nothing downstream can be trusted.

**3. Verify in place.**

```bash
node scripts/verify-snapshot-a.mjs ../snapshot-a --expected-root <trusted SHA-256>
```

**4. Copy to two independent durable locations.** Independent means different
providers, not two buckets in one account: the point is surviving the loss of any
single one.

**5. Verify each copy in its own location against the independently retained
capture root.** Record the command, root hash and result from each. Do not obtain
the expected root from the same copy being tested.

**6. Record in the migration runbook:** the cut-off, the root hash, both
locations, and the verification result from each. Bible section 16 point 2 asks
for the verification result and the export schema, and this file is the schema.

**7. Only then** does the destructive reset proceed. Snapshot A is never
re-imported as live product state.

## Verifying a copy years later

Retain a verifier package with each durable copy: the reviewed
`scripts/verify-snapshot-a.mjs` and `src/snapshot/snapshot-a.js` with those relative
paths, plus a `package.json` containing `{"type":"module"}`. It uses only Node
built-ins, needs no npm install, and reads no database or API. Retain the reviewed
Git revision and tool-file hashes in the capture record. The offline test runs
these copies outside the repository. With the data and verifier package available:

```bash
node verification-tools/scripts/verify-snapshot-a.mjs /path/to/copy --expected-root <trusted SHA-256>
```

The verifier exits non-zero and names every problem it finds rather than stopping
at the first, so two damaged copies can be compared in a single pass. If a copy
fails, fetch another durable copy and verify that one. Never repair a copy by
hand — a hand-edited snapshot is no longer a record of anything.

## October 28 verifier hardening evidence

Three regressions reproduced against the earlier verifier: a removed data file
also removed from a recomputed manifest was accepted; a JSON `null` manifest
threw; a fully rewritten internally consistent archive had no trusted-root
comparison. The repaired verifier rejects these cases. The focused suite has
27 passing local tests, including section/chain/column/count corruption, arbitrary
manifest paths, invalid JSON, CLI exit codes and an isolated verifier package.
No final capture, archive storage upload or reset was performed. The capture
follow-up adds the consistent read-only view, rollback and no-overwrite guards.
A PostgreSQL 17 integration test commits a concurrent update between table reads,
checks that capture still sees the earlier state, rejects a write and verifies
rollback. Local Docker was unavailable; its CI result must be recorded separately.

At `2026-10-28T19:35:52Z`, a read-only in-memory rehearsal against the pinned live
testnet database completed twice with the same root
`bbc6aa0e2d277f442427479ee939534952c75e140ef74ec55513b80a21060a00`.
Both transactions report `repeatable read` / `read_only=on`. Counts: 38 artworks,
73 auctions, 15 bids, six completed settlements, three resales, ten participating
addresses; primary settled volume `23200000000000000` wei. Both in-memory archives
pass the verifier. Only hashes/counts and transaction-mode evidence were saved
privately; no archive data files or final Snapshot A were written. This confirms
the current schema/read path, not a final cut-off or two durable copies.

Final-contract schema alignment and a fresh stabilized-source rehearsal remain
required before the late-C capture. Current schema version 1 is not automatically
valid for future contract projections.

## October 28 tooling release

PR #386, `cc7db8dc`, released after CI40755921705 passed: Linux 2,892 passing checks (two unrelated skips), Windows 2,496 (33 environment-dependent skips), builds and contract suites. The new PostgreSQL concurrency check **executed and passed on Linux**. Production deployment7395560251 succeeded. B05/B4 current-schema tooling readiness is complete; the final capture and independent durable-copy gate remain C16.
