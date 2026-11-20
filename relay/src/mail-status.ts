/**
 * Последний результат отправки письма.
 *
 * Зачем: когда письмо не приходит, а Telegram приходит, снаружи не видно причины —
 * логи Cloudflare доступны только в дашборде. Поэтому результат последней попытки
 * кладётся в KV (или в память изолята) и отдаётся в `/health`:
 *
 *   emailLastOk      — время последнего успешного письма;
 *   emailLastError   — код ошибки последней неудачной попытки (например
 *                      `email_resend_http:403`), очищается первым успехом;
 *   emailLastErrorAt — когда это было.
 *
 * В значении только код и время: ни адресов, ни имён, ни текста заявок.
 */

export interface MailStatusEnv {
  ATS_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  };
}

const KEY_ERROR = 'mail:lastError';
const KEY_OK = 'mail:lastOk';
const TTL = 7 * 24 * 3600;

/* Без KV (локально, в тестах) помним последний результат в памяти изолята. */
const memory = new Map<string, string>();

async function read(env: MailStatusEnv, key: string): Promise<string | null> {
  if (env.ATS_KV) {
    try { return await env.ATS_KV.get(key); } catch { return null; }
  }
  return memory.get(key) ?? null;
}

async function write(env: MailStatusEnv, key: string, value: string): Promise<void> {
  if (env.ATS_KV) {
    try { await env.ATS_KV.put(key, value, { expirationTtl: TTL }); return; } catch { /* падать из-за диагностики нельзя */ }
  }
  memory.set(key, value);
}

/** Успешная отправка: отмечаем время и снимаем прошлую ошибку. */
export async function markMailOk(env: MailStatusEnv, at: Date = new Date()): Promise<void> {
  await write(env, KEY_OK, at.toISOString());
  await write(env, KEY_ERROR, '');
}

/** Неудачная отправка: запоминаем только код ошибки и время. */
export async function markMailFailed(env: MailStatusEnv, code: string, at: Date = new Date()): Promise<void> {
  await write(env, KEY_ERROR, `${String(code).slice(0, 120)}|${at.toISOString()}`);
}

export interface MailStatus {
  lastOk?: string;
  lastError?: string;
  lastErrorAt?: string;
}

export async function mailStatus(env: MailStatusEnv): Promise<MailStatus> {
  const [ok, failed] = await Promise.all([read(env, KEY_OK), read(env, KEY_ERROR)]);
  const out: MailStatus = {};
  if (ok) out.lastOk = ok;
  if (failed) {
    const [code, at] = failed.split('|');
    if (code) out.lastError = code;
    if (at) out.lastErrorAt = at;
  }
  return out;
}
