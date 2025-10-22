import { ensureRedis } from '../lib/redis';
import { v4 as uuid } from 'uuid';

const QUEUE_KEY = 'matchmaking:queue'; // list of JSON strings
const SOCKET_KEY_PREFIX = 'matchmaking:socket:'; // socket:<socketId> -> raw entry
const PRIVATE_PREFIX = 'game:code:'; // string -> gameId
const CODE_TTL_SECONDS = 60 * 10; // 10 minutes

export interface QueueEntry {
  playerId: string;
  socketId: string;
  username?: string;
}

export interface MatchedPair {
  gameId: string;
  first: QueueEntry;
  second: QueueEntry;
}

export interface QueueJoinResult {
  status: 'matched' | 'queued';
  matched?: MatchedPair;
}

// ---- In-memory fallback ----
const memQueue: QueueEntry[] = [];
const memCodes = new Map<string, { gameId: string; expiresAt: number }>();

function memJoinQueue(entry: QueueEntry): QueueJoinResult {
  // de-duplicate by socketId only (allow same user in two tabs for testing)
  for (let i = memQueue.length - 1; i >= 0; i--) {
    if (memQueue[i].socketId === entry.socketId) {
      memQueue.splice(i, 1);
    }
  }
  // Try to take an opponent waiting
  const opponent = memQueue.pop();
  if (!opponent) {
    // No opponent yet: queue self
    memQueue.push(entry);
    return { status: 'queued' };
  }
  return { status: 'matched', matched: { gameId: uuid(), first: opponent, second: entry } };
}

function memLeaveQueue(entry: QueueEntry): void {
  for (let i = memQueue.length - 1; i >= 0; i--) {
    if (memQueue[i].socketId === entry.socketId) {
      memQueue.splice(i, 1);
    }
  }
}

function memCreateCode(gameId?: string): { code: string; gameId: string } {
  const gid = gameId ?? uuid();
  const code = uuid().slice(0, 6).toUpperCase();
  const expiresAt = Date.now() + CODE_TTL_SECONDS * 1000;
  memCodes.set(code, { gameId: gid, expiresAt });
  setTimeout(() => {
    const rec = memCodes.get(code);
    if (rec && rec.expiresAt <= Date.now()) memCodes.delete(code);
  }, CODE_TTL_SECONDS * 1000 + 1000).unref?.();
  return { code, gameId: gid };
}

function memResolveCode(code: string): string | null {
  const rec = memCodes.get(code);
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    memCodes.delete(code);
    return null;
  }
  return rec.gameId;
}

export async function joinQueue(entry: QueueEntry): Promise<QueueJoinResult> {
  try {
    const r = await ensureRedis();
    const raw = JSON.stringify(entry);

    // Keep only one queue entry per socketId: replace previous raw in list if present
    const skey = SOCKET_KEY_PREFIX + entry.socketId;
    const prev = await r.get(skey);
    await r.set(skey, raw, 'EX', 300).catch(() => undefined);
    if (prev && prev !== raw) {
      // best-effort remove old value for this socketId
      await r.lrem(QUEUE_KEY, 0, prev).catch(() => undefined);
    }
    // Try to pop ONE opponent from the tail (oldest waiting)
    const oppRaw = await r.rpop(QUEUE_KEY);
    if (!oppRaw) {
      // No opponent yet: push self and wait
      await r.lpush(QUEUE_KEY, raw);
      return { status: 'queued' };
    }

    try {
      const opponent: QueueEntry = JSON.parse(oppRaw);
      // If opponent is actually self (same socket), requeue self and wait
      if (opponent.socketId === entry.socketId) {
        await r.lpush(QUEUE_KEY, raw).catch(() => undefined);
        return { status: 'queued' };
      }
      const gameId = uuid();
      return { status: 'matched', matched: { gameId, first: opponent, second: entry } };
    } catch {
      // Malformed opponent: queue self and fallback to memory path
      await r.lpush(QUEUE_KEY, raw).catch(() => undefined);
      return memJoinQueue(entry);
    }
  } catch {
    // Redis unavailable → fallback to memory
    return memJoinQueue(entry);
  }
}

export async function leaveQueue(entry: QueueEntry): Promise<void> {
  try {
    const r = await ensureRedis();
    const raw = JSON.stringify(entry);
    await r.lrem(QUEUE_KEY, 0, raw).catch(() => undefined);
  } catch {
    memLeaveQueue(entry);
  }
}

export async function createPrivateGameCode(gameId?: string): Promise<{ code: string; gameId: string }> {
  try {
    const r = await ensureRedis();
    const gid = gameId ?? uuid();
    const code = uuid().slice(0, 6).toUpperCase();
    const key = PRIVATE_PREFIX + code;
    await r.set(key, gid, 'EX', CODE_TTL_SECONDS);
    return { code, gameId: gid };
  } catch {
    return memCreateCode(gameId);
  }
}

export async function resolveGameCode(code: string): Promise<string | null> {
  try {
    const r = await ensureRedis();
    const key = PRIVATE_PREFIX + code;
    const gid = await r.get(key);
    if (gid) return gid;
  } catch {
    // ignore and try memory
  }
  return memResolveCode(code);
}
