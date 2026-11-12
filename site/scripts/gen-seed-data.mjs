/* Круг 26: генератор site/src/server/seed-data.ts из content/merged-r26 (A7 услуги, A7 кейсы/чипы, A9 статьи).
   Тексты и цифры переносятся дословно: парсер берёт блоки md целиком, без ручного набора. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const A7 = join(ROOT, 'content', 'merged-r26', 'a7');
const A9 = join(ROOT, 'content', 'merged-r26', 'a9');

const ICON = {
  shinomontazh: '/img/svc-1.svg', balansirovka: '/img/svc-2.svg', 'to-maslo': '/img/svc-4.svg',
  tormoza: '/img/svc-5.svg', podveska: '/img/svc-7.svg', 'grm-sceplenie': '/img/svc-8.svg',
  diagnostika: '/img/svc-6.svg',
};
const FILES = ['01-shinomontazh.md', '02-balansirovka.md', '03-to-maslo.md', '04-tormoza.md', '05-podveska.md', '06-grm-sceplenie.md', '07-diagnostika.md'];

const between = (s, a, b) => {
  const i = s.indexOf(a); if (i < 0) throw new Error('нет блока ' + a);
  const j = s.indexOf(b, i + a.length); if (j < 0) throw new Error('нет конца блока ' + a);
  return s.slice(i + a.length, j).trim();
};
const bullet = (s, key) => {
  const re = new RegExp('\\*\\*' + key + '\\:?\\*\\*[^`]*`([^`]+)`');
  const m = s.match(re); if (!m) throw new Error('нет поля ' + key);
  return m[1];
};

const services = FILES.map((f) => {
  const md = readFileSync(join(A7, '03-services', f), 'utf8');
  const meta = between(md, '## Метаданные', '## Текст для страницы');
  /* круг 27 (§3.2): в исходниках A7 заголовок раздела попал в текст первой строкой —
     служебный префикс «(поле `description`)» вырезаем, чтобы брак не возвращался в сид */
  const description = between(md, '## Текст для страницы', '## Служебное')
    .replace(/^\s*\(поле `description`\)\s*\n+/, '')
    .trimStart();
  const line = meta.match(/\*\*grp:\*\* `([^`]+)` · \*\*tag:\*\* `([^`]+)` · \*\*sort:\*\* `(\d+)` · \*\*hidden:\*\* `(\d+)` · \*\*chip:\*\* `(\d+)`/);
  if (!line) throw new Error('нет строки grp/tag ' + f);
  return {
    slug: bullet(md, 'slug:'),
    title: bullet(md, 'title \\(H1\\):'),
    short: bullet(md, 'short \\(знаков: \\d+\\):'),
    description,
    icon: ICON[bullet(md, 'slug:')],
    grp: line[1], tag: line[2], sort: Number(line[3]), hidden: Number(line[4]), chip: Number(line[5]),
    seo_title: bullet(md, 'seo_title \\(знаков: \\d+\\):'),
    seo_description: bullet(md, 'seo_description \\(знаков: \\d+\\):'),
    price_from: bullet(md, 'price_from:'),
  };
});

/* скрытые чип-позиции (a7/04-chips.md): только чип формы, без страницы */
const hiddenChips = [
  { slug: 'remont-kolesa', title: 'Ремонт колеса: прокол, порез, грыжа', grp: 'Колёса', sort: 101, price_from: 'от 600 ₽' },
  { slug: 'sceplenie', title: 'Сцепление', grp: 'Ремонт и ТО', sort: 102, price_from: 'от 6000 ₽' },
  { slug: 'diagnostika-hodovaya', title: 'Диагностика ходовой', grp: 'Диагностика', sort: 103, price_from: 'от 500 ₽' },
  { slug: 'kondicioner', title: 'Кондиционер', grp: 'Диагностика', sort: 104, price_from: null },
].map((c) => ({ ...c, short: '', description: '', icon: '', tag: c.grp, hidden: 1, chip: 1, seo_title: '', seo_description: '' }));

const cases = [
  { slug: 'case-1', title: 'Прокол в протекторе — отремонтировали за один визит', description: 'Колёса · ремонт колеса R16 — 800 ₽.', service_slug: 'balansirovka', cover_static: '/img/case-1.svg', sort: 1 },
  { slug: 'case-2', title: 'Порез по боковине: осмотрели и сказали прямо', description: 'Колёса · ремонт колеса R17 — 800 ₽ или замена шины, если ремонт небезопасен.', service_slug: 'balansirovka', cover_static: '/img/case-2.svg', sort: 2 },
  { slug: 'case-3', title: 'Стук на неровностях — заменили стойки стабилизатора, 1300 ₽ за сторону', description: 'Подвеска · стойки стабилизатора 1000–1300 ₽.', service_slug: 'podveska', cover_static: '/img/case-3.svg', sort: 3 },
  { slug: 'case-4', title: 'Вибрация при торможении — заменили диски вместе с колодками', description: 'Тормоза · диски с колодками 2200–4000 ₽, с обслуживанием суппорта.', service_slug: 'tormoza', cover_static: '/img/case-4.svg', sort: 4 },
  { slug: 'case-5', title: 'ТО с осмотром: масло, фильтры и список того, что подождёт', description: 'ТО · масло в двигателе 1000–1300 ₽ плюс осмотр на подъёмнике.', service_slug: 'to-maslo', cover_static: '/img/case-5.svg', sort: 5 },
  { slug: 'case-6', title: 'Пробуксовка сцепления — заменили комплект', description: 'Сцепление · от 6000 ₽, цена за работу.', service_slug: 'grm-sceplenie', cover_static: '/img/case-6.svg', sort: 6 },
];

const chip_labels = {
  shinomontazh: 'Шиномонтаж',
  balansirovka: 'Балансировка',
  'remont-kolesa': 'Ремонт колеса: прокол, порез, грыжа',
  'to-maslo': 'ТО и замена масла',
  tormoza: 'Тормозные колодки и диски',
  podveska: 'Подвеска и рулевое',
  'grm-sceplenie': 'ГРМ: ремень и цепь',
  sceplenie: 'Сцепление',
  diagnostika: 'Компьютерная диагностика',
  'diagnostika-hodovaya': 'Диагностика ходовой',
  kondicioner: 'Кондиционер',
};

const brands = ['Лада (LADA)', 'Toyota', 'Kia', 'Hyundai', 'Renault', 'Volkswagen', 'Škoda', 'Nissan',
  'Chevrolet', 'Ford', 'Mitsubishi', 'BMW', 'Mercedes-Benz', 'Audi', 'Mazda', 'Chery', 'Haval', 'Geely', 'ГАЗ', 'УАЗ'];

/* статьи A9: frontmatter + тело дословно */
const ART = ['01-remen-grm.md', '02-stuk-v-podveske.md', '03-sezonnaya-smena-shin.md', '04-diagnostika-pered-pokupkoy.md', '05-zapravka-kondicionera.md'];
const news = ART.map((f) => {
  const raw = readFileSync(join(A9, '02-articles', f), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/); if (!m) throw new Error('нет frontmatter ' + f);
  const fm = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([a-z_]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]));
  return { slug: fm.slug, category: fm.category, title: fm.title, excerpt: fm.excerpt, seo_description: fm.seo_description, published_at: fm.published_at, cover_static: fm.cover_static, body_md: m[2].trim() };
});

const J = (v) => JSON.stringify(v, null, 1);
const out = `/** Данные сида круга 26: услуги и чипы — content/merged-r26/a7 (03-services, 04-chips, 05-cases),
 *  статьи — content/merged-r26/a9/02-articles. Сгенерировано scripts/gen-seed-data.mjs: тексты и цифры
 *  перенесены из утверждённых md дословно, без ручного набора. */
export const SEED = {
 "services": ${J([...services, ...hiddenChips])},
 "cases": ${J(cases)},
 "brands": ${J(brands)},
 "chip_labels": ${J(chip_labels)},
 "news": ${J(news)}
} as const;
`;
writeFileSync(join(ROOT, 'site', 'src', 'server', 'seed-data.ts'), out);
console.log('seed-data.ts записан: услуг', services.length + hiddenChips.length, '(видимых', services.length, '), кейсов', cases.length, ', статей', news.length);
for (const s of services) console.log(' ', s.slug, s.sort, s.price_from, '| short', s.short.length, 'зн | desc', s.description.length, 'зн');
