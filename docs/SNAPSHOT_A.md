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

The capture query applies the inclusive cut-off directly to each table's
`TIMESTAMPTZ` column. New captures retain six fractional digits in UTC so the
offline verifier can compare the recorded times at PostgreSQL precision.
Previously exported version 1 files remain readable at their recorded precision.
A reader cannot recover discarded microseconds from an older file.

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
The verifier rejects damaged UTF-8 and prints the root, cut-off and counts
from the manifest it checked. The result describes the bytes read during that
run. Reverify the durable copies against the retained root immediately before
reset, even if their filesystem modification dates appear unchanged.

When a trusted root is supplied, the directory must contain the nine regular
files listed above. Additional files and subdirectories fail the check before
upload or after retrieval. Store the verifier kit, notes and retrieval receipts
beside the archive directory. The plain consistency check remains available
for inspecting the listed files in older mixed directories.

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
node scripts/export-snapshot-a.mjs --chain-id 84532 --out ../snapshot-a --cut-off <ISO-8601 UTC>
```

New captures target Base Sepolia (84532). The explicit chain option takes
precedence over `ARTSOUL_INDEXER_CHAIN_ID`; when both are absent the exporter
uses 84532. The CLI checks the chain, calendar date and options before opening
the database connection.

A November 20 rehearsal on an isolated PostgreSQL 18.4 server captured the
Base Sepolia row exactly at a leap-day cut-off expressed as a numeric UTC
offset. A row one microsecond later and a Base mainnet row were excluded.
The exported archive verified offline against its capture root.

Needs `DATABASE_URL`, a cut-off with an explicit time zone (UTC `Z` or a numeric
offset and up to six fractional digits), and a new output directory inside an
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

**5. Verify both durable copies against the independently retained capture root.**
Immediately before cutover, retrieve the complete export from each provider into
its own new directory. Use the offline verifier from the reviewed kit.

```bash
node scripts/verify-snapshot-a.mjs /restore/provider-a --second-copy /restore/provider-b --expected-root TRUSTED_CAPTURE_ROOT --announced-cut-off ANNOUNCED_ISO_TIMESTAMP
```

The command reads both restores and succeeds only when each matches the trusted
root. It reports the chain, cut-off, counts and root for each valid copy, and
rejects reused files, including directory aliases and detectable hard links.
Supply the cut-off from the original public announcement. The verifier checks
that the time has arrived and that both archives identify Base Sepolia and
the same instant down to one microsecond. Equivalent time-zone offsets match.
This also catches an earlier rehearsal archived together with its own root. Save the
command, exit status, output and the provider's object or version identifier
for each retrieval. Two local directories alone cannot establish independent
remote custody. On separate recovery machines, run the single-copy command
from step 3 on each and retain both results against the same trusted root.

**6. Record in the migration runbook:** the cut-off, the root hash, both
locations, and the verification result from each. Bible section 16 point 2 asks
for the verification result and the export schema, and this file is the schema.

**7. Only then** does the destructive reset proceed. Snapshot A is never
re-imported as live product state.

## Verify the product database before the first mainnet publication

After the reviewed cutover, check both the candidate site's public responses
and its indexer database from the same operator session. Set
`ARTSOUL_CUTOVER_DATABASE_URL` privately to the intended database connection.
Use an existing operator role with unfiltered read access. Keep credentials
out of command arguments and verification records.

```bash
node scripts/verify-mainnet-catalog.mjs <candidate-origin> <reviewed-core-address> <deployment-block> --database
```

The command compares the database cursor with the reviewed Base mainnet Core
and deployment block, then checks for residual product rows, including retired
auction tables, bids, withdrawals, floor history, trust signals, eligibility,
settlement evidence and the counters backing public metrics. A mainnet metrics
row containing zero activity is permitted. Unrelated or pre-deployment chain
events fail the check. The database reads use one read-only, repeatable-read
transaction. Insufficient visibility, missing tables and unavailable services
cause the command to fail. It reports table names without printing row data.

Retain the result with the public catalog check and verify both restored
Snapshot A copies again after the cutover. Also verify browser configuration,
legacy media storage and cache behavior against the release candidate. A quiet
database sampled before writers are switched does not prove the launch state.

## Verifying a copy years later

Prepare the offline verifier once from a reviewed Git commit. Run the builder
in the development checkout with a full commit ID and a new directory alongside
the archive. It reads the committed verifier and schema module from local Git,
adds a minimal module declaration and writes their byte hashes to `SHA256SUMS`.
This step can be rehearsed before the final capture or a database is available.

```bash
node scripts/package-snapshot-a-verifier.mjs REVIEWED_COMMIT ../verification-tools
```

Record the printed commit and `SHA256SUMS` digest independently of the kit.
Keep the archive's separate trusted root from capture step 2. Copy the kit
alongside each durable archive. To check a recovered copy, change into its kit
directory and compare the first command's digest with the recorded kit digest
before checking the three files and running the verifier.

```bash
sha256sum SHA256SUMS
sha256sum -c SHA256SUMS
node scripts/verify-snapshot-a.mjs /path/to/copy --expected-root TRUSTED_CAPTURE_ROOT
```

In PowerShell use `Get-FileHash -Algorithm SHA256 -LiteralPath SHA256SUMS`
for the first comparison. Compare the three hashes from
`Get-FileHash -Algorithm SHA256 -LiteralPath package.json,scripts/verify-snapshot-a.mjs,src/snapshot/snapshot-a.js`
with the matching paths in the checked `SHA256SUMS`. Stop on any mismatch.
The recovered machine needs Node and a trusted hash utility. The kit runs
without the source repository, npm, a wallet or a database connection.

The November 18 rehearsal packaged verifier commit
`c1d1687d99eb88b404d71e239a9c1013a9ece670`. Its `SHA256SUMS` digest was
`331fc893346975ddf75ac1949150883bc1f639450f5bc78d003b811107b6c965`.
The operator checked all three packaged files against that list on Windows.
Retain a fresh reference to the reviewed kit alongside the final capture record.

The verifier exits non-zero when either restored copy fails. It reports both
results even if one restore is missing. Retrieve a fresh copy from the
corresponding durable source and repeat the check.

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

On November 18 the three snapshot suites passed 29 local checks, including the
PostgreSQL 17 integration test. Across all seven tables, the test included the row
at the cut-off and excluded the one a microsecond later under a different session
time zone. The offline verifier also rejected a later row in an otherwise
internally consistent fixture. For legacy unzoned cut-offs, verification retains
the existing hash and structural checks. These results use synthetic test rows.
The final cut-off and the verification of both durable locations remain open.

## October 28 tooling release

PR #386, `cc7db8dc`, released after CI40755921705 passed: Linux 2,892 passing checks (two unrelated skips), Windows 2,496 (33 environment-dependent skips), builds and contract suites. The new PostgreSQL concurrency check **executed and passed on Linux**. Production deployment7395560251 succeeded. B05/B4 current-schema tooling readiness is complete; the final capture and independent durable-copy gate remain C16.
