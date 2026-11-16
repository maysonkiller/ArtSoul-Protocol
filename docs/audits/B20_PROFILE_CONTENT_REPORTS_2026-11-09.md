# Profile-content reports and reversible public masking

Status: production migration, deployment, intake activation and the owner-authorized
report/review/mask/restore/participant-notification cycle accepted November 16.
The live cycle exposed and verified a separate notification read-state correction
linked below. This bounded B20 acceptance does not close the remaining Phase B gates.

## Implemented scope

Profile visitors can submit a `profile_content` complaint through the existing
report pipeline. The authenticated reporter must match `X-ArtSoul-Wallet`;
the normalized target is `profile_wallet`, without a synthetic artwork or chain
identifier. Existing categories, good-faith declaration, rolling wallet quota
and duplicate handling remain in force across all report types.

The database captures the target's public profile content and its SHA-256 hash
atomically. Caller-supplied snapshots and hashes cannot select the evidence.
The snapshot contains public names, biography, avatar and social-link display
fields, including derived connection flags and the public Discord URL. Raw
OAuth IDs, email addresses and credentials are excluded from complaint evidence.

Existing authorized staff review the captured content with the existing
hide/dismiss/reopen/restore actions. Decisions retain report-version checks,
per-target serialization, audit events and participant notifications. Hide and
reopen reject changed profile content; an old report cannot hide an unreviewed
replacement. Dismissal and resolution of historical reports remain possible.

An actioned report masks public content only while its captured hash matches the
current profile. Independent actioned complaints keep identical content hidden
until the final applicable complaint is resolved. Original profiles, OAuth
links, wallet identity, artwork ownership and historical uploads are preserved.
Changing content does not delete an earlier complaint or its audit record.

## Public and private read boundaries

The service-only `public_profile_content` view evaluates current content and
matching actioned reports in one database snapshot. It masks names, biography,
avatar, public social fields and OAuth-ID inputs to the public serializer.
Public profile, artwork identity, donation and search readers use this view;
search matching also uses masked identities. Exact wallet/artwork references
remain available without exposing hidden profile names.

The migration revokes direct `profiles` access from `PUBLIC`, `anon` and
`authenticated`. Private evidence, visibility context and mutation functions
remain service-only. An authenticated owner can read their original fields
through `/api/profile` for editing, with a matching wallet header; those
originals stay in the editor and do not populate the public profile summary.

Public identity responses use `private, no-store`. Cached artwork lifecycle
snapshots refresh their public identity fields rather than reusing old names or
avatars after a decision. Existing browser/page caches may still retain content
already downloaded until refresh; immediate cross-client invalidation is not
implemented or claimed.

`ARTSOUL_PROFILE_REPORTS_ENABLED` gates new intake through the existing reporting
configuration. Public masking remains active independently of intake flags or
the daily limit. The projection migration must precede deployment of readers
that require it; switching intake off must not expose actioned content.

## Verification

The focused backend run passed 60 tests with no failures or skips:

```text
node --test --test-concurrency=1 test/profile-content-moderation-api.test.mjs test/profile-content-moderation-rpc.test.cjs test/donation-moderation-api.test.mjs test/artwork-report-intake.test.cjs test/moderation-notifications.test.mjs
```

The disposable PostgreSQL cases exercise concurrent quota/deduplication,
independent complaints, stale versions, a profile edit holding the row lock
while review waits, rollback on audit/notification failure, exact restoration,
browser-role denial, masked search and existing artwork/donation RPC behavior.
The migration can be applied twice without deleting evidence or active masks.
The existing durable `REPORT_SUBMITTED` email path is reused; no new mail service
or automatic moderation decision is introduced.

A read-only production backup was restored into an isolated local database.
The complete restoration verified 115 tables, 640,817 rows and 1,316 security
declarations. The profile-content migration was then applied twice to that
restored database. This is full-data rehearsal evidence, not live migration or
production acceptance. The owner-held private record is
`protocol-2026-11-09/db-restore-1794259655322-a645c6a3/evidence.json` under the
existing `.artsoul-recovery` directory; its database contents are not public.

The rehearsed migration SHA-256 is
`397a3cd638d1b57be5b938749cdc8a0d0cc7618512c2afa0415a81dfcd434e10`.
The archive represents its recorded snapshot, not later writes; Storage object
bytes are outside the PostgreSQL archive. The read-only 21:35 UTC live preflight
still found 11 profiles, eight reports and no public projection view. Existing
advisories (one security-definer view and 17 function search-path warnings) are
not resolved or declared clean by this bounded change.

## November 16 production release

PR #484 merged as `5d59398c`. Candidate CI passed on Linux (4,305 unit passes,
two skips) and Windows (3,591 unit passes, 36 skips), plus 55 contract tests on
each platform and build/static checks. A second independent code review found
no blocking defect in public-reader coverage or wallet/session binding.

A fresh archive was restored offline before live migration: 115 tables,
783,661 rows, all 115 COPY digests, 22 sequences and 1,314 security declarations
matched. The same migration was applied twice with unchanged source data.
Private evidence: `protocol-2026-11-16/db-restore-1794827841560-208ca87e/evidence.json`.
The first rehearsal attempt stopped at a local stdout buffer limit; writing the
150,668,022-byte verification dump directly to a private file fixed that tooling
limit without weakening parity assertions. Both containers stopped. The source
archive's existing `realtime.messages_payload_exclusive NOT VALID` constraint
was retained; no validation or removal is claimed.

The migration above was applied to the Protocol project on November 16.
The subsequent live read preserved all 11 profiles, eight reports and the
profile-content checksum; the projection returned 11 profiles with zero masks.
Both new views use `security_invoker=true`; raw profile reads by anon/authenticated
and direct anon projection reads are denied while the service view remains
readable. Security-advisor findings are unchanged after excluding timestamps.
The pre-existing view and function-path findings remain separate follow-ups.

Initial production deployment `dpl_CstMP61eq7ma83K2SNKkppARGovm` passed public
profile/search/artwork, unauthenticated private-route and direct anonymous REST
denial checks before intake activation. `ARTSOUL_PROFILE_REPORTS_ENABLED=true`
was then set for production and the same commit redeployed as
`dpl_ExZ3Dh7nCuj6yu36bmV9riaE94G8`. It is READY with the normal-domain aliases.
The nine checks passed again on `artsoulprotocol.com`, with the public flag true.
Existing reporting quota, staff factors and notification delivery are reused;
no new service or paid tier was enabled.

The released profile form opened and Cancel closed it without a report write.
Responsive inspection found a missing native-dialog centering class; the
follow-up reuses the existing `artwork-moderation-dialog` geometry and backdrop.
PR #485 released that correction as `40a37be2`; deployment
`dpl_Amx47MmM9Wy3CycnshWAo9tb2KEV` is READY on the normal domain. Linux/Windows
CI and build/static checks passed. Chrome verified the live form at 1536×720
(560×676 dialog) and 390×844 (343.4×685.25 dialog) in Future. Classic at 390×844
was centered at approximately (15.9,78.6), measured 343.4×686.85, had no
horizontal overflow, `animation: none` and zero transition duration. Both Cancel
and focus return worked. The viewport override was reset and Future restored.
These are responsive-browser checks, not physical-iPhone acceptance.

The owner authorized a clearly labeled TEST report and reversible review cycle
on the owner-controlled lys profile. During sign-in Rabby exposed lys, and the
form closed on account change; this alone did not prove whether an earlier
request had reached the server. After the owner selected the founder wallet,
submission returned `Report already received`. The read-only server check found
one pending TEST record at `2026-11-16T11:38:39.216573Z`, category `other`, from
the founder wallet to lys, reference `33b154ce-33bc-454b-82dd-50a1496c7b69`.
The receipt verifies deduplication, not a second complaint.

The owner then completed normal staff passkey verification. The protected review
UI recorded the TEST hide at `11:43:44.013947Z` and restoration at
`11:44:46.531572Z`. Fresh browser loads showed the neutral avatar/wallet label,
no biography or social links while hidden; both existing works remained visible
with wallet-based creator labels. After restoration the original lys avatar,
name, biography, X link and creator labels returned. No financial action or
artwork mutation was performed.

Read-only initial/hidden/restored snapshots verified the original content hash,
exact public masking and restoration, five expected audit events and four
recipient notices (reporter actioned/resolved; owner hidden/restored). The
notification email was provider-accepted in one attempt, with no delivery error;
provider acceptance alone does not prove mailbox receipt. The private record is
`docs/private/b20-actual-cycle-2026-11-16.json`.

The founder's actual notification panel displayed both report decisions, linked
to the correct profile, and marked each read when expanded. The owner then
selected lys and completed normal sign-in. Both owner notices were visible and
linked correctly, but their initial read mutations returned HTTP 409. The
[bounded read-state correction](B20_PROFILE_NOTIFICATION_READ_STATE_2026-11-16.md)
added the omitted profile types to the existing summary/read/remove allowlists.
After its verified live application, both actual owner clicks returned HTTP 200,
the panel displayed `Read`, and the unread badge decreased from four to two.
All four cycle notices were independently confirmed read and not dismissed.
This completes the designated participant-notification acceptance without
impersonating a session or marking notices through privileged database writes.

The exact-reference search in the connected Gmail mailbox returned no result;
mailbox receipt is not claimed and this is not evidence of delivery failure.
The existing mail-worker acceptance is unchanged; provider acceptance for this
report remains separately recorded.

A separate edge fix requires a stored profile ID before offering or retaining
the report dialog; a bare wallet-only fallback profile has nothing to report.
Ten rendered UI tests and the production build pass locally. PR #487 merged as
`23d36f3a` after Linux/Windows/static and deployment checks passed; no new
dependency was added.

## Remaining work

- Keep historical unused-cover uploads until the owner selects a retention
  policy. Separate covers/customization remain paused; no deletion schedule or
  broader profile editor is activated by this work.

The existing staff authority and factor policy, financial mechanics, contracts
and wallet write-network guards are unchanged. Prior accepted financial
transactions are not replayed for this acceptance.
