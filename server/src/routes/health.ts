import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tic-tac-toe', version: '0.1.0' });
});

export default router;
