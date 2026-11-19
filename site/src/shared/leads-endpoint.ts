/**
 * Круг 80 / задание 80-1: единственный адрес приёмника заявок на весь сайт.
 *
 * Без `PUBLIC_LEADS_ENDPOINT` всё работает как раньше: формы ходят на свой сервер
 * (`/api/leads`, `/api/slots`) — это демо-режим и локальная сборка с Astro-сервером.
 * С `PUBLIC_LEADS_ENDPOINT=https://<прослойка>` заявки и слоты идут напрямую
 * в Cloudflare Worker, а сайт остаётся статикой на GitHub Pages.
 *
 * Здесь же — формат адреса (только https, без хвостового слэша), таймаут запроса
 * и флаг `relayMode`, по которому страницы прячут блок фото и демо-плашку.
 */

/** Сколько ждём ответа прослойки/сервера, прежде чем показать экран с телефоном. */
export const LEADS_TIMEOUT_MS = 12_000;

export interface LeadsEndpointInfo {
  /** Нормализованная база без хвостового слэша; пустая строка — демо-режим. */
  base: string;
  /** Текст ошибки конфигурации (тогда база пустая и сайт остаётся демо). */
  error: string | null;
}

/**
 * Разбирает значение переменной сборки.
 * Пустое значение — не ошибка: это демо-режим.
 */
export function parseLeadsEndpoint(raw: string | null | undefined): LeadsEndpointInfo {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { base: '', error: null };
  if (/\s/.test(value)) return { base: '', error: 'адрес прослойки содержит пробел' };
  if (!value.toLowerCase().startsWith('https://')) {
    return { base: '', error: 'адрес прослойки должен начинаться с https://' };
  }
  const base = value.replace(/\/+$/, '');
  const rest = base.slice('https://'.length);
  if (!rest) return { base: '', error: 'в адресе прослойки нет хоста' };
  if (/[?#]/.test(rest)) return { base: '', error: 'адрес прослойки не должен содержать ? или #' };
  if (!/^[a-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/i.test(rest)) {
    return { base: '', error: 'в адресе прослойки недопустимые символы' };
  }
  return { base, error: null };
}

/* Vite подставляет значение на сборке только в каноническую запись
   `import.meta.env.PUBLIC_LEADS_ENDPOINT` — поэтому она стоит здесь целиком,
   без промежуточных переменных и без `?.` (иначе в бандл уезжает мёртвый код). */
function fromViteEnv(): string {
  try {
    const value: unknown = import.meta.env.PUBLIC_LEADS_ENDPOINT;
    return typeof value === 'string' ? value : '';
  } catch {
    /* в Node import.meta.env нет — это не ошибка */
    return '';
  }
}

/** Значение из process.env — для скриптов сборки, гейтов и тестов. */
function fromNodeEnv(): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.PUBLIC_LEADS_ENDPOINT;
  return typeof value === 'string' ? value : '';
}

/** Сырое значение переменной: сначала сборка, потом окружение Node. */
export function leadsEndpointRaw(): string {
  const fromBuild = fromViteEnv();
  return fromBuild || fromNodeEnv();
}

const parsed = parseLeadsEndpoint(leadsEndpointRaw());

/** База прослойки без хвостового слэша; '' — работаем через свой сервер. */
export const LEADS_BASE = parsed.base;

/** Ошибка конфигурации адреса (если была) — её печатает check-leads-config. */
export const LEADS_ENDPOINT_ERROR = parsed.error;

/** true — заявки идут в прослойку: прячем блок фото, демо-плашку и обещания «базы сервиса». */
export const relayMode = LEADS_BASE !== '';

export type LeadsResource = 'leads' | 'slots';

/**
 * Адрес ресурса для заданной базы (чистая функция — её проверяют тесты и гейт).
 * `buildLeadsUrl('', 'leads')` → `/api/leads`
 * `buildLeadsUrl('https://worker', 'slots', 'date=2026-10-21')` → `https://worker/slots?date=…`
 */
export function buildLeadsUrl(base: string, resource: LeadsResource, query?: string): string {
  const tail = query ? `?${query}` : '';
  return base ? `${base}/${resource}${tail}` : `/api/${resource}${tail}`;
}

/** Адрес ресурса в текущем режиме сборки. */
export function leadsUrl(resource: LeadsResource, query?: string): string {
  return buildLeadsUrl(LEADS_BASE, resource, query);
}

/**
 * fetch с таймаутом. Прослойка может «зависнуть» — без ограничения человек
 * смотрит на «Отправляем…» бесконечно. По таймауту бросаем AbortError,
 * клиенты показывают обычный экран с телефоном.
 */
export async function leadsFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = LEADS_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Секунды из Retry-After (число секунд или дата); null — заголовка нет/он кривой. */
export function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const raw = header.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}
