/**
 * Повторяет правила `site/src/server/validation.ts` (zod) на чистом TS —
 * Worker не тянет zod и БД, но обязан отвечать теми же кодами и русскими текстами.
 * Контракт заявки менять нельзя: поля те же, что у сайта.
 */
import { isValidSlotDate, SLOT_TIMES } from './slots.ts';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PHOTO_RE = /^upl_[A-Za-z0-9_-]+$/;

export const MIN_FILL_MS = 4000;

/** +7XXXXXXXXXX из 8/7/+7, скобок, пробелов и дефисов. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) d = '7' + d;
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
  if (d.length !== 11 || !d.startsWith('7')) return null;
  return '+7' + d.slice(1);
}

export interface Car {
  brand: string;
  model: string | null;
  year: number | null;
  vin: string | null;
  mileage: number | null;
}

export interface Preferred {
  date: string | null;
  slot: string | null;
  asap: boolean;
}

export interface LeadBase {
  name: string;
  phone: string;
  contact_method: 'call' | 'telegram';
  consent: true;
  consent_version: string;
  page: string;
  idempotency_key: string;
  honeypot: string;
  form_started_at?: number;
}

export interface BookingPayload extends LeadBase {
  kind: 'booking';
  car: Car;
  services: string[];
  preferred: Preferred;
  photos: string[];
}

export interface MessagePayload extends LeadBase {
  kind: 'message';
  message: string;
}

export type LeadPayload = BookingPayload | MessagePayload;

export type FieldErrors = Record<string, string>;

export type Validated =
  | { ok: true; value: LeadPayload }
  | { ok: false; error: 'bad_json' | 'validation'; fields: FieldErrors };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

export function validateLead(body: unknown): Validated {
  if (!isObj(body)) return { ok: false, error: 'bad_json', fields: {} };
  const isMessage = typeof body.message === 'string';
  const fields: FieldErrors = {};
  const bad = (k: string, msg: string): void => { if (!(k in fields)) fields[k] = msg; };

  // --- общие поля ---
  const name = str(body.name).trim();
  if (name.length < 2) bad('name', 'Укажите имя');
  else if (name.length > 60) bad('name', 'Имя — до 60 символов');

  const phone = normalizePhone(body.phone);
  if (!phone) bad('phone', 'Телефон: +7 (999) 999-99-99');

  const contactRaw = body.contact_method;
  const contact_method = contactRaw === undefined && isMessage ? 'call' : contactRaw;
  if (contact_method !== 'call' && contact_method !== 'telegram') {
    bad('contact_method', 'Выберите вариант из списка');
  }

  if (body.consent !== true) bad('consent', 'Без согласия на обработку данных отправить нельзя');

  const consent_version = str(body.consent_version);
  if (consent_version.length < 4) bad('consent_version', 'Версия согласия: не указана');

  const page = str(body.page);
  if (!page || page.length > 40) bad('page', 'Страница: не указана');

  const idempotency_key = str(body.idempotency_key);
  if (!UUID_RE.test(idempotency_key)) bad('idempotency_key', 'Ключ идемпотентности: uuid v4');

  const honeypot = str(body.honeypot);
  if (honeypot.length > 200) bad('honeypot', 'Значение больше допустимого');

  const form_started_at = body.form_started_at === undefined ? undefined : int(body.form_started_at);
  if (body.form_started_at !== undefined && (form_started_at == null || form_started_at <= 0)) {
    bad('form_started_at', 'Время заполнения: неверный формат значения');
  }

  const base = {
    name, phone: phone ?? '', contact_method: contact_method as 'call' | 'telegram',
    consent: true as const, consent_version, page, idempotency_key, honeypot,
    ...(form_started_at ? { form_started_at } : {}),
  };

  // Остальные блоки проверяем всегда: клиент должен увидеть все ошибки сразу,
  // как это делает zod на сервере, а не по одной за отправку.
  const value = isMessage ? collectMessage(body, fields) : collectBooking(body, fields);
  if (fields_has(fields)) return { ok: false, error: 'validation', fields };
  return { ok: true, value: { ...base, ...(value as object) } as LeadPayload };
}

const fields_has = (f: FieldErrors): boolean => Object.keys(f).length > 0;

function collectMessage(body: Record<string, unknown>, fields: FieldErrors): Partial<MessagePayload> {
  const message = str(body.message).trim();
  if (message.length < 10) fields.message = 'Опишите вопрос — минимум 10 символов';
  else if (message.length > 2000) fields.message = 'Значение больше допустимого';
  return { kind: 'message', message };
}

function collectBooking(body: Record<string, unknown>, fields: FieldErrors): Partial<BookingPayload> {

  const car = isObj(body.car) ? body.car : null;
  if (!car) {
    fields.car = 'Данные автомобиля: заполните блок';
  } else {
    const brand = str(car.brand).trim();
    if (brand.length < 2) fields['car.brand'] = 'Укажите марку';
    else if (brand.length > 60) fields['car.brand'] = 'Название марки — до 60 символов';
    const model = str(car.model).trim();
    if (model.length > 60) fields['car.model'] = 'Название модели — до 60 символов';
    if (car.year !== null && car.year !== undefined) {
      const y = int(car.year);
      if (y === null || y < 1980 || y > 2026) fields['car.year'] = 'Год выпуска — не раньше 1980 и не позже 2026';
    }
    if (car.vin !== null && car.vin !== undefined) {
      if (!VIN_RE.test(str(car.vin))) fields['car.vin'] = 'VIN: 17 символов, без I, O, Q';
    }
    if (car.mileage !== null && car.mileage !== undefined) {
      const m = int(car.mileage);
      if (m === null || m < 0 || m > 2000000) fields['car.mileage'] = 'Пробег — не больше 2 000 000 км';
    }
  }

  const servicesRaw = body.services;
  const services: string[] = [];
  if (!Array.isArray(servicesRaw) || servicesRaw.length === 0) {
    fields.services = 'Отметьте хотя бы одну услугу или «Не знаю — нужна диагностика»';
  } else if (servicesRaw.length > 8) {
    fields.services = 'Не больше 8 услуг за раз';
  } else if (!servicesRaw.every((s) => typeof s === 'string' && (SLUG_RE.test(s) || s === 'diagnostika'))) {
    fields.services = 'Неизвестная услуга';
  } else if (new Set(servicesRaw).size !== servicesRaw.length) {
    fields.services = 'Услуги повторяются';
  } else {
    services.push(...(servicesRaw as string[]));
  }

  const p = isObj(body.preferred) ? body.preferred : null;
  let preferred: Preferred = { date: null, slot: null, asap: false };
  if (!p) {
    fields.preferred = 'Дата и время: заполните блок';
  } else {
    const asap = p.asap === true;
    const date = p.date === null || p.date === undefined ? null : str(p.date);
    const slot = p.slot === null || p.slot === undefined ? null : str(p.slot);
    if (date && !isValidSlotDate(date)) fields['preferred.date'] = 'Дата должна быть в пределах 14 дней от сегодня';
    if (slot && !SLOT_TIMES.includes(slot)) fields['preferred.slot'] = 'Неверный слот';
    if (!asap && !(date && slot)) fields.preferred = 'Выберите дату и время или «как можно скорее»';
    preferred = { date: asap ? null : date, slot: asap ? null : slot, asap };
  }

  const photosRaw = body.photos ?? [];
  const photos: string[] = [];
  if (!Array.isArray(photosRaw)) fields.photos = 'Фото: неверный формат значения';
  else if (photosRaw.length > 3) fields.photos = 'Не больше 3 фото';
  else if (!photosRaw.every((x) => typeof x === 'string' && PHOTO_RE.test(x))) fields.photos = 'Фото: неверный формат значения';
  else photos.push(...(photosRaw as string[]));

  const c = (body.car ?? {}) as Record<string, unknown>;
  return {
    kind: 'booking',
    car: {
      brand: str(c.brand).trim(),
      model: str(c.model).trim() || null,
      year: c.year === null || c.year === undefined ? null : (c.year as number),
      vin: c.vin === null || c.vin === undefined ? null : str(c.vin),
      mileage: c.mileage === null || c.mileage === undefined ? null : (c.mileage as number),
    },
    services,
    preferred,
    photos,
  };
}
