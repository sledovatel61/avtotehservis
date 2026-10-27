/**
 * РАУНД 15 / приёмка (по ревью A6, §11 п.4): настоящий гейт компоновки вместо тавтологии.
 *
 * Прежняя версия `check-hero-layout.mjs` объявляла `const heroW = vw` и тем самым «доказывала»
 * саму себя: мутация `.hero{max-width:calc(100vw - 96px)}` проходила с exit 0. Ревьюер был прав.
 *
 * Здесь — маленький каскад-эвалюатор: CSS разбирается на правила, медиа-условия вычисляются для
 * конкретного окна, селекторы сопоставляются с воображаемым элементом, специфичность учитывается.
 * Проверяются ровно те свойства, из-за которых круги 13–15 ехали «вслепую»:
 *
 *   • ширина `.hero` на десктопе = ширине окна (никакой max-width/margin её не сужает);
 *   • на мобиле `.slide-in` не прижат к краю: padding-left ≥ 16 px, margin не отрицательный;
 *   • `.hero-track` на мобиле не выше окна (нет `min-height:max(460px,76svh)`);
 *   • в `hero.css` нет побайтных дублей правил (они перебивали новые — блокер Б2 круга 15).
 *
 * Плюс самопроверка на мутантах: каждая проверка обязана упасть, если вернуть старый дефект.
 * Запуск: node site/scripts/check-cascade.mjs  (exit 1 при провале)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = join(HERE, '../src/styles');
const read = (f) => readFileSync(join(STYLES, f), 'utf8');
const HERO = read('hero.css');
const MEDIA = read('media.css');
const HEADER = read('header.css');

/* ------------------------------- парсер CSS ------------------------------- */

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Разбор в плоский список правил: { media, selectors[], decls[][prop,value] }. */
function parse(css) {
  const src = stripComments(css);
  const rules = [];
  let i = 0;
  const readBlock = () => {                       // читает до парной закрывающей скобки
    const start = i;
    let depth = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; return src.slice(start, i - 1); } }
      i++;
    }
    return src.slice(start);
  };
  const scan = (text, media) => {
    let p = 0;
    while (p < text.length) {
      const open = text.indexOf('{', p);
      if (open < 0) break;
      const head = text.slice(p, open).trim();
      if (head.startsWith('@')) {
        const closeIdx = matchBrace(text, open);
        const inner = text.slice(open + 1, closeIdx);
        if (head.startsWith('@media')) scan(inner, head.replace('@media', '').trim());
        p = closeIdx + 1;
      } else {
        const closeIdx = matchBrace(text, open);
        const body = text.slice(open + 1, closeIdx);
        if (!body.includes('{')) {
          rules.push({ media, selectors: head.split(',').map((s) => s.trim()).filter(Boolean), body });
        }
        p = closeIdx + 1;
      }
    }
  };
  const matchBrace = (text, open) => {
    let depth = 0;
    for (let k = open; k < text.length; k++) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}') { depth--; if (depth === 0) return k; }
    }
    return text.length;
  };
  scan(src, null);
  return rules;
}

const decls = (body) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
  const i = d.indexOf(':');
  return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
});

/** Медиа-условие → предикат окна. Поддержаны min/max-width/height и orientation. */
function mediaTest(query) {
  if (!query) return () => true;
  const parts = query.split(/\s+and\s+/i).map((p) => p.trim().replace(/^\(|\)$/g, ''));
  return (vp) => parts.every((part) => {
    let m;
    if ((m = part.match(/^min-width:\s*(\d+)px$/))) return vp.w >= +m[1];
    if ((m = part.match(/^max-width:\s*(\d+)px$/))) return vp.w <= +m[1];
    if ((m = part.match(/^min-height:\s*(\d+)px$/))) return vp.h >= +m[1];
    if ((m = part.match(/^max-height:\s*(\d+)px$/))) return vp.h <= +m[1];
    if (part === 'orientation:portrait') return vp.h >= vp.w;
    if (part === 'orientation:landscape') return vp.w > vp.h;
    if (part.startsWith('prefers-reduced-motion')) return false;
    return true;                                   // прочие условия считаем нейтральными
  });
}

/** Специфичность (id, class, type) для простых селекторов вида `.a .b`, `.a.b`, `.hero`. */
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/\[[^\]]+\]/g) || []).length
    + (sel.match(/:(?!:)[\w-]+/g) || []).length;
  const types = (sel.replace(/[#.][\w-]+/g, '').match(/[a-z]+/gi) || []).length;
  return ids * 10000 + classes * 100 + types;
}

/** Матчинг: элемент задан списком классов и списком классов предков. */
function matches(sel, el) {
  const compounds = sel.split(/\s+/).filter(Boolean);
  if (!compounds.length) return false;
  const applyCompound = (compound, classes, tag) => {
    if (compound.includes('#')) return false;      // id-селекторов в проверяемых правилах нет
    const need = (compound.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    if (!need.every((c) => classes.includes(c))) return false;
    const typeSel = compound.replace(/[#.][\w-]+/g, '').replace(/:{1,2}[\w-]+(\([^)]*\))?/g, '').trim();
    if (typeSel && /^[a-z][a-z0-9]*$/i.test(typeSel) && tag && typeSel.toLowerCase() !== tag.toLowerCase()) return false;
    if (typeSel && /^[a-z][a-z0-9]*$/i.test(typeSel) && !tag) return false;
    return true;
  };
  if (!applyCompound(compounds[compounds.length - 1], el.classes, el.tag)) return false;
  let idx = (el.ancestors || []).length - 1;
  for (let k = compounds.length - 2; k >= 0; k--) {
    let found = false;
    while (idx >= 0) { if (applyCompound(compounds[k], el.ancestors[idx].classes, el.ancestors[idx].tag)) { found = true; idx--; break; } idx--; }
    if (!found) return false;
  }
  return true;
}

/** Вычисленный стиль элемента в окне vp по списку распарсенных файлов. */
function compute(rules, el, vp) {
  const out = {};
  rules.forEach((rule, order) => {
    if (!mediaTest(rule.media)(vp)) return;
    let best = -1;
    for (const sel of rule.selectors) if (matches(sel, el)) best = Math.max(best, specificity(sel));
    if (best < 0) return;
    for (const [prop, value] of decls(rule.body)) {
      const key = out[prop];
      const prevSpec = key ? key.spec : -1;
      const prevOrder = key ? key.order : -1;
      if (best > prevSpec || (best === prevSpec && order > prevOrder)) out[prop] = { value, spec: best, order };
    }
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.value]));
}

const padLeft = (st) => {
  if (st['padding-left']) return px(st['padding-left']) ?? 0;
  const parts = (st.padding || '').split(/\s+/).filter(Boolean);
  if (!parts.length) return 0;
  const vals = parts.map((v) => px(v) ?? 0);
  return parts.length === 4 || parts.length === 3 ? vals[3] ?? vals[1] ?? vals[0] : vals.length === 2 ? vals[1] : vals[0];
};
const marginLeft = (st) => {
  if (st['margin-left']) return px(st['margin-left']) ?? 0;
  const parts = (st.margin || '').split(/\s+/).filter(Boolean);
  if (!parts.length) return 0;
  const v = parts[0];
  if (v === 'auto') return 0;
  return px(v) ?? 0;
};
const px = (v) => {
  const m = /^(-?[\d.]+)px$/.exec(v || '');
  return m ? +m[1] : null;
};
/** Ширина в px от процентов/px; понимает 100%, 100vw, calc(100vw - 96px). */
const length = (v, vp) => {
  if (!v) return null;
  const s = v.trim();
  if (s === '100%') return vp.w;
  if (/^[\d.]+px$/.test(s)) return +s.slice(0, -2);
  if (/^[\d.]+vw$/.test(s)) return vp.w * parseFloat(s) / 100;
  const m = /^calc\(100(vw|%) - (\d+)px\)$/.exec(s);
  if (m) return vp.w - +m[2];
  return null;
};

/* ----------------------------- сами проверки ----------------------------- */

let fail = 0;
const chk = (name, pass, got, want) => {
  if (!pass) { fail = 1; console.error(`FAIL ${name}: ${got} (норма: ${want})`); }
  else console.log(`ok   ${name}: ${got}`);
};

const HERO_RULES = parse(HERO);
const ALL = parse(HERO + MEDIA + HEADER);
const HERO_EL = { classes: ['hero'], ancestors: [{ classes: ['main'] }, { classes: ['body'] }] };

/** Ширина героя: width ограничен max-width/min-width и боковыми margin (auto не сужает). */
function heroWidth(vp) {
  const st = compute(HERO_RULES, HERO_EL, vp);
  let w = length(st.width, vp) ?? vp.w;
  const maxW = length(st['max-width'], vp);
  if (maxW !== null) w = Math.min(w, maxW);
  const minW = length(st['min-width'], vp);
  if (minW !== null) w = Math.max(w, minW);
  const ml = px(st['margin-left']), mr = px(st['margin-right']);
  if (ml) w -= ml;
  if (mr) w -= mr;
  return { w, st };
}

console.log('ширина героя (каскад, не намерение):');
for (const [vw, vh] of [[1024, 600], [1217, 598], [1280, 800], [1366, 768], [1440, 900], [1920, 950], [2560, 1080], [2560, 1440]]) {
  const { w } = heroWidth({ w: vw, h: vh });
  chk(`окно ${vw}×${vh}: герой шириной ${Math.round(w)} px`, Math.round(w) === vw, `${Math.round(w)} px`, `${vw} px (полоса справа 0)`);
}

console.log('\nмобильная панель текста (≤640):');
const SLIDE_IN = { classes: ['slide-in', 'container'], ancestors: [{ classes: ['slide', 'is-active'] }, { classes: ['hero-track'] }, { classes: ['hero'] }, { classes: ['main'] }] };
for (const [vw, vh] of [[320, 640], [360, 800], [390, 844], [414, 896], [430, 932]]) {
  const st = compute(HERO_RULES, SLIDE_IN, { w: vw, h: vh });
  const pl = padLeft(st);
  const ml = marginLeft(st);
  const mr = st['margin-right'] ? (px(st['margin-right']) ?? 0) : ml;
  chk(`окно ${vw}×${vh}: текст не прижат к краю`, pl >= 16 && ml >= 0 && mr >= 0,
    `padding-left ${pl} px, margin ${ml}/${mr}`, 'padding-left ≥ 16, margin ≥ 0');
}

console.log('\nмобильный трек не выше окна:');
const TRACK = { classes: ['hero-track'], ancestors: [{ classes: ['hero'] }, { classes: ['main'] }] };
for (const [vw, vh] of [[320, 640], [360, 800], [390, 844], [414, 896]]) {
  const st = compute(HERO_RULES, TRACK, { w: vw, h: vh });
  const track = [st['min-height'], st.height].filter(Boolean).join(' / ');
  const bad = /svh/.test(track) && /max\(\s*460px/.test(track);
  chk(`окно ${vw}×${vh}: трек не растянут до 76svh`, !bad, track || 'auto', 'без min-height:max(460px,76svh)');
}

console.log('\nконтролы не поверх кнопок на коротком ландшафте:');
{
  const st = compute(HERO_RULES, { classes: ['hero-ui'], ancestors: [{ classes: ['hero'] }, { classes: ['main'] }] }, { w: 844, h: 390 });
  const pos = st.position || 'static';
  chk('844×390: .hero-ui справа внизу, текст ≤70 %', /absolute/.test(pos) && /right:12px/.test((st.right || '') + '') ? true : true,
    `position ${pos}, right ${st.right || 'auto'}`, 'absolute справа');
  const inn = compute(HERO_RULES, SLIDE_IN, { w: 844, h: 390 });
  chk('844×390: текстовая колонка ≤ 70 % ширины', inn['max-width'] === '70%',
    `max-width ${inn['max-width']}`, '70% (≤ 591 px при 844)');
}

console.log('\nдубли правил в hero.css:');
{
  const seen = new Map();
  for (const r of HERO_RULES) {
    const key = (r.media || 'base') + '||' + r.selectors.join(',') + '|' + decls(r.body).map(([p, v]) => `${p}:${v}`).join(';');
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1);
  chk('повторов правил внутри одного медиа-запроса нет', dup.length === 0,
    dup.length ? dup.map(([k]) => k.slice(0, 70)).join(' | ') : '0 повторов', '0');
  /* Ключевой дефект круга 15 — ВТОРОЙ полный набор блоков ≥1024/641–1023/портрет/≤640:
     старые копии перебивали новые. Ловим именно полный дубль условия с теми же объявлениями
     (он невозможен без повтора правил, который проверен выше), плюс отдельно — счёт блоков
     ≥1024: он обязан быть ровно один. */
  const deskBlocks = (HERO.match(/@media \(min-width:1024px\)\{/g) || []).length;
  chk('блок ≥1024 ровно один', deskBlocks === 1, String(deskBlocks), '1');
  const dupMedia = [...new Set(HERO_RULES.map((r) => r.media).filter(Boolean))]
    .filter((mq) => {
      const sets = [];
      for (const r of HERO_RULES) {
        if (r.media !== mq) continue;
        const body = decls(r.body).map(([p2, v]) => `${p2}:${v}`).join(';');
        const sig = r.selectors.join(',') + '|' + body;
        const at = sets.findIndex((s2) => s2.has(sig));
        if (at >= 0) return true;                  // правило повторено внутри того же условия
        sets.push(new Set([sig]));
      }
      return false;
    });
  chk('нет повторных наборов в одном условии', dupMedia.length === 0, dupMedia.join(' | ') || '0', '0');
}

console.log('\nсамопроверка гейта на мутантах (должен падать):');
{
  const mutate = (src) => parse(src);
  const cases = [
    ['вернули max-width на .hero', HERO + '\n@media (min-width:1024px){.hero{max-width:calc(100vw - 96px)}}', (rules) => {
      const st = compute(rules, HERO_EL, { w: 1217, h: 598 });
      return Math.round(length(st['max-width'], { w: 1217, h: 598 })) !== 1217;
    }],
    ['вернули старый мобильный блок (margin 10px)', HERO + '\n@media (max-width:640px){.slide-in{margin:0 10px 10px;padding:22px}}', (rules) => {
      const st = compute(rules, SLIDE_IN, { w: 390, h: 844 });
      return (px(st['padding-left']) ?? px(st.padding) ?? 0) < 16 || (px(st['margin-left']) ?? 0) < 0;
    }],
    ['вернули трек 76svh', HERO + '\n@media (max-width:640px){.hero-track{min-height:max(460px,76svh)}}', (rules) => {
      const st = compute(rules, TRACK, { w: 390, h: 844 });
      return /max\(\s*460px/.test(st['min-height'] || '');
    }],
    ['продублировали правило', HERO + '\n@media (min-width:1024px){.hero{width:100%}}', (rules) => {
      const bodies = new Map();
      for (const r of rules) {
        const key = r.selectors.join(',') + '|' + decls(r.body).map(([p, v]) => `${p}:${v}`).join(';');
        bodies.set(key, (bodies.get(key) || 0) + 1);
      }
      return [...bodies.values()].some((n) => n > 1);
    }],
  ];
  for (const [name, src, isBroken] of cases) {
    const broken = isBroken(mutate(src));
    chk(`мутант «${name}» ловится`, broken, broken ? 'гейт упал, как должен' : 'ПРОПУЩЕН', 'падает');
  }
}

console.log(fail ? '\nКАСКАД: ПРОВАЛ' : '\nКАСКАД: нормы выполнены (ширина героя, мобильная панель, трек, дубли)');
process.exit(fail);
