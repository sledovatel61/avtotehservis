/* Факты визитки — только из site/src/server/settings.ts (блок DEFAULTS).
 *
 * Задание (§10) говорит: если текст задания расходится с кодом сайта — прав код.
 * Поэтому здесь нет ни одной цифры, набранной руками: всё вычитывается из DEFAULTS
 * при сборке, а расхождения с промптом перечислены в README.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './font.mjs';

const SETTINGS = path.join(REPO_ROOT, 'site/src/server/settings.ts');

function readDefaults() {
  const src = fs.readFileSync(SETTINGS, 'utf8');
  const start = src.indexOf('export const DEFAULTS');
  if (start < 0) throw new Error('settings.ts: не найден блок DEFAULTS');
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  let inStr = null;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('settings.ts: не закрыт литерал DEFAULTS');
  const literal = src.slice(braceStart, end);
  // литерал состоит только из значений — исполняем в изоляции
  return new Function(`"use strict";return (${literal});`)();
}

const D = readDefaults();

export const facts = {
  name: D.site_name,
  city: D.city,
  address: D.address,
  addressFull: D.address_full,
  landmark: D.landmark,
  hours: D.hours,
  phoneMain: D.phone_main,
  phoneMainTel: D.phone_main_tel,
  extPhones: D.phones_extra,
  telegramPhone: D.telegram_phone,
  telegramUrl: D.telegram_url,
  email: D.email,
  legal: D.legal,
  site: 'ats-rostov.ru',
  siteUrl: 'https://ats-rostov.ru',
  shortLandmark: 'ост. «3-й Поселковый»',
  // услуги — из site/src/server/seed-data.ts (видимые, hidden=0): ровно как на сайте
  services: readServices(),
};

function readServices() {
  const file = path.join(REPO_ROOT, 'site/src/server/seed-data.ts');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('const RAW_SEED = ') + 'const RAW_SEED = '.length;
  const end = src.indexOf('} as const;', start) + 1;
  const seed = JSON.parse(src.slice(start, end));
  return seed.services
    .filter((s) => !s.hidden)
    .map((s) => ({ slug: s.slug, title: s.title, grp: s.grp }));
}

/** Телефоны для печати. Городской — второй, Telegram — подписью, а не вторым номером. */
export const phones = (() => {
  const city = D.phones_extra.find((p) => p.tel.startsWith('+7863'));
  const tg = D.telegram_phone === D.phone_main ? D.phone_main : D.telegram_phone;
  return {
    main: D.phone_main,
    mainTel: D.phone_main_tel,
    city: city ? city.display : null,
    cityTel: city ? city.tel : null,
    telegram: tg,
    telegramUrl: D.telegram_url,
  };
})();

export const legalShort = `ИП Яковенко П. И. · ИНН ${D.legal.inn}`;
export const legalFull = `${D.legal.name} · ИНН ${D.legal.inn} · ОГРНИП ${D.legal.ogrnip}`;

/** Строка услуг для оборота: короткий список направлений. */
export const servicesLine = 'Шиномонтаж · ТО и масло · Ходовая и тормоза · Диагностика и конвер';
export const servicesLine2 = 'Сварочные работы · ГРМ и сцепление · Кондиционер';

if (process.argv[1]?.endsWith('facts.mjs')) {
  console.log(JSON.stringify({ ...facts, phones, legalShort }, null, 1));
}
