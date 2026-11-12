/* Гейт содержания раздела «Voyah Free» (круг 28).
   Проверяет не «на глаз», а машинно: объём блоков, прайс (15 позиций, суммы и порядок),
   запрещённые темы (годы выпуска, транслитерация, высоковольтная часть), метатеги,
   длину ответов FAQ, переспам адреса и противоречие про боксы.

   Запуск:
     node scripts/check-voyah-content.mjs                 — проверить content/merged-r28/a8/voyah-free.md
     node scripts/check-voyah-content.mjs <путь.md>       — проверить другой файл
     node scripts/check-voyah-content.mjs --self-test     — мутанты: каждый обязан ронять свой пункт

   Коды выхода: 0 — чисто, 1 — есть провалы, 2 — файл не найден.
   Гейт не входит в `npm test`, пока контент не доведён до нормы по объёму (задание №39);
   после приёмки A8 v2 добавляется в цепочку check-* в package.json. */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DEFAULT = join(ROOT, 'content/merged-r28/a8/voyah-free.md');

/* ---------- эталон прайса владельца: порядок и суммы менять нельзя ---------- */
const PRICE = [
  { price: 2000, must: [['масл'], ['фильтр']], label: 'масло ДВС + все фильтры' },
  { price: 2500, must: [['передн'], ['редуктор']], label: 'масло переднего редуктора' },
  { price: 2500, must: [['задн'], ['редуктор']], label: 'масло заднего редуктора' },
  { price: 2500, must: [['генератор']], label: 'масло генераторной установки' },
  { price: 2000, must: [['тормозн'], ['жидкост']], label: 'тормозная жидкость' },
  { price: 2000, must: [['колодк'], ['перед']], label: 'колодки перед' },
  { price: 2500, must: [['колодк'], ['задн']], label: 'колодки зад' },
  { price: 3000, must: [['диск'], ['колодк'], ['перед']], label: 'передние диски + колодки' },
  { price: 4000, must: [['диск'], ['колодк'], ['задн']], label: 'задние диски + колодки' },
  { price: 1500, must: [['свеч']], label: 'свечи' },
  { price: 2500, must: [['прокладк']], label: 'прокладка клапанной крышки' },
  { price: 1200, must: [['наконечник']], label: 'рулевой наконечник' },
  { price: 2500, must: [['тяг']], label: 'рулевая тяга' },
  { price: 'от 2500', must: [['рычаг']], label: 'рычаги передней подвески' },
  { price: 1500, must: [['диагностик']], label: 'диагностика ходовой' },
];

/* Запрещённые темы (ответы владельца 09.11.2026). Каждая — отдельный пункт отчёта. */
const BANS = [
  { id: 'годы выпуска', re: /\b20(2[1-6])\b/ },
  { id: 'слово «рестайлинг»/«поколение»', re: /рестайл|поколени/iu },
  { id: 'транслитерация названия', re: /Воя|Во[яй] Фри/iu },
  { id: 'высоковольтная тема', re: /высоковольт|высоковольтн|силов(ая|ой) электроник|батаре[яию]|bms|зарядк[аиу]/iu },
  { id: 'противоречие про боксы', re: /один бокс|одном боксе|единственн\w* бокс/iu },
  { id: '«официальный дилер» как заявление о себе', re: /мы\s*[-—–]?\s*официальн\w+ (дилер|сервис)/iu },
];

const norm = (s) => s.replace(/\u00a0/g, ' ').replace(/ё/gu, 'е').toLowerCase();
const stripMd = (t) =>
  t
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, ' ')
    .replace(/[#*`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const chars = (s) => stripMd(s).replace(/\s/g, '').length;
const block = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = b ? s.indexOf(b) : s.length;
  return s.slice(i, j < 0 ? s.length : j);
};

/* ------------------------------- проверки ------------------------------- */
export function check(text) {
  const fails = [];
  const notes = [];
  const add = (code, msg) => fails.push({ code, msg });

  /* 1. обязательные блоки */
  for (const marker of ['<!-- блок: home-teaser -->', '<!-- блок: hero -->', '<!-- блок: seo -->']) {
    if (!text.includes(marker)) add('B1', `нет разметки блока ${marker}`);
  }

  /* 2. объём: страница 6000–8000 знаков без пробелов, тизер 700–900 */
  const page = block(text, '<!-- блок: hero -->', '<!-- блок: seo -->');
  const teaser = block(text, '<!-- блок: home-teaser -->', '<!-- блок: hero -->');
  const pageChars = chars(page);
  const teaserChars = chars(teaser);
  if (pageChars < 6000) add('V1', `объём страницы ${pageChars} < 6000 знаков без пробелов`);
  else if (pageChars > 8000) add('V1', `объём страницы ${pageChars} > 8000 знаков без пробелов`);
  if (teaserChars < 700) add('V2', `объём тизера ${teaserChars} < 700 знаков`);
  else if (teaserChars > 900) add('V2', `объём тизера ${teaserChars} > 900 знаков`);
  notes.push(`объём: страница ${pageChars}, тизер ${teaserChars}`);

  /* 3. прайс: ровно 15 строк, суммы и порядок как у владельца */
  const rows = [...text.matchAll(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm)]
    .map((m) => [m[1], m[2], m[3]])
    .filter(([g]) => !/^:?-{2,}/.test(g) && !/^(группа|group)$/i.test(g.trim()));
  if (rows.length !== 15) add('P1', `в прайсе ${rows.length} строк вместо 15`);
  rows.forEach(([, name, price], i) => {
    const ref = PRICE[i];
    if (!ref) return;
    const n = norm(name);
    const got = norm(price).replace(/\s/g, '').replace(/(₽|руб\.?|рублей)$/u, '');
    const want = String(ref.price);
    const gotNum = /^от/.test(want)
      ? (/(от)/u.test(got) && got.replace(/[^0-9]/g, '') === want.replace(/[^0-9]/g, ''))
      : got === want;
    if (!gotNum) add('P2', `строка ${i + 1} «${name}»: цена «${price}» вместо ${ref.price} ₽`);
    for (const alts of ref.must) {
      if (!alts.some((a) => n.includes(a))) add('P3', `строка ${i + 1} не про «${ref.label}»: «${name}»`);
    }
  });
  const prices = rows.map((r) => norm(r[2]).replace(/\s/g, ''));
  notes.push(`прайс: ${rows.length} строк, суммы ${prices.slice(0, 3).join(' / ')}…`);

  /* 4. запрещённые темы */
  for (const b of BANS) {
    const hit = text.match(b.re);
    if (hit) {
      const at = text.slice(Math.max(0, hit.index - 40), hit.index + hit[0].length + 40).replace(/\s+/g, ' ');
      add('F1', `запрещено (${b.id}): «${hit[0]}» …${at}…`);
    }
  }

  /* 5. название латиницей в H1 и в пункте меню */
  const meta = Object.fromEntries(
    [...text.matchAll(/`(slug|title|description|h1|eyebrow|menu_label|cta_primary|cta_secondary)`: `([^`]+)`/g)].map(
      (m) => [m[1], m[2]],
    ),
  );
  if (!meta.menu_label) add('M1', 'в метаданных нет `menu_label`');
  else if (meta.menu_label !== 'Voyah Free') add('M1', `menu_label «${meta.menu_label}» ≠ «Voyah Free»`);
  if (!meta.h1) add('M2', 'в метаданных нет `h1`');
  else {
    if (!meta.h1.includes('Voyah Free')) add('M2', `в h1 нет «Voyah Free»: «${meta.h1}»`);
    if (meta.h1.length > 62) add('M2', `h1 ${meta.h1.length} знаков > 62`);
  }
  if (!meta.title) add('M3', 'нет `title`');
  else if (meta.title.length > 60) add('M3', `title ${meta.title.length} > 60 знаков`);
  if (!meta.description) add('M4', 'нет `description`');
  else if (meta.description.length < 140 || meta.description.length > 170)
    add('M4', `description ${meta.description.length} знаков вне 140…170`);
  notes.push(`метаданные: title ${meta.title?.length ?? '—'}, description ${meta.description?.length ?? '—'}, h1 ${meta.h1?.length ?? '—'}`);

  /* 6. FAQ: ≥5 вопросов, ответы 180–420 знаков, тема гарантии есть, высоковольтной нет (см. BANS) */
  const faq = block(text, '## Частые вопросы', '<!-- блок: seo -->');
  const qs = [...faq.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim());
  if (qs.length < 5) add('Q1', `в FAQ ${qs.length} вопросов (норма ≥5)`);
  const answers = faq.split(/^###\s+/m).slice(1);
  answers.forEach((a, i) => {
    const body = a.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
    const len = body.length; /* для ответов FAQ норма считается с пробелами — как в задании */
    if (len < 180 || len > 420) add('Q2', `ответ ${i + 1} «${qs[i]?.slice(0, 40)}…» ${len} знаков (норма 180…420)`);
  });
  notes.push(`FAQ: ${qs.length} вопросов`);

  /* 7. переспам адреса: не более 6 раз на странице, не более 2 в тизере */
  const addr = /Портовой,?\s*439/giu;
  const addrPage = (page.match(addr) || []).length;
  const addrTeaser = (teaser.match(addr) || []).length;
  if (addrPage > 6) add('A1', `«Портовой, 439» на странице ${addrPage} раз (норма ≤6)`);
  if (addrTeaser > 2) add('A2', `«Портовой, 439» в тизере ${addrTeaser} раз (норма ≤2)`);
  notes.push(`адрес: страница ${addrPage}, тизер ${addrTeaser}`);

  /* 8. три кадра с alt и подписью */
  const alts = (text.match(/\*\*Alt:\*\*/g) || []).length;
  const caps = (text.match(/\*\*Подпись:\*\*/g) || []).length;
  if (alts < 3) add('I1', `alt-текстов ${alts} (нужно 3)`);
  if (caps < 3) add('I2', `подписей ${caps} (нужно 3)`);
  notes.push(`кадры: alt ${alts}, подписи ${caps}`);

  /* 9. суммы — за работу, без запчастей: оговорка обязательна */
  if (!/за работу|без запчаст/iu.test(text)) add('S1', 'нет оговорки «за работу, без запчастей»');

  return { fails, notes };
}

/* ------------------------------- мутанты -------------------------------- */
const MUTANTS = [
  {
    id: 'V1-объём-страницы',
    mutate: (t) => {
      const i = t.indexOf('<!-- блок: hero -->');
      const j = t.indexOf('<!-- блок: seo -->');
      return t.slice(0, i) + t.slice(i, i + Math.floor((j - i) * 0.4)) + t.slice(j);
    },
    expect: 'V1',
  },
  {
    id: 'V2-объём-тизера',
    mutate: (t) => t.replace(/\*\*Лид:\*\*[^\n]+\n/, '**Лид:** Коротко.\n'),
    expect: 'V2',
  },
  {
    id: 'P1-пропала-строка',
    mutate: (t) => t.replace(/^\|\s*Диагностика\s*\|[^\n]*\n/gm, ''),
    expect: 'P1',
  },
  {
    id: 'P2-сумма-изменена',
    mutate: (t) => t.replace(/(Масло в двигателе \+ все фильтры\s*\|\s*)2000/iu, '$12100'),
    expect: 'P2',
  },
  {
    id: 'P2-порядок-строк',
    mutate: (t) =>
      t
        .replace(/^(\|\s*ТО и жидкости\s*\|\s*Масло переднего редуктора[^\n]*\n)(\|\s*ТО и жидкости\s*\|\s*Масло заднего редуктора[^\n]*\n)/mu, '$2$1'),
    expect: ['P2', 'P3'], /* перестановка двух строк с одинаковой суммой ловится по названию */
  },
  {
    id: 'F1-годы',
    mutate: (t) => t.replace(/(## Почему Voyah Free[^\n]*\n\n)/u, '$1Voyah Free 2024 года. '),
    expect: 'F1',
  },
  {
    id: 'F1-транслитерация',
    mutate: (t) => t.replace(/(## Почему Voyah Free[^\n]*\n\n)/u, '$1Воя Фри — это удобно. '),
    expect: 'F1',
  },
  {
    id: 'F1-высоковольтная-тема',
    mutate: (t) => t.replace(/(## Почему Voyah Free[^\n]*\n\n)/u, '$1Проверяем высоковольтную батарею. '),
    expect: 'F1',
  },
  {
    id: 'F1-один-бокс',
    mutate: (t) => t.replace(/(## Почему Voyah Free[^\n]*\n\n)/u, '$1Работаем в одном боксе. '),
    expect: 'F1',
  },
  {
    id: 'M1-меню',
    mutate: (t) => t.replace(/`menu_label`: `Voyah Free`/, '`menu_label`: `Voyah`'),
    expect: 'M1',
  },
  {
    id: 'M3-title',
    mutate: (t) => t.replace(/`title`: `[^`]+`/, '`title`: `' + 'Voyah Free в Ростове-на-Дону — техническое обслуживание на Портовой, 439`' + '`'),
    expect: 'M3',
  },
  {
    id: 'Q2-короткий-ответ',
    mutate: (t) => t.replace(/(### Сколько времени занимает ТО\?\n\n)[^\n]+/u, '$1Коротко.'),
    expect: 'Q2',
  },
  {
    id: 'A1-переспам-адреса',
    mutate: (t) => t.replace(/(## Почему Voyah Free[^\n]*\n\n)/u, '$1' + 'Работаем на Портовой, 439. '.repeat(8)),
    expect: 'A1',
  },
  {
    id: 'I1-нет-alt',
    mutate: (t) => t.replace(/\*\*Alt:\*\*/g, '**Изображение:**'),
    expect: 'I1',
  },
  {
    id: 'S1-нет-оговорки',
    mutate: (t) => t.replace(/за работу|без запчаст/giu, 'по прайсу'),
    expect: 'S1',
  },
];

/* --------------------------------- main --------------------------------- */
function runFile(file, { quiet = false } = {}) {
  const text = readFileSync(file, 'utf8');
  const { fails, notes } = check(text);
  if (!quiet) {
    for (const n of notes) console.log(`     ${n}`);
    for (const f of fails) console.log(`FAIL ${f.code}: ${f.msg}`);
  }
  return fails;
}

function selfTest(file) {
  const base = readFileSync(file, 'utf8');
  const baseFails = check(base).fails.map((f) => f.code);
  console.log(`база: ${baseFails.length} провалов${baseFails.length ? ` (${[...new Set(baseFails)].join(', ')})` : ''}`);
  const dir = mkdtempSync(join(tmpdir(), 'voyah-gate-'));
  let bad = 0;
  for (const m of MUTANTS) {
    const mutated = m.mutate(base);
    if (mutated === base) {
      console.log(`FAIL ${m.id}: мутация не применилась (шаблон не найден)`);
      bad++;
      continue;
    }
    const f = join(dir, `${m.id}.md`);
    writeFileSync(f, mutated);
    const codes = check(mutated).fails.map((x) => x.code);
    const want = [].concat(m.expect);
    const hit = want.filter((c) => codes.includes(c));
    if (hit.length) console.log(`ok   ${m.id}: гейт упал (${hit.join(' или ')})`);
    else {
      console.log(`FAIL ${m.id}: ожидался ${want.join('/')}, получено ${codes.join(',') || 'ничего'}`);
      bad++;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`самопроверка: ${MUTANTS.length - bad}/${MUTANTS.length} мутантов роняют свой пункт`);
  return bad === 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const file = args.find((a) => a.endsWith('.md')) || DEFAULT;
  process.exit(selfTest(file) ? 0 : 1);
}
const file = args.find((a) => a.endsWith('.md')) || DEFAULT;
let fails;
try {
  fails = runFile(file);
} catch (e) {
  console.error(`check-voyah-content: не читается файл ${file}: ${e.message}`);
  process.exit(2);
}
if (fails.length) {
  console.log(`\ncheck-voyah-content: ${fails.length} провалов — ${file}`);
  process.exit(1);
}
console.log(`\ncheck-voyah-content: чисто — ${file}`);
