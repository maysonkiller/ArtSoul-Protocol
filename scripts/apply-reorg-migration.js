#!/usr/bin/env node

import { readFileSync } from 'fs';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function applyMigration() {
    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('[Migration] Applying 008_reorg_handling.sql...');

        const sql = readFileSync('src/indexer/migrations/008_reorg_handling.sql', 'utf8');

        await db.query(sql);

        console.log('[Migration] ✅ Successfully applied 008_reorg_handling.sql');
    } catch (error) {
        console.error('[Migration] ❌ Failed:', error.message);
        process.exit(1);
    } finally {
        await db.close();
    }
}

applyMigration();
