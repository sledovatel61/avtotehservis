import { db } from './db.ts';

export interface PhoneExtra { title: string; display: string; tel: string }
export interface Rating { source: string; value: string; count: number; note: string; url: string }

export interface Settings {
  site_name: string;
  city: string;
  address: string;
  address_full: string;
  address_short: string;
  landmark: string;
  coords: { lat: number; lon: number };
  hours: string;
  phone_main: string;
  phone_main_tel: string;
  phones_extra: PhoneExtra[];
  telegram_phone: string;
  telegram_url: string;
  email: string;
  legal: { name: string; inn: string; ogrnip: string };
  ratings_visible: boolean;
  ratings: Rating[];
  consent_version: string;
  slot_capacity: number;
  map_link: string;
  brands: string[];
}

/** Значения по умолчанию — факты из prompts/04 Приложение А и docs/01 (адрес, телефоны, юрлицо). */
export const DEFAULTS: Settings = {
  site_name: 'АвтоТехСервис',
  city: 'Ростов-на-Дону',
  address: 'ул. Портовая, 439',
  address_full: 'Ростов-на-Дону, ул. Портовая, 439',
  address_short: 'Портовая 439',
  landmark: 'ост. «3-й Поселковый» ~330 м, рядом база «Бум»',
  coords: { lat: 47.193068, lon: 39.648295 },
  hours: 'ежедневно 9:00–19:00',
  phone_main: '+7 (928) 906-57-00',
  phone_main_tel: '+79289065700',
  // Доп. номера СКРЫТЫ до подтверждения владельцем (docs/06 C5, §3 ревью round5):
  // значения найдены в сторонних каталогах. Владельцу — заполнить display/tel
  // в /admin/settings; при пустом tel номер не показывается. Пункт в docs/12.
  phones_extra: [
    { title: 'Приёмная', display: '', tel: '' },
    { title: 'Ремонтная зона', display: '', tel: '' },
  ],
  telegram_phone: '+7 (951) 826-98-39',
  telegram_url: 'https://t.me/+79518269839',
  email: 'avtotehservis439@mail.ru',
  legal: { name: 'ИП Яковенко Павел Иванович', inn: '341010400388', ogrnip: '324619600117335' },
  // Блок рейтингов скрыт, пока владелец не подтвердит цифры (требование задания §6).
  ratings_visible: false,
  ratings: [
    { source: 'Яндекс Карты', value: '4,5', count: 182, note: 'данные заказчика, требуется проверка', url: 'https://yandex.ru/maps/?text=АвтоТехСервис+Ростов-на-Дону+Портовая+439' },
    { source: '2ГИС', value: '3,6', count: 12, note: 'поисковая выдача на 21.10.2026', url: 'https://2gis.ru/rostov-na-donu/search/АвтоТехСервис%20Портовая%20439' },
    { source: 'Zoon', value: '2,2', count: 1, note: 'поисковая выдача на 21.10.2026', url: 'https://zoon.ru/rostov-na-donu/?query=АвтоТехСервис+Портовая+439' },
  ],
  consent_version: '2026-10-21',
  slot_capacity: 2,
  map_link: 'https://yandex.ru/maps/?pt=39.648295,47.193068&z=17&l=map',
  brands: [],
};

/** Настройки: значения из БД перекрывают дефолты (по ключу, JSON). */
export function getSettings(): Settings {
  const out: Settings = JSON.parse(JSON.stringify(DEFAULTS));
  let rows: { key: string; value: string }[] = [];
  try {
    rows = db().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  } catch {
    return out; // БД ещё не мигрирована — работаем на дефолтах
  }
  for (const r of rows) {
    try {
      (out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
    } catch { /* битый JSON в настройках игнорируем, остаётся дефолт */ }
  }
  return out;
}

export function setSetting(key: keyof Settings | string, value: unknown): void {
  db().prepare(`INSERT INTO settings(key, value, updated_at) VALUES(?, ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`)
    .run(key, JSON.stringify(value));
}

export function getSetting<T>(key: string, fallback: T): T {
  try {
    const row = db().prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : fallback;
  } catch { return fallback; }
}
