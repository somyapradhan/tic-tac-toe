import { Router } from 'express';
import { getTopLeaderboard } from '../services/leaderboardService';

const router = Router();

router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 10)));
    const top = await getTopLeaderboard(limit);
    res.json({ top });
  } catch (err) {
    console.error('[leaderboard] error', err);
    res.status(500).json({ error: 'leaderboard_error' });
  }
});

export default router;
