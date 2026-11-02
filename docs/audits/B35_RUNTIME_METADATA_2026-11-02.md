# B35 — Running interpreter and dependency metadata

Status: the bounded read-only comparison passes. This is an activation
prerequisite, not activation or complete installed-package integrity evidence.

## Scope and result

At November 2, 2026, 14:00:09 UTC, one SSH probe inspected the existing indexer
server. The candidate remains `f1484c7b5079e9c9b0fff422a54c3c1edc168f92`;
the manifest and candidate package/lock bytes were pinned before inspection.
No remote files, packages, database, cache, service or billing setting changed.
No application package code was imported or executed by the probe.

The six candidate imports reach 55 locked package locations. The running Linux
x64 installation contains 50 of them: 45 required through at least one path
and five optional. All 50 names, exact versions and dependency/optional/peer,
engine, OS and CPU declarations match. Resolution starts at each actual parent
location, including nested packages; no shadow-path or layout difference was
found. Requiredness follows the entire ancestry rather than the lockfile's
individual optional flag.

Five incompatible macOS, Windows and Linux ARM native variants are absent.
The optional peers `pg-native`, `bufferutil` and `utf-8-validate` are also absent.
These are recorded absences, not missing required dependencies. Present metadata
bytes/stat identities and absent paths were checked again before completion.
The graph walk performed 65 operations and reported no mismatches.

The PM2-selected worker PID and its process start time/tree remained stable.
Its `/proc` executable identity matches the clean SSH probe's Node executable
device/inode. That probe reports Node `v22.23.4`, Linux x64 and the required
`fetch`, `AbortSignal.any`, `AbortSignal.timeout` and `throwIfAborted` APIs.
No process command line, environment, secret configuration or logs were read.
The measured remote probe duration was 948 ms; this is not a capacity benchmark.

## Evidence and limitations

| Private artifact | SHA-256 |
| --- | --- |
| Probe implementation | `b42936c460b16c09cc14ad28c3de3b56468bc0fe9c083164601eb21e7ec5e8fb` |
| Serialized remote probe | `832926b4c3e5561b550bd4cc2f595aaf70527af5e899cc75c1f5e8a4df5a04e6` |
| Captured result | `db65714789f127cc0bb1986eaaaca93bcc873c8e8dc0311e6e1c6b7acc5ba809` |

Matching metadata is not verification of installed source/native binary bytes
or npm tarball integrity. No package entry was loaded: ESM/CommonJS export
conditions, optional native-addon behavior and runtime integration remain
unproven. Node engine ranges were compared as metadata, not evaluated by a new
range parser. The shared executable inode does not establish worker flags,
loaded libraries or startup configuration. This inspection covers only the
candidate dependency closure, not every installed package.

These distinctions follow the documented separation between
[Node package entry/conditional exports](https://nodejs.org/api/packages.html#conditional-exports)
and [npm optional dependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#optionaldependencies).
No new dependency or package installation was needed for this comparison.

The newer worker remains inactive. Fresh source/configuration pins, independent
encrypted recovery/key custody, compatible cutover, real RPC/cache transport and
representative resource usage remain separate acceptance gates. The prior
[archive restoration evidence](B35_ARCHIVE_MIGRATION_REHEARSAL_2026-11-02.md)
and [migration runbook](../security/MIGRATION_RUNBOOK.md) still apply.
