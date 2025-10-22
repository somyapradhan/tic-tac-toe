import { ensureDb } from '../lib/db';
import { GameState } from '../types/game';
import { upsertPlayer } from '../lib/schema';

// In-memory recent list per player (fallback when DB is down)
const recentMem = new Map<string, GameRow[]>();
const MAX_RECENT = 20;

function pushRecentMem(game: GameState) {
  const row: GameRow = {
    id: game.id,
    x_player_id: game.players.X.id,
    o_player_id: game.players.O.id,
    winner: game.winner,
    moves: game.moves,
    started_at: new Date(game.startedAt).toISOString(),
    ended_at: game.endedAt ? new Date(game.endedAt).toISOString() : null,
  };
  const ids = [game.players.X.id, game.players.O.id];
  for (const pid of ids) {
    const arr = recentMem.get(pid) || [];
    arr.unshift(row);
    while (arr.length > MAX_RECENT) arr.pop();
    recentMem.set(pid, arr);
  }
}

export async function saveCompletedGame(game: GameState) {
  if (game.status !== 'completed') return; // only persist completed games
  pushRecentMem(game); // always keep memory copy
  try {
    const db = await ensureDb();
    // Ensure players exist / update usernames
    await upsertPlayer(game.players.X.id, game.players.X.username);
    await upsertPlayer(game.players.O.id, game.players.O.username);

    const winner = game.winner === null ? null : game.winner;
    await db.query(
      `insert into games (id, x_player_id, o_player_id, winner, moves, started_at, ended_at)
       values ($1,$2,$3,$4,$5,to_timestamp($6/1000.0), to_timestamp($7/1000.0))
       on conflict (id) do update set
         winner = excluded.winner,
         moves = excluded.moves,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at`,
      [
        game.id,
        game.players.X.id,
        game.players.O.id,
        winner,
        JSON.stringify(game.moves),
        game.startedAt,
        game.endedAt ?? game.startedAt,
      ]
    );
  } catch {
    // ignore; memory fallback already updated
  }
}

export interface GameRow {
  id: string;
  x_player_id: string;
  o_player_id: string;
  winner: string | null;
  moves: any;
  started_at: string; // ISO
  ended_at: string | null; // ISO
}

export async function getRecentGamesByPlayer(playerId: string, limit = 10, offset = 0): Promise<GameRow[]> {
  try {
    const db = await ensureDb();
    const { rows } = await db.query(
      `select id, x_player_id, o_player_id, winner, moves,
              started_at::timestamptz as started_at,
              ended_at::timestamptz as ended_at
         from games
        where x_player_id = $1 or o_player_id = $1
        order by ended_at desc nulls last, started_at desc
        limit $2 offset $3`,
      [playerId, Math.max(1, Math.min(100, limit)), Math.max(0, offset)]
    );
    return rows;
  } catch {
    const arr = recentMem.get(playerId) || [];
    const start = Math.max(0, offset);
    const end = start + Math.max(1, Math.min(100, limit));
    return arr.slice(start, end);
  }
}
