/** In-memory sliding-window rate limit (для одного процесса; VPS 2 ГБ — один инстанс). */
const buckets = new Map<string, number[]>();

/** Проверка БЕЗ расхода квоты: сколько осталось в окне. */
export function peekLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  buckets.set(key, arr);
  if (arr.length >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000));
    return { ok: false, retryAfterSec };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Расход единицы квоты — вызывать только когда операция действительно удалась. */
export function consumeLimit(key: string): void {
  const arr = buckets.get(key) ?? [];
  arr.push(Date.now());
  buckets.set(key, arr);
}

/** Проверка с расходом единицы (для попыток, где важна каждая: вход, загрузки, антифлуд). */
export function checkLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000));
    return { ok: false, retryAfterSec };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true, retryAfterSec: 0 };
}

/** Периодическая чистка, чтобы карта не росла бесконечно. */
export function sweepLimits(): void {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const fresh = arr.filter((t) => now - t < 6 * 3600 * 1000);
    if (fresh.length === 0) buckets.delete(k); else buckets.set(k, fresh);
  }
}

/** Лимит из env: пустая строка, мусор, 0 и отрицательные значения → значение по умолчанию.
 *  Иначе `cp .env.example` (где строки RATE_LIMIT_* были активны и пусты) даёт
 *  Number('') === 0 → лимит 0 → каждая заявка и загрузка получают 429
 *  (блокер ревью round5; systemd EnvironmentFile подставляет именно пустую строку). */
export function limitFromEnv(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export const LIMITS = {
  leads: { max: 5, windowMs: 3600_000 },        // мягкая квота IP+cookie: 5/час, расходуются только успешные создания
  leadsIp: { max: 30, windowMs: 3600_000 },     // жёсткая квота ТОЛЬКО по IP: 30/час — подмена cookie не обходит
  antiflood: { max: 30, windowMs: 10 * 60_000 },// мягкий антифлуд IP+cookie: любые обращения к /api/leads, 30/10 мин
  antifloodIp: { max: 60, windowMs: 10 * 60_000 },// жёсткий антифлуд ТОЛЬКО по IP: 60/10 мин
  uploads: { max: 30, windowMs: 3600_000 },     // загрузки: 30/час
  login: { max: 5, windowMs: 15 * 60_000 },     // вход: 5/15 мин
} as const;
