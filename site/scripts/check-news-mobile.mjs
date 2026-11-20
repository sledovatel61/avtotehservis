/**
 * Круг 83: «Полезное» на телефоне. Гейт по СОБРАННОМУ CSS, а не по исходникам.
 *
 * Почему так: карточки стояли в две колонки на 390 px из-за порядка файлов в бандле —
 * правило `@media (max-width:1024px){.news-grid{grid-template-columns:1fr}}` лежало
 * в media.css, а media.css подключается РАНЬШЕ misc.css с pages.css. При равной
 * специфичности выигрывал pages.css, и на телефоне сетка оставалась двухколоночной.
 * Глазами исходников этого не видно, поэтому гейт читает <link rel=stylesheet>
 * из собранной страницы в том же порядке, что и браузер, и считает каскад.
 *
 * Что проверяется на 360/390/414/640/760/860: одна колонка, карточка — столбиком,
 * карточка не шире контейнера. На 861/900/1024/1440: две колонки, карточка — строка.
 * Плюс мета-строка не ломается (flex-wrap) и дата не переносится посередине.
 *
 * Запуск: node scripts/check-news-mobile.mjs [--self-test]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicPath } from './lib/public-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../pages-dist');
const SELF = process.argv.includes('--self-test');
const { base } = readPublicPath(process.env);

if (!existsSync(join(DIST, 'news/index.html'))) {
  console.error('FAIL нет pages-dist/news/index.html — сначала npm run build:pages');
  process.exit(1);
}

/* ---------- собираем CSS ровно в том порядке, в котором его увидит браузер ---------- */
const html = readFileSync(join(DIST, 'news/index.html'), 'utf8');
const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
const stripBaseRe = base ? new RegExp(`^${base}/`) : /^\/+/;
const sheets = hrefs.map((href) => {
  const file = join(DIST, href.replace(stripBaseRe, '').replace(/^\//, ''));
  if (!existsSync(file)) {
    console.error(`FAIL не найден собранный CSS: ${href}`);
    process.exit(1);
  }
  return readFileSync(file, 'utf8');
});
const ORDER = hrefs.map((h) => h.split('/').pop()).join(' → ');

/* ---------- разбор CSS: плоский список правил с их медиа-условиями ---------- */
function blockAt(src, from) { // from указывает на '{'
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return { body: src.slice(from + 1, j), end: j }; }
  }
  return { body: src.slice(from + 1), end: src.length };
}
function parseRules(src, conds = []) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    const { body, end } = blockAt(src, open);
    if (head.startsWith('@media')) out.push(...parseRules(body, [...conds, head.slice(6).trim()]));
    else if (head.startsWith('@')) { /* @supports, @keyframes, @font-face — не про нашу сетку */ }
    else out.push({ conds, sel: head, decl: body });
    i = end + 1;
  }
  return out;
}
const PARSED = sheets.map((css) => parseRules(css)); // по файлам, в порядке <link>

/* медиа-условие → подходит ли под ширину окна */
function matches(media, w) {
  if (!media) return true;
  const cond = media.replace(/\s+/g, '');
  const parts = cond.split(' and ');
  return parts.every((p) => {
    let m = p.match(/^\(max-width:(\d+)px\)$/) || p.match(/^\(width<=(\d+)px\)$/);
    if (m) return w <= +m[1];
    m = p.match(/^\(min-width:(\d+)px\)$/) || p.match(/^\(width>=(\d+)px\)$/);
    if (m) return w >= +m[1];
    m = p.match(/^\(width>=(\d+)px\)and\(width<=(\d+)px\)$/);
    if (m) return w >= +m[1] && w <= +m[2];
    if (p === 'print' || p.startsWith('(') === false) return false;
    return true; // прочие условия считаем выполненными
  });
}

const PROPS = ['grid-template-columns', 'flex-direction', 'flex', 'aspect-ratio', 'padding', 'min-width', 'font-size'];

/** значение последнего подходящего объявления для селектора и свойства */
function valueAt(selector, prop, width) {
  let out = null;
  for (const rules of PARSED) {
    for (const { conds, sel, decl } of rules) {
      if (!conds.every((c) => matches(c, width))) continue;
      if (!sel.split(',').map((x) => x.trim()).includes(selector)) continue;
      for (const part of decl.split(';')) {
        const idx = part.indexOf(':');
        if (idx < 0) continue;
        if (part.slice(0, idx).trim() !== prop) continue;
        out = part.slice(idx + 1).trim();
      }
    }
  }
  return out;
}

let fail = 0;
const bad = (m) => { fail = 1; console.error('FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

console.log(`«Полезное» на мобильном — каскад собранного CSS\n  порядок: ${ORDER}\n`);

for (const w of [360, 390, 414, 640, 760, 860]) {
  const cols = valueAt('.news-grid', 'grid-template-columns', w);
  const dir = valueAt('.news-card', 'flex-direction', w);
  const img = valueAt('.news-img', 'aspect-ratio', w);
  if (!/^1fr$|^repeat\(1,/.test(cols ?? '')) bad(`${w}: сетка «${cols}» — нужна одна колонка`);
  else ok(`${w}: одна колонка (${cols}), карточка ${dir ?? 'row'}, фото ${img ?? 'без пропорции'}`);
  if (dir !== 'column') bad(`${w}: карточка не столбиком (flex-direction: ${dir ?? 'row'})`);
  if (!img) bad(`${w}: у фото нет пропорции — на телефоне оно сжимается в узкую полоску`);
  const h3 = parseFloat(valueAt('.news-body h3', 'font-size', w) ?? '17.5');
  if (!(h3 >= 18)) bad(`${w}: заголовок карточки ${h3} px — мелко для одной колонки (норма ≥18)`);
}

for (const w of [861, 900, 1024, 1440]) {
  const cols = valueAt('.news-grid', 'grid-template-columns', w);
  const dir = valueAt('.news-card', 'flex-direction', w);
  if (!/^repeat\(2,/.test(cols ?? '')) bad(`${w}: сетка «${cols}» — на десктопе нужны две колонки`);
  else ok(`${w}: две колонки (${cols}), карточка ${dir ?? 'row'}`);
}

/* мета-строка: категория и дата не должны наезжать друг на друга */
{
  const wrap = valueAt('.news-meta', 'flex-wrap', 390);
  const nowrap = valueAt('.news-meta time', 'white-space', 390);
  (wrap === 'wrap' ? ok('мета-строка переносится (flex-wrap: wrap) — дата не наезжает на категорию')
    : bad(`мета-строка без flex-wrap (${wrap ?? 'нет'}) — на узкой карточке дата наезжает на категорию`));
  (nowrap === 'nowrap' ? ok('дата внутри не рвётся (white-space: nowrap)')
    : bad(`дата переносится посередине (white-space: ${nowrap ?? 'нет'})`));
}

/* карточка не должна требовать больше ширины, чем даёт колонка */
{
  const minw = valueAt('.news-card', 'min-width', 390);
  (minw === '0' ? ok('карточка может сжиматься (min-width: 0) — переполнения нет')
    : bad(`у карточки min-width: ${minw ?? 'не задан'} — во flex/grid она не сожмётся и вылезет`));
}

/* ---------- самопроверка: гейт обязан падать, если вернуть старый порядок ---------- */
if (SELF) {
  console.log('\nсамопроверка: гейт обязан ловить возврат двух колонок на телефоне');
  let selfOk = true;
  const expectFail = (name, broken) => {
    if (broken) console.log('  ok   ' + name);
    else { selfOk = false; console.error('  FAIL ' + name); }
  };
  /* имитируем старый бандл: правило одной колонки лежит в раннем файле, а двухколоночное — в позднем */
  const earlyFile = 'x-early.css';
  const lateFile = 'x-late.css';
  const saved = PARSED.slice();
  PARSED.length = 0;
  PARSED.push(parseRules('@media (max-width:760px){.news-grid{grid-template-columns:1fr}}'));
  PARSED.push(parseRules('.news-grid{grid-template-columns:repeat(2,1fr)}'));
  const cols = valueAt('.news-grid', 'grid-template-columns', 390);
  expectFail('две колонки из позднего файла перебивают ранний медиазапрос — гейт падает', cols !== '1fr');
  PARSED.length = 0;
  PARSED.push(...saved);
  void earlyFile; void lateFile;
  /* и наоборот: правило в том же файле после базового — работает */
  const probe = valueAt('.news-grid', 'grid-template-columns', 390);
  expectFail('в текущей сборке на 390 px реально одна колонка', probe === '1fr');
  if (!selfOk) fail = 1;
  console.log(selfOk ? '  самопроверка пройдена' : '  самопроверка НЕ пройдена');
}

console.log(fail ? '\nFAIL: мобильное «Полезное» не проходит гейт' : '\nPASS: на телефоне одна колонка, карточки читаются');
process.exit(fail ? 1 : 0);
