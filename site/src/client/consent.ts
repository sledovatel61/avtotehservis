/**
 * Согласие на cookies и подключение аналитики (круг 89, задание `prompts/133`).
 *
 * Принцип, ради которого файл существует: **до согласия ни один сторонний запрос
 * не уходит**. Поэтому в разметке нет ни `<script src="mc.yandex.ru/…">`, ни
 * `googletagmanager`: теги создаёт этот модуль, и только когда человек нажал
 * «Принять все» и в сборке задан ID счётчика.
 *
 * Почему `<noscript>`-пиксель Метрики мы НЕ ставим: он грузится у всех, кто зашёл
 * без JS, то есть до и без согласия. Это ровно то, что политика обещает не делать.
 * Если через полгода захочется «добавить полезное» — не надо: пиксель = обработка
 * данных без согласия.
 *
 * Модель хранения:
 *   • `localStorage['ats_consent_v1']` — основной источник для клиента;
 *   • cookie `ats_consent` (180 дней, SameSite=Lax, Secure на https) — чтобы факт
 *     выбора был виден и на сервере, и в аудите;
 *   • значение — `{"choice":"all"|"necessary","version":"<policy_version>","ts":"…"}`;
 *     выбор с чужой версией политики считается отсутствующим (переспросим).
 */
import { track } from './lib.ts';

/** Ключ хранилища. `v1` в имени — формат записи, а не версия политики. */
export const CONSENT_STORAGE_KEY = 'ats_consent_v1';
/** Cookie с тем же выбором — для серверной стороны и аудита. */
export const CONSENT_COOKIE = 'ats_consent';
/** 180 дней в секундах. */
export const CONSENT_MAX_AGE = 15_552_000;
/**
 * Версия политики, к которой относится выбор. Должна совпадать с
 * `policy_version` из `src/server/settings.ts` (дата вступления редакции §6).
 * Версия согласия формы (`consent_version`) — другая сущность, её не трогаем:
 * она сверяется с `relay/wrangler.toml`, и её смена ломает все заявки.
 */
export const POLICY_VERSION = '2026-11-21';

export type ConsentChoice = 'all' | 'necessary';
/** `unknown` — не спрашивали (или выбор относится к другой версии политики). */
export type ConsentState = ConsentChoice | 'unknown';

export interface CounterIds { ym?: string; ga?: string }

/** Хосты, которые нужно разрешить в CSP. Пустые массивы — счётчиков нет. */
export interface CounterHosts {
  script: string[];
  img: string[];
  connect: string[];
}

const YM = 'https://mc.yandex.ru';
const YM_CONNECT = [YM, 'https://mc.webvisor.org'];
const GA = 'https://www.googletagmanager.com';
const GA_IMG = ['https://www.google-analytics.com', GA];
const GA_CONNECT = ['https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', GA];

const uniq = (list: string[]): string[] => [...new Set(list)];

/** Разбор сохранённого выбора. Мусор, пусто и чужая версия → `unknown`. */
export function consentState(raw: unknown, version: string = POLICY_VERSION): ConsentState {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return 'unknown';
    try { data = JSON.parse(raw); } catch { return 'unknown'; }
  }
  if (!data || typeof data !== 'object') return 'unknown';
  const o = data as Record<string, unknown>;
  if (o.choice !== 'all' && o.choice !== 'necessary') return 'unknown';
  if (typeof o.version !== 'string' || o.version !== version) return 'unknown';
  return o.choice;
}

/** Грузим ли счётчики: только осознанное «все» и хотя бы один заданный ID. */
export function analyticsAllowed(choice: ConsentState, ids: CounterIds = {}): boolean {
  if (choice !== 'all') return false;
  return Boolean((ids.ym ?? '').trim() || (ids.ga ?? '').trim());
}

/** Хосты счётчиков для CSP: добавляются условно, по наличию ID. */
export function counterHosts(ids: CounterIds = {}): CounterHosts {
  const out: CounterHosts = { script: [], img: [], connect: [] };
  if ((ids.ym ?? '').trim()) {
    out.script.push(YM);
    out.img.push(YM);
    out.connect.push(...YM_CONNECT);
  }
  if ((ids.ga ?? '').trim()) {
    out.script.push(GA);
    out.img.push(...GA_IMG);
    out.connect.push(...GA_CONNECT);
  }
  return { script: uniq(out.script), img: uniq(out.img), connect: uniq(out.connect) };
}

/**
 * Политика CSP с условными доменами аналитики.
 * `directives` — готовые строки вида `script-src 'self'`; без хостов результат
 * побайтово равен `directives.join('; ')`, то есть строгая политика не меняется.
 */
export function cspWithAnalytics(directives: string[], hosts: CounterHosts = counterHosts({})): string {
  const extra: Record<string, string[]> = {
    'script-src': hosts.script,
    'img-src': hosts.img,
    'connect-src': hosts.connect,
  };
  return directives
    .filter(Boolean)
    .map((d) => {
      const [name, ...rest] = d.split(' ');
      const add = extra[name] ?? [];
      return [name, ...rest, ...add].join(' ');
    })
    .join('; ');
}

/** Значение cookie по имени (пустая строка, если нет). */
function readCookie(name: string): string {
  const parts = document.cookie ? document.cookie.split('; ') : [];
  const found = parts.find((c) => c.startsWith(`${name}=`));
  if (!found) return '';
  try { return decodeURIComponent(found.slice(name.length + 1)); } catch { return ''; }
}

/** Текущий выбор: сначала localStorage, затем cookie. */
export function currentConsent(version: string = POLICY_VERSION): ConsentState {
  if (typeof window === 'undefined') return 'unknown';
  let raw = '';
  try { raw = window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? ''; } catch { raw = ''; }
  const stored = consentState(raw, version);
  if (stored !== 'unknown') return stored;
  return consentState(readCookie(CONSENT_COOKIE), version);
}

/** Записать выбор в localStorage и cookie. */
export function saveConsent(choice: ConsentChoice, version: string = POLICY_VERSION): void {
  const payload = JSON.stringify({ choice, version, ts: new Date().toISOString() });
  try { window.localStorage.setItem(CONSENT_STORAGE_KEY, payload); } catch { /* приватный режим */ }
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(payload)}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

/** Аналитические cookie, которые надо снести при отзыве согласия. */
const ANALYTICS_COOKIE_PREFIXES = ['_ym_', '_ga', '_gid'];

function purgeAnalyticsCookies(): void {
  if (!document.cookie) return;
  const names = document.cookie.split(';').map((c) => c.trim().split('=')[0]).filter(Boolean);
  const host = window.location.hostname;
  const registrable = host.split('.').slice(-2).join('.');
  for (const name of names) {
    if (!ANALYTICS_COOKIE_PREFIXES.some((p) => name.startsWith(p))) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/`;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${host}`;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${registrable}`;
  }
}

/** Отозвать согласие: состояние → «не спрашивали», аналитические cookie удалены. */
export function clearConsent(): void {
  try { window.localStorage.removeItem(CONSENT_STORAGE_KEY); } catch { /* приватный режим */ }
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  purgeAnalyticsCookies();
}

/** Флаг в памяти: повторная инициализация счётчиков запрещена. */
let countersLoaded = false;

function loadYandex(id: string): void {
  const w = window as unknown as { ym?: (...args: unknown[]) => void };
  if (!w.ym) {
    const queue: unknown[][] = [];
    w.ym = (...args: unknown[]) => { queue.push(args); };
    (w.ym as unknown as { a: unknown[][] }).a = queue;
  }
  w.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `${YM}/metrika/tag.js`;
  document.head.append(s);
}

function loadGa(id: string): void {
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer ?? [];
  if (!w.gtag) {
    w.gtag = (...args: unknown[]) => { w.dataLayer?.push(args); };
  }
  w.gtag('js', new Date());
  w.gtag('config', id, { anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = `${GA}/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(s);
}

/** ID счётчиков из `<html data-ym data-ga>` (пустые, если переменных сборки нет). */
export function readCounterIds(): CounterIds {
  if (typeof document === 'undefined') return {};
  const d = document.documentElement.dataset;
  return { ym: (d.ym ?? '').trim(), ga: (d.ga ?? '').trim() };
}

/** Версия политики из `<html data-policy-version>` (фолбэк — константа модуля). */
export function readPolicyVersion(): string {
  if (typeof document === 'undefined') return POLICY_VERSION;
  return (document.documentElement.dataset.policyVersion ?? '').trim() || POLICY_VERSION;
}

/**
 * Подключить счётчики. Возвращает `true`, если теги были вставлены сейчас.
 * Повторные вызовы и вызов без согласия ничего не делают.
 */
export function loadAnalytics(
  ids: CounterIds = readCounterIds(),
  version: string = readPolicyVersion(),
): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (countersLoaded) return false;
  if (!analyticsAllowed(currentConsent(version), ids)) return false;
  countersLoaded = true;
  const ym = (ids.ym ?? '').trim();
  if (ym) loadYandex(ym);
  const ga = (ids.ga ?? '').trim();
  if (ga) loadGa(ga);
  track('analytics_on', { ym: Boolean(ym), ga: Boolean(ga) });
  return true;
}

/** Сбросить флаг загрузки — только для тестов/manual-проверок. */
export function resetAnalyticsFlag(): void {
  countersLoaded = false;
}

/** `/manage` и `/admin` — служебные: ни баннера, ни счётчиков. */
function isServicePath(path: string): boolean {
  return path.startsWith('/manage') || path.startsWith('/admin');
}

function initConsent(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (isServicePath(window.location.pathname)) return;

  const panel = document.querySelector<HTMLElement>('[data-consent]');
  if (!panel) return;
  const revoke = panel.querySelector<HTMLElement>('[data-consent-revoke]');
  const note = panel.querySelector<HTMLElement>('[data-consent-note]');
  const version = readPolicyVersion();

  const show = (on: boolean, withNote = false): void => {
    panel.hidden = !on;
    /* мобильный док уступает место панели, чтобы они не наезжали друг на друга */
    document.body.classList.toggle('consent-open', on);
    if (note) note.hidden = !(on && withNote);
    if (revoke) revoke.hidden = currentConsent(version) === 'unknown';
  };
  const apply = (state: ConsentState): void => {
    if (state === 'all') loadAnalytics(readCounterIds(), version);
    show(state === 'unknown');
  };

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-consent-open]')) { show(true, true); return; }
    if (target.closest('[data-consent-accept]')) { saveConsent('all', version); apply('all'); return; }
    if (target.closest('[data-consent-necessary]')) { saveConsent('necessary', version); apply('necessary'); return; }
    if (target.closest('[data-consent-revoke]')) {
      clearConsent();
      /* Сторонние скрипты уже в документе; честно пишем об этом в панели. */
      show(true, true);
    }
  });

  apply(currentConsent(version));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initConsent);
  else initConsent();
}
