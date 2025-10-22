import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getRecentGamesByPlayer } from '../repositories/gamesRepo';
import { getUserById } from '../repositories/usersRepo';

const router = Router();

// GET /me/games?limit=10
router.get('/me/games', requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 10)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const games = await getRecentGamesByPlayer(user.id, limit, offset);
    // Resolve usernames (works even if DB is down thanks to usersRepo fallback)
    const uniqIds = new Set<string>();
    for (const g of games) { uniqIds.add(g.x_player_id); uniqIds.add(g.o_player_id); }
    const idToName = new Map<string, string>();
    await Promise.all(Array.from(uniqIds).map(async (id) => {
      const u = await getUserById(id);
      if (u) idToName.set(id, u.username);
    }));

    const formatted = games.map(g => {
      const youAreX = g.x_player_id === user.id;
      const yourMark = youAreX ? 'X' : 'O';
      const oppId = youAreX ? g.o_player_id : g.x_player_id;
      const result = g.winner === 'draw' ? 'Draw' : (g.winner === yourMark ? 'You won' : 'You lost');
      const x_username = idToName.get(g.x_player_id) || g.x_player_id;
      const o_username = idToName.get(g.o_player_id) || g.o_player_id;
      return { ...g, your_mark: yourMark, opponent_id: oppId, result, x_username, o_username };
    });
    res.json({ games: formatted, limit, offset });
  } catch (err) {
    console.error('[profile] me/games error', err);
    res.status(500).json({ error: 'me_games_error' });
  }
});

export default router;
