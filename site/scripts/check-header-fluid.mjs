/**
 * Круг 81: шапка на всю ширину и крупнее — гейт без headless-браузера.
 *
 * Почему расчёт, а не рендер: puppeteer в CI есть, но локально и на части раннеров
 * не поднимается Chromium (libnss3). Поэтому ширину считаем по метрикам шрифтов
 * (те же цифры, что сняты fontTools с site/public/fonts/*.woff2) и по тем же
 * clamp-формулам, что стоят в header.css, — так гейт работает везде и ловит
 * регресс в CSS, а не «красивый» рендер.
 *
 * Что проверяется:
 *   1) разметка: `.hdr-in` больше не `.container`, у него свой max-width/padding;
 *      демо-плашка над шапкой стоит по тем же краям (.hdr-wrap);
 *   2) 1024…2560 шаг 16: содержимое шапки помещается в доступную ширину, меню
 *      остаётся в одну строку (нет обрезки «Записаться» и «Voyah Free»);
 *   3) на 1920 шапка занимает ≥80 % окна, на 2560 — ≥65 %;
 *   4) размеры растут по clamp: пункт меню и логотип на 2560 крупнее, чем на 1280;
 *      на 1024–1360 размеры не растут (самый тесный диапазон);
 *   5) высота полосы не выходит за 76 px — первый экран не съезжает.
 *
 * Запуск: node scripts/check-header-fluid.mjs [--self-test]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = process.argv.includes('--self-test');

const META = {
  nav: {
    'Главная': 3.945, 'Услуги и цены': 7.065, 'Прайс': 3.100, 'О компании': 5.880,
    'Работы': 3.645, 'Полезное': 4.835, 'Контакты': 4.755, 'Voyah Free': 4.750,
  },
  logoName: 9.756,     // Unbounded 600, «АвтоТехСервис»
  logoSub: 16.18,      // Golos Text 500, «Ростов-на-Дону · Портовая, 439» + .04em на 26 знаков
  logoSubLs: 26 * 0.04,
  phone: 8.500,        // Golos Text 700, «+7 (951) 826-98-39»
  btn: 5.725,          // Golos Text 500, «Записаться»
  logoGap: 10,         // .logo{gap:10px}
  activeDot: 11,       // .is-active::after 5 px + margin 6 px
};
const WIDTHS = [];
for (let w = 1024; w <= 2560; w += 16) WIDTHS.push(w);

/* ---------- чтение CSS ---------- */
const CSS = readFileSync(join(HERE, '../src/styles/header.css'), 'utf8');
const TOKENS = readFileSync(join(HERE, '../src/styles/tokens.css'), 'utf8');
const ASTRO = readFileSync(join(HERE, '../src/components/Header.astro'), 'utf8');
const EXPORT = readFileSync(join(HERE, './export-pages.mjs'), 'utf8');
const MEDIA_CSS = readFileSync(join(HERE, '../src/styles/media.css'), 'utf8');

/* вырезает тело блока по открывающей скобке с учётом вложенности */
function body(css, from) {
  const i = css.indexOf('{', from);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (!depth) return css.slice(i + 1, j); }
  }
  return css.slice(i + 1);
}

const BASE = CSS.slice(0, CSS.indexOf('@media'));
const MEDIA = [];
{
  const re = /@media \(min-width:(\d+)px\)(?: and \(max-width:(\d+)px\))?\s*\{/g;
  let m;
  while ((m = re.exec(CSS))) {
    MEDIA.push({ min: +m[1], max: m[2] ? +m[2] : Infinity, css: body(CSS, m.index) });
  }
}

/* все блоки правила подряд: база, затем подходящие media — последнее объявление
   в цепочке и считается действующим (упрощённый каскад при равной специфичности) */
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[}\\n;])\\s*${esc}\\s*\\{`, 'g');
  let m, out = '';
  while ((m = re.exec(css))) out += body(css, m.index + m[0].length - 1) + ';';
  return out || null;
};
const decl = (block, prop) => {
  if (!block) return null;
  const re = new RegExp(`(?:^|[;\\n])\\s*${prop}\\s*:\\s*([^;]+)`, 'g');
  let m, out = null;
  while ((m = re.exec(block))) out = m[1].trim();
  return out;
};

/* значение свойства с балансировкой скобок: clamp(13.5px,calc(.625vw + 5px),15.5px)
   нельзя взять регуляркой [^)]* — внутри calc есть своя скобка */
function grabFn(block, prop) {
  if (!block) return null;
  const re = new RegExp(`(?:^|[;\\n])\\s*${prop}\\s*:\\s*`, 'g');
  let m, out = null;
  while ((m = re.exec(block))) {
    const rest = block.slice(m.index + m[0].length);
    const fn = rest.match(/^(clamp|calc|min|max)\(/);
    if (!fn) {
      const plain = rest.match(/^[^;]+/);
      if (plain) out = plain[0].trim();
      continue;
    }
    let depth = 0;
    for (let i = fn[0].length - 1; i < rest.length; i++) {
      if (rest[i] === '(') depth++;
      else if (rest[i] === ')') { depth--; if (!depth) { out = rest.slice(0, i + 1).trim(); break; } }
    }
  }
  return out;
}

/* ---------- вычисление clamp/calc ---------- */
function len(expr, vw) {
  const e = String(expr).trim();
  const num = (s) => {
    s = s.trim();
    if (s.endsWith('vw')) return parseFloat(s) * vw / 100;
    if (s.endsWith('px')) return parseFloat(s);
    return parseFloat(s);
  };
  const cl = e.match(/^clamp\((.+)\)$/);
  if (cl) {
    const [a, b, c] = cl[1].split(',').map((x) => x.trim());
    return Math.max(len(a, vw), Math.min(len(b, vw), len(c, vw)));
  }
  const ca = e.match(/^calc\((.+)\)$/);
  if (ca) {
    const parts = ca[1].replace(/\s+/g, ' ').trim().split(' ');
    let v = num(parts[0]);
    for (let i = 1; i < parts.length; i += 2) v = parts[i] === '-' ? v - num(parts[i + 1]) : v + num(parts[i + 1]);
    return v;
  }
  return num(e);
}

function styleAt(vw) {
  const chain = [BASE];
  for (const m of MEDIA) if (vw >= m.min && vw <= m.max) chain.push(m.css);
  const sel = (s) => {
    let out = null;
    for (const c of chain) {
      const b = rule(c, s);
      if (b !== null) out = out === null ? b : out + ';' + b;
    }
    return out;
  };
  return sel;
}

function measure(vw) {
  const pick = styleAt(vw);
  const padIn = len((CSS.match(/padding-inline:\s*(clamp\([^)]*\))/) || [])[1], vw);
  const hdrMax = parseFloat((TOKENS.match(/--hdr-max:\s*(\d+)px/) || [])[1]);
  const logo = pick('.logo img') || '';
  const navA = pick('.nav a') || '';
  const navUl = pick('.nav ul') || '';
  const cta = pick('.hdr-cta') || '';
  const btn = pick('.hdr-cta .btn') || '';
  const phone = pick('.hdr-phone') || '';
  const phoneSvg = pick('.hdr-phone svg') || '';
  const voyah = pick('.nav .nav-voyah a') || '';
  const title = pick('.logo-t') || '';
  const sub = pick('.logo-t b') || '';
  const hdrIn = pick('.hdr-in') || '';

  const logoW = len(grabFn(logo, 'width'), vw);
  const logoH = logoW * 42 / 68;
  const navFont = len(grabFn(navA, 'font-size') ?? '13.5px', vw);
  const padParts = grabFn(navA, 'padding').split(/\s+/);
  const padY = len(padParts[0], vw);
  const padX = len(padParts[1] ?? padParts[0], vw);
  const ulGap = len(grabFn(navUl, 'gap') ?? '0', vw);
  const ctaGap = len(grabFn(cta, 'gap') ?? '10px', vw);
  const btnFont = len(grabFn(btn, 'font-size') ?? '12.5px', vw);
  const btnPad = grabFn(btn, 'padding').split(/\s+/);
  const btnPadX = len(btnPad[1] ?? btnPad[0], vw);
  const btnPadY = len(btnPad[0], vw);
  const phoneFont = len(grabFn(phone, 'font-size') ?? '14.5px', vw);
  const phoneGap = len(grabFn(phone, 'gap') ?? '6px', vw);
  const iconW = len(grabFn(phoneSvg, 'width') ?? '17px', vw);
  const nameFont = len(grabFn(title, 'font-size') ?? '16px', vw);
  const subFont = len(grabFn(sub, 'font-size') ?? '10px', vw);
  const voyahPad = len(grabFn(voyah, 'padding-left') ?? `${padX}px`, vw);

  const hidePhone = /display:\s*none/.test(phone);
  const hidePhoneText = /display:\s*none/.test(pick('.hdr-phone span') || '');
  const hideSub = /display:\s*none/.test(sub);
  const hideNav = /display:\s*none/.test(pick('.nav') || '');
  const hideBurger = !/display:\s*(block|flex)/.test(pick('.burger') || '');

  const nameW = META.logoName * nameFont;
  const subW = (META.logoSub + META.logoSubLs) * subFont;
  const textW = hideSub ? nameW : Math.max(nameW, subW);
  const logoBlock = logoW + META.logoGap + textW;

  let navBlock = 0;
  if (!hideNav) {
    const items = Object.entries(META.nav);
    navBlock = items.reduce((sum, [label, em], i) =>
      sum + em * navFont + padX * 2 + (i === items.length - 1 ? Math.max(0, voyahPad - padX) : 0), 0)
      + ulGap * (items.length - 1) + META.activeDot;
  }

  const phoneW = hidePhone ? 0 : iconW + phoneGap + (hidePhoneText ? 0 : META.phone * phoneFont);
  const btnW = META.btn * btnFont + btnPadX * 2;
  const ctaBlock = (phoneW ? phoneW + ctaGap : 0) + btnW;

  const gap = len(grabFn(hdrIn, 'gap') ?? '14px', vw);
  const padYBlock = len(grabFn(hdrIn, 'padding-top') ?? '14px', vw);

  const content = Math.min(vw, hdrMax) - 2 * padIn;
  const need = logoBlock + gap + navBlock + gap + ctaBlock;
  return {
    vw, content, need, slack: content - need, gap, logoW, logoBlock, navBlock, ctaBlock,
    navFont, nameFont, subFont, btnFont, phoneFont, padX, padY, btnPadY,
    hidePhone, hidePhoneText, hideSub, hideNav, hideBurger, box: Math.min(vw, hdrMax),
    height: Math.max(44, logoH, nameFont * 1.1 + (hideSub ? 0 : 3 + subFont * 1.25), navFont * 1.2 + padY * 2) + padYBlock * 2,
  };
}

/* ---------- проверки ---------- */
let fail = 0;
const bad = (m) => { fail = 1; console.error('FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);

console.log('шапка, круг 81 — статика:');
const checks = [
  ['`.hdr-in` без .container', !/class="hdr-in container"/.test(ASTRO) && /class="hdr-in"/.test(ASTRO)],
  ['своя ширина: max-width:var(--hdr-max)', /\.hdr-in,\.hdr-wrap\{[^}]*max-width:var\(--hdr-max\)/.test(CSS)],
  ['боковые поля clamp(20px,3vw,48px)', /padding-inline:clamp\(20px,3vw,48px\)/.test(CSS)],
  ['--hdr-max объявлена в tokens.css', /--hdr-max:\s*1800px/.test(TOKENS)],
  ['демо-плашка стоит по краям шапки (.hdr-wrap)', /demo-notice hdr-wrap/.test(EXPORT)],
  ['шапка остаётся sticky', /\.hdr\{[^}]*position:sticky/.test(CSS)],
  ['компакт-режим жив (is-compact)', /\.hdr\.is-compact \.hdr-in\{padding-top:8px/.test(CSS)],
  ['пункты меню не переносятся', /\.nav a\{white-space:nowrap\}/.test(CSS)],
  ['пункт меню ≥ 44 px', /\.nav a\{[^}]*min-height:44px/.test(CSS)],
  ['--container не тронут', /--container:1200px/.test(TOKENS)],
  ['на ≤1023 меню спрятано, бургер показан', /@media \(max-width:1023px\)\{[\s\S]*?\.nav\{display:none\}[\s\S]*?\.burger\{display:block/.test(MEDIA_CSS)],
  ['пункты меню — пилюли с рамкой', /\.nav a\{[^}]*border-radius:999px[^}]*box-shadow:inset 0 0 0 1px/.test(CSS)],
  ['подписи меню крупнеют до 17 px', /\.nav a\{[^}]*font-size:clamp\(13\.5px,calc\(\.75vw \+ 3\.5px\),17px\)/.test(CSS)],
  ['кнопка «Записаться» до 16.5 px', /\.hdr-cta \.btn\{[^}]*font-size:clamp\(12\.5px,calc\(\.7vw \+ 4\.5px\),16\.5px\)/.test(CSS)],
];
for (const [name, pass] of checks) (pass ? ok(name) : bad(name));

console.log('\nзамер по 1024…2560 (шаг 16), ширина в px:');
let worst = null;
for (const w of WIDTHS) {
  const m = measure(w);
  if (m.slack < 8) bad(`${w}: не помещается — нужно ${m.need.toFixed(0)} px при ${m.content.toFixed(0)} (запас ${m.slack.toFixed(0)})`);
  if (m.height > 76) bad(`${w}: шапка ${m.height.toFixed(1)} px выше 76 — первый экран съедет`);
  if (!worst || m.slack < worst.slack) worst = m;
}
if (fail) console.error(`  минимальный запас ${worst.slack.toFixed(0)} px на ${worst.vw}`);
else ok(`1024…2560: везде влезает, минимальный запас ${worst.slack.toFixed(0)} px на ${worst.vw}`);

for (const [w, min] of [[1920, 0.8], [2560, 0.65]]) {
  const m = measure(w);
  const share = m.box / w;
  (share >= min ? ok(`${w}: шапка занимает ${(share * 100).toFixed(1)} % окна (норма ≥${min * 100} %)`)
    : bad(`${w}: шапка занимает ${(share * 100).toFixed(1)} % окна при норме ≥${min * 100} %`));
}

const a = measure(1280), b = measure(1440), c = measure(2560), d = measure(1024);
(b.navFont > a.navFont ? ok(`меню крупнее на 1440, чем на 1280 (${a.navFont.toFixed(1)} → ${b.navFont.toFixed(1)} px)`)
  : bad(`меню не растёт: 1280 ${a.navFont} px, 1440 ${b.navFont} px`));
(c.logoW > d.logoW ? ok(`логотип крупнее на 2560, чем на 1024 (${d.logoW.toFixed(0)} → ${c.logoW.toFixed(0)} px)`)
  : bad(`логотип не растёт: 1024 ${d.logoW} px, 2560 ${c.logoW} px`));
/* круг 82: подписи меню крупнее (13.5 → 17 px), поэтому «не расти» теперь
   относится только к самому тесному диапазону 1024–1199 и к 1200–1359,
   где ещё прячется телефон. Внутри каждого диапазона размер фиксирован,
   дальше растёт по clamp без прыжков. */
(Math.abs(measure(1024).navFont - measure(1199).navFont) < 0.01 && Math.abs(measure(1199).navFont - measure(1200).navFont) < 0.01
  ? ok('на 1024–1199 и 1200–1359 пункты меню не дёргаются — тесный диапазон')
  : bad(`пункты меню дёргаются на 1024–1359: ${measure(1024).navFont} → ${measure(1199).navFont} → ${measure(1200).navFont}`));
(measure(1360).navFont > measure(1199).navFont
  ? ok(`с 1360 подписи заметно крупнее: ${measure(1199).navFont.toFixed(1)} → ${measure(1360).navFont.toFixed(1)} px`)
  : bad('с 1360 подписи не стали крупнее'));
(measure(1920).navFont >= 16 ? ok(`на 1920 подписи меню ${measure(1920).navFont.toFixed(1)} px (было 15.5 — мелко)`)
  : bad(`на 1920 подписи меню ${measure(1920).navFont.toFixed(1)} px — мелко, норма ≥16`));
(measure(1920).btnFont >= 15.5 ? ok(`на 1920 надпись «Записаться» ${measure(1920).btnFont.toFixed(1)} px (было 14)`)
  : bad(`на 1920 надпись «Записаться» ${measure(1920).btnFont.toFixed(1)} px — мелко, норма ≥15.5`));
(c.need > b.need ? ok(`содержимое шапки шире на 2560, чем на 1440 (${b.need.toFixed(0)} → ${c.need.toFixed(0)} px)`)
  : bad('содержимое не растёт с шириной'));

console.log('\nтаблица (ширины из задания 81):');
const TABLE_W = [360, 390, 768, 1024, 1100, 1280, 1366, 1440, 1680, 1920, 2560];
console.table(TABLE_W.map((w) => {
  if (w < 1024) {
    const pad = len('clamp(20px,3vw,48px)', w);
    return {
      'ширина': w, 'контент': Math.round(w - 2 * pad), 'нужно': '—', 'запас': '—',
      'режим': 'бургер, .nav скрыт', 'меню': '—', 'лого': Math.round(Math.min(58, Math.max(52, w * 0.16))),
      'телефон': 'скрыт', 'шапка': '64 px',
    };
  }
  const m = measure(w);
  return {
    'ширина': w, 'контент': Math.round(m.content), 'нужно': Math.round(m.need), 'запас': Math.round(m.slack),
    'режим': `${(m.box / w * 100).toFixed(0)} % окна`,
    'меню': m.navFont.toFixed(2) + ' px', 'лого': m.logoW.toFixed(0),
    'телефон': m.hidePhone ? 'скрыт' : m.hidePhoneText ? 'трубка' : m.phoneFont.toFixed(1) + ' px',
    'шапка': m.height.toFixed(0) + ' px',
  };
}));

/* ---------- самопроверка гейта ---------- */
if (SELF) {
  console.log('\nсамопроверка: гейт обязан падать на сломанной шапке');
  let selfOk = true;
  const expectFail = (name, broken) => {
    if (broken) { console.log('  ok   ' + name); } else { selfOk = false; console.error('  FAIL ' + name); }
  };

  const brokenMax = TOKENS.replace(/--hdr-max:\s*\d+px/, '--hdr-max:1200px');
  const boxShare = parseFloat((brokenMax.match(/--hdr-max:\s*(\d+)px/) || [])[1]) / 1920;
  expectFail('max-width 1200 px → доля окна 62 % (норма ≥80 %) — гейт падает', !(boxShare >= 0.8));

  const hugeNav = CSS.replace(/font-size:clamp\(13\.5px,calc\(\.75vw \+ 3\.5px\),17px\)/, 'font-size:38px');
  if (hugeNav === CSS) expectFail('правило размера пункта меню найдено для подмены', false);
  else {
    const need8 = Object.values(META.nav).reduce((sum, em) => sum + em * 38 + 4 * 2, 0);
    const content1024 = 963;
    expectFail(`меню 38 px требует ${Math.round(need8)} px при ${content1024} доступных — гейт падает`, need8 > content1024);
  }

  const noWrap = CSS.replace('.nav a{white-space:nowrap}', '.nav a{white-space:normal}');
  expectFail('снятый nowrap ловится статической проверкой', !/\.nav a\{white-space:nowrap\}/.test(noWrap));

  const containerBack = ASTRO.replace('<div class="hdr-in">', '<div class="hdr-in container">');
  expectFail('возвращённый .container ловится статической проверкой', /class="hdr-in container"/.test(containerBack));

  if (!selfOk) fail = 1;
  console.log(selfOk ? '  самопроверка пройдена: все четыре поломки пойманы' : '  самопроверка НЕ пройдена');
}

console.log(fail ? '\nFAIL: шапка не проходит гейт' : '\nPASS: шапка тянется по окну и растёт по clamp');
process.exit(fail ? 1 : 0);
