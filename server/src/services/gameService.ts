import { GameState, Move, PlayerInfo, PlayerMark } from '../types/game';
import { v4 as uuid } from 'uuid';
import { ensureRedis } from '../lib/redis';
import type { MatchedPair } from './matchmakingService';

export function createGame(x: PlayerInfo, o: PlayerInfo): GameState {
  return {
    id: uuid(),
    board: Array(9).fill(null),
    players: { X: x, O: o },
    currentTurn: 'X',
    status: 'active',
    winner: null,
    moves: [],
    startedAt: Date.now(),
  };
}

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function detectWinner(board: (PlayerMark | null)[]): PlayerMark | 'draw' | null {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a];
    }
  }
  if (board.every((c) => c !== null)) return 'draw';
  return null;
}

export function applyMove(game: GameState, move: Omit<Move, 'at'>): GameState {
  if (game.status !== 'active') throw new Error('Game not active');
  if (move.mark !== game.currentTurn) throw new Error('Not your turn');
  if (move.index < 0 || move.index > 8) throw new Error('Invalid cell index');
  if (game.board[move.index] !== null) throw new Error('Cell occupied');

  const board = game.board.slice();
  board[move.index] = move.mark;
  const moves = game.moves.concat({ ...move, at: Date.now() });

  const winner = detectWinner(board);
  let status: GameState['status'] = game.status;
  let endedAt: number | undefined = game.endedAt;
  if (winner) {
    status = 'completed';
    endedAt = Date.now();
  }

  const nextTurn: PlayerMark = move.mark === 'X' ? 'O' : 'X';

  return {
    ...game,
    board,
    moves,
    currentTurn: winner ? game.currentTurn : nextTurn,
    status,
    winner,
    endedAt,
  };
}

// ---- Redis persistence helpers ----
const GAME_PREFIX = 'game:'; // value = JSON GameState
const GAME_TTL_SECONDS = 60 * 60; // 1 hour TTL for completed games in Redis

// In-memory fallback store
const memGames = new Map<string, GameState>();
const memExpiry = new Map<string, number>();
function memSave(game: GameState) {
  memGames.set(game.id, game);
  if (game.status === 'completed') {
    const until = Date.now() + GAME_TTL_SECONDS * 1000;
    memExpiry.set(game.id, until);
    setTimeout(() => {
      const t = memExpiry.get(game.id);
      if (t && t <= Date.now()) {
        memGames.delete(game.id);
        memExpiry.delete(game.id);
      }
    }, GAME_TTL_SECONDS * 1000 + 1000).unref?.();
  }
}

export async function createGameForPair(pair: MatchedPair): Promise<GameState> {
  // Assign X and O deterministically: first is X, second is O
  const x: PlayerInfo = { id: pair.first.playerId, username: pair.first.username ?? 'PlayerX' };
  const o: PlayerInfo = { id: pair.second.playerId, username: pair.second.username ?? 'PlayerO' };
  const game: GameState = {
    id: pair.gameId,
    board: Array(9).fill(null),
    players: { X: x, O: o },
    currentTurn: 'X',
    status: 'active',
    winner: null,
    moves: [],
    startedAt: Date.now(),
  };
  try {
    const r = await ensureRedis();
    const key = GAME_PREFIX + game.id;
    await r.set(key, JSON.stringify(game));
  } catch {
    memSave(game);
  }
  return game;
}

export async function loadGame(gameId: string): Promise<GameState | null> {
  try {
    const r = await ensureRedis();
    const raw = await r.get(GAME_PREFIX + gameId);
    if (!raw) return memGames.get(gameId) ?? null;
    try {
      return JSON.parse(raw) as GameState;
    } catch {
      return memGames.get(gameId) ?? null;
    }
  } catch {
    return memGames.get(gameId) ?? null;
  }
}

export async function saveGame(game: GameState): Promise<void> {
  try {
    const r = await ensureRedis();
    const key = GAME_PREFIX + game.id;
    await r.set(key, JSON.stringify(game));
    if (game.status === 'completed') {
      await r.expire(key, GAME_TTL_SECONDS);
    }
  } catch {
    memSave(game);
  }
}

export interface MoveInput {
  gameId: string;
  playerId: string;
  index: number;
}

export async function applyMoveAndPersist(input: MoveInput): Promise<GameState> {
  const game = await loadGame(input.gameId);
  if (!game) throw new Error('Game not found');
  // Determine player's mark
  let mark: PlayerMark | null = null;
  if (game.players.X.id === input.playerId) mark = 'X';
  if (game.players.O.id === input.playerId) mark = 'O';
  if (!mark) throw new Error('Player not in game');

  const updated = applyMove(game, { playerId: input.playerId, mark, index: input.index });
  await saveGame(updated);
  return updated;
}

export function gameRoom(gameId: string) {
  return `game:${gameId}`;
}
