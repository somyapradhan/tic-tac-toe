import { Pool } from 'pg';
import { env } from '../config/env';

let pool: Pool | null = null;

export function getDb() {
  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      // Many managed Postgres providers (e.g., Neon) require SSL
      ssl: { rejectUnauthorized: false },
      // Fail faster instead of hanging on unreachable networks
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function ensureDb() {
  const p = getDb();
  // Simple test query
  try {
    await p.query('SELECT 1');
  } catch (err) {
    console.error('[db] connection test failed', err);
    throw err;
  }
  return p;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
