import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { env } from '../config/env';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; username: string; name?: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers['authorization'];
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const bodyTok = (req.body as any)?.token as string | undefined;
    const queryTok = (req.query as any)?.token as string | undefined;
    const t: string | undefined = bearer ?? bodyTok ?? queryTok ?? undefined;
    if (!t) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const payload = verifyToken(t);
    if (!payload) return res.status(401).json({ error: 'unauthorized' });
    req.user = { id: payload.id, username: payload.username, name: payload.name };
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
