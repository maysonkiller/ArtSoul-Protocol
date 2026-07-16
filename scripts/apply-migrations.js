#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const { Pool } = pg;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INDEXER_BASE_MIGRATION_DIR = path.resolve(SCRIPT_DIR, '../sql/migrations');
export const INDEXER_MIGRATION_DIR = path.resolve(SCRIPT_DIR, '../src/indexer/migrations');
const EXPECTED_FIRST_MIGRATION = 1;
const EXPECTED_LAST_MIGRATION = 13;
const MIGRATION_LOCK_ID = 1_533_548_723;

export function migrationChecksum(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function migrationSource(directory, sourcePrefix, minimum, maximum) {
  return fs.readdirSync(directory)
    .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name))
    .filter(name => {
      const number = Number(name.slice(0, 3));
      return number >= minimum && number <= maximum;
    })
    .map(name => ({ directory, sourcePrefix, name }));
}

export function listIndexerMigrations() {
  const sources = [
    ...migrationSource(INDEXER_BASE_MIGRATION_DIR, 'sql/migrations', 1, 3),
    ...migrationSource(INDEXER_MIGRATION_DIR, 'src/indexer/migrations', 4, 13)
  ];
  const migrations = sources
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .map(({ directory, sourcePrefix, name }) => {
      const number = Number(name.slice(0, 3));
      const filePath = path.join(directory, name);
      const sql = fs.readFileSync(filePath, 'utf8');
      return {
        id: name.replace(/\.sql$/i, ''),
        name,
        number,
        sourcePath: `${sourcePrefix}/${name}`,
        filePath,
        sql,
        checksum: migrationChecksum(sql)
      };
    });

  const expectedNumbers = Array.from(
    { length: EXPECTED_LAST_MIGRATION - EXPECTED_FIRST_MIGRATION + 1 },
    (_, index) => EXPECTED_FIRST_MIGRATION + index
  );
  const actualNumbers = migrations.map(migration => migration.number);
  if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
    throw new Error(
      `Indexer migration sequence must be ${expectedNumbers.join(', ')}; found ${actualNumbers.join(', ') || 'none'}`
    );
  }

  return migrations;
}

async function ensureMigrationLedger(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.artsoul_schema_migrations (
      migration_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      environment TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_by TEXT NOT NULL DEFAULT CURRENT_USER
    )
  `);
  await client.query('REVOKE ALL ON public.artsoul_schema_migrations FROM PUBLIC, anon, authenticated');
  await client.query('GRANT ALL ON public.artsoul_schema_migrations TO service_role');
  await client.query('ALTER TABLE public.artsoul_schema_migrations ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE public.artsoul_schema_migrations FORCE ROW LEVEL SECURITY');
}

export async function applyIndexerMigrations({
  apply = false,
  connectionString = process.env.DATABASE_URL,
  environment = process.env.ARTSOUL_MIGRATION_ENVIRONMENT || ''
} = {}) {
  const migrations = listIndexerMigrations();

  if (!apply) {
    return {
      applied: false,
      migrations: migrations.map(({ id, name, checksum }) => ({ id, name, checksum }))
    };
  }

  if (!connectionString) {
    throw new Error('DATABASE_URL is required with --apply');
  }
  if (!environment) {
    throw new Error('ARTSOUL_MIGRATION_ENVIRONMENT is required with --apply (for example: local, preview, production)');
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const results = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureMigrationLedger(client);

    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        const existing = await client.query(
          'SELECT sha256 FROM public.artsoul_schema_migrations WHERE migration_id = $1',
          [migration.id]
        );

        if (existing.rows.length > 0) {
          if (existing.rows[0].sha256 !== migration.checksum) {
            throw new Error(`Checksum mismatch for already applied migration ${migration.name}`);
          }
          await client.query('COMMIT');
          results.push({ name: migration.name, status: 'already-applied' });
          continue;
        }

        await client.query(migration.sql);
        await client.query(
          `INSERT INTO public.artsoul_schema_migrations
             (migration_id, source_path, sha256, environment)
           VALUES ($1, $2, $3, $4)`,
          [migration.id, migration.sourcePath, migration.checksum, environment]
        );
        await client.query('COMMIT');
        results.push({ name: migration.name, status: 'applied' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
      await pool.end();
    }
  }

  return { applied: true, migrations: results };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const result = await applyIndexerMigrations({ apply });

  if (!apply) {
    console.log('Dry run only. No database changes were made.');
    for (const migration of result.migrations) {
      console.log(`${migration.name} sha256:${migration.checksum.slice(0, 12)}...`);
    }
    console.log('Follow docs/security/MIGRATION_RUNBOOK.md before using --apply.');
    return;
  }

  for (const migration of result.migrations) {
    console.log(`${migration.status}: ${migration.name}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
