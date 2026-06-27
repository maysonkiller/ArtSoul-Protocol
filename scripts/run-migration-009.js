#!/usr/bin/env node

import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

async function runMigration() {
    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const sql = readFileSync('src/indexer/migrations/009_event_queue_spillover.sql', 'utf8');
        await db.query(sql);
        console.log('Migration 009 applied successfully');
    } catch (error) {
        console.error('Migration failed:', error.message);
        throw error;
    } finally {
        await db.close();
    }
}

runMigration().catch(console.error);
