import Redis from 'ioredis';
import { env } from '../config/env';

let client: Redis | null = null;
let errorLoggedOnce = false;

export function getRedis() {
  if (!client) {
    client = new Redis(env.redisUrl, {
      lazyConnect: true,
      // Stop retrying requests to avoid MaxRetries spam; caller will fallback
      maxRetriesPerRequest: 0,
      // Disable offline queue to fail fast when not connected
      enableOfflineQueue: false,
      // Do not auto-retry socket reconnects endlessly; return null to stop retries
      retryStrategy: () => null,
      reconnectOnError: () => false,
    });

    client.on('error', (err) => {
      if (!errorLoggedOnce) {
        console.warn('[redis] connection error (will use in-memory fallback if available):', err?.message || err);
        errorLoggedOnce = true;
      }
    });
  }
  return client;
}

export async function ensureRedis() {
  const r = getRedis();
  if (r.status === 'wait' || r.status === 'end') {
    await r.connect();
  }
  return r;
}

export async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
    errorLoggedOnce = false;
  }
}
