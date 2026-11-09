# B30 — Managed exporter temporary-file attribution

Status: recurring growth is attributed; the provider-owned correction is not
applied. This is separate from the earlier application egress correction and
does not close representative capacity acceptance.

## Confirmed cause

A five-minute live diagnostic window captured six temporary files, all from
`application_name=postgres_exporter`, PID 71771. Their total exactly reconciles
the database counters for the same window:

| Measurement | Before | After | Increase |
| --- | ---: | ---: | ---: |
| `temp_files` | 194072 | 194078 | 6 |
| `temp_bytes` | 430760140560 | 430780418412 | 20277852 |

The effective window was November 9, 2026, 15:57:30.219–16:02:32.722 UTC.
Each file was 3,379,642 bytes. The same pair of queries ran at 15:57:58,
15:59:58 and 16:01:58 UTC:

- `5197431765113000632`: sum of calls/execution time over
  `extensions.pg_stat_statements`, joined to `pg_database`.
- `-8285757822602875730`: the managed `normalized_pg_stat_statements`
  classifier producing `user_queries_total`.

These records attribute all growth in this window. They do not establish the
source of every historical temporary byte, physical disk occupancy, billed
egress or every IO-budget warning. Temporary bytes are cumulative work, not
duplicate uploaded artwork files requiring deletion.

## Bounded reproduction and proposed correction

At 16:06 UTC, each exact logged SELECT was executed once per memory setting
using read-only transactions, a five-second statement timeout and
`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)`:

| Query | Session-local memory | Temp blocks read / written | Execution time |
| --- | --- | ---: | ---: |
| Call/time aggregate | 3500 kB | 413 / 413 | 16.790 ms |
| User-query classifier | 3500 kB | 413 / 413 | 190.389 ms |
| Call/time aggregate | 16 MB | 0 / 0 | 8.689 ms |
| User-query classifier | 16 MB | 0 / 0 | 187.903 ms |

Counts come from the root plan, without double-counting child nodes. This is
one bounded reproduction, not a performance benchmark. Every transaction was
rolled back; the connection's before/after `work_mem` remained 3500 kB.

The appropriate correction is scoped to the managed exporter connection or
its queries. Do not raise every application connection's memory, alter managed
extension functions, reset statement history or upgrade paid compute merely
to suppress this symptom. The customer interface does not expose the managed
exporter's process/query configuration. On November 9, the owner authorized
contacting support for a confirmed provider issue. The dashboard accepted the
request under Performance issues / Database and displayed "Support request
sent". The request asks for a collector-only correction and explicitly excludes
paid changes and disabling Spend Cap. The optional human/AI project-data access
switch was turned off before submission. No ticket identifier was displayed;
the provider's correction and the follow-up measurement remain pending.

The independently reported [Supabase issue #52457](https://github.com/supabase/supabase/issues/52457)
describes the same managed query pair. The public
[exporter service template](https://github.com/supabase/postgres/blob/12931793f8fa7ef7bd0eb0aea01e8a2c931a2c67/ansible/files/postgres_exporter.service.j2)
sets `application_name=postgres_exporter` and disables statement tracking for
that connection. That configuration is a plausible explanation for the earlier
gap between statement counters and database totals; the per-file trace, not
that inference, establishes ownership here.

## Diagnostic cleanup and evidence

The supported CLI temporarily set `log_temp_files=1MB` with `--no-restart` and
automatically deleted only that override in `finally`. Overrides returned to
`{}` and effective logging to `-1` at 16:02:41 UTC. Database startup stayed
November 2, 00:22:36.181 UTC, and its statistics reset marker stayed April 26,
02:16:05.746 UTC. No restart, counter reset, user-data mutation, worker change,
new service or billing change occurred. See the provider's
[configuration documentation](https://supabase.com/docs/guides/database/custom-postgres-config).

Private, ignored evidence:

- `docs/private/b30-bounded-temp-log-2026-11-09.json`
- `docs/private/b30-exporter-temp-trace-2026-11-09.json`
- `docs/private/b30-exporter-explain-2026-11-09.json`
- `docs/private/B30_SUPABASE_SUPPORT_DRAFT_2026-11-09.md`
- `docs/private/B30_SUPABASE_USAGE_COST_2026-11-09.md`

After the provider changes its collector, repeat one short, bounded counter/log
window to verify the correction and retain representative IO/egress acceptance
as a separate gate. Until then, report attribution as complete and remediation
as pending; do not claim that future warnings or overruns are impossible.
