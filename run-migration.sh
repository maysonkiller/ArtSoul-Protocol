#!/bin/bash

# AI Integration Database Migration Runner
# Date: 2026-05-06

echo "🗄️ Starting AI Integration Database Migration..."
echo ""

# Supabase connection details
SUPABASE_URL="https://bexigvqrunomwtjsxlej.supabase.co"
SUPABASE_PROJECT_REF="bexigvqrunomwtjsxlej"

echo "📋 Migration Steps:"
echo "1. Go to: https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/editor"
echo "2. Click 'SQL Editor' in left sidebar"
echo "3. Click 'New Query'"
echo "4. Copy contents of: migrations/001_ai_integration.sql"
echo "5. Paste into SQL Editor"
echo "6. Click 'Run' button"
echo ""

echo "⚠️  IMPORTANT: Review the migration before running!"
echo ""

echo "✅ Expected output:"
echo "   - All ALTER TABLE commands succeed"
echo "   - ai_valuations table created"
echo "   - Helper functions created"
echo "   - Indexes created"
echo "   - Final message: 'AI Integration Migration Complete!'"
echo ""

echo "🔍 Verification queries (run after migration):"
echo ""
echo "-- Check artworks columns"
echo "SELECT column_name FROM information_schema.columns"
echo "WHERE table_name = 'artworks'"
echo "AND column_name IN ('ai_floor_price', 'discovery_attempts', 'failed_auctions');"
echo ""
echo "-- Check auctions columns"
echo "SELECT column_name FROM information_schema.columns"
echo "WHERE table_name = 'auctions'"
echo "AND column_name IN ('auction_type', 'ai_triggered', 'ai_floor_price');"
echo ""
echo "-- Check ai_valuations table"
echo "SELECT COUNT(*) FROM ai_valuations;"
echo ""

echo "📝 Migration file location: migrations/001_ai_integration.sql"
echo ""
echo "🚀 Ready to migrate!"
