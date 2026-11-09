# B35 — Package content, isolated loading and startup context

November 9 update: the reviewed Core runtime is now active on the existing host
after independent recovery and a fresh migration rehearsal. See
[the dated activation evidence](B35_INDEPENDENT_RECOVERY_AND_CORE_CUTOVER_2026-11-09.md).
The inactive status below describes the November 2 inspection, not current deployment.

Status: package bytes match the pinned candidate dependency closure; isolated
imports and native/fallback checks pass. One executable-mode difference was
explicitly reviewed. The newer worker remains inactive.

Scope: Bible provenance/lifecycle and roadmap boundaries, following
[runtime metadata verification](B35_RUNTIME_METADATA_2026-11-02.md) and the
[archive migration rehearsal](B35_ARCHIVE_MIGRATION_REHEARSAL_2026-11-02.md).
Candidate: `f1484c7b5079e9c9b0fff422a54c3c1edc168f92`.
No installed packages, service, database, cache, billing or production flags changed.

## Installed content

The November 2, 15:19 UTC read-only inventory compared 50 installed Linux x64
package trees with the exact lockfile tarballs, each verified against its SHA-512
integrity. All **3,948 files / 33,369,345 bytes** match by size and SHA-256; no
missing, unexpected or changed-content file was found in that closure. Native
addon binaries are included. The remote inventory took 3,678 ms; this is not a
throughput or capacity benchmark. The tarballs consumed 7,694,622 download bytes
on the local PC, not Supabase egress.

Nested dependency locations were checked against the pinned resolution graph;
unlisted nested directories were not silently skipped. The nested `semver` bin
link resolves to the exact declared executable. File/directory stamps and the
PM2-selected worker identity remained stable. Reads, archive entries, expanded
bytes, elapsed time and output were bounded. Symlinks, traversal and unexpected
archive roots/types are refused rather than extracted onto the live server.

The raw result remains `CONTENT_REVIEW_REQUIRED`: the sole difference is the
execute bit on `msgpackr-extract/bin/download-prebuilds.js`. Its 336 bytes match
SHA-256 `e5d9fb733fb23a14f4a3e09f0618051b9393a419b0f77e2b15766a8cf8beb22c`.
The package declares that exact file as its `bin`. Accepting this mode difference
is a reviewed inference consistent with
[npm's executable-bin setup](https://raw.githubusercontent.com/npm/bin-links/main/lib/fix-bin.js),
not a claim that archive and installed modes are identical. No other mode exception
is accepted. No lifecycle script or downloaded executable was run on the server.

Seventeen offline verifier checks pass, covering valid/legacy archive roots,
path traversal, absolute/drive/backslash paths, links/special files, duplicate
entries, multiple roots, integrity, missing/extra/changed content and mode drift.

## Isolated loading

A fresh fixture contains only the verified 50-package closure, the 27 candidate
modules and synthetic smoke inputs. The existing local Node container image was
used without pulling an image or installing packages. Both runs used no network,
a read-only filesystem and fixture mount, an unprivileged user, no capabilities,
no new privileges, and bounded memory/CPU/process resources. Host secrets were
not mounted. Both containers exited and were removed.

- Native run: **54 checks pass**, selecting the verified Linux x64 N-API glibc
  addon; no other native binary was loaded.
- Explicit JavaScript fallback: **52 checks pass**, with no native addon loaded.
- Both runs import all 27 candidate modules and exercise ESM/CommonJS dependency
  entry points, synthetic configuration, ABI/amount encoding, integer decoding,
  metrics and MessagePack round trips. No network attempt was observed.

The fixture reports Node `v22.23.3`, ABI 127 / N-API 10; the live interpreter is
`v22.23.4`. This is Linux/major-version compatibility evidence, **not exact live
runtime equivalence**. No application main, runner constructor, queue connection,
RPC, SQL or Redis integration was executed by these smoke checks.

## Startup context and remaining configuration

At 15:35 UTC, a separate bounded read-only probe observed the same stable worker
and executable. The launcher has the expected directory and entrypoint and
sources the two expected environment files. The initial process environment
selects only Base Sepolia / chain 84532; search indexing is enabled. Existing
polling/range/reorg values remain 2,000 ms / 10 blocks / 60,000 ms.

The new NFT writer is unset. Its origin/range and runtime-hash pins are absent,
as is `REDIS_URL` in that initial environment. The launcher directory has no
default `.env`, and no adjacent interpreter `prebuilds` directory was found.
No nonempty Node/native-loader override from the inspected allowlist was present;
whitespace-only overrides count as present. Credential checks return presence
booleans only, never values or URLs.

This is initial-environment and launcher-syntax evidence, not a complete effective
configuration parser or proof of loaded libraries. No server package was imported.
The absent Redis/pins require configuration and transport qualification before
NFT indexing; they are not solved by copying files or restarting the worker.

## Evidence references

Raw inventories, probes and fixtures remain private. Public hashes bind the
observations without publishing configuration or credentials.

| Private artifact | SHA-256 |
| --- | --- |
| Content comparison result | `5cefa4baf15b05c4319ebb96d03443e5de44a4c43833da72308db7429f6b5d62` |
| Content verifier | `e6e2dcde6e289105561c3b44878167d16ea5cb971e69e21135831d8ee689ab97` |
| Inventory probe | `86019ca54530f93272b479466447ea78a477344d5a95a8ebf49151890b295cf9` |
| Offline verifier checks | `a4882be2e0d7d98754c2e98e5077b1c118abd8f6ab08202b13da9bc469703208` |
| Isolated fixture preparation | `b3c050ab0969728d8cf3014402daff1e8b1d7165429439ef7587fd243a36a6a0` |
| Isolated smoke implementation | `d1ce937086001c9241907b3e0dee2367549548c16aebb20006b0f5dc416c3acd` |
| Native and fallback results | `99dead98682b8f52eab562656e5086b1532cdc59157b7111d3fbdf7307d6545d` |
| Startup-context probe | `3ce5504e9bb78c779a7141caaff554a7a4d8b8029eba871b272a5786a8d32f11` |
| Startup-context result | `d7b297e5211f0e8039b6f1c8a1524ae068023d909d3cc591bb1408f47729e398` |

These close package-byte comparison and isolated-loading prerequisites only.
Independent encrypted recovery/key custody, fresh source/deployment/origin proof,
effective live role/schema/configuration, compatible cutover, actual RPC/cache
transport and representative resource usage remain open. Do not mark B35, the
public beta or Phase B complete from this evidence.

Interpretations: accept only the declared-bin execute-bit difference; distinguish
isolated loading from effective live configuration. No architecture or economics
amendment is introduced.
