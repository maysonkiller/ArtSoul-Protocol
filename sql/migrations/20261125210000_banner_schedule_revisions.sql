-- Private rehearsal ledger. Recording terms here does not activate a placement.
BEGIN;
CREATE SCHEMA IF NOT EXISTS artsoul_private;
CREATE TABLE artsoul_private.banner_schedule_revisions (
    revision integer PRIMARY KEY CHECK (revision > 0),
    previous_revision integer GENERATED ALWAYS AS (NULLIF(revision - 1, 0)) STORED
        REFERENCES artsoul_private.banner_schedule_revisions(revision),
    placements jsonb NOT NULL CHECK (jsonb_typeof(placements) = 'array'),
    awards jsonb NOT NULL CHECK (jsonb_typeof(awards) = 'array'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    recorded_by name NOT NULL DEFAULT session_user,
    CHECK (jsonb_array_length(placements) + jsonb_array_length(awards) > 0)
);
ALTER TABLE artsoul_private.banner_schedule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE artsoul_private.banner_schedule_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE artsoul_private.banner_schedule_revisions FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION artsoul_private.preserve_banner_schedule_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Published banner schedule history is append-only';
END;
$$;
REVOKE ALL ON FUNCTION artsoul_private.preserve_banner_schedule_history() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER preserve_banner_schedule_history
BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.banner_schedule_revisions
FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.preserve_banner_schedule_history();
COMMIT;
