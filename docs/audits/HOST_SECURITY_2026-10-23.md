# Hosting security maintenance — October 23, 2026

Status: applied and checked on both owner-designated Hetzner servers. This is
hosting/operations work under canon sections 1 and 17, not a contract, economics,
mainnet, schema or application release. The canonical checkout remains
`C:\Projects\ArtSoul`, branch `codex/takeover-audit`, starting HEAD `c6a584e`.
The Protocol website remains the verified PR #331 release, `5f3127c`.

## Findings and applied changes

| Check | ArtSoul OS host | Protocol indexer host |
| --- | --- | --- |
| PHP packages/processes/custom candidates | None found in the bounded inventory | None found in the bounded inventory |
| Node.js package | 22.23.2 → 22.23.4 | 22.23.0 → 22.23.4 |
| Ubuntu zlib package | 1:1.3.dfsg-3.1ubuntu2.2 → 2.3 | 1:1.3.dfsg-3.1ubuntu2.2 → 2.3 |
| Active kernel | 6.8.0-137 → 6.8.0-147 after controlled reboot | Already 6.8.0-147; no additional reboot |
| Final services | API, bot, dashboard and nginx active; watchdog passes | Base Sepolia online; legacy Ethereum Sepolia stopped; report-email timer active |
| Fresh security-package check | No newer installed-package version from refreshed Ubuntu security lists | Official Ubuntu-security dry run: zero upgrades/removals |

The [PHP advisory](https://www.php.net/archive/2026.php#2026-10-21-5),
[Hetzner notice](https://status.hetzner.com/incident/f4144d55-38c3-48d1-8664-7a3429355cd7)
and [Ubuntu PHP backport notice](https://ubuntu.com/security/notices/USN-8948-1)
were checked. No PHP update was necessary for the observed installations.
Inventory covered package records, services, process names, web mappings,
bounded custom binary paths and common container runtimes. It is not a forensic
compromise assessment or a claim about arbitrary dormant files.

The installed Node updates come from the existing signed NodeSource repository;
see [Node 22.23.4](https://nodejs.org/en/blog/release/v22.23.4/). zlib follows
[USN-8954-1](https://ubuntu.com/security/notices/USN-8954-1). The indexer mirror
still offered the older zlib package, so the update used a separate temporary
official Ubuntu-security source/list directory and the existing Ubuntu signing
keyring. Permanent package sources and signature validation were preserved.

Indexer SSH recovery: the authorized-keys file was empty. The owner approved a
dedicated key; its fingerprint was verified in the console and by a fresh SSH
login. Agent/port/X11 forwarding are disabled for that key. Existing file state
was backed up. Root SSH password login is now prohibited; public-key login was
retested after the policy reload. Hetzner console password login remains available.
The temporary console session was logged out. Three empty maintenance connections
were closed only after matching their accepted key and confirming no children.
Final `needrestart` lists no stale services or user sessions on either host.

The indexer's runtime database connection previously lacked TLS. A preflight
with certificate verification correctly rejected an untrusted chain. Using the
existing trusted Supabase CA, `sslmode=verify-full` then passed. The root-only
runtime configuration now uses that CA and strict verification; after restart,
an independent client using the running worker's exact connection settings
reports TLS 1.3, encrypted and authorized. No certificate checks were disabled.
The provider's pooler-to-database leg reports no TLS through `pg_stat_ssl`; this
is distinct from the now-verified host-to-pooler connection and is not claimed
to have changed.

## Indexer cadence and actual verification

[Base's Denim documentation](https://docs.base.org/upgrades/denim/overview)
confirms native 200 ms blocks on Sepolia from October 21. Both existing RPCs
independently returned 100 canonical blocks spanning 20,000 ms. The former
15-second polling interval therefore accumulated approximately 75 blocks per
poll; observed health lag was 77–94 blocks, above the existing strict `<20` gate.

The Base-only host override is now `INDEXER_POLL_INTERVAL=2000`. No cursor reset,
replay, event deletion, confirmation-depth change or threshold relaxation was
performed. The first 16-read series measured 5–20 blocks (one boundary failure).
After the final TLS restart, all 16 reads at 09:32:48–09:33:36 UTC passed:
5–18 blocks, `isSynced=true`, no unresolved event errors and no rolling RPC errors.
The standalone `monitor:indexer` also returned `ok=true`. These are bounded
maintenance measurements, not a long-term latency guarantee or a new permanent
high-frequency monitoring job.

Repository verification: `node --test test/indexer-health-policy.test.mjs
test/indexer-health-monitor.test.mjs test/phase-a-close-out.test.cjs` passes 16/16,
zero skips; log `output/audit/host-maintenance-checks-2026-10-23.log`.
`git diff --check` passes. The two test descriptions no longer claim that a
15-second poll fits the lag bound. No application implementation changed, so
no new website build or deployment is claimed for this operational update.

OS API, bot and dashboard each return HTTP 200 locally. The actual watchdog's
public curl health request returns 200; its latest run succeeds. An earlier
Python-only Cloudflare 403 was not a reproduced website outage. A prior watchdog
alert came from its database/migration probe; discarded output prevents a more
specific historical diagnosis. Backup and watchdog timers remain enabled.

The Protocol indexer source stays at `5529973e41b29ca6ed62662c2e8fae17242bda2f`.
No application source was overlaid or pulled. A read-only query using the running
worker's actual database credentials now establishes its role and execution
rights on both existing rollback overloads. The detailed role evidence is private.
Media/publication tables remain absent; this does not prove future media migration
permissions or complete TA-10 integration.

## Retained evidence, rollback and remaining limits

Ignored evidence includes `docs/private/artsoul-*-host-*-2026-10-23.json`,
`artsoul-os-service-final-2026-10-23.json`,
`indexer-cadence-after-2026-10-23.json`, `indexer-cadence-tls-2026-10-23.json`,
`indexer-worker-identity-tls-2026-10-23.json` and the SSH installation screenshot
under `output/audit/`. No credential bodies or environment dumps enter Git.
Each host retains root-only rollback files under
`/root/artsoul-security-20261023/`: old Node package, original zlib library,
package logs and relevant service/configuration snapshots. Indexer poll/TLS
changes have separate original environment copies; SSH policy is a separate
drop-in. Restoring an older insecure runtime or plaintext connection is not the
normal recovery path; first diagnose and preserve the verified configuration.

Remaining operational follow-ups are explicit:

- The existing three-block confirmation policy is unchanged. Denim reduces its
  elapsed-time equivalent from about six seconds to 0.6 seconds; review the
  indexer/recovery confirmation policy together before the next rollout. It is
  not Ethereum finality. No new confirmation number is silently approved here.
- Faster polling and block production alter RPC cost assumptions. Keep existing
  spending controls and inspect measured fallback usage; July cost estimates are
  historical. No paid plan or auto-scale setting was enabled.
- The existing worker database role has broad privileges. Its identity is now
  confirmed, not newly granted. A narrower-role rollout needs reviewed permissions
  and real rollback/integration tests; this maintenance does not grant new roles.
- ArtSoul OS's watchdog describes every failed migration-status check as a database
  outage. A scoped wording correction belongs in that product's repository;
  current checks pass. Its logs do not prove the cause of the earlier transient.

Phase A remains 81 done / 2 in progress (A-83 and A-23). Ordinary mobile success,
host maintenance and read-only role evidence do not replace real delayed-receipt
acceptance, TA-10 activation or the beta GO decision. Deferred desktop TA-12 stays
separate. Next Protocol implementation step: bounded recovery discovery from the
existing durable publication draft after reload, with no submission replay.
