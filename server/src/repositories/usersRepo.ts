import { ensureDb } from '../lib/db';
import { v4 as uuid } from 'uuid';

export interface User {
  id: string;
  username: string;
  name: string | null;
  password_hash: string | null;
}

// In-memory fallback store (used only if DB is unavailable)
const memUsers = new Map<string, User>(); // key by id
const memByUsername = new Map<string, string>(); // username -> id

export async function createUser(opts: { username: string; name: string; passwordHash: string }): Promise<User> {
  try {
    const db = await ensureDb();
    const id = uuid();
    const { rows } = await db.query(
      `insert into players (id, username, name, password_hash)
       values ($1, $2, $3, $4)
       returning id, username, name, password_hash`,
      [id, opts.username, opts.name, opts.passwordHash]
    );
    return rows[0];
  } catch {
    // Fallback to memory
    const id = uuid();
    const user: User = { id, username: opts.username, name: opts.name, password_hash: opts.passwordHash };
    memUsers.set(id, user);
    memByUsername.set(opts.username.toLowerCase(), id);
    return user;
  }
}

export async function getUserByUsername(username: string): Promise<User | null> {
  try {
    const db = await ensureDb();
    const { rows } = await db.query(
      `select id, username, name, password_hash from players where lower(username) = lower($1) limit 1`,
      [username]
    );
    return rows[0] || null;
  } catch {
    const id = memByUsername.get(username.toLowerCase());
    return id ? memUsers.get(id) || null : null;
  }
}

export async function getUserById(id: string): Promise<User | null> {
  try {
    const db = await ensureDb();
    const { rows } = await db.query(
      `select id, username, name, password_hash from players where id = $1 limit 1`,
      [id]
    );
    return rows[0] || null;
  } catch {
    return memUsers.get(id) || null;
  }
}
