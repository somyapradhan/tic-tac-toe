import { ensureRedis } from '../lib/redis';
import { ensureDb } from '../lib/db';

const LEADERBOARD_KEY = 'leaderboard:global'; // ZSET by wins
const USERNAMES_KEY = 'leaderboard:usernames'; // HASH playerId -> username

export interface LeaderboardEntry {
  playerId: string;
  wins: number;
}
export interface LeaderboardRow {
  playerId: string;
  username: string;
  wins: number;
}

// In-memory fallback
const memBoard = new Map<string, number>();
const memNames = new Map<string, string>();

function memIncrement(playerId: string, delta: number) {
  memBoard.set(playerId, (memBoard.get(playerId) ?? 0) + delta);
}

function memTop(n: number): LeaderboardEntry[] {
  const arr = Array.from(memBoard.entries()).map(([playerId, wins]) => ({ playerId, wins }));
  arr.sort((a, b) => b.wins - a.wins);
  return arr.slice(0, n);
}

function memResolveNames(entries: LeaderboardEntry[]): LeaderboardRow[] {
  return entries.map(e => ({ playerId: e.playerId, username: memNames.get(e.playerId) ?? e.playerId, wins: e.wins }));
}

export async function getTopLeaderboard(n = 10): Promise<LeaderboardRow[]> {
  // Primary: PostgreSQL
  try {
    const db = await ensureDb();
    const { rows } = await db.query(
      `select player_id as "playerId", username, wins
         from leaderboard
        order by wins desc, username asc
        limit $1`,
      [Math.max(1, Math.min(100, n))]
    );
    return rows as LeaderboardRow[];
  } catch {
    // Fallback: Redis
    try {
      const r = await ensureRedis();
      const raw = (await r.zrevrange(LEADERBOARD_KEY, 0, n - 1, 'WITHSCORES')) as unknown as string[];
      const out: LeaderboardEntry[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        const playerId = raw[i];
        const wins = Number(raw[i + 1] ?? '0');
        out.push({ playerId, wins });
      }
      if (out.length === 0) return [];
      const ids = out.map(e => e.playerId);
      const names = await r.hmget(USERNAMES_KEY, ...ids);
      const rows: LeaderboardRow[] = out.map((e, idx) => ({ playerId: e.playerId, username: names[idx] || e.playerId, wins: e.wins }));
      return rows;
    } catch {
      // Fallback: memory
      return memResolveNames(memTop(n));
    }
  }
}

export async function incrementWin(playerId: string, delta = 1, username?: string): Promise<void> {
  // Primary: PostgreSQL
  try {
    const db = await ensureDb();
    await db.query(
      `insert into leaderboard(player_id, username, wins)
       values ($1, $2, $3)
       on conflict (player_id) do update set
         username = excluded.username,
         wins = leaderboard.wins + excluded.wins,
         updated_at = now()`,
      [playerId, username ?? playerId, delta]
    );
    // Best-effort mirror to Redis cache
    try {
      const r = await ensureRedis();
      await r.zincrby(LEADERBOARD_KEY, delta, playerId);
      if (username) await r.hset(USERNAMES_KEY, playerId, username);
    } catch {}
    return;
  } catch {
    // Fallback: Redis, then memory
    try {
      const r = await ensureRedis();
      await r.zincrby(LEADERBOARD_KEY, delta, playerId);
      if (username) await r.hset(USERNAMES_KEY, playerId, username);
      return;
    } catch {
      memIncrement(playerId, delta);
      if (username) memNames.set(playerId, username);
    }
  }
}
