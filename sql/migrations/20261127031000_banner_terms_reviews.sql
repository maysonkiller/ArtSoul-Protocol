-- Private review evidence for the Base Sepolia rehearsal.
BEGIN;
CREATE TABLE artsoul_private.banner_terms_reviews (
    placement_id text NOT NULL CHECK (placement_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
    stage text NOT NULL CHECK (stage IN ('terms', 'award')),
    revision integer NOT NULL REFERENCES artsoul_private.banner_schedule_revisions(revision),
    proposer_wallet text NOT NULL CHECK (proposer_wallet ~ '^0x[0-9a-f]{40}$'),
    reviewer_wallet text NOT NULL CHECK (reviewer_wallet ~ '^0x[0-9a-f]{40}$' AND reviewer_wallet <> proposer_wallet),
    proposer_signature text NOT NULL CHECK (proposer_signature ~ '^0x[0-9a-f]{130}$'),
    reviewer_signature text NOT NULL CHECK (reviewer_signature ~ '^0x[0-9a-f]{130}$'),
    directory_hash text NOT NULL CHECK (directory_hash ~ '^0x[0-9a-f]{64}$'),
    payer_wallet text CHECK (payer_wallet ~ '^0x[0-9a-f]{40}$'),
    payer_nonce numeric(78,0) CHECK (payer_nonce >= 0),
    treasury_wallet text CHECK (treasury_wallet ~ '^0x[0-9a-f]{40}$'),
    refund_nonce numeric(78,0) CHECK (refund_nonce >= 0),
    CHECK ((payer_wallet IS NULL) = (payer_nonce IS NULL) AND (payer_wallet IS NULL) = (treasury_wallet IS NULL)
        AND (refund_nonce IS NULL OR treasury_wallet IS NOT NULL)),
    UNIQUE (payer_wallet, payer_nonce),
    UNIQUE (treasury_wallet, refund_nonce),
    reviewed_at timestamptz NOT NULL,
    recorded_by name NOT NULL DEFAULT session_user,
    PRIMARY KEY (placement_id, stage)
);
ALTER TABLE artsoul_private.banner_terms_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE artsoul_private.banner_terms_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE artsoul_private.banner_terms_reviews FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER preserve_banner_terms_review
BEFORE UPDATE OR DELETE OR TRUNCATE ON artsoul_private.banner_terms_reviews
FOR EACH STATEMENT EXECUTE FUNCTION artsoul_private.preserve_banner_schedule_history();
COMMIT;
