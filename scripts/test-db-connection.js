#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL
});

try {
  await client.connect();
  console.log(' DB CONNECTION OK');

  const result = await client.query('SELECT version()');
  console.log('PostgreSQL version:', result.rows[0].version);

  await client.end();
} catch (e) {
  console.error(' DB CONNECTION FAILED:', e.message);
  console.error('Error code:', e.code);
  process.exit(1);
}
