# Release recovery evidence, November 27

## Current Storage versions and recovered bytes

At 02:03:04 UTC the live Protocol database reported one public bucket, 159 objects and 115,603,645 bytes. Every entry had an object version, size, media type and ETag. A single read-only [aggregate query](../../sql/runbooks/read_storage_recovery_inventory.sql) covered every bucket and object in the project. It returned counts and one digest. No media was downloaded.

The [offline verifier](../../scripts/check-storage-recovery.mjs) checked the independently recorded [media manifest digest](B35_ATOMIC_INDEXER_RECOVERY_2026-10-29.md#november-1-object-byte-recovery-rehearsal) and compared the original bucket, key, version, byte length, ETag and media type of every entry with that aggregate. Every file in the existing reconstructed directory was reread at its original path and hashed by content. All 159 objects matched. The only root-level recovery metadata file excluded from the object count was `evidence.json`.

| Evidence | SHA-256 |
| --- | --- |
| Independently retained byte manifest | `bc3a8818db0c5ba1be4d6caf6f8a8865232254d41b6c512dca498acf4e435d3b` |
| Live versioned object inventory | `8077ce9393b9445852f86b15222488fa7b39162d6874e91e75f417fc7ea91353` |

For a repeat, run the aggregate SQL on the intended source project and save its single result row as a JSON object. Use the retained manifest and its digest from an independent record. Supply the restored directory containing the original bucket subdirectories. The verifier reads local files and reports the source observation time.

```sh
node scripts/check-storage-recovery.mjs PROJECT_ID MANIFEST_FILE MANIFEST_SHA256 RESTORED_DIRECTORY SOURCE_ROW_JSON
node --test test/storage-recovery.test.mjs
```

All three regression tests passed. Coverage includes an opaque multipart ETag, a non-ASCII key, version drift at the same object count and total size, modified bytes of unchanged length, a missing or extra file and an invalid parent path. A newly added bucket or a bucket becoming private requires a new capture and review. Supabase stores object metadata in Postgres and stores file bytes separately. [Supabase backup scope](https://supabase.com/docs/guides/platform/backups)

## Current mutable settings

At 02:05:01 UTC a bounded read-only SQL statement captured all rows in `artsoul_private.aura_sources` and `artsoul_private.aura_border_history` from one database snapshot. The newest source revision was recorded on November 26. The payload occupied 1,730 bytes. A fresh loopback-only PostgreSQL instance applied the November 25 border setting and Team authority migrations, the November 26 source registry and the November 27 Founder migration. The data was inserted into those actual tables in one transaction. The restored two source revisions and five setting revisions reproduced every field, including timestamps and authority references. The normal setting reader returned the latest revision and value. Direct table access remained denied to all three Data API roles.

The comparison used `jsonb_agg(to_jsonb(row) ORDER BY revision)` for settings and `ORDER BY kind, chain_id, scope, address, revision` for source rows, with both databases in UTC. The two arrays were wrapped in a JSONB object under their table names. The UTF-8 PostgreSQL JSONB text had SHA-256 `9892a94d7034da3aa6a32a32196c397df8e7d6faba4111ca17647fd2d4da5c07` on both sides. The private export was removed and the disposable instance was stopped and cleaned up.

The replacement Core's private issuer, sale and primary credit tables each contained one row during a separate current aggregate read. The prior [three-table restore](../testnet/ORDINARY_MARKET_REHEARSAL_2026-11-25.md#restoring-the-first-hosted-sale) pertains to that signed sale. A matching count by itself does not establish row equality.

### Restore after the frame-source revocations

At **09:36:11 UTC** a second read-only statement captured the same two tables from one production snapshot. They contained **four source revisions and five border-setting revisions**. The ordered JSONB payload was **2,539 bytes**. Its SHA-256 was `d2b6089c99a9e82d9487d22eeee3d8e06045c1ea9db83a70f29b19ea92b05fb8`.

A new password-protected PostgreSQL 18.4 instance on `127.0.0.1` applied the four earlier migrations and the [governing Team frame-source migration](../../sql/migrations/20261127130000_governing_team_frame_sources.sql) to empty tables. The restore inserted all nine captured rows in a single transaction. The restored JSONB matched the source byte for byte, including timestamps and the new `runtime_hash` field, which was null in each of these four historical decisions.

The normal source reader returned revision 2, disabled, for both the former Platform publisher and former Partner designation. The collection reader returned zero active sources for those addresses. The setting reader returned revision 5 with labels enabled. Both tables retained RLS, and all six table/role combinations denied direct Data API privileges. The disposable listener was confirmed closed and its data directory and one-off runner were removed. This second read covered only the two appearance tables. The independent full-project recovery point remains the one listed below.

## Cutover limits

The last evidenced independent encrypted full database and Storage recovery point is [November 9](B35_INDEPENDENT_RECOVERY_AND_CORE_CUTOVER_2026-11-09.md). The November 16 full database archive was read-validated. This drill covered current Storage and two mutable settings tables. A new independent whole-project backup and full isolated restore at the eventual cutover, including current roles, schemas, mutable service data and indexer progress, are still required before destructive operations. C14 and D2 remain open.
