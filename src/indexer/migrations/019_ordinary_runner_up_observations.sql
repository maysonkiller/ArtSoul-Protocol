-- One latest finalized point-in-time observation per replacement deployment and auction.
CREATE TABLE IF NOT EXISTS artsoul_private.ordinary_runner_up_observations (
    chain_id integer NOT NULL,
    core_address text NOT NULL,
    auction_id numeric(78,0) NOT NULL CHECK (auction_id > 0),
    artwork_id numeric(78,0) NOT NULL CHECK (artwork_id > 0),
    block_number bigint NOT NULL CHECK (block_number >= 0),
    block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$' AND block_hash !~ '^0x0+$'),
    status text NOT NULL CHECK (status IN ('not_offered', 'open', 'expired', 'closed', 'accepted')),
    bidder text CHECK (bidder ~ '^0x[0-9a-f]{40}$' AND bidder !~ '^0x0+$'),
    price_wei numeric(78,0) CHECK (price_wei > 0),
    deadline numeric(78,0) CHECK (deadline > 0),
    CHECK ((status = 'not_offered' AND bidder IS NULL AND price_wei IS NULL AND deadline IS NULL) OR
           (status <> 'not_offered' AND bidder IS NOT NULL AND price_wei IS NOT NULL AND deadline IS NOT NULL)),
    PRIMARY KEY (chain_id, core_address, auction_id),
    FOREIGN KEY (chain_id, core_address) REFERENCES artsoul_private.ordinary_issuers (chain_id, core_address)
);

ALTER TABLE artsoul_private.ordinary_runner_up_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.ordinary_runner_up_observations FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
        EXECUTE format('REVOKE ALL ON artsoul_private.ordinary_runner_up_observations FROM %I', api_role);
    END LOOP;
END;
$$;
