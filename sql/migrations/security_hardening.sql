-- ARTSOUL INFRASTRUCTURE HARDENING (Phase 8.5)
-- Target: Supabase Public Schema Security

-- 1. RESET AND CLEANUP (Optional but recommended for fresh start)
-- Note: In a real production, we would backup first.

-- 2. EXPLICIT GRANTS (Supabase May 30 Requirement)
-- GRANT SELECT on all public tables to anon (Guests)
GRANT SELECT ON public.artworks TO anon;
GRANT SELECT ON public.auctions TO anon;
GRANT SELECT ON public.nft_ownership TO anon;
GRANT SELECT ON public.secondary_sales TO anon;
GRANT SELECT ON public.ai_valuations TO anon;
GRANT SELECT ON public.users TO anon;

-- GRANT Full Access to service_role (Backend/Indexer)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- GRANT specific access to authenticated users
GRANT SELECT, INSERT, UPDATE ON public.artworks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.auctions TO authenticated;
GRANT SELECT, INSERT ON public.secondary_sales TO authenticated;

-- 3. ROW LEVEL SECURITY (RLS) ENABLEMENT
ALTER TABLE public.artworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nft_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secondary_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 4. RLS POLICIES

-- ARTWORKS
CREATE POLICY "Public artworks are viewable by everyone"
ON public.artworks FOR SELECT USING (true);

CREATE POLICY "Creators can update their own artworks"
ON public.artworks FOR UPDATE USING (auth.uid() = creator_address);

-- AUCTIONS
CREATE POLICY "Auctions are viewable by everyone"
ON public.auctions FOR SELECT USING (true);

CREATE POLICY "Creators can manage their own auctions"
ON public.auctions FOR ALL USING (auth.uid() = creator);

-- NFT OWNERSHIP
CREATE POLICY "Ownership registry is public"
ON public.nft_ownership FOR SELECT USING (true);

-- SECONDARY SALES
CREATE POLICY "Sales history is public"
ON public.secondary_sales FOR SELECT USING (true);

CREATE POLICY "Authenticated users can list for sale"
ON public.secondary_sales FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- AI VALUATIONS
CREATE POLICY "AI valuations are read-only for everyone"
ON public.ai_valuations FOR SELECT USING (true);

-- USERS
CREATE POLICY "User profiles are public"
ON public.users FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile"
ON public.users FOR UPDATE USING (auth.uid() = wallet_address);
