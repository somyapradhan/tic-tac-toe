import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { createUser, getUserByUsername } from '../repositories/usersRepo';
import { signToken } from '../lib/jwt';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(1).max(80),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(12),
});

router.post('/auth/register', async (req, res) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await getUserByUsername(body.username);
    if (existing) return res.status(409).json({ error: 'username_taken' });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(body.password, salt);
    const user = await createUser({ username: body.username, name: body.name, passwordHash: hash });

    const token = signToken({ id: user.id, username: user.username, name: user.name });
    res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'invalid_input', details: err.issues });
    res.status(500).json({ error: 'register_failed' });
  }
});

const loginSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6).max(12),
});

router.post('/auth/login', async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await getUserByUsername(body.username);
    if (!user || !user.password_hash) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken({ id: user.id, username: user.username, name: user.name });
    res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'invalid_input', details: err.issues });
    res.status(500).json({ error: 'login_failed' });
  }
});

export default router;
