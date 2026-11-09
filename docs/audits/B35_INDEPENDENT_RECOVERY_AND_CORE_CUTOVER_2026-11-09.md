# B35 — Independent recovery and Core worker activation

Status: independent encrypted recovery, owner key custody, fresh archive
restoration, the five reviewed migrations and the Core-only worker cutover
are verified. This closes those deployment prerequisites, not Phase B's
representative cost, device, signed-journey or real-cohort acceptance.

## Independent recovery

The November 9, 12:57:09–12:57:40 UTC read-only backup targets only Protocol
project `bexigvqrunomwtjsxlej`. No ArtSoul OS database or storage was changed.
The custom database archive is 58,406,971 bytes, SHA-256
`092e83db8bf37970c632327dec23589cd76827f1e46868150a806453a59a7779`.
It contains 113 tables / 632,787 rows and 1,279 security declarations.
All 159 Storage objects (115,603,645 bytes) match the earlier verified local
originals by identity, version, size, ETag and content digest; unchanged bytes
were reused rather than downloaded again from Supabase.

Database, objects, inventories, role/extension metadata and restoration notes
form a 168-file bundle. The AES-256 encrypted archive is 175,204,437 bytes,
SHA-256 `2fe0f6987b99c3795423bc2698e6a637b2c0368b683d4305668ac4435ab5db30`.
It is stored on the existing Hetzner indexer host, independently of this PC,
with a root-only directory and mode-0600 archive/receipt. The recovery key is
absent from the server, repository and bundle. The owner confirmed saving it
in Google Password Manager and checking access from an iPhone.

The server copy was downloaded, decrypted and checked against all 168 file
digests. Incorrect-key and modified-ciphertext attempts failed. Its database
archive was restored into an isolated, network-disabled instance using the
already-installed pinned Supabase PostgreSQL image. All table COPY digests,
sequence state and 1,279 security declarations match; no invalid index was
found. The container was stopped after verification. A second fresh restore
passed the ordered five-migration rehearsal, including transactional rollback,
commit, original-data preservation, effective role privileges and replay checks.

This is point-in-time disaster recovery, not continuous backup or Snapshot A.
Snapshot A remains deferred to the final public testnet. Loss of both this PC
and the existing server is outside this two-location recovery evidence.

## Applied migration batch

At 13:18 UTC the existing worker was stopped and these exact reviewed files
were applied in one transaction, using the existing database owner role:

| Migration | SHA-256 |
| --- | --- |
| `20261029212603_notification_reorg_identity.sql` | `7c77d9093fb0bbd44b6866fd73f5e52dba025d799714911e024a477171ecbc1c` |
| `20261029220854_recovery_cache_obligation.sql` | `0663314b7b73f77e6bc4c899b361655eaaf6650174cca15e1dc9be215b4431e8` |
| `20261101120000_nft_transfer_coverage.sql` | `f5fdaf539284819f5d0d8f60178167175cc7b520c633008ef69b746525b1b472` |
| `20261101130000_verified_nft_owners.sql` | `6d36e0613f4f96eaf0e43e850e6c9d15303aa9e5fbf0a22dc95faaa611ed2d51` |
| `20261101140000_verified_nft_history.sql` | `ec5e40cc2bae56a9677a85cf0e8de10b57aabeefe3efe6690b6aad626d3cdf36` |

Cursor and event counts were unchanged by the transaction. This is an explicit
manual deployment record; no historical migration ledger was fabricated.
NFT coverage has forced RLS, no anonymous/authenticated SELECT, and no
service-role INSERT/UPDATE/DELETE. All four verified NFT reader functions deny
anonymous/authenticated execution and permit only the service role.

## Existing server activation

The 27-module runtime closure matches pinned candidate
`f1484c7b5079e9c9b0fff422a54c3c1edc168f92` and the same modules in current main.
Syntax/import checks passed with the host's existing Node and dependencies.
Old runtime files, manifests, launcher and package metadata were preserved
before replacement. No dependency installation or new server was needed.

The existing `artsoul-base-sepolia` PM2 process now runs the reviewed Core
worker. Chain 84532, Core address, three-block confirmation depth and recorded
event history are unchanged. Both `ARTSOUL_NFT_TRANSFER_INDEX_ENABLED` and
`ARTSOUL_NFT_OWNERSHIP_ENABLED` remain false. No Redis connection is configured.
The recovery purge obligation therefore remains pending by design: the worker
does not acknowledge a purge that never happened. Configuring Redis or enabling
NFT consumers still requires their transport/coverage/recovery acceptance.

**Do not restart the older B30 worker against this committed schema.** Preserve
new evidence and use a reviewed compatible forward repair, or the complete
restore/recovery procedure in the migration runbook. A code-only downgrade is
not an established rollback.

## Freshness policy and observed health

The temporary 15-second poll configuration was rejected and the existing
2,000-ms interval restored. Before changing the health policy, seven bounded
observations at 13:25 UTC showed 13–29 blocks of lag, advancing at approximately
five blocks per second, with no unresolved or RPC errors. This establishes
bounded processing delay, not a growing backlog.

[Base's Denim documentation](https://www.base.org/blog/denim) describes canonical
200-ms blocks instead of the previous two-second blocks. Twenty blocks now
represent approximately four seconds rather than forty. The November 9
operational decision uses the existing configuration override to require lag
strictly below **50 blocks**, nominally **10 seconds**, on this host and its
checker. No repository fallback, confirmation depth, finality or monetary
policy was changed. This is stricter in elapsed time than the pre-Denim
40-second boundary; the actual observations are retained rather than relabeled
as zero lag. A sustained failure still requires investigation.

Seven observations at 13:33:25–13:34:09 UTC reported lags of
26, 22, 28, 23, 20, 16 and 12 blocks: all healthy and synchronized under this
explicit policy, with zero unresolved/RPC errors. Confirmed and indexed
cursors both advanced from 56,546,658 to 56,546,888. The legacy Ethereum
Sepolia cursor and its three events remain unchanged; Base retains 218 events.
The isolated monitor/policy/error-state suite passes all 17 tests.

At 13:37:49 UTC the standalone monitor on the host passed all invariants with
the matching 50-block override, recording lag 25 and no failures. At 13:38:09
the final source/configuration/grant check again passed, with lag 23 and all
27 module digests matching. PM2's process list was saved and the protected
activation journal marked `CORE_CUTOVER_VERIFIED`.

Four normal-domain checks after cutover returned populated HTTP-200 artwork,
provenance, search and profile responses without fallback warnings. Together
they transferred 18,486 response bytes. They are functionality checks, not a
latency/load benchmark or proof of future provider quota headroom.

The 13:34:42–13:38:09 statement-counter comparison retained the same reset
marker. The active server-side digest returned 53 rows for 53 calls; the old
full-history transfer signature increased by neither calls nor rows. Three
bounded hash-range reads returned 36 rows. This verifies retention of the
egress fix across cutover. Database temporary bytes rose by 23,579,086 during
that interval; neither the digest nor those range reads recorded temporary
blocks. That growth is not reported as billed egress or attributed to the
worker without matching evidence.

## Evening follow-up: sustained operation

Read-only snapshots at 13:43:53 and 20:27:56 UTC span 6 hours 44 minutes.
The same process remained online, with unchanged restart count and all 27
reviewed module digests matching. Its indexed boundary advanced by 121,213
blocks and six events; the final observation was healthy and synchronized,
12 blocks behind, with zero unresolved event errors or recent RPC errors.
Legacy Ethereum Sepolia history remained unchanged. Recovery receipt permissions
and restricted NFT reader grants also remained correct.

Statement reset markers were unchanged. The old full-history transfer query
recorded **zero additional calls or rows**. The active server-side digest
returned 6,639 rows across 6,639 calls, and bounded hash-range reads returned
4,824 rows across 402 calls. None of those tracked queries wrote temporary
blocks. Database-wide counters nevertheless increased by 506 temporary files
and 1,717,537,706 temporary bytes. This longer window does not attribute every
byte; the separately traced managed-exporter issue remains awaiting provider
correction. Cumulative temporary work is not stored artwork size or billed
egress.

At 20:33 UTC, the same four bounded production API probes returned HTTP 200:
artwork data without warnings, four provenance events, five search results and
a populated profile. They transferred 18,486 response bytes in total. This
extends operational evidence without claiming a load benchmark, monthly cost
ceiling or native-device acceptance. No configuration or data was changed.
Private evidence: `b35-live-check-1794231833298.json`,
`b35-live-check-1794256076399.json` and
`b35-public-evening-2026-11-09.json` under `docs/private/`.

## Remaining boundaries

- Representative IO, temporary-file and provider-egress observation remains
  open. A short successful deployment does not prove a sustainable monthly cost.
- Denim also changes the elapsed duration of three confirmations. The next
  contract/finality review must evaluate that separately; this operational
  change does not claim three blocks are Ethereum finality.
- Native iPhone/Phantom acceptance, remaining signed assistant journeys and
  the final-contract public cohort retain their existing gates.
- Spend Cap stays enabled; no paid capacity, API plan, mainnet write or new
  financial parameter was activated.

Private evidence comprises the dated backup receipt, restore/rehearsal reports,
activation journal and bounded health/privilege snapshots. They are retained
outside version control; archive contents, credentials and personal records
are not included in this public report.
