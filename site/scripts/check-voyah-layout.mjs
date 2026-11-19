/* Круг 29 (M5 + S1/S2/S4/S5): гейт компоновки раздела «Voyah Free».

   Почему отдельный файл: блокер B1 (белая надпись на латунной кнопке, 1,85:1)
   прошёл `npm test` 79/79 — в `measure-contrast.mjs` не было ни одного
   селектора `.v-*`. Здесь проверяется то, что видно только в рендере:
   высота первого экрана, шапка на 7 пунктах, длительность и затухание интро.

   Входы: собранный публичный артефакт site/pages-dist (тот же, что уходит на
   Pages, — с демо-плашкой над шапкой, из-за которой первый экран и уезжал).
   Рендер — Chromium (puppeteer-core 23 + @sparticuz/chromium 131).

   Проверки:
     L1 первый экран: низ `.v-hero-meta` укладывается в окно на десктопе
        (1440×900, 1366×768, 1280×800, 1024×768) с запасом ≥16 px;
     L2 шапка: правый край `.hdr-cta .btn` не выходит за правый край контента
        `.hdr-in` на 1024…1920 с шагом 16 px; 7 пунктов в одну строку;
     L3 H1 ровно в три строки, каждая строка — одна (высота строки = line-height);
     L4 нет горизонтального скролла на 320…1920;
     L5 круглая кнопка на латуни: computed color текста — тёмный --v-ink
        (контраст 10,6:1), а не холодный #EAF2FF (1,85:1) — защита от рецидива B1;
     L6 интро: полная длительность ≤2500 мс на десктопе и ≤1620 мс на ≤700 px;
        силуэт гаснет ДО разъезда штор; КАЖДЫЙ заход на страницу показывает
        заставку заново (круг 30: раньше sessionStorage гасил её до конца сессии);
        `?intro=0` — выключает; без JS и при reduced-motion оверлея нет.
   L6 по умолчанию — ЗАСТАВКИ НЕТ (круг 74, 13.11.2026: владелец показывает
        страницу заказчику): оверлея `.vy-intro` нет ни сразу, ни через 2,9 с,
        нет body.vy-lock, нет canvas, заголовок не перекрыт, прокрутка свободна.
        Сборка с PUBLIC_VY_INTRO=1 и запуск гейта с VY_INTRO=1 проверяют прежние
        тайминги (2200–2600 / 1200–1500 мс), шторку 250–470 мс и пропуск ≤300 мс.
   Запуск: node site/scripts/check-voyah-layout.mjs (exit 1 при провале).
   --self-test: мутанты вёрстки и заставки (шапка шире контейнера, кнопка
   холодного цвета, «заставка вернулась»; при VY_INTRO=1 ещё интро 2900 мс,
   мгновенная шторка, скрытый кадр) и знака (искажённый viewBox, заливка краской
   владельца #1B1F3C, потерянный контур) — каждый обязан уронить гейт. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'pages-dist');
const BASE = '/avtotehservis';
const PORT = 4338;
const PAGE = `${BASE}/voyah-free/`;

/* Круг 74 (13.11.2026): заставка выключена на публикации — владелец показывает
   страницу заказчику. Гейт L6 проверяет то состояние, в котором страница
   собирается: без VY_INTRO=1 — что оверлея нет и он ничего не перекрывает;
   с VY_INTRO=1 — прежние тайминги, шторку и пропуск. Так проверка не отстаёт
   от кода и не требует держать мёртвые мутанты. */
const INTRO_ON = process.env.VY_INTRO === '1';

const DESKTOP = [[1440, 900], [1366, 768], [1280, 800], [1024, 768]];
const ALL = [...DESKTOP, [1920, 1080], [768, 1024], [390, 844], [320, 640]];
const HEADER = [];
for (let w = 1024; w <= 1920; w += 16) HEADER.push(w);

const MIME = { html: 'text/html', css: 'text/css', js: 'text/javascript', avif: 'image/avif', webp: 'image/webp', svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain', woff2: 'font/woff2', png: 'image/png', jpg: 'image/jpeg' };

let server;
async function startServer() {
  server = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
    const file = join(DIST, p === '/' ? 'index.html' : /\.[a-z0-9]+$/i.test(p) ? p : join(p, 'index.html'));
    try {
      const b = await readFile(file);
      const ext = file.split('.').pop().toLowerCase();
      res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
      res.end(b);
    } catch { res.statusCode = 404; res.end('nf'); }
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
}

const URL_ = `http://127.0.0.1:${PORT}${PAGE}`;

/* мутанты self-test: подменяем CSS/JS на лету */
const MUTANTS = {
  'шапка шире контейнера': `.hdr-in{gap:40px !important}.nav a{padding:8px 16px !important}.hdr-cta .btn{padding:10px 26px !important}`,
  'кнопка холодного цвета (рецидив B1)': `.v-hero .v-btn--brass,.v-sec .v-btn--brass{color:#EAF2FF !important}`,
  'интро длиннее нормы': `.vy-intro{--vy-scene:2600ms !important}`,
  'финальная шторка мгновенная': `.vy-intro{--vy-panel:60ms !important}`,
  'кадр заставки не виден': `.vy-intro-canvas,.vy-intro-poster{display:none !important}`,
};

/* Мутанты, которые имеют смысл только при включённой заставке: при выключенной
   `.vy-intro` в DOM нет, и CSS-подмене нечего ломать. Чтобы self-test не
   «зеленел» вхолостую, при INTRO_OFF они не запускаются, а вместо них работает
   DOM-мутант ниже — он возвращает оверлей и обязан уронить гейт в обоих режимах. */
const INTRO_MUTANTS = ['интро длиннее нормы', 'финальная шторка мгновенная', 'кадр заставки не виден'];

/* DOM-мутант: заставка «вернулась» на страницу. Гейт обязан это заметить —
   ровно так выглядел бы регресс, если бы выключение откатили. */
const DOM_MUTANTS = {
  'заставка вернулась поверх страницы': () => {
    const mk = () => {
      if (document.querySelector('.vy-intro')) return true;
      if (!document.body) return false;
      const d = document.createElement('div');
      d.className = 'vy-intro';
      d.setAttribute('aria-hidden', 'false');
      d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0B0E14';
      document.body.append(d);
      return true;
    };
    if (!mk()) {
      const mo = new MutationObserver(() => { if (mk()) mo.disconnect(); });
      mo.observe(document, { childList: true, subtree: true });
    }
  },
};

/* L7 нельзя проверить подмешиванием CSS: знак — инлайновый SVG, его ломают
   атрибутами. Мутант — кусок кода, который выполняется для каждого svg.v-mark
   сразу после появления в DOM (знак приезжает вместе с разметкой, но
   подстраховываемся MutationObserver'ом). */
const SVG_MUTANTS = {
  'знак искажён (viewBox растянут)': `el.setAttribute('viewBox','0 0 520 620.1')`,
  'знак залит краской владельца #1B1F3C': `el.querySelectorAll('path').forEach((p)=>p.setAttribute('fill','#1B1F3C'))`,
  'у знака потерян контур': `if (!el.dataset.mut) { el.dataset.mut = '1'; el.querySelector('path')?.remove(); }`,
};

async function run(mutant) {
  const fails = [];
  const notes = [];
  const bad = (m) => fails.push(m);
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox', '--disable-gpu'],
    headless: 'shell',
    defaultViewport: null,
  });
  try {
    /* ---------- L1…L5: статика ---------- */
    for (const [w, h] of ALL) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      /* круг 30: сессионного гейта в интро больше нет — прячем заставку
         параметром ?intro=0, иначе она перекроет замеры первого экрана */

      if (SVG_MUTANTS[mutant]) await page.evaluateOnNewDocument((code) => {
        const apply = () => document.querySelectorAll('svg.v-mark, svg.v-aside-mark')
          .forEach((el) => { try { new Function('el', code)(el); } catch { /* noop */ } });
        apply();
        const mo = new MutationObserver(apply);
        mo.observe(document, { childList: true, subtree: true });
        addEventListener('load', apply);
      }, SVG_MUTANTS[mutant]);
      else if (mutant) await page.evaluateOnNewDocument((css) => {
        const add = () => {
          const head = document.head || document.documentElement;
          if (!head) return false;
          const st = document.createElement('style');
          st.textContent = css;
          head.append(st);
          return true;
        };
        if (!add()) {
          const mo = new MutationObserver(() => { if (add()) mo.disconnect(); });
          mo.observe(document, { childList: true, subtree: true });
        }
      }, MUTANTS[mutant]);
      if (DOM_MUTANTS[mutant]) await page.evaluateOnNewDocument(DOM_MUTANTS[mutant]);
      await page.goto(URL_ + '?intro=0', { waitUntil: 'load' });
      await page.evaluate(() => window.scrollTo(0, 0));
      /* мутанты подмешивают CSS после DOMContentLoaded — ждём, пока доиграют
         150-мс переходы цвета, иначе замер ловит промежуточный оттенок */
      await new Promise((r) => setTimeout(r, 260));

      const m = await page.evaluate(() => {
        const r = (el) => el?.getBoundingClientRect();
        const h1 = document.querySelector('.v-hero-h');
        const lines = [...document.querySelectorAll('.v-hero-h .v-h1-l')].map((s) => ({
          h: +r(s).height.toFixed(2), text: s.textContent.trim(),
        }));
        const cs = h1 ? getComputedStyle(h1) : null;
        const meta = document.querySelector('.v-hero-meta');
        const hero = document.querySelector('.v-hero');
        const btn = document.querySelector('.v-hero .v-btn--brass');
        const cta = document.querySelector('.hdr-cta .btn');
        const wrap = document.querySelector('.hdr-in');
        const nav = [...document.querySelectorAll('.nav > ul > li')];
        const navTops = [...new Set(nav.map((li) => Math.round(r(li).top)))];
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          h1: h1 ? { fs: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), lines } : null,
          heroBottom: hero ? r(hero).bottom : null,
          metaBottom: meta ? r(meta).bottom : null,
          btnRight: cta ? r(cta).right : null,
          wrapRight: wrap ? r(wrap).right - parseFloat(getComputedStyle(wrap).paddingRight) : null,
          navCount: nav.length,
          navTops,
          brassColor: btn ? getComputedStyle(btn).color : null,
        };
      });
      const tag = `${w}×${h}`;

      /* ---------- L7: знак марки на странице (задание №48) ----------
         Логотип вернулся на страницу инлайновым SVG, поэтому проверяем не
         «файл лежит», а что он реально нарисован и не искажён: пропорция
         контура совпадает с пропорцией кадра (0.7122), заливка — не краска
         владельца #1B1F3C (она даёт 1.23:1 на почти чёрном фоне), и видимая
         ширина/высота знака не нулевые. */
      const mark = await page.evaluate(() => [...document.querySelectorAll('svg.v-mark, svg.v-aside-mark')].map((el) => {
        const r = el.getBoundingClientRect();
        const path = el.querySelector('path');
        /* bbox контура — объединение по всем подпутям: у знака их три
           (две лопасти и игла), и по отдельности каждая даёт свою пропорцию */
        let ub = null;
        try {
          for (const pp of el.querySelectorAll('path')) {
            const b = pp.getBBox();
            ub = ub
              ? { x0: Math.min(ub.x0, b.x), y0: Math.min(ub.y0, b.y), x1: Math.max(ub.x1, b.x + b.width), y1: Math.max(ub.y1, b.y + b.height) }
              : { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
          }
        } catch { ub = null; }
        const pathBox = ub ? { width: ub.x1 - ub.x0, height: ub.y1 - ub.y0 } : null;
        return {
          cls: el.getAttribute('class'),
          w: +r.width.toFixed(2),
          h: +r.height.toFixed(2),
          fill: getComputedStyle(path || el).fill,
          paths: el.querySelectorAll('path').length,
          vb: el.getAttribute('viewBox'),
          pathRatio: pathBox && pathBox.height ? +(pathBox.width / pathBox.height).toFixed(4) : null,
        };
      }));
      if (!mark.length) bad(`${tag}: на странице нет знака марки (svg.v-mark / .v-aside-mark)`);
      for (const m of mark) {
        const vbRatio = m.vb ? (() => { const v = m.vb.trim().split(/\s+/).map(Number); return +(v[2] / v[3]).toFixed(4); })() : null;
        if (vbRatio == null || Math.abs(vbRatio - 0.7122) > 0.01) bad(`${tag}: ${m.cls} пропорция кадра ${m.vb} ≠ 0.7122 (искажение знака)`);
        if (m.pathRatio != null && Math.abs(m.pathRatio - 0.7122) > 0.02) bad(`${tag}: ${m.cls} пропорция контура ${m.pathRatio} ≠ 0.7122`);
        /* пропорция самого элемента: при неверной ширине (как у PNG 24×34 =
           0.706) знак получает лишний горизонтальный запас и съезжает */
        const elRatio = m.h > 0 ? +(m.w / m.h).toFixed(4) : null;
        if (elRatio != null && Math.abs(elRatio - 0.7122) > 0.01) bad(`${tag}: ${m.cls} пропорция элемента ${elRatio} ≠ 0.7122 (${m.w}×${m.h})`);
        if (m.paths !== 3) bad(`${tag}: ${m.cls} контуров ${m.paths}, а в знаке их 3 (2 лопасти + игла)`);
        if (!(m.w > 1 && m.h > 1)) bad(`${tag}: ${m.cls} не отрисован (${m.w}×${m.h})`);
        const rgb = (m.fill.match(/\d+/g) || []).map(Number);
        if (rgb.length >= 3) {
          /* краска владельца на тёмном фоне не видна: 1.23:1 */
          const ink = rgb[0] < 40 && rgb[1] < 40 && rgb[2] < 65;
          if (ink) bad(`${tag}: ${m.cls} залит краской владельца ${m.fill} — на тёмном фоне 1.23:1`);
        } else if (!/currentcolor|rgb/i.test(m.fill)) bad(`${tag}: ${m.cls} заливка не определена (${m.fill})`);
      }

      if (m.scrollWidth > m.innerWidth + 1) bad(`${tag}: горизонтальный скролл ${m.scrollWidth} > ${m.innerWidth}`);
      if (!m.h1) bad(`${tag}: нет .v-hero-h`);
      else {
        if (m.h1.lines.length !== 3) bad(`${tag}: H1 не 3 строки (${m.h1.lines.length})`);
        const oneLine = m.h1.lines.every((l) => Math.abs(l.h - m.h1.lh) < m.h1.lh * 0.12);
        if (!oneLine) bad(`${tag}: строка H1 переносится (высоты ${m.h1.lines.map((l) => l.h).join('/')} при line-height ${m.h1.lh})`);
      }
      if (w >= 1024) {
        const slack = h - m.metaBottom;
        if (slack < 16) bad(`${tag}: первый экран не влезает, низ мета-строки ${Math.round(m.metaBottom)} при окне ${h} (запас ${Math.round(slack)} < 16)`);
        else notes.push(`${tag}: запас первого экрана ${Math.round(slack)} px`);
      }
      if (w >= 1024 && m.btnRight != null) {
        const over = m.btnRight - m.wrapRight;
        if (over > 0.5) bad(`${tag}: «Записаться» выходит за контейнер на ${over.toFixed(1)} px`);
        if (m.navTops.length !== 1) bad(`${tag}: пункты меню в ${m.navTops.length} строки`);
        if (m.navCount !== 7) bad(`${tag}: пунктов меню ${m.navCount}, а надо 7`);
      }
      if (w === 1920) { /* отдельный прогон ниже по сетке 16 px */ }
      if (m.brassColor) {
        const rgb = m.brassColor.match(/\d+/g).map(Number);
        if (!(rgb[0] < 40 && rgb[1] < 40 && rgb[2] < 60)) bad(`${tag}: надпись на латуни ${m.brassColor} — не тёмная (блокер B1)`);
      } else bad(`${tag}: не найдена латунная кнопка в первом экране`);
      await page.close();
    }

    /* ---------- L2 по всей сетке 1024…1920 ---------- */
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      /* круг 30: сессионного гейта в интро больше нет — прячем заставку
         параметром ?intro=0, иначе она перекроет замеры первого экрана */

      if (SVG_MUTANTS[mutant]) await page.evaluateOnNewDocument((code) => {
        const apply = () => document.querySelectorAll('svg.v-mark, svg.v-aside-mark')
          .forEach((el) => { try { new Function('el', code)(el); } catch { /* noop */ } });
        apply();
        const mo = new MutationObserver(apply);
        mo.observe(document, { childList: true, subtree: true });
        addEventListener('load', apply);
      }, SVG_MUTANTS[mutant]);
      else if (mutant) await page.evaluateOnNewDocument((css) => {
        const add = () => {
          const head = document.head || document.documentElement;
          if (!head) return false;
          const st = document.createElement('style');
          st.textContent = css;
          head.append(st);
          return true;
        };
        if (!add()) {
          const mo = new MutationObserver(() => { if (add()) mo.disconnect(); });
          mo.observe(document, { childList: true, subtree: true });
        }
      }, MUTANTS[mutant]);
      if (DOM_MUTANTS[mutant]) await page.evaluateOnNewDocument(DOM_MUTANTS[mutant]);
      await page.goto(URL_ + '?intro=0', { waitUntil: 'load' });
      let gapMin = Infinity;
      for (const w of HEADER) {
        await page.setViewport({ width: w, height: 900 });
        const m = await page.evaluate(() => {
          const r = (el) => el.getBoundingClientRect();
          const wrap = document.querySelector('.hdr-in');
          return {
            btn: r(document.querySelector('.hdr-cta .btn')).right,
            wrap: r(wrap).right - parseFloat(getComputedStyle(wrap).paddingRight),
            sw: document.documentElement.scrollWidth,
            iw: window.innerWidth,
            navTops: [...new Set([...document.querySelectorAll('.nav > ul > li')].map((li) => Math.round(r(li).top)))],
          };
        });
        if (m.btn - m.wrap > 0.5) bad(`шапка ${w}: кнопка за контейнером на ${(m.btn - m.wrap).toFixed(1)} px`);
        else gapMin = Math.min(gapMin, m.wrap - m.btn);
        if (m.navTops.length !== 1) bad(`шапка ${w}: меню в ${m.navTops.length} строки`);
        if (m.sw > m.iw + 1) bad(`шапка ${w}: горизонтальный скролл ${m.sw} > ${m.iw}`);
      }
      notes.push(`шапка: 1024…1920 шаг 16 — кнопка внутри контейнера (минимальный зазор ${gapMin.toFixed(1)} px), меню в одну строку`);
      await page.close();
    }

    if (INTRO_ON) {
    /* ---------- L6a: интро включено (сборка PUBLIC_VY_INTRO=1) ---------- */
      /* ---------- L6: интро (круг 30 — 3D-заставка на WebGL2) ---------- */
      for (const [w, h, min, limit, label] of [[1440, 900, 2200, 2600, 'десктоп'], [390, 844, 1200, 1500, 'мобильный 390'], [360, 780, 1200, 1500, 'мобильный 360']]) {
        const page = await browser.newPage();
        await page.setViewport({ width: w, height: h });
        if (SVG_MUTANTS[mutant]) await page.evaluateOnNewDocument((code) => {
          const apply = () => document.querySelectorAll('svg.v-mark, svg.v-aside-mark')
            .forEach((el) => { try { new Function('el', code)(el); } catch { /* noop */ } });
          apply();
          const mo = new MutationObserver(apply);
          mo.observe(document, { childList: true, subtree: true });
          addEventListener('load', apply);
        }, SVG_MUTANTS[mutant]);
        else if (mutant) await page.evaluateOnNewDocument((css) => {
          const add = () => {
            const head = document.head || document.documentElement;
            if (!head) return false;
            const st = document.createElement('style');
            st.textContent = css;
            head.append(st);
            return true;
          };
          if (!add()) {
            const mo = new MutationObserver(() => { if (add()) mo.disconnect(); });
            mo.observe(document, { childList: true, subtree: true });
          }
        }, MUTANTS[mutant]);
        if (DOM_MUTANTS[mutant]) await page.evaluateOnNewDocument(DOM_MUTANTS[mutant]);
        /* счётчик ставим ДО загрузки: иначе отсчёт начнётся после load и
           укоротит измеренную длительность на время разбора страницы */
        await page.evaluateOnNewDocument(() => {
          const rec = { t0: null, seenAt: null, openAt: null, gone: null, aria: null, drawn: false };
          window.__vyRec = rec;
          const tick = () => {
            const root = document.querySelector('.vy-intro');
            if (root) {
              if (rec.seenAt == null) rec.seenAt = performance.now();
              if (!rec.drawn) {
                const el = document.querySelector('.vy-intro-canvas, .vy-intro-poster');
                if (el) {
                  const cs = getComputedStyle(el);
                  const r = el.getBoundingClientRect();
                  if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 100 && r.height > 100) rec.drawn = true;
                }
              }
              if (rec.t0 == null && rec.drawn) rec.t0 = performance.now();
              if (rec.aria == null) rec.aria = root.getAttribute('aria-hidden');
              if (rec.openAt == null && root.classList.contains('is-open')) rec.openAt = performance.now();
            } else if (rec.seenAt != null && rec.gone == null) {
              rec.gone = performance.now();
              return;
            }
            if (performance.now() > 12000) return;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await page.goto(URL_, { waitUntil: 'load' });
        if (!(await page.$('.vy-intro'))) { bad(`интро ${label}: оверлей не появился при входе на страницу`); await page.close(); continue; }
        const res = await page.evaluate(() => new Promise((resolve) => {
          setTimeout(() => { const r = window.__vyRec ?? {}; resolve({ end: 0, fade: null, drawn: r.drawn ?? false, aria: r.aria ?? null, lock: false, canvases: 0, timeout: true }); }, 6000);
          const wait = () => {
            const r = window.__vyRec;
            if (r && r.gone != null) {
              return resolve({
                end: r.gone - (r.t0 ?? r.seenAt),
                fade: r.openAt == null ? null : r.gone - r.openAt,
                drawn: r.drawn,
                aria: r.aria,
                lock: document.body.classList.contains('vy-lock'),
                canvases: document.querySelectorAll('canvas').length,
              });
            }
            requestAnimationFrame(wait);
          };
          wait();
        }));
        if (res.timeout) { bad(`интро ${label}: оверлей не снялся за 6 с`); await page.close(); continue; }
        const dur = Math.round(res.end);
        if (!res.drawn) bad(`интро ${label}: ни 3D-canvas, ни статичного кадра`);
        if (res.aria !== 'true') bad(`интро ${label}: оверлей без aria-hidden="true"`);
        if (dur > limit) bad(`интро ${label}: ${dur} мс при норме ≤${limit}`);
        else if (dur < min) bad(`интро ${label}: ${dur} мс при норме ≥${min}`);
        else notes.push(`интро ${label}: ${dur} мс (норма ${min}–${limit})`);
        if (res.fade == null) bad(`интро ${label}: заставка не дошла до финальной фазы (is-open)`);
        else if (res.fade < 250 || res.fade > 470) bad(`интро ${label}: финальная шторка ${Math.round(res.fade)} мс при норме 250–300 (+140 запас)`);
        else notes.push(`интро ${label}: шторка ${Math.round(res.fade)} мс`);
        if (res.lock) bad(`интро ${label}: остался body.vy-lock`);
        if (res.canvases > 0) bad(`интро ${label}: после снятия в DOM остался canvas (${res.canvases})`);
        /* круг 30: повторный заход в той же сессии — заставка снова на месте */
        await page.goto(URL_, { waitUntil: 'load' });
        if (!(await page.$('.vy-intro'))) bad(`интро ${label}: при повторном заходе заставки нет (требование владельца)`);
        /* ?intro=0 — выключение по ссылке */
        await page.goto(URL_ + '?intro=0', { waitUntil: 'load' });
        if (await page.$('.vy-intro')) bad(`интро ${label}: ?intro=0 не выключает заставку`);
        await page.close();
        /* пропуск кликом и Esc — не дольше 300 мс (проверяем на десктопе) */
        if (w === 1440) {
          for (const how of ['click', 'esc']) {
            const sp = await browser.newPage();
            await sp.setViewport({ width: w, height: h });
            await sp.goto(URL_, { waitUntil: 'load' });
            await new Promise((r) => setTimeout(r, 350));
            const skipMs = await sp.evaluate((mode) => new Promise((resolve) => {
              const t0 = performance.now();
              const tick = () => {
                if (!document.querySelector('.vy-intro')) return resolve(performance.now() - t0);
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
              if (mode === 'esc') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              else document.querySelector('.vy-intro')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }), how);
            if (skipMs > 300) bad(`интро: пропуск по ${how} — ${Math.round(skipMs)} мс при норме ≤300`);
            else notes.push(`интро: пропуск по ${how} — ${Math.round(skipMs)} мс`);
            await sp.close();
          }
        }
      }
    } else {
    /* ---------- L6b: интро выключено (боевая сборка, круг 74) ----------
       Владелец показывает страницу заказчику, заставки быть не должно: ни
       оверлея, ни блокировки прокрутки, ни 3D-слоя. Проверяем не только
       «сразу после load», но и позже — заставка играла 2,2–2,6 с, и поздний
       старт тоже считается регрессом. */
    for (const [w, h, label] of [[1440, 900, 'десктоп'], [390, 844, 'мобильный 390'], [360, 780, 'мобильный 360']]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h });
      await page.goto(URL_, { waitUntil: 'load' });
      const snap = () => page.evaluate(() => ({
        intro: !!document.querySelector('.vy-intro'),
        lock: document.body.classList.contains('vy-lock'),
        canvases: document.querySelectorAll('canvas').length,
        scroll: getComputedStyle(document.body).overflow,
        h1: (() => {
          const el = document.querySelector('.v-hero-h');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { text: el.textContent.trim().slice(0, 40), covered: !(hit && (hit === el || el.contains(hit))) };
        })(),
      }));
      for (const [ms, when] of [[350, 'сразу'], [2900, 'через 2,9 с']]) {
        await new Promise((r) => setTimeout(r, ms - (ms === 2900 ? 350 : 0)));
        const s = await snap();
        if (s.intro) bad(`интро ${label}: оверлей .vy-intro на месте (${when}) — заставка должна быть выключена`);
        if (s.lock) bad(`интро ${label}: body.vy-lock не снят (${when}) — прокрутка заблокирована`);
        if (s.canvases > 0) bad(`интро ${label}: в DOM ${s.canvases} canvas — 3D-слой должен быть выключен`);
        if (!s.h1) bad(`интро ${label}: нет заголовка .v-hero-h (${when})`);
        else if (s.h1.covered) bad(`интро ${label}: заголовок перекрыт посторонним слоем (${when})`);
      }
      const scrollY = await page.evaluate(() => { window.scrollTo(0, 600); return window.scrollY; });
      if (scrollY < 500) bad(`интро ${label}: страница не прокручивается (scrollY ${scrollY}) — осталась блокировка`);
      notes.push(`интро ${label}: выключено — оверлея нет, прокрутка свободна, canvas 0`);
      await page.close();
    }
    }

    /* reduced-motion и без JS */
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.goto(URL_, { waitUntil: 'load' });
      if (await page.$('.vy-intro')) bad('интро: показывается при prefers-reduced-motion');
      await page.close();
      const nojs = await browser.newPage();
      await nojs.setJavaScriptEnabled(false);
      await nojs.goto(URL_, { waitUntil: 'load' });
      if (await nojs.$('.vy-intro')) bad('интро: оверлей при выключенном JS');
      const h1 = await nojs.$eval('.v-hero-h', (el) => el.textContent.trim());
      if (!h1.includes('ТО Voyah Free')) bad('без JS: H1 не читается');
      await nojs.close();
    }

  } finally {
    await browser.close();
  }
  return { fails, notes };
}

await startServer();
try {
  if (process.argv.includes('--self-test')) {
    let bad = 0;
    const names = [
      ...Object.keys(MUTANTS).filter((n) => INTRO_ON || !INTRO_MUTANTS.includes(n)),
      ...Object.keys(SVG_MUTANTS),
      ...Object.keys(DOM_MUTANTS),
    ];
    for (const name of names) {
      const { fails } = await run(name);
      const fell = fails.length > 0;
      if (!fell) bad = 1;
      console.log(`${fell ? 'ok  ' : 'ПРОВАЛ'} мутант «${name}»: гейт ${fell ? 'упал, как должен' : 'НЕ УПАЛ'}${fell ? ` → ${fails[0]}` : ''}`);
    }
    process.exit(bad);
  }
  const { fails, notes } = await run(null);
  for (const n of notes.slice(0, 12)) console.log('ok   ' + n);
  if (fails.length) {
    for (const f of fails) console.log('FAIL ' + f);
    console.log(`VOYAH-LAYOUT: ${fails.length} провалов`);
    process.exit(1);
  }
  console.log('VOYAH-LAYOUT: всё в норме');
} finally {
  server.close();
}
