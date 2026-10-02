-- Additive. Apply only after the event/projection tests and a verified backup.
-- The FK makes the existing chain-scoped contract-event rollback remove donations
-- atomically; moderation evidence is retained independently from chain projections.
BEGIN;
CREATE TABLE IF NOT EXISTS public.artwork_donations (
    chain_id NUMERIC(78,0) NOT NULL CHECK (chain_id = 84532),
    contract_address TEXT NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
    transaction_hash TEXT NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
    log_index INTEGER NOT NULL CHECK (log_index >= 0),
    block_number BIGINT NOT NULL CHECK (block_number >= 0),
    artwork_id NUMERIC(78,0) NOT NULL CHECK (artwork_id > 0),
    creator TEXT NOT NULL CHECK (creator ~ '^0x[0-9a-f]{40}$'),
    donor TEXT NOT NULL CHECK (donor ~ '^0x[0-9a-f]{40}$'),
    amount NUMERIC(78,0) NOT NULL CHECK (amount > 0),
    anonymous BOOLEAN NOT NULL,
    message TEXT CHECK (OCTET_LENGTH(message) <= 560),
    recorded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, transaction_hash, log_index)
        REFERENCES public.contract_events(chain_id, transaction_hash, log_index) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS artwork_donations_newest
    ON public.artwork_donations(chain_id, contract_address, artwork_id, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS artwork_donations_amount
    ON public.artwork_donations(chain_id, contract_address, artwork_id, amount DESC, block_number DESC, log_index DESC);

CREATE TABLE IF NOT EXISTS public.donation_message_visibility (
    chain_id NUMERIC(78,0) NOT NULL CHECK (chain_id = 84532),
    transaction_hash TEXT NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
    log_index INTEGER NOT NULL CHECK (log_index >= 0),
    hidden BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, transaction_hash, log_index)
);
DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['artwork_donations', 'donation_message_visibility'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    END LOOP;
END $$;
COMMIT;
