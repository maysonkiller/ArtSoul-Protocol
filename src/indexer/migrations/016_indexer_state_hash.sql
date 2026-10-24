-- Forward repair for fresh installations of the ordered indexer migrations.
-- Migration 001 creates indexer_state without state_hash; 012's CREATE TABLE
-- IF NOT EXISTS cannot add a column to that existing table. Keep both applied
-- migrations immutable and use the same initial sentinel as the runtime.
-- No existing hashes, cursors, policies or grants are changed.
ALTER TABLE public.indexer_state
    ADD COLUMN IF NOT EXISTS state_hash VARCHAR(66) NOT NULL DEFAULT '0x0';
