import { z } from 'zod';
import { allServiceSlugs } from './services.ts';
import { getSettings } from './settings.ts';
import { isValidSlotDate, SLOT_TIMES } from './slots.ts';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Нормализация телефона: +7XXXXXXXXXX. Принимает 8/7/+7, скобки, пробелы, дефисы. */
export function normalizePhone(raw: string): string | null {
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 10) d = '7' + d;
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
  if (d.length !== 11 || !d.startsWith('7')) return null;
  return '+7' + d.slice(1);
}

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const carSchema = z.object({
  brand: z.string().trim().min(2, 'Укажите марку').max(60, 'Название марки — до 60 символов'),
  model: z.string().trim().max(60, 'Название модели — до 60 символов').optional().nullable().transform((v) => v || null),
  year: z.union([z.number().int().min(1980, 'Год выпуска — не раньше 1980').max(2026, 'Год выпуска — не позже 2026'), z.null()]).optional().transform((v) => v ?? null),
  vin: z.union([z.string().regex(VIN_RE, 'VIN: 17 символов, без I, O, Q'), z.null()]).optional().transform((v) => v ?? null),
  mileage: z.union([z.number().int().min(0, 'Пробег — не меньше 0').max(2000000, 'Пробег — не больше 2 000 000 км'), z.null()]).optional().transform((v) => v ?? null),
});

const preferredSchema = z.object({
  date: z.string().refine(isValidSlotDate, 'Дата должна быть в пределах 14 дней от сегодня').nullable().optional().transform((v) => v ?? null),
  slot: z.string().refine((s) => SLOT_TIMES.includes(s), 'Неверный слот').nullable().optional().transform((v) => v ?? null),
  asap: z.boolean().optional().transform((v) => !!v),
}).refine((p) => p.asap || (p.date && p.slot), { message: 'Выберите дату и время или «как можно скорее»' });

function servicesValidator() {
  const allowed = new Set([...allServiceSlugs(), 'diagnostika']);
  return z.array(z.string()).min(1, 'Отметьте хотя бы одну услугу или «Не знаю — нужна диагностика»').max(8, 'Не больше 8 услуг за раз')
    .refine((arr) => arr.every((s) => allowed.has(s)), 'Неизвестная услуга')
    .refine((arr) => new Set(arr).size === arr.length, 'Услуги повторяются');
}

export const bookingSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(60, 'Имя — до 60 символов'),
  phone: z.string().transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) { ctx.addIssue({ code: 'custom', message: 'Телефон: +7 (999) 999-99-99' }); return z.NEVER; }
    return n;
  }),
  contact_method: z.enum(['call', 'telegram']),
  car: carSchema,
  services: z.lazy(servicesValidator),
  preferred: preferredSchema,
  photos: z.array(z.string().regex(/^upl_[A-Za-z0-9_-]+$/)).max(3).optional().transform((v) => v ?? []),
  consent: z.literal(true, { error: 'Без согласия на обработку данных отправить нельзя' }),
  consent_version: z.string().min(4),
  page: z.string().min(1).max(40),
  idempotency_key: z.string().regex(UUID_RE, 'Ключ идемпотентности: uuid v4'),
  honeypot: z.string().max(200).optional().transform((v) => v ?? ''),
  form_started_at: z.number().int().positive().optional(),
});

export const messageSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(60, 'Имя — до 60 символов'),
  phone: z.string().transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) { ctx.addIssue({ code: 'custom', message: 'Телефон: +7 (999) 999-99-99' }); return z.NEVER; }
    return n;
  }),
  contact_method: z.enum(['call', 'telegram']).optional().transform((v) => v ?? 'call'),
  message: z.string().trim().min(10, 'Опишите вопрос — минимум 10 символов').max(2000),
  consent: z.literal(true, { error: 'Без согласия на обработку данных отправить нельзя' }),
  consent_version: z.string().min(4),
  page: z.string().min(1).max(40),
  idempotency_key: z.string().regex(UUID_RE, 'Ключ идемпотентности: uuid v4'),
  honeypot: z.string().max(200).optional().transform((v) => v ?? ''),
  form_started_at: z.number().int().positive().optional(),
});

export type BookingPayload = z.infer<typeof bookingSchema>;
export type MessagePayload = z.infer<typeof messageSchema>;

export interface FieldErrors { fields: Record<string, string> }

/** Русский текст для стандартных сообщений zod (minor-1 ревью): если в сообщении
 *  нет кириллицы — значит это дефолт zod («Too big: expected number…»), меняем на понятный. */
function ruIssueMessage(issue: z.core.$ZodIssue): string {
  if (/[а-яА-ЯёЁ]/.test(issue.message)) return issue.message;
  switch (issue.code) {
    case 'too_big': return 'Значение больше допустимого';
    case 'too_small': return 'Значение меньше допустимого';
    case 'invalid_type': return 'Неверный формат значения';
    case 'invalid_value': return 'Выберите вариант из списка';
    case 'invalid_union': return 'Неверный формат значения';
    case 'unrecognized_keys': return 'Лишние поля в запросе';
    default: return 'Проверьте значение поля';
  }
}

/** Подписи полей — для generic-сообщений zod на отсутствующих объектах (nit ревью round4):
 *  «car: Неверный формат значения» бесполезен, «Данные автомобиля: заполните блок» — понятен. */
const FIELD_LABELS: Record<string, string> = {
  car: 'Данные автомобиля', preferred: 'Дата и время', photos: 'Фото', consent: 'Согласие',
  consent_version: 'Версия согласия', page: 'Страница', form_started_at: 'Время заполнения',
  idempotency_key: 'Ключ идемпотентности', contact_method: 'Способ связи', message: 'Текст вопроса',
  services: 'Услуги', name: 'Имя', phone: 'Телефон',
};

/** zod-ошибки → {code, message, fields} для ответа 400 (сообщения всегда по-русски). */
export function toErrorFields(err: z.ZodError): FieldErrors {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (key in fields) continue;
    let msg = ruIssueMessage(issue);
    const label = FIELD_LABELS[String(issue.path[0] ?? '')];
    // Для отсутствующих объектов zod даёт invalid_type на самом поле — заменяем generic на подпись.
    if (label && issue.code === 'invalid_type' && msg === 'Неверный формат значения') {
      msg = `${label}: заполните блок`;
    }
    fields[key] = msg;
  }
  return { fields };
}

export function consentVersionOk(v: string): boolean {
  return v === getSettings().consent_version;
}

export const MIN_FILL_MS = 4000; // минимальное время заполнения формы (антибот)
