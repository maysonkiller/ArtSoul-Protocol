-- Preserve actual log provenance. Unknown historical sources stay unknown.
ALTER TABLE public.contract_events ADD COLUMN IF NOT EXISTS contract_address VARCHAR(42)
    CHECK (contract_address IS NULL OR (contract_address ~ '^0x[0-9a-f]{40}$' AND
      contract_address <> '0x0000000000000000000000000000000000000000'));
CREATE INDEX IF NOT EXISTS contract_events_source_auction
    ON public.contract_events(chain_id,(event_data->>'auctionId'),block_number DESC,log_index DESC)
    INCLUDE(contract_address)
    WHERE event_name IN ('AuctionCreated','BidPlaced');
