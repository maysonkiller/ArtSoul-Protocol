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
| `floor_history.json` | Canonical floor changes and their source |
| `participants.json` | Every address that took part, lowercased, deduplicated, sorted |
| `manifest.json` | Schema version, chain, cut-off, entitlement notice, counts, per-file hashes, root hash |

Every row carries `indexed_at`, so a reader can place each event in time without
another source.

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
`root_hash` covers the manifest body itself — so editing a file *and* its entry
in the manifest still fails, because the root hash no longer matches.

Output is deterministic: object keys are sorted, rows are sorted by their own
content, and every file ends with a newline. Running the export twice against the
same cut-off produces byte-identical files and the same root hash. That equality
is the cheapest evidence the capture is sound, and a disagreement between two
runs is indistinguishable from tampering — which is why it is a hard property
rather than a convenience.

## Capture runbook

Run this on the announced cut-off date, before any destructive step.

**1. Export.**

```bash
node scripts/export-snapshot-a.mjs --out ../snapshot-a --cut-off <ISO-8601 UTC>
```

Needs `DATABASE_URL`. The output goes outside the repository and is never
committed: it is a data export, not source.

**2. Export again to a second directory and compare the root hashes.**
They must be identical. If they differ, stop — the capture is not reproducible
and nothing downstream can be trusted.

**3. Verify in place.**

```bash
node scripts/verify-snapshot-a.mjs ../snapshot-a
```

**4. Copy to two independent durable locations.** Independent means different
providers, not two buckets in one account: the point is surviving the loss of any
single one.

**5. Verify each copy in its own location.** A copy nobody has verified where it
lives is a copy nobody has verified. Record the root hash from each.

**6. Record in the migration runbook:** the cut-off, the root hash, both
locations, and the verification result from each. Bible section 16 point 2 asks
for the verification result and the export schema, and this file is the schema.

**7. Only then** does the destructive reset proceed. Snapshot A is never
re-imported as live product state.

## Verifying a copy years later

Everything needed is in the directory:

```bash
node scripts/verify-snapshot-a.mjs /path/to/copy
```

The verifier exits non-zero and names every problem it finds rather than stopping
at the first, so two damaged copies can be compared in a single pass. If a copy
fails, fetch another durable copy and verify that one. Never repair a copy by
hand — a hand-edited snapshot is no longer a record of anything.
