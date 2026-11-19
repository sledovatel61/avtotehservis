/* Приёмка круга 24: сетка услуг на мобильном стояла в три колонки по ~110 px —
   текст в карточках рвался и уходил за правый край, потому что у .svc-grid не было
   ни одного брейкпоинта. Похожая попытка положить правило в media.css не сработала:
   бандл pages.css грузится ПОСЛЕ, и базовое правило перебивало медиазапрос порядком.

   Гейт проверяет не наличие строки, а результат мини-каскада: на ширине 390 px для
   каждого grid-контейнера последнее действующее объявление grid-template-columns
   обязано давать ОДНУ колонку. Учитываются оба синтаксиса медиазапросов —
   `max-width:640px` и минифицированный `width<=640px`, — и порядок подключения
   стилей из HTML страницы.

   Запуск: node scripts/check-mobile-grid.mjs [--self-test] */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(SITE, 'pages-dist');
const MOBILE_W = 390;

/* контейнеры с текстом, у которых на десктопе больше одной колонки */
const GUARDED = ['.svc-grid', '.news-grid', '.feats', '.facts', '.rates', '.ftr-grid',
  '.contacts-grid', '.post-layout', '.svc-detail', '.about-grid'];

/* какой странице какие CSS принадлежат и в каком порядке — берём из собранного HTML */
function cssOrderFor(page) {
  const html = readFileSync(join(DIST, page), 'utf8');
  return [...html.matchAll(/<link[^>]+href="\/avtotehservis\/(_astro\/[^"]+\.css)"[^>]*>/g)].map((m) => m[1]);
}
function findPage() {
  const guess = 'services/index.html';
  if (existsSync(join(DIST, guess))) return guess;
  for (const d of readdirSync(DIST, { withFileTypes: true })) {
    if (d.isDirectory() && existsSync(join(DIST, d.name, 'index.html'))) return `${d.name}/index.html`;
  }
  return 'index.html';
}
const loadCss = (order) => order.map((f) => readFileSync(join(DIST, f), 'utf8')).join('\n');

/* медиазапрос → применяется ли он на ширине w */
function appliesAt(query, w) {
  /* в запросе может быть НЕСКОЛЬКО условий: (width>=900px) and (width<=1024px).
     Проверяем все, иначе «>=900px» терялось за «<=1024px» и медиа применялось не там. */
  let ok = true; let seen = false;
  for (const m of query.matchAll(/(?:max-width\s*:\s*|width\s*<=\s*)(\d+)px/g)) { seen = true; if (!(w <= +m[1])) ok = false; }
  for (const m of query.matchAll(/(?:min-width\s*:\s*|width\s*>=\s*)(\d+)px/g)) { seen = true; if (!(w >= +m[1])) ok = false; }
  return seen ? ok : true;                      /* запрос без ширины считаем применяющимся */
}

/* Плоский список правил в порядке документа с учётом вложенности @media.
   Простой сканер: идём по символам, на «{» перед которым стоит @media — заходим в медиа.
   Так корректно разбирается и `@media (width>=900px) and (width<=1024px)`, на котором
   регулярка с [^)]* обрывалась на первой скобке и теряла половину условий. */
function rules(css, w) {
  const out = [];
  const mediaStack = [];                        /* применяется ли каждый уровень */
  let buf = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const head = buf.trim();
      if (head.startsWith('@media')) {
        mediaStack.push(appliesAt(head.slice(6), w));
        buf = '';
        continue;
      }
      /* обычное правило: читаем тело до парной «}» */
      let depth = 1; let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      const applies = mediaStack.every(Boolean);
      if (!head.startsWith('@')) {
        for (const sel of head.split(',')) {
          const s = sel.trim();
          if (s) out.push({ sel: s, decl: body, applies });
        }
      }
      i = j - 1; buf = '';
      continue;
    }
    if (ch === '}') { mediaStack.pop(); buf = ''; continue; }
    buf += ch;
  }
  return out;
}

const colsOf = (decl) => {
  const m = decl.match(/grid-template-columns\s*:\s*([^;}]+)/);
  return m ? m[1].trim() : null;
};
const isOneCol = (v) => /^(1fr|none|repeat\(\s*1\s*,|minmax\(0,\s*1fr\)|100%)/.test(v);

function check(css, w = MOBILE_W) {
  const fails = [];
  const list = rules(css, w);
  for (const sel of GUARDED) {
    const own = list.filter((r) => r.sel === sel && r.applies && colsOf(r.decl));
    if (!own.length) continue;                  /* контейнера нет на этой странице */
    const last = colsOf(own[own.length - 1].decl);
    const desktop = colsOf(own[0].decl);
    const multi = /repeat\(\s*([2-9]|\d{2,})|1fr\s+1fr/.test(desktop || '');
    if (multi && !isOneCol(last))
      fails.push(`${sel}: на ${w} px действует «${last}» — колонок больше одной (десктоп: «${desktop}»)`);
  }
  return fails;
}

const css = loadCss(cssOrderFor(findPage()));

if (process.argv.includes('--self-test')) {
  const dropOneColSvc = (t) => t.replace(/@media[^{]*\{\.svc-grid\{grid-template-columns:1fr[^}]*\}\}/g, '');
  const mutants = [
    ['исходный дефект: у .svc-grid нет мобильного брейкпоинта',
      dropOneColSvc(css)],
    ['брейкпоинт есть, но перебит базовым правилом ниже по каскаду',
      dropOneColSvc(css) + '\n.svc-grid{grid-template-columns:repeat(3,1fr)}'],
    ['брейкпоинт только на 1024, а на 390 снова три колонки',
      dropOneColSvc(css) + '\n@media (max-width:1024px){.svc-grid{grid-template-columns:repeat(2,1fr)}}'],
  ];
  let ok = 0;
  for (const [name, mutant] of mutants) {
    const f = check(mutant);
    if (f.length) { ok++; console.log(`ok   мутант «${name}»: упал (${f[0]})`); }
    else console.log(`FAIL мутант «${name}» выжил`);
  }
  const base = check(css);
  if (base.length) { console.log(`FAIL база грязная: ${base.join('; ')}`); process.exit(1); }
  console.log(`check-mobile-grid: ${ok}/${mutants.length} мутантов роняют гейт, база чиста`);
  process.exit(ok === mutants.length ? 0 : 1);
}

const fails = check(css);
if (fails.length) { for (const f of fails) console.log('FAIL', f); console.log('MOBILE-GRID: ПРОВАЛ'); process.exit(1); }
console.log(`check-mobile-grid: OK (${GUARDED.length} контейнеров, на ${MOBILE_W} px везде одна колонка)`);
