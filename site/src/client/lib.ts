/* Утилиты клиентских модулей (TS strict). */
export const $ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document): T | null =>
  root.querySelector(s) as T | null;
export const $$ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll(s)) as T[];

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** localStorage может быть недоступен (приватный режим, ограничения file://) — деградируем тихо. */
export const safeLS = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, val: string): void {
    try { window.localStorage.setItem(key, val); } catch { /* нет хранилища — работаем без черновика */ }
  },
  del(key: string): void {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Отладочная аналитика: структурные события в консоль. Метрики на сайт не ставим (152-ФЗ, чужие счётчики запрещены). */
export function track(name: string, data?: Record<string, unknown>): void {
  try { console.debug('[event]', name, data ?? {}); } catch { /* ignore */ }
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Фокус-ловушка: Tab циклит внутри root, возвращает ранее активный элемент при закрытии. */
export function trapFocus(root: HTMLElement, keyHandler: (e: KeyboardEvent) => boolean): () => void {
  const prev = document.activeElement as HTMLElement | null;
  const onKey = (e: KeyboardEvent): void => {
    if (keyHandler(e)) return;
    if (e.key !== 'Tab') return;
    const items = $$(FOCUSABLE, root).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  const first = $$(FOCUSABLE, root).find((el) => el.offsetParent !== null);
  try { (first ?? root).focus(); } catch { /* ignore */ }
  return () => {
    document.removeEventListener('keydown', onKey);
    try { prev?.focus(); } catch { /* ignore */ }
  };
}

/** Маска +7 (999) 999-99-99: вставка из буфера не ломает формат. */
export function attachMask(input: HTMLInputElement): void {
  const digitsOnly = (v: string): string => v.replace(/\D/g, '');
  const fmt = (d: string): string => {
    let s = d;
    if (s.startsWith('8')) s = '7' + s.slice(1);
    if (!s.startsWith('7')) s = '7' + s;
    s = s.slice(0, 11);
    const p = s.slice(1);
    let out = '+7';
    if (p.length > 0) out += ' (' + p.slice(0, 3);
    if (p.length >= 3) out += ')';
    if (p.length > 3) out += ' ' + p.slice(3, 6);
    if (p.length > 6) out += '-' + p.slice(6, 8);
    if (p.length > 8) out += '-' + p.slice(8, 10);
    return out;
  };
  const apply = (): void => {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value;
    const after = fmt(digitsOnly(before));
    if (before === after) return;
    input.value = after;
    const diff = after.length - before.length;
    const np = Math.max(0, Math.min(after.length, pos + diff));
    try { input.setSelectionRange(np, np); } catch { /* ignore */ }
  };
  input.addEventListener('input', apply);
  input.addEventListener('blur', () => { if (digitsOnly(input.value).length === 1) input.value = ''; });
  if (input.value) apply();
}

/** VIN: 17 символов, I/O/Q запрещены, верхний регистр. */
export function attachVin(input: HTMLInputElement, hint?: HTMLElement | null): void {
  const upd = (): void => {
    const v = input.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
    if (v !== input.value) input.value = v;
    if (hint) hint.textContent = v.length === 0 ? '17 символов, без I, O, Q' : `${v.length}/17`;
  };
  input.addEventListener('input', upd);
  upd();
}
