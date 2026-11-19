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
  fillPrices,
  missingPriceRefs,
} from '../src/shared/prices-schema.ts';
import { SEED } from '../src/server/seed-data.ts';

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

const KEY_CROSS_PAGE_CHECKS = [
  ['oil-sedan (table)', '{{price:oil-sedan}}', ['prices/index.html', 'services/to-maslo/index.html']],
  ['oil-sedan (from)', '{{from:oil-sedan}}', ['index.html', 'prices/index.html', 'about/index.html', 'services/to-maslo/index.html']],
  ['oil-crossover (table)', '{{price:oil-crossover}}', ['prices/index.html', 'services/to-maslo/index.html']],
  ['oil-crossover (from)', '{{from:oil-crossover}}', ['index.html', 'prices/index.html', 'about/index.html']],
  ['diag-susp', '{{price:diag-susp}}', ['prices/index.html', 'about/index.html', 'services/diagnostika/index.html']],
  ['diag-susp (from)', '{{from:diag-susp}}', ['index.html', 'services/diagnostika/index.html']],
  ['diag-comp', '{{price:diag-comp}}', ['index.html', 'prices/index.html', 'about/index.html', 'services/diagnostika/index.html']],
  ['set-r16', '{{price:set-r16}}', ['index.html', 'prices/index.html', 'about/index.html', 'services/shinomontazh/index.html']],
  ['ac-refill', '{{price:ac-refill}}', ['index.html', 'prices/index.html', 'about/index.html', 'services/diagnostika/index.html']],
  ['weld-exhaust', '{{price:weld-exhaust}}', ['index.html', 'prices/index.html', 'about/index.html', 'services/svarka/index.html']],
  ['voyah-oil', '{{price:voyah-oil}}', ['index.html', 'voyah-free/index.html']],
  ['voyah-diag-susp', '{{price:voyah-diag-susp}}', ['index.html', 'voyah-free/index.html']],
];

const BARE_RUB_RE = /\d\s*₽/;

export function checkCrossPageSync(prices, htmlByRelPath) {
  const mismatches = [];
  for (const [label, token, relPages] of KEY_CROSS_PAGE_CHECKS) {
    const expectedText = fillPrices(token, prices);
    if (!expectedText || expectedText.includes('{{')) {
      mismatches.push(`не удалось раскрыть ${token} (${label})`);
      continue;
    }
    for (const rel of relPages) {
      const html = htmlByRelPath.get(rel);
      if (!html) {
        mismatches.push(`нет страницы ${rel}`);
        continue;
      }
      if (!html.includes(expectedText)) {
        mismatches.push(`${label} (${expectedText}) не найден на странице ${rel}`);
      }
    }
  }
  return mismatches;
}

export function checkServiceBadgesAndTitles(catalogServices, htmlByRelPath) {
  const issues = [];
  const servicesHtml = htmlByRelPath.get('services/index.html') ?? '';
  if (!servicesHtml) {
    issues.push('нет страницы services/index.html');
    return issues;
  }

  for (const svc of catalogServices) {
    const expectedBadge = svc.price_from;
    if (!expectedBadge) continue;

    // 1. Бейдж .svc-price в карточке на /services
    const cardRe = new RegExp(
      `<a class="svc-card" href="[^"]*\\/services\\/${svc.slug}">[\\s\\S]*?<span class="svc-price">([^<]+)<\\/span>[\\s\\S]*?<\\/a>`,
    );
    const cardMatch = servicesHtml.match(cardRe);
    if (!cardMatch) {
      issues.push(`/services: не найден бейдж .svc-price для карточки ${svc.slug}`);
    } else if (cardMatch[1].trim() !== expectedBadge) {
      issues.push(
        `/services: бейдж .svc-price у ${svc.slug} равен «${cardMatch[1].trim()}», а price_from в базе — «${expectedBadge}»`,
      );
    }

    // 2. Бейдж #svc-price и <title> на странице услуги /services/<slug>
    const detailRel = `services/${svc.slug}/index.html`;
    const detailHtml = htmlByRelPath.get(detailRel);
    if (!detailHtml) {
      issues.push(`нет страницы ${detailRel}`);
      continue;
    }
    const headBadgeMatch = detailHtml.match(/id="svc-price">([^<]+)<\/p>/);
    const expectedHeadBadge = `${expectedBadge} — за работу`;
    if (!headBadgeMatch) {
      issues.push(`${detailRel}: не найден #svc-price`);
    } else if (headBadgeMatch[1].trim() !== expectedHeadBadge) {
      issues.push(
        `${detailRel}: #svc-price равен «${headBadgeMatch[1].trim()}», ожидалось «${expectedHeadBadge}»`,
      );
    }

    const titleMatch = detailHtml.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      const titleText = titleMatch[1];
      const fromInTitle = titleText.match(/от\s+\d[\d\s]*₽/i);
      if (fromInTitle && !titleText.includes(expectedBadge)) {
        issues.push(
          `${detailRel}: в <title> («${titleText}») указано «${fromInTitle[0]}», а бейдж услуги — «${expectedBadge}»`,
        );
      }
    }
  }
  return issues;
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

/* 2. Проверка отсутствия нераскрытых {{price:...}} / {{from:...}} / {{span:...}} в pages-dist/index.html */
console.log('\n2. Проверка собранных HTML на нераскрытые подстановки:');
const htmlFiles = walkFiles(DIST_DIR, (f) => f.endsWith('/index.html') || f === join(DIST_DIR, 'index.html'));
if (htmlFiles.length === 0) {
  bad('в pages-dist нет собранных index.html — сначала выполните экспорт страниц');
} else {
  let leaked = 0;
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    if (/\{\{(price|from|From|span|tyre):/.test(html) || /\{\{[^}]*\}\}/.test(html)) {
      leaked++;
      bad(`нераскрытый плейсхолдер в ${relative(DIST_DIR, file)}`);
    }
  }
  if (leaked === 0) ok(`во всех ${htmlFiles.length} HTML-файлах нет нераскрытых {{price|from|span|tyre:…}}`);
}

/* 3. Все не-скрытые позиции присутствуют на /prices и /voyah-free */
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

/* 4. Ключевые сквозные позиции и бейджи карточек услуг */
console.log('\n4. Сквозная сверка ключевых позиций и бейджей карточек услуг:');
const htmlByRelPath = new Map();
for (const file of htmlFiles) {
  htmlByRelPath.set(relative(DIST_DIR, file), readFileSync(file, 'utf8'));
}
const crossMismatches = checkCrossPageSync(prices, htmlByRelPath);
if (crossMismatches.length === 0) {
  ok(`все ${KEY_CROSS_PAGE_CHECKS.length} сквозных проверок цен совпадают во всех целевых HTML`);
} else {
  for (const m of crossMismatches) bad(m);
}

const catalogServices = SEED.services.filter((s) => s.hidden === 0);
const badgeIssues = checkServiceBadgesAndTitles(catalogServices, htmlByRelPath);
if (badgeIssues.length === 0) {
  ok(`бейджи .svc-price, #svc-price и <title> всех ${catalogServices.length} услуг совпадают с price_from`);
} else {
  for (const issue of badgeIssues) bad(issue);
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
    bad(`в ${relative(SITE_ROOT, file)} неизвестные ссылки {{price|from|span|tyre:…}}: ${miss.join(', ')}`);
  }
}
if (bareFound === 0) {
  ok(`проверено ${sourceFiles.length} исходных файлов — зашитых сумм и битых ссылок нет`);
}

/* 6. Самопроверка --self-test на мутантах */
if (SELF) {
  console.log('\n6. Самопроверка (--self-test):');
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

  // (б) мутант 2: битые ссылки {{price:no-such-id}}, {{from:bad-from}}, {{span:oil-sedan..bad-span}} ловятся missingPriceRefs
  const missB = missingPriceRefs(
    'Тест {{price:no-such-id}}, {{from:bad-from}}, {{span:oil-sedan..bad-span}}.',
    prices,
  );
  expectCaught(
    '(б) битые ссылки {{price:…}}, {{from:…}}, {{span:…}} ловятся через missingPriceRefs',
    missB.includes('no-such-id') && missB.includes('bad-from') && missB.includes('bad-span'),
  );

  // (в) мутант 3: портим price: "бесплатно" -> validatePrices отвергает
  const mutantPricesC = structuredClone(rawPrices);
  mutantPricesC.groups[0].items[0].price = 'бесплатно';
  const resC = validatePrices(mutantPricesC);
  expectCaught('(в) невалидная цена "бесплатно" отвергается validatePrices', resC.ok === false);

  // (г) мутант 4: строка "замена — 9999 ₽" в .astro-исходнике ловится детектором
  expectCaught('(г) зашитая сумма "замена — 9999 ₽" в .astro ловится детектором', detectBareRubleInSource('<p>замена — 9999 ₽</p>'));

  // (д) мутант 5: подмена бейджа .svc-price у shinomontazh на минимум группы (от 600 ₽ вместо от 1000 ₽) ловится
  const mutantHtmlMap = new Map(htmlByRelPath);
  const origServicesHtml = htmlByRelPath.get('services/index.html') ?? '';
  mutantHtmlMap.set(
    'services/index.html',
    origServicesHtml.replace(
      /(href="[^"]*\/services\/shinomontazh">[\s\S]*?<span class="svc-price">)от 1000 ₽(<\/span>)/,
      '$1от 600 ₽$2',
    ),
  );
  const badgeMutantIssues = checkServiceBadgesAndTitles(catalogServices, mutantHtmlMap);
  expectCaught(
    '(д) разъезд бейджа .svc-price (от 600 ₽) с price_from и <title> (от 1000 ₽) ловится гейтом',
    badgeMutantIssues.length > 0,
  );

  if (!selfOk) fail = 1;
}

console.log(fail ? '\nFAIL: гейт синхронизации прайса не пройден' : '\nPASS: единый прайс синхронизирован со всеми страницами');
process.exit(fail ? 1 : 0);
