-- ARTSOUL DATABASE SCHEMA (LOCKED SPEC v1)
-- DB = OFFCHAIN TRUTH LAYER

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    wallet_address TEXT PRIMARY KEY,
    reputation_score INTEGER DEFAULT 0,
    total_volume NUMERIC DEFAULT 0,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. ARTWORKS
CREATE TABLE IF NOT EXISTS artworks (
    artwork_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_address TEXT REFERENCES users(wallet_address),
    media_url TEXT NOT NULL,
    metadata_url TEXT,
    is_minted BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'pending', -- pending, auction, minted, archived
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. AUCTIONS
CREATE TABLE IF NOT EXISTS auctions (
    auction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id UUID REFERENCES artworks(artwork_id),
    seller_address TEXT REFERENCES users(wallet_address),
    highest_bid NUMERIC DEFAULT 0,
    highest_bidder TEXT,
    deposit_amount NUMERIC DEFAULT 0,
    settlement_deadline TIMESTAMPTZ,
    status TEXT DEFAULT 'active', -- active, ended, settled, defaulted
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. NFT OWNERSHIP
CREATE TABLE IF NOT EXISTS nft_ownership (
    token_id TEXT PRIMARY KEY,
    current_owner TEXT REFERENCES users(wallet_address),
    artwork_id UUID REFERENCES artworks(artwork_id),
    network TEXT NOT NULL, -- 'base_sepolia', 'eth_sepolia', etc.
    minted_at TIMESTAMPTZ DEFAULT now()
);

-- 5. AI VALUATIONS (OFFCHAIN ONLY)
CREATE TABLE IF NOT EXISTS ai_valuations (
    valuation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id UUID REFERENCES artworks(artwork_id),
    estimated_value NUMERIC,
    confidence NUMERIC,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. SECONDARY SALES
CREATE TABLE IF NOT EXISTS secondary_sales (
    sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id TEXT REFERENCES nft_ownership(token_id),
    seller TEXT REFERENCES users(wallet_address),
    buyer TEXT REFERENCES users(wallet_address),
    sale_price NUMERIC,
    royalty_paid NUMERIC,
    sale_date TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_artworks_creator ON artworks(creator_address);
CREATE INDEX IF NOT EXISTS idx_auctions_artwork ON auctions(artwork_id);
CREATE INDEX IF NOT EXISTS idx_nft_owner ON nft_ownership(current_owner);
