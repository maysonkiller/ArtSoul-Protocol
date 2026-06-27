-- AI Integration Migration
-- Date: 2026-05-05
-- Purpose: Add AI valuation and discovery auction support

-- ============================================
-- ARTWORKS TABLE UPDATES
-- ============================================

-- Add AI floor price column
ALTER TABLE artworks
ADD COLUMN IF NOT EXISTS ai_floor_price NUMERIC;

-- Add discovery attempts counter
ALTER TABLE artworks
ADD COLUMN IF NOT EXISTS discovery_attempts INTEGER DEFAULT 0;

-- Add failed auctions counter
ALTER TABLE artworks
ADD COLUMN IF NOT EXISTS failed_auctions INTEGER DEFAULT 0;

-- Add engagement metrics
ALTER TABLE artworks
ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0;

ALTER TABLE artworks
ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;

ALTER TABLE artworks
ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0;

-- Update status column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'artworks' AND column_name = 'status'
    ) THEN
        ALTER TABLE artworks ADD COLUMN status TEXT DEFAULT 'draft';
    END IF;
END $$;

-- Add index for status queries
CREATE INDEX IF NOT EXISTS idx_artworks_status ON artworks(status);

-- Add index for discovery attempts
CREATE INDEX IF NOT EXISTS idx_artworks_discovery ON artworks(discovery_attempts);

-- ============================================
-- AUCTIONS TABLE UPDATES
-- ============================================

-- Add auction type (primary or discovery)
ALTER TABLE auctions
ADD COLUMN IF NOT EXISTS auction_type TEXT DEFAULT 'primary';

-- Add AI triggered flag
ALTER TABLE auctions
ADD COLUMN IF NOT EXISTS ai_triggered BOOLEAN DEFAULT false;

-- Add AI floor price
ALTER TABLE auctions
ADD COLUMN IF NOT EXISTS ai_floor_price NUMERIC;

-- Add index for auction type
CREATE INDEX IF NOT EXISTS idx_auctions_type ON auctions(auction_type);

-- Add index for AI triggered auctions
CREATE INDEX IF NOT EXISTS idx_auctions_ai ON auctions(ai_triggered) WHERE ai_triggered = true;

-- ============================================
-- NEW TABLE: AI_VALUATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS ai_valuations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artwork_id UUID REFERENCES artworks(id) ON DELETE CASCADE,

    -- Valuation result
    calculated_floor NUMERIC NOT NULL,

    -- Breakdown
    avg_similar_sales NUMERIC,
    engagement_multiplier NUMERIC,
    rarity_multiplier NUMERIC,
    creator_multiplier NUMERIC,

    -- Confidence
    confidence TEXT, -- 'high', 'medium', 'low'

    -- Metadata
    similar_sales_count INTEGER,
    engagement_score NUMERIC,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add index for artwork lookups
CREATE INDEX IF NOT EXISTS idx_ai_valuations_artwork ON ai_valuations(artwork_id);

-- Add index for recent valuations
CREATE INDEX IF NOT EXISTS idx_ai_valuations_created ON ai_valuations(created_at DESC);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get recent sales for similar artworks
CREATE OR REPLACE FUNCTION get_recent_sales(
    p_file_type TEXT,
    p_days INTEGER DEFAULT 7,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    artwork_id UUID,
    sale_price NUMERIC,
    sale_date TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id,
        a.sale_price,
        a.updated_at
    FROM artworks a
    WHERE
        a.file_type = p_file_type
        AND a.status = 'sold'
        AND a.sale_price IS NOT NULL
        AND a.updated_at >= NOW() - (p_days || ' days')::INTERVAL
    ORDER BY a.updated_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get creator sales history
CREATE OR REPLACE FUNCTION get_creator_sales(
    p_creator_address TEXT
)
RETURNS TABLE (
    artwork_id UUID,
    sale_price NUMERIC,
    sale_date TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id,
        a.sale_price,
        a.updated_at
    FROM artworks a
    WHERE
        LOWER(a.creator_id) = LOWER(p_creator_address)
        AND a.status = 'sold'
        AND a.sale_price IS NOT NULL
    ORDER BY a.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to check if artwork should trigger discovery
CREATE OR REPLACE FUNCTION should_trigger_discovery(
    p_artwork_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_discovery_attempts INTEGER;
    v_status TEXT;
BEGIN
    SELECT discovery_attempts, status
    INTO v_discovery_attempts, v_status
    FROM artworks
    WHERE id = p_artwork_id;

    -- Don't trigger if max attempts reached
    IF v_discovery_attempts >= 3 THEN
        RETURN FALSE;
    END IF;

    -- Don't trigger if marked as low liquidity
    IF v_status = 'low_liquidity' THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DATA MIGRATION
-- ============================================

-- Set default values for existing artworks
UPDATE artworks
SET
    discovery_attempts = 0,
    failed_auctions = 0,
    views = 0,
    likes = 0,
    shares = 0
WHERE
    discovery_attempts IS NULL
    OR failed_auctions IS NULL;

-- Set auction type for existing auctions
UPDATE auctions
SET
    auction_type = 'primary',
    ai_triggered = false
WHERE
    auction_type IS NULL;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check artworks table
SELECT
    COUNT(*) as total_artworks,
    COUNT(ai_floor_price) as with_ai_floor,
    AVG(discovery_attempts) as avg_discovery_attempts,
    COUNT(CASE WHEN status = 'low_liquidity' THEN 1 END) as low_liquidity_count
FROM artworks;

-- Check auctions table
SELECT
    COUNT(*) as total_auctions,
    COUNT(CASE WHEN auction_type = 'primary' THEN 1 END) as primary_auctions,
    COUNT(CASE WHEN auction_type = 'discovery' THEN 1 END) as discovery_auctions,
    COUNT(CASE WHEN ai_triggered = true THEN 1 END) as ai_triggered_count
FROM auctions;

-- Check ai_valuations table
SELECT COUNT(*) as total_valuations FROM ai_valuations;

-- ============================================
-- ROLLBACK (if needed)
-- ============================================

/*
-- Uncomment to rollback changes

-- Drop new table
DROP TABLE IF EXISTS ai_valuations CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS get_recent_sales(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_creator_sales(TEXT);
DROP FUNCTION IF EXISTS should_trigger_discovery(UUID);

-- Drop indexes
DROP INDEX IF EXISTS idx_artworks_status;
DROP INDEX IF EXISTS idx_artworks_discovery;
DROP INDEX IF EXISTS idx_auctions_type;
DROP INDEX IF EXISTS idx_auctions_ai;

-- Remove columns from artworks
ALTER TABLE artworks DROP COLUMN IF EXISTS ai_floor_price;
ALTER TABLE artworks DROP COLUMN IF EXISTS discovery_attempts;
ALTER TABLE artworks DROP COLUMN IF EXISTS failed_auctions;
ALTER TABLE artworks DROP COLUMN IF EXISTS views;
ALTER TABLE artworks DROP COLUMN IF EXISTS likes;
ALTER TABLE artworks DROP COLUMN IF EXISTS shares;

-- Remove columns from auctions
ALTER TABLE auctions DROP COLUMN IF EXISTS auction_type;
ALTER TABLE auctions DROP COLUMN IF EXISTS ai_triggered;
ALTER TABLE auctions DROP COLUMN IF EXISTS ai_floor_price;
*/

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT 'AI Integration Migration Complete!' as status;
