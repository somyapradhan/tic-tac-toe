import type { Server as HTTPServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { joinQueue, leaveQueue, createPrivateGameCode, resolveGameCode, type QueueEntry } from '../services/matchmakingService';
import { createGameForPair, gameRoom, applyMoveAndPersist, loadGame } from '../services/gameService';
import { incrementWin } from '../services/leaderboardService';
import { saveCompletedGame } from '../repositories/gamesRepo';
import { verifyToken } from '../lib/jwt';

export function createSocketServer(httpServer: HTTPServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigin,
      methods: ['GET', 'POST'],
    },
  });

  // Auth middleware: require JWT; in development, allow guest identity if JWT missing
  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth as any;
      const header = socket.handshake.headers['authorization'] as string | undefined;
      const token = auth?.token || (header && header.startsWith('Bearer ') ? header.slice(7) : undefined);
      if (!token) {
        if (env.nodeEnv === 'development') {
          // Allow a guest user for local testing when auth is not set up
          (socket as any).data = (socket as any).data || {};
          (socket as any).data.user = { id: `guest:${socket.id}`, username: `guest_${socket.id.slice(0,4)}`, name: 'Guest' };
          console.warn('[socket-auth] no token, allowing guest in development for', socket.id);
          return next();
        }
        console.warn('[socket-auth] missing token, rejecting', socket.id);
        return next(new Error('unauthorized'));
      }
      const payload = verifyToken(token);
      if (!payload) {
        if (env.nodeEnv === 'development') {
          (socket as any).data = (socket as any).data || {};
          (socket as any).data.user = { id: `guest:${socket.id}`, username: `guest_${socket.id.slice(0,4)}`, name: 'Guest' };
          console.warn('[socket-auth] invalid token, allowing guest in development for', socket.id);
          return next();
        }
        console.warn('[socket-auth] invalid token, rejecting', socket.id);
        return next(new Error('unauthorized'));
      }
      // Attach identity to socket
      (socket as any).data = (socket as any).data || {};
      (socket as any).data.user = { id: payload.id, username: payload.username, name: payload.name };
      return next();
    } catch (e) {
      console.warn('[socket-auth] error during auth', (e as any)?.message || e);
      if (env.nodeEnv === 'development') {
        (socket as any).data = (socket as any).data || {};
        (socket as any).data.user = { id: `guest:${socket.id}`, username: `guest_${socket.id.slice(0,4)}`, name: 'Guest' };
        return next();
      }
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const sid = socket.id;
    console.log(`[socket] connected: ${sid}`);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${sid} reason=${reason}`);
    });

    // Placeholder events
    socket.on('ping:client', (payload) => {
      socket.emit('pong:server', { received: payload, at: Date.now() });
    });

    // --- Matchmaking placeholders ---
    socket.on('matchmaking:join', async (_payload: any) => {
      try {
        const user = (socket as any).data?.user;
        if (!user) return socket.emit('error', { type: 'unauthorized' });
        const entry: QueueEntry = { playerId: user.id, socketId: sid, username: user.username };
        const result = await joinQueue(entry);
        console.log('[mm] join from', sid, 'user', user.username, 'status', result.status);
        if (result.status === 'queued') {
          socket.emit('matchmaking:queued', { ok: true });
          return;
        }
        if (!result.matched) return;
        const game = await createGameForPair(result.matched);
        const room = gameRoom(game.id);

        // Validate sockets are still connected; if not, requeue the connected one
        const s1 = io.sockets.sockets.get(result.matched.first.socketId);
        const s2 = io.sockets.sockets.get(result.matched.second.socketId);
        if (!s1 || !s2) {
          const present = s1 ? result.matched.first : s2 ? result.matched.second : null;
          if (present) {
            // requeue the connected one
            const again = await joinQueue(present);
            if (again.status === 'queued') {
              if (present.socketId === sid) socket.emit('matchmaking:queued', { ok: true });
              return;
            }
            // if matched immediately with someone else, process that new match
            if (again.matched) {
              const game2 = await createGameForPair(again.matched);
              const room2 = gameRoom(game2.id);
              const sa = io.sockets.sockets.get(again.matched.first.socketId);
              const sb = io.sockets.sockets.get(again.matched.second.socketId);
              sa?.join(room2);
              sb?.join(room2);
              io.to(room2).emit('game:matched', { gameId: game2.id, players: game2.players });
              io.to(room2).emit('game:state', game2);
              return;
            }
          }
          // if neither present, just stop; they'll requeue on next join
          return;
        }

        // Join both sockets to the room and start
        s1.join(room);
        s2.join(room);
        // Emit to room and directly to sockets to avoid race conditions
        io.to(room).emit('game:matched', { gameId: game.id, players: game.players });
        io.to(room).emit('game:state', game);
        s1.emit('game:matched', { gameId: game.id, players: game.players });
        s1.emit('game:state', game);
        s2.emit('game:matched', { gameId: game.id, players: game.players });
        s2.emit('game:state', game);
        console.log('[mm] matched room', room, 'players', game.players.X.username, 'vs', game.players.O.username);
      } catch (err) {
        socket.emit('error', { type: 'matchmaking_join_error' });
      }
    });

    socket.on('matchmaking:leave', async (_payload: any) => {
      try {
        const user = (socket as any).data?.user;
        if (!user) return socket.emit('error', { type: 'unauthorized' });
        const entry: QueueEntry = { playerId: user.id, socketId: sid, username: user.username };
        await leaveQueue(entry);
        socket.emit('matchmaking:left', { ok: true });
      } catch (err) {
        socket.emit('error', { type: 'matchmaking_leave_error' });
      }
    });

    socket.on('matchmaking:create_private', async () => {
      try {
        const { code, gameId } = await createPrivateGameCode();
        socket.emit('matchmaking:private_created', { code, gameId });
      } catch (err) {
        socket.emit('error', { type: 'private_create_error' });
      }
    });

    socket.on('matchmaking:join_code', async (payload: { code: string }) => {
      try {
        const gameId = await resolveGameCode(payload.code);
        if (!gameId) return socket.emit('error', { type: 'invalid_code' });
        socket.emit('game:matched', { status: 'matched', gameId });
      } catch (err) {
        socket.emit('error', { type: 'join_code_error' });
      }
    });

    // --- Game events ---
    socket.on('game:move', async (payload: { gameId: string; index: number }) => {
      try {
        const user = (socket as any).data?.user;
        if (!user) return socket.emit('game:error', { error: 'unauthorized' });
        const updated = await applyMoveAndPersist({ gameId: payload.gameId, playerId: user.id, index: payload.index });
        const room = gameRoom(payload.gameId);
        io.to(room).emit('game:state', updated);
        if (updated.status === 'completed') {
          io.to(room).emit('game:ended', { winner: updated.winner });
          // Update leaderboard on non-draw (include username for mapping)
          if (updated.winner === 'X') {
            await incrementWin(updated.players.X.id, 1, updated.players.X.username);
          } else if (updated.winner === 'O') {
            await incrementWin(updated.players.O.id, 1, updated.players.O.username);
          }
          // Persist to PostgreSQL
          try { await saveCompletedGame(updated); } catch (e) { /* log but do not crash */ console.error('[persist] save game failed', e); }
        }
      } catch (err: any) {
        socket.emit('game:error', { error: err?.message ?? 'move_error' });
      }
    });

    socket.on('game:leave', async (payload: { gameId: string }) => {
      const room = gameRoom(payload.gameId);
      socket.leave(room);
      socket.emit('game:left', { ok: true });
    });
  });

  return io;
}
