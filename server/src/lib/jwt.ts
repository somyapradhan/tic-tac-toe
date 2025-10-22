import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthTokenPayload {
  id: string;
  username: string;
  name?: string | null;
}

export function signToken(payload: AuthTokenPayload, expiresIn: string = '7d') {
  return jwt.sign(payload, env.jwtSecret, { expiresIn });
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
  } catch {
    return null;
  }
}
