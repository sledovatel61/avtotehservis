/**
 * Круг 85: гейт синхронизации единого прайс-хранилища site/content/prices.json
 * со всеми страницами сайта (site/pages-dist/) и исходниками (.astro, seed-data.ts).
 *
 * Запуск: node scripts/check-prices-sync.mjs [--self-test]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePrices,
  priceIndexOf,
  missingPriceRefs,
} from '../src/shared/prices-schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(HERE, '..');
const PRICES_PATH = join(SITE_ROOT, 'content/prices.json');
const DIST_DIR = join(SITE_ROOT, 'pages-dist');
const PAGES_SRC_DIR = join(SITE_ROOT, 'src/pages');
const SEED_DATA_PATH = join(SITE_ROOT, 'src/server/seed-data.ts');
const SELF = process.argv.includes('--self-test');

let fail = 0;
const bad = (m) => { fail = 1; console.error('FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

function walkFiles(dir, predicate) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, predicate));
    else if (!predicate || predicate(full)) out.push(full);
  }
  return out.sort();
}

const EXPECTED_GROUP_COUNTS = [
  ['to', 6],
  ['tormoza', 5],
  ['podveska', 11],
  ['grm', 13],
  ['diagnostika', 2],
  ['kondicioner', 4],
  ['svarka', 2],
];

const KEY_CROSS_PAGE_ITEMS = [
  ['oil-sedan', ['index.html', 'prices/index.html', 'about/index.html', 'services/to-maslo/index.html']],
  ['oil-crossover', ['index.html', 'prices/index.html', 'about/index.html', 'services/to-maslo/index.html']],
  ['diag-susp', ['index.html', 'prices/index.html', 'about/index.html', 'services/diagnostika/index.html']],
  ['diag-comp', ['index.html', 'prices/index.html', 'about/index.html', 'services/diagnostika/index.html']],
  ['set-r16', ['index.html', 'prices/index.html', 'about/index.html', 'services/shinomontazh/index.html']],
  ['ac-refill', ['index.html', 'prices/index.html', 'about/index.html', 'services/diagnostika/index.html']],
  ['weld-exhaust', ['index.html', 'prices/index.html', 'about/index.html', 'services/svarka/index.html']],
  ['voyah-oil', ['index.html', 'voyah-free/index.html']],
  ['voyah-diag-susp', ['index.html', 'voyah-free/index.html']],
];

const BARE_RUB_RE = /\d\s*₽/;

export function checkCrossPageSync(prices, htmlByRelPath) {
  const idx = priceIndexOf(prices);
  const mismatches = [];
  for (const [id, relPages] of KEY_CROSS_PAGE_ITEMS) {
    const expectedPrice = idx.get(id);
    if (!expectedPrice) {
      mismatches.push(`нет позиции ${id} в прайсе`);
      continue;
    }
    for (const rel of relPages) {
      const html = htmlByRelPath.get(rel);
      if (!html) {
        mismatches.push(`нет страницы ${rel}`);
        continue;
      }
      if (!html.includes(expectedPrice)) {
        mismatches.push(`${id} (${expectedPrice}) не найден на странице ${rel}`);
      }
    }
  }
  return mismatches;
}

export function detectBareRubleInSource(sourceText) {
  return BARE_RUB_RE.test(sourceText);
}

/* 1. Проверка content/prices.json и количества позиций (73) */
console.log('1. Проверка схемы и полноты site/content/prices.json:');
if (!existsSync(PRICES_PATH)) {
  bad('нет файла site/content/prices.json');
  process.exit(1);
}
const rawPrices = JSON.parse(readFileSync(PRICES_PATH, 'utf8'));
const validation = validatePrices(rawPrices);
if (!validation.ok) {
  bad('validatePrices вернула ошибки: ' + JSON.stringify(validation.errors));
  process.exit(1);
}
const prices = validation.value;
ok('validatePrices(json) === ok: true');

const actualGroupSummary = prices.groups.map((g) => `${g.id}:${g.items.length}`).join(', ');
const expectedGroupSummary = EXPECTED_GROUP_COUNTS.map(([id, n]) => `${id}:${n}`).join(', ');
if (actualGroupSummary === expectedGroupSummary) {
  ok(`группы прайса (${actualGroupSummary})`);
} else {
  bad(`состав групп прайса (${actualGroupSummary}) не совпадает с ожидаемым (${expectedGroupSummary})`);
}

const tSet = prices.tyres.set.length;
const tRep = prices.tyres.repair.length;
const tExt = prices.tyres.extra.length;
const vLen = prices.voyah.length;
const fLen = prices.featured.length;
const totalCount =
  prices.groups.reduce((s, g) => s + g.items.length, 0) + tSet + tRep + tExt + vLen;

if (tSet === 8 && tRep === 3 && tExt === 4 && vLen === 15 && fLen === 3 && totalCount === 73) {
  ok(`tyres=${tSet}/${tRep}/${tExt}, voyah=${vLen}, featured=${fLen}, всего позиций прайса=${totalCount}`);
} else {
  bad(`ожидалось tyres 8/3/4, voyah 15, featured 3, всего позиций 73; получено tyres ${tSet}/${tRep}/${tExt}, voyah ${vLen}, featured ${fLen}, всего ${totalCount}`);
}

/* 2. Проверка отсутствия нераскрытых {{price:...}} в pages-dist/index.html */
console.log('\n2. Проверка собранных HTML на нераскрытые подстановки:');
const htmlFiles = walkFiles(DIST_DIR, (f) => f.endsWith('/index.html') || f === join(DIST_DIR, 'index.html'));
if (htmlFiles.length === 0) {
  bad('в pages-dist нет собранных index.html — сначала выполните экспорт страниц');
} else {
  let leaked = 0;
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    if (html.includes('{{price:') || /\{\{[^}]*\}\}/.test(html)) {
      leaked++;
      bad(`нераскрытый плейсхолдер в ${relative(DIST_DIR, file)}`);
    }
  }
  if (leaked === 0) ok(`во всех ${htmlFiles.length} HTML-файлах нет нераскрытых {{price:…}}`);
}

/* 3. Все не-скрытые позиции присутствуют на /prices или /voyah-free */
console.log('\n3. Полнота таблиц на /prices и /voyah-free:');
const pricesHtmlPath = join(DIST_DIR, 'prices/index.html');
const voyahHtmlPath = join(DIST_DIR, 'voyah-free/index.html');
if (!existsSync(pricesHtmlPath) || !existsSync(voyahHtmlPath)) {
  bad('нет pages-dist/prices/index.html или pages-dist/voyah-free/index.html');
} else {
  const pricesHtml = readFileSync(pricesHtmlPath, 'utf8');
  const voyahHtml = readFileSync(voyahHtmlPath, 'utf8');
  let missingRows = 0;

  for (const g of prices.groups) {
    for (const it of g.items) {
      if (it.hidden) continue;
      if (!pricesHtml.includes(it.name) || !pricesHtml.includes(it.price)) {
        missingRows++;
        bad(`/prices: нет позиции ${it.id} (${it.name} — ${it.price})`);
      }
    }
  }
  for (const r of prices.tyres.set) {
    if (r.hidden) continue;
    if (!pricesHtml.includes(r.radius) || !pricesHtml.includes(r.passenger) || !pricesHtml.includes(r.crossover)) {
      missingRows++;
      bad(`/prices: нет строки комплекта шин ${r.id} (${r.radius}: ${r.passenger} / ${r.crossover})`);
    }
  }
  for (const r of prices.tyres.repair) {
    if (r.hidden) continue;
    const rad = r.radius || r.range;
    if (!pricesHtml.includes(rad) || !pricesHtml.includes(r.price)) {
      missingRows++;
      bad(`/prices: нет строки ремонта колеса ${r.id} (${rad}: ${r.price})`);
    }
  }
  for (const r of prices.tyres.extra) {
    if (r.hidden) continue;
    if (!pricesHtml.includes(r.name) || !pricesHtml.includes(r.price)) {
      missingRows++;
      bad(`/prices: нет доп. позиции шин ${r.id} (${r.name}: ${r.price})`);
    }
  }
  for (const it of prices.voyah) {
    if (it.hidden) continue;
    if (!voyahHtml.includes(it.name) || !voyahHtml.includes(it.price)) {
      missingRows++;
      bad(`/voyah-free: нет позиции ${it.id} (${it.name}: ${it.price})`);
    }
  }
  if (missingRows === 0) {
    ok('все не-скрытые позиции groups, tyres и voyah присутствуют на /prices и /voyah-free');
  }
}

/* 4. Ключевые сквозные позиции на всех целевых страницах */
console.log('\n4. Сквозная сверка ключевых позиций по страницам:');
const htmlByRelPath = new Map();
for (const file of htmlFiles) {
  htmlByRelPath.set(relative(DIST_DIR, file), readFileSync(file, 'utf8'));
}
const crossMismatches = checkCrossPageSync(prices, htmlByRelPath);
if (crossMismatches.length === 0) {
  ok(`все ${KEY_CROSS_PAGE_ITEMS.length} сквозных позиций совпадают во всех целевых HTML`);
} else {
  for (const m of crossMismatches) bad(m);
}

/* 5. В исходниках .astro и seed-data.ts нет «голых» рублёвых сумм /\d\s*₽/ */
console.log('\n5. Проверка исходников .astro и seed-data.ts на зашитые рублёвые суммы:');
const astroFiles = walkFiles(PAGES_SRC_DIR, (f) => f.endsWith('.astro'));
const sourceFiles = [...astroFiles, SEED_DATA_PATH];
let bareFound = 0;
for (const file of sourceFiles) {
  const txt = readFileSync(file, 'utf8');
  if (detectBareRubleInSource(txt)) {
    bareFound++;
    bad(`в ${relative(SITE_ROOT, file)} найдена зашитая рублёвая сумма (/\\d\\s*₽/)`);
  }
  const miss = missingPriceRefs(txt, prices);
  if (miss.length > 0) {
    bareFound++;
    bad(`в ${relative(SITE_ROOT, file)} неизвестные ссылки {{price:…}}: ${miss.join(', ')}`);
  }
}
if (bareFound === 0) {
  ok(`проверено ${sourceFiles.length} исходных файлов — зашитых сумм и битых ссылок нет`);
}

/* 6. Самопроверка --self-test на 4 мутантах */
if (SELF) {
  console.log('\n6. Самопроверка (--self-test, 4 мутанта):');
  let selfOk = true;
  const expectCaught = (label, caught) => {
    if (caught) console.log('  ok   ' + label);
    else { selfOk = false; console.error('  FAIL ' + label); }
  };

  // (а) мутант 1: меняем oil-sedan в копии прайса -> старый HTML должен дать расхождение
  const mutantPricesA = structuredClone(prices);
  mutantPricesA.groups[0].items[0].price = '9876–9999 ₽';
  const mismatchesA = checkCrossPageSync(mutantPricesA, htmlByRelPath);
  expectCaught('(а) подмена oil-sedan в прайсе ловится при сверке со старым HTML', mismatchesA.length > 0);

  // (б) мутант 2: вставляем {{price:no-such-id}} -> missingPriceRefs возвращает ['no-such-id']
  const missB = missingPriceRefs('Стоимость работы — {{price:no-such-id}}.', prices);
  expectCaught('(б) битая ссылка {{price:no-such-id}} ловится через missingPriceRefs', missB.includes('no-such-id'));

  // (в) мутант 3: портим price: "бесплатно" -> validatePrices отвергает
  const mutantPricesC = structuredClone(rawPrices);
  mutantPricesC.groups[0].items[0].price = 'бесплатно';
  const resC = validatePrices(mutantPricesC);
  expectCaught('(в) невалидная цена "бесплатно" отвергается validatePrices', resC.ok === false);

  // (г) мутант 4: строка "замена — 9999 ₽" в .astro-исходнике ловится детектором
  expectCaught('(г) зашитая сумма "замена — 9999 ₽" в .astro ловится детектором', detectBareRubleInSource('<p>замена — 9999 ₽</p>'));

  if (!selfOk) fail = 1;
}

console.log(fail ? '\nFAIL: гейт синхронизации прайса не пройден' : '\nPASS: единый прайс синхронизирован со всеми страницами');
process.exit(fail ? 1 : 0);
