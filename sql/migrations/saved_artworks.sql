-- Private reversible bookmarks, independent of discovery signals and ownership.
-- Wallet isolation is enforced by the authenticated server; client roles have no
-- Data API access because the wallet session is not a Supabase Auth identity.
BEGIN;
CREATE TABLE IF NOT EXISTS public.saved_artworks (
  id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address <> '0x0000000000000000000000000000000000000000'),
  chain_id BIGINT NOT NULL CHECK (chain_id > 0 AND chain_id <= 9007199254740991),
  core_address TEXT NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address <> '0x0000000000000000000000000000000000000000'),
  artwork_id NUMERIC(78,0) NOT NULL CHECK (artwork_id > 0 AND artwork_id < 115792089237316195423570985008687907853269984665640564039457584007913129639936),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, chain_id, core_address, artwork_id)
);
CREATE INDEX IF NOT EXISTS saved_artworks_wallet_order ON public.saved_artworks(wallet_address, id DESC);
ALTER TABLE public.saved_artworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_artworks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_artworks FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.saved_artworks_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_artworks TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.saved_artworks_id_seq TO service_role;
COMMIT;
