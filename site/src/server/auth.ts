import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.ts';

const scrypt = promisify(_scrypt) as (pw: string | Buffer, salt: string | Buffer, keylen: number, opts: object) => Promise<Buffer>;

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const derived = await scrypt(password, salt, Buffer.from(hash, 'hex').length, { N: +n, r: +r, p: +p, maxmem: 128 * (+n) * (+r) * 2 });
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}

export const SESSION_COOKIE = 'ats_session';
const SESSION_DAYS = 7;

export function createSession(userId: number, userAgent: string | null, ipHash: string | null): string {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  db().prepare(`INSERT INTO sessions(token_hash, user_id, expires_at, user_agent, ip_hash)
                VALUES(?, ?, datetime('now', '+${SESSION_DAYS} days'), ?, ?)`)
    .run(tokenHash, userId, userAgent, ipHash);
  return token;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface SessionUser { id: number; login: string; role: string }

export function resolveSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db().prepare(`SELECT u.id, u.login, u.role FROM sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')`).get(sha256(token)) as SessionUser | undefined;
  return row ?? null;
}

export function destroySession(token: string | undefined): void {
  if (token) db().prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
}

export function cleanupSessions(): void {
  db().prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

export function findUser(login: string): { id: number; login: string; password_hash: string; role: string } | undefined {
  return db().prepare('SELECT id, login, password_hash, role FROM admin_users WHERE login=?').get(login) as
    { id: number; login: string; password_hash: string; role: string } | undefined;
}
