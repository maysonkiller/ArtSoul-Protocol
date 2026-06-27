#!/usr/bin/env node

/**
 * Apply database migrations
 */

import pg from 'pg';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function applyMigrations() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('Connecting to database...');
        const client = await pool.connect();

        console.log('Creating pgcrypto extension...');
        await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        console.log('✅ pgcrypto extension created');

        console.log('\nApplying migration 004_distributed_locks.sql...');
        const migration004 = fs.readFileSync('src/indexer/migrations/004_distributed_locks.sql', 'utf8');
        await client.query(migration004);
        console.log('✅ Migration 004 applied');

        console.log('\nApplying migration 005_event_idempotency.sql...');
        const migration005 = fs.readFileSync('src/indexer/migrations/005_event_idempotency.sql', 'utf8');
        await client.query(migration005);
        console.log('✅ Migration 005 applied');

        console.log('\nVerifying setup...');
        const extensions = await client.query(
            "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'"
        );
        console.log('Extensions:', extensions.rows);

        const tables = await client.query(
            `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
             AND tablename IN ('distributed_locks', 'event_processing_registry')`
        );
        console.log('Tables:', tables.rows);

        client.release();
        console.log('\n✅ All migrations applied successfully');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

applyMigrations().catch(console.error);
