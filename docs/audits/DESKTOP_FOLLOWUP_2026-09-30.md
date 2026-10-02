# September 30 desktop follow-up

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`, starting revision
`4e67451617be3bf96dc814026d45243f82f1b2b7`. The single checkout remains canonical.
No historical worktree was copied or merged into it. A recovery patch and new-file
archive are retained privately under `output/recovery/desktop-173100-20260930-184135`.

## Evidence and scope

The new 17:31 desktop recording is 252.90 seconds, 1920x1080, SHA-256
`91902a2fa6d51624a6960235168d41d3299bf825dd3f8a8267170a53dd7ff370`.
All 126 two-second samples were reviewed. Offline speech recognition assisted
navigation; its output is approximate, not a verified quotation.

Observed: redundant connected qualifiers and a manual X editor; X unlink/relink,
Cancel and navigation; a non-clickable Discord identity; bounded but visible page
loads. The recording is evidence for those desktop actions, not every phone,
wallet-signature, lock/reload or moderation acceptance gate.

The founder explicitly excluded AI valuation. Its client/test Git blobs remain
`46e7139f352f3102cadb83e46f009291f855406c` and
`2f31e85095533e5c55e2181488c4cb7767a67b17`. No AI authorization or valuation UI
change was restored. Existing auction economics and deployed Core/NFT code and
storage are unchanged.

## Reproductions and repairs

| Area | Cause and local repair | Regression evidence |
| --- | --- | --- |
| Social display | Remove the two redundant qualifiers and manual X editor. Preserve existing public-link data and OAuth-only identity proof. Derive a validated Discord profile URL server-side. | Profile identity, API and browser checks; ordinary PUT still cannot fabricate provider proof. |
| Private email | Add wallet-authenticated private mailbox verification, rather than treating typed text as proof. Single-use 15-minute token, hashed storage, atomic consumption, revision fencing, quotas and owner-only UI. Same-document links and A-to-B-to-A wallet transitions were reproduced and fixed. | Actual handler/client tests, real disposable PostgreSQL, built browser request/confirm/reload/disconnect/error and privacy checks. External delivery is not claimed. |
| Gallery load | The gallery feed started only after the page module. Reuse the existing exact-query head prefetch and one-consumer handoff. | Four controlled runs: mean first-card time 2188.95 to 1273.40 ms, one feed request per run. This is a local scheduling comparison, not a production percentile. |
| Public entry order | The page entry waited behind legacy ethers/ENS module evaluation. Emit gallery/profile/artwork entries first, preserving earlier classic dependencies. | Matched six-case browser comparison: public content about 1.44-1.46 s before versus 0.21-0.22 s after under the controlled adapter delay. Build verifies actual emitted order. |
| Wallet readiness | `readyState=interactive` was mistaken for completed deferred modules. The shared loader now awaits the actual DOMContentLoaded barrier before starting the SDK, including explicit early connection intent. | Early/late event, failed boot/retry and hidden-tab tests; connected implementation starts after adapter completion in the built comparison. No signature or transaction was sent. |
| Donate | Add the approved separate creator-support contract, exact creator/receipt verification, optional UI, indexed history and anonymity projection. A NUL message could poison PostgreSQL; preserve raw message bytes as hex before event persistence and project only display-safe text. | Combined contract suite, real event parsing and PostgreSQL processing/reorg/idempotency/RLS, API and wallet-adapter checks. No contract deployment is claimed. |
| Report clicks | The legacy global click timer disabled the submit button before its default form action. Use its existing opt-out on these React-controlled buttons, with a synchronous operation guard. | Normal built-browser click plus deferred-auth duplicate and changed-wallet probes. No external complaint was submitted. |
| Message review | Add an explicit donation-message target to the existing report workflow. Review affects only message visibility, with audit, recipient notices and exact indexed staff context. Preserve old artwork RPC signatures and old-schema queue reads. | Typed-target PostgreSQL and API regressions, including independent reports, rollback and old A8 journeys. Live access requirements remain unchanged. |
| Donation dates | Historical logs omitted their timestamp and fell back to processing time. Read the existing chain-scoped block timestamp inside the event transaction and refresh stored timestamps on block replacement. Missing time stops the event for retry. | Three failing historical/reorg/missing-time reproductions now pass in real PostgreSQL; no per-donation RPC or auction-time change. |

The loading mark was not simply hidden. Existing confirmed-auction propagation
still wins over a deliberately stale API round in artwork, gallery and profile.
Legacy optional artwork contract hydration after late wallet restoration is an
existing limitation in both compared versions; it is not falsely attributed to
this change or silently expanded into AI work.

## Delivery and activation boundary

The current checkpoint records the final suite/build/release result. Local tests
and fixture-based browser flows are not real provider, physical-device or live
contract acceptance. This follow-up has not applied its new SQL, sent external
email, deployed a contract or performed a mainnet transaction. The three
separately authorized mail DNS records are present; domain verification and
sender activation are recorded separately from application release.

New email, quota, donation and donation-moderation migrations are additive,
reviewable and **unapplied**. The quota-only migration avoids installing unrelated
Collection Launch tables. The existing four A8 migrations are already applied;
do not rerun them as if missing. See the [migration ledger](../security/MIGRATION_RUNBOOK.md).

Email and donations default off. Disabled email configuration exposes no dead
Connect control. Email activation needs the reviewed schema, configured sender
and a real delivery/confirmation check. Donate activation needs its reviewed Safe,
Core/deployment inputs, indexer configuration, schema and operational
message moderation. Anonymous means anonymous in ArtSoul labels, not on-chain.
Before activation, compare the verified deployment block with the existing Core
cursor. If it has advanced past donation events, perform a bounded idempotent
replay through the existing engine from the deployment block; do not reset or
silently omit the early donation history.

The [dated amendment](../canon/CHANGELOG_2026-09-30_ARTIST_SUPPORT.md) records earlier
implementation of the approved support design and every bounded interpretation;
it does not authorize mainnet or claim the optional fifth contract is deployed.
The [October 3 amendment](../canon/CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md)
subsequently removes the message amount threshold and authorizes current
passkey/recovery setup. Any non-zero donation may carry an optional message.

Phase A remains open for retained device acceptance and operator passkey/recovery
and live moderation gates. Auction 66 was ended and settled on October 2, token 6
was minted with a 0.011 test ETH floor, and the creator withdrew the exact credit.
Both-RPC accounting and eleven public apex browser checks passed; see the
[recorded completion](PHASE_A_TESTNET_2026-09-29.md#october-2-auction-66-completion).
Its follow-up automation was deleted. Do not replay any of those transactions.

Robinhood wallet support and a distinct Robinhood Chain launch target remain an
explicit decision boundary. Official [connection documentation](https://docs.robinhood.com/chain/connecting/)
was checked; a registry entry would not prove contracts, indexer, signing or
mainnet readiness. No operational network selection was changed in this follow-up.
