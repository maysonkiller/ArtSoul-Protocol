-- 002: AUCTION STATE SCHEMA
-- Extended state tracking and automatic timestamp maintenance.

-- Pending Withdrawals Table
CREATE TABLE IF NOT EXISTS indexed_withdrawals (
    user_address VARCHAR(42) PRIMARY KEY,
    pending_amount NUMERIC(78, 0) NOT NULL DEFAULT 0,
    last_updated_block BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_user_address CHECK (user_address ~ '^0x[a-fA-F0-9]{40}$'),
    CONSTRAINT valid_amount CHECK (pending_amount >= 0)
);

CREATE INDEX idx_withdrawals_last_updated_block ON indexed_withdrawals(last_updated_block);

-- Functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for automatic timestamp updates
CREATE TRIGGER update_auctions_updated_at
    BEFORE UPDATE ON indexed_auctions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_withdrawals_updated_at
    BEFORE UPDATE ON indexed_withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
