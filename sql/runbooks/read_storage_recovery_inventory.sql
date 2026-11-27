-- Run on the source project. Only aggregate counts and a digest leave the database.
WITH object_versions AS (
    SELECT (metadata->>'size')::bigint AS bytes,
        (version IS NULL OR metadata->>'size' IS NULL OR metadata->>'eTag' IS NULL OR metadata->>'mimetype' IS NULL) AS incomplete,
        encode(sha256(convert_to(concat_ws(':',
            encode(convert_to(bucket_id, 'UTF8'), 'hex'), encode(convert_to(name, 'UTF8'), 'hex'),
            encode(convert_to(version::text, 'UTF8'), 'hex'), encode(convert_to(metadata->>'size', 'UTF8'), 'hex'),
            encode(convert_to(trim(both '"' from regexp_replace(metadata->>'eTag', '^W/', '')), 'UTF8'), 'hex'),
            encode(convert_to(metadata->>'mimetype', 'UTF8'), 'hex')), 'UTF8')), 'hex') AS fingerprint
    FROM storage.objects
)
SELECT statement_timestamp() AS observed_at,
    (SELECT count(*)::integer FROM storage.buckets) AS buckets,
    (SELECT count(*)::integer FROM storage.buckets WHERE public) AS public_buckets,
    count(*)::integer AS objects, coalesce(sum(bytes), 0)::text AS bytes,
    count(*) FILTER (WHERE incomplete)::integer AS incomplete,
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' ORDER BY fingerprint COLLATE "C"), ''), 'UTF8')), 'hex') AS inventory_sha256
FROM object_versions;
