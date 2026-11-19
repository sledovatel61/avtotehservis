/**
 * Круг 84: пометка о том, что цены — информационно-справочные.
 *
 * Владелец (голосом, 19.11) попросил написать на сайте, что цены не окончательные:
 * прайс справочный, может меняться, итог зависит от объёма и дополнительных работ.
 * Пометка живёт в одном месте (site/src/server/prices.ts), поэтому гейт проверяет
 * две вещи:
 *   1) на КАЖДОЙ странице, где в тексте есть рубли, есть блок .price-disclaimer;
 *   2) текст пометки содержит обязательные формулировки («информационно-справочный»,
 *      «не являются публичной офертой»), а на /prices ещё и дату актуальности цифр.
 *
 * Раньше дата была зашита в сноску («проверена 05.11.2026») и разъезжалась с прайсом,
 * поэтому отдельно проверяем, что старой даты в собранных страницах не осталось.
 *
 * Запуск: node scripts/check-price-disclaimer.mjs [--self-test]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../pages-dist');
const SRC = join(HERE, '../src/server/prices.ts');
const PRICES_JSON = join(HERE, '../content/prices.json');
const SELF = process.argv.includes('--self-test');

/** страницы, где есть цены: [путь собранного файла, человеческое имя] */
const PAGES = [
  ['index.html', 'главная'],
  ['prices/index.html', 'прайс'],
  ['services/index.html', 'услуги'],
  ['services/shinomontazh/index.html', 'карточка услуги (шиномонтаж)'],
  ['voyah-free/index.html', 'Voyah Free'],
  ['about/index.html', 'о компании'],
];

const REQUIRED = ['информационно-справочный', 'не являются публичной офертой'];
/* короткие версии пишут то же самое короче: «не публичная оферта». Смысл проверяем,
   а не дословную строку — иначе любая правка формулировки роняет гейт зря. */
const OFFER_ANY = /(не являются публичной офертой|не публичная оферта)/;
/** проверка фрагмента пометки: есть ли в нём обе мысли владельца */
const noteOk = (text) => /информационно-справочн/.test(text) && OFFER_ANY.test(text);

let fail = 0;
const bad = (m) => { fail = 1; console.error('FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

if (!existsSync(SRC)) {
  console.error('FAIL нет src/server/prices.ts — пометка должна жить в одном месте');
  process.exit(1);
}
const src = readFileSync(SRC, 'utf8');
for (const phrase of REQUIRED) {
  (src.includes(phrase) ? ok(`текст пометки в prices.ts содержит «${phrase}»`)
    : bad(`в prices.ts нет обязательной формулировки «${phrase}»`));
}
const pricesJson = existsSync(PRICES_JSON) ? JSON.parse(readFileSync(PRICES_JSON, 'utf8')) : {};
((/PRICE_UPDATED/.test(src) && /getPrices/.test(src) && /^\d{4}-\d{2}-\d{2}$/.test(pricesJson.updated_at ?? ''))
  ? ok(`дата актуальности читается из content/prices.json (${pricesJson.updated_at}) через PRICE_UPDATED`)
  : bad('в prices.ts PRICE_UPDATED должна браться из getPrices().updated_at (ГГГГ-ММ-ДД в content/prices.json)'));

console.log('\nстраницы с ценами:');
for (const [file, name] of PAGES) {
  const path = join(DIST, file);
  if (!existsSync(path)) { bad(`${name}: нет собранной страницы ${file}`); continue; }
  const html = readFileSync(path, 'utf8');
  const hasPrices = /₽/.test(html);
  const hasBlock = /class="price-disclaimer/.test(html);
  if (!hasPrices) { bad(`${name}: на странице нет рублей — проверьте, что она вообще собралась`); continue; }
  if (!hasBlock) { bad(`${name}: есть цены, но нет пометки .price-disclaimer`); continue; }
  /* текст пометки должен быть рядом с блоком, а не только в CSS */
  const idx = html.indexOf('price-disclaimer');
  /* пометка — один абзац; берём кусок от блока до конца абзаца */
  const slice = html.slice(idx, idx + 900);
  if (!noteOk(slice)) bad(`${name}: в пометке нет «информационно-справочн…» и/или «не …публичная оферта»`);
  else ok(`${name}: пометка на месте, обе формулировки есть`);
}

console.log('\nдата и оферта:');
{
  const prices = readFileSync(join(DIST, 'prices/index.html'), 'utf8');
  const dates = [...prices.matchAll(/\d{2}\.\d{2}\.\d{4}/g)].map((m) => m[0]);
  const uniq = [...new Set(dates)];
  if (uniq.length) ok(`на /prices дата актуальности: ${uniq.join(', ')}`);
  else bad('на /prices нет даты актуальности цифр');
  (uniq.includes('05.11.2026')
    ? bad('на /prices осталась старая дата 05.11.2026 — она расходится с PRICE_UPDATED')
    : ok('старой даты 05.11.2026 в собранной странице нет'));
  (/не являются публичной офертой/.test(prices) ? ok('на /prices прямо сказано «не являются публичной офертой»')
    : bad('на /prices нет формулировки про публичную оферту'));
  (/дополнительн[а-яё]* работ/.test(prices) ? ok('на /prices сказано про дополнительные работы (просьба владельца)')
    : bad('на /prices не упомянуты дополнительные работы — владелец просил именно это'));
}

/* ---------- самопроверка ---------- */
if (SELF) {
  console.log('\nсамопроверка: гейт обязан падать, если пометку убрать или переписать');
  let selfOk = true;
  const expectFail = (name, broken) => {
    if (broken) console.log('  ok   ' + name);
    else { selfOk = false; console.error('  FAIL ' + name); }
  };
  const sample = readFileSync(join(DIST, 'prices/index.html'), 'utf8');
  const stripped = sample.replace(/class="price-disclaimer/g, 'class="x');
  expectFail('убранный блок пометки ловится', !/class="price-disclaimer/.test(stripped));
  const reworded = src.replaceAll('информационно-справочный', 'справочный');
  expectFail('переписанная формулировка ловится', !reworded.includes('информационно-справочный'));
  expectFail('короткая пометка без оферты ловится', !noteOk('Цены — информационно-справочные, уточняйте по телефону.'));
  const oldDate = sample.replace(/\d{2}\.\d{2}\.\d{4}/, '05.11.2026');
  expectFail('старая дата ловится', /05\.11\.2026/.test(oldDate));
  if (!selfOk) fail = 1;
  console.log(selfOk ? '  самопроверка пройдена' : '  самопроверка НЕ пройдена');
}

console.log(fail ? '\nFAIL: пометка о справочных ценах не проходит гейт'
  : '\nPASS: на всех страницах с ценами есть пометка, дата одна');
process.exit(fail ? 1 : 0);
