# A8 Moderation Rollout Order

Status: implementation and activation plan. This runbook coordinates the
A8a/A8b/A8c foundations and the disabled A8d Safe recovery foundation.
It does not amend protocol architecture or economics.

## Application addendum — 2026-09-30

The exact reviewed A8a, A8b, A8c and A8d migrations have committed in order,
one transaction each, under founder authorization. This supersedes their earlier
unapplied status; it does not activate the features. The dormant schema has
eight tables, seven service-only RPCs and five protected identity sequences,
with zero new feature rows at verification. All three feature flags remain
disabled; no staff role, bootstrap grant, enrollment or recovery was created.

Full and schema-only backups were retained with verified hashes, and the full
custom archive was readable. This was not a database restore drill. The
historical migration ledger remains absent; no historical baseline was invented.
The operation has a separate checksum-bound application journal. See
[the A8 schema evidence record](../audits/PHASE_A_A8_SCHEMA_2026-09-30.md) and
the dated record in `security/MIGRATION_RUNBOOK.md`.

RG-03 activation, real passkey enrollment, Safe recovery and production workflow
acceptance remain open. The September 29 Phase C scheduling deferral is preserved.

## 1. Build now, behind disabled flags

Complete A-22 without exposing production authority:

1. Add a dedicated Protocol Admin page for the reports queue, hidden-content
   review, notifications and append-only action history.
2. Add a `Protocol Admin` item to the shared account dropdown only after the
   server confirms an active staff role for the current SIWE wallet.
3. Require the A8a passkey step-up before the page returns protected data or
   accepts a moderation action. The step-up session remains 15 minutes.
4. Re-check SIWE, active staff role and passkey step-up on every protected API
   request. A hidden link, route name or client-side flag is never an
   authorization boundary.
5. Group related complaints only for queue presentation. Preserve every
   reporter's independent report and event record.
6. Keep critical or irreversible actions behind the approved multisig path.
7. Add deterministic concurrent status transitions, stable client errors,
   untrusted-text rendering, keyboard focus trapping and integration tests.

The public Report button and all staff authority remain disabled throughout
this stage.

## 2. Prepare the activation resources

Prepare these resources for live activation; they are not prerequisites for
the separately authorized dormant schema stage in section 3:

1. Connect and verify the final project domain and WebAuthn RP ID.
2. Identify the Safe-only founder recovery prerequisites in
   `A8D_SAFE_RECOVERY.md`; configuration and rehearsal follow the ordered live
   activation stage below.
3. Review the A8a, A8b, A8c and A8d migrations and their backup/catalog evidence.
4. Plan each moderator's least-privilege role and individual passkey enrollment.
   Do not assign roles during schema preparation or store private staff wallet
   assignments in source.

These steps follow `RESOURCE_GATED_WORK.md`,
`runbooks/A8A_PASSKEY_FOUNDATION.md`, and
`runbooks/A8D_SAFE_RECOVERY.md`.

## 3. Prepare the database, then activate the deployment

### Dormant schema preparation

Explicit founder authorization may permit this stage while RG-03 activation
remains blocked. Follow `security/MIGRATION_RUNBOOK.md` for the complete
catalog, checksum, backup and rollback procedure. Consult the dated application
addendum above first; do not repeat the completed production migrations.

1. Verify the target database and approved checksums; create and validate a
   full backup and a schema-only export, then reconcile the prerequisite catalog
   and migration record. Do not infer historical migration status from names.
2. Confirm `ARTSOUL_MODERATION_PASSKEY_ENABLED`,
   `ARTSOUL_PROTOCOL_ADMIN_ENABLED` and `ARTSOUL_REPORTING_ENABLED` remain absent
   or false. Keep Safe configuration unchanged. No staff-role assignment,
   bootstrap grant, enrollment, report/review/recovery call or visibility change
   belongs to schema preparation.
3. Apply, in order and one transaction each,
   `sql/migrations/a8a_moderation_passkey_foundation.sql`,
   `sql/migrations/a8b_artwork_report_intake.sql`,
   `sql/migrations/a8c_protocol_admin_review.sql`, and
   `sql/migrations/a8d_moderation_safe_recovery.sql`. The operator must wrap each
   file in an explicit transaction and stop/roll back on error; the files have
   no wrappers. Never route these feature files through the indexer runner.
4. Verify each stage before proceeding, using its matching read-only A8 file
   and `sql/verification/phase_a_security_verification.sql`. Retain catalog,
   aggregate-count and checksum evidence privately. Confirm forced RLS,
   service-only access, fixed RPC `search_path`, empty newly created tables,
   unchanged disabled flags and healthy public reads. An empty recipient inbox
   is not proof of notification delivery or completion of moderation acceptance.

### Live activation

RG-03 remains required before activating the dependent authority. The September
29 deferral of real passkey/Safe ceremonies to Phase C does not permit a bypass.
The Protocol Admin implementation must pass its local acceptance first; it need
not already be operational in production to prepare the schema.

1. Complete the final-domain/RP and other RG-03 activation prerequisites from
   `RESOURCE_GATED_WORK.md`, including the required apex-origin evidence.
2. Configure the final RP ID/origin/name, dedicated moderation-session secret,
   exact Safe/chain and two independent recovery RPCs. Enable only
   `ARTSOUL_MODERATION_PASSKEY_ENABLED`, confirm the authorized active founder
   role, and create the one-time auditable bootstrap grant. Enrol and verify
   two independent founder passkeys, then complete the Safe recovery rehearsal
   and all 11 mandatory denials in `A8D_SAFE_RECOVERY.md` section 6. Preserve
   the final RP/origin evidence; destructive fault injection belongs only in
   the isolated rehearsal environment.
3. Enable `ARTSOUL_PROTOCOL_ADMIN_ENABLED=true`, redeploy, and complete the
   protected admin acceptance checklist while public reporting remains off.
4. Set `ARTSOUL_REPORT_DAILY_LIMIT=5` and only then enable
   `ARTSOUL_REPORTING_ENABLED=true` for the controlled beta.
5. Redeploy and allow the public-config cache to expire.

Five new reports per reporter wallet across a rolling 24-hour window is the
approved controlled-beta starting value. It may be tuned later from observed
queue volume without changing protocol economics.

## 4. Production acceptance

Verify all of the following before declaring A8 complete:

- ordinary and disconnected users never see the Protocol Admin entry;
- manually adding the entry in browser tools grants no access;
- an eligible staff wallet sees the entry only after server role confirmation;
- the admin page exposes no protected data before passkey step-up;
- the 15-minute step-up expires and requires re-verification;
- the same wallet/artwork/category pending complaint deduplicates to one report
  and one event;
- two different reporter wallets create two independent reports and events;
- the sixth new report from one wallet inside 24 hours returns HTTP 429;
- report submission alone never hides an artwork;
- valid-claim hide/unhide decisions create immutable staff audit evidence;
- concurrent staff decisions resolve deterministically without lost history;
- notification failures do not corrupt the review decision;
- disabling any relevant feature flag fails closed and preserves stored evidence.
- resolving one of several actioned reports does not expose the artwork until
  the last actioned report for that artwork is resolved;
- an actioned report cannot be reopened, and reopening a closed report is
  rejected while a newer pending duplicate from the same reporter and
  category exists;
- `REPORT_RESTORED` and the creator's `ARTWORK_RESTORED` notification appear
  only when a resolution actually returned the artwork to public visibility.

## 5. After controlled-beta observation

Review queue volume, duplicate patterns, false reports and response time. Keep
the limit at five unless observed evidence supports a change. Any new abuse
control must preserve privacy, individual report evidence and the rule that
submission count never determines a moderation outcome.
