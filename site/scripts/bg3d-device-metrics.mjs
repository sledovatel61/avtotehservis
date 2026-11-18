#!/usr/bin/env node
/**
 * Харнесс реальных замеров 3D-фона на живом браузере (задание №44, раунд 30).
 *
 * Зачем он нужен, если есть scripts/bg3d-measure.mjs: там, где песочница кончается
 * (нет GPU и браузера), начинаются цифры, которые нельзя честно смоделировать —
 * настоящие fps, настоящее время GPU, настоящая батарея и настоящая память DOM/кучи
 * после 20 переходов. Этот скрипт снимает именно их. В песочнице он отказывается
 * запускаться и объясняет, что делать; на машине с Chrome — работает.
 *
 * Что нужно:
 *   npm i -D playwright && npx playwright install chromium      # или puppeteer
 *   cd site && npm run build && BG3D_LAB=1 node dist/server/entry.mjs   # стенд на :4321
 *
 * Запуск:
 *   node scripts/bg3d-device-metrics.mjs                        # 4 профиля × эмуляция в Chrome
 *   node scripts/bg3d-device-metrics.mjs --profiles P3,P4       # только мобильные
 *   node scripts/bg3d-device-metrics.mjs --attach http://192.168.1.20:9222
 *       # главное: настоящий телефон. На устройстве включить отладку по USB
 *       # (chrome://inspect → Remote target), и харнесс снимет РЕАЛЬНЫЕ fps/батарею/память
 *       # с железа, а не с эмуляции. Только так числа P3/P4 становятся замером, а не моделью.
 *   node scripts/bg3d-device-metrics.mjs --headed --seconds 15 --cycles 20
 *
 * Что снимается на каждом профиле:
 *   fps / frameMsAvg / frameMsP95 / gpuMs (EXT_disjoint_timer_query, если браузер отдаёт),
 *   фактическое разрешение канваса и масштаб после пиксельного бюджета, деградации watchdog'а,
 *   решение gate.ts с причинами, JS-куча (performance.memory + CDP Memory.getDOMCounters),
 *   батарея (BatteryManager: уровень до/после, зарядка), и отдельные сценарии:
 *   prefers-reduced-motion, saveData, пауза вне экрана, кнопка «выключить».
 *
 * Результат: evaluation/round30-bg-3d/device-metrics/<профиль>.json + свод console.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const REPO = resolve(SITE, '..');
const OUT = resolve(REPO, 'evaluation', 'round30-bg-3d', 'device-metrics');

const arg = (name, dflt = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const has = (name) => process.argv.includes(`--${name}`);

const BASE = arg('url', 'http://localhost:4321');
const SECONDS = Number(arg('seconds', 8));
const CYCLES = Number(arg('cycles', 20));
const HEADED = has('headed');
const ATTACH = arg('attach', null);
const ONLY = arg('profiles', null)?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) ?? null;

/** Те же четыре профиля, что в scripts/bg3d-measure.mjs — чтобы модель и замер сравнивались 1:1.
 *  Эмуляция в Chrome передаёт viewport/DPR/UA/тач и троттлит CPU, но GPU остаётся хостовым:
 *  для честных P3/P4 нужен --attach к настоящему устройству. */
const PROFILES = [
  { id: 'P1', name: 'Десктоп + dGPU', viewport: { width: 1920, height: 1080 }, dpr: 1, cpuThrottle: 1,
    ua: null, mobile: false, touch: false },
  { id: 'P2', name: 'Офисный ноутбук (iGPU)', viewport: { width: 1366, height: 768 }, dpr: 1, cpuThrottle: 2,
    ua: null, mobile: false, touch: false },
  { id: 'P3', name: 'Массовый Android (Adreno 610 класс)', viewport: { width: 393, height: 852 }, dpr: 2.75, cpuThrottle: 4,
    ua: 'Mozilla/5.0 (Linux; Android 12; Redmi Note 12 4G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    mobile: true, touch: true },
  { id: 'P4', name: 'Слабый Android (Mali-G57 MC1 класс)', viewport: { width: 360, height: 800 }, dpr: 2, cpuThrottle: 6,
    ua: 'Mozilla/5.0 (Linux; Android 11; SM-A032F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    mobile: true, touch: true },
];

const VARIANTS = ['depth', 'silhouette'];

/* ------------------------------------------------------------------ */
async function loadDriver() {
  for (const mod of ['playwright', 'playwright-core', 'puppeteer']) {
    try {
      const m = await import(mod);
      const impl = m.default ?? m;
      const chromium = impl.chromium ?? impl;
      if (typeof chromium.launch === 'function' || typeof chromium.launchPuppeteer === 'function') return { mod, chromium, impl };
      if (typeof impl.launch === 'function') return { mod, chromium: impl, impl };
    } catch { /* следующий кандидат */ }
  }
  return null;
}

const driver = await loadDriver();
if (!driver) {
  console.error(`
НЕ ЗАПУЩЕНО: в этой среде нет браузера (ни playwright, ни puppeteer), а без GPU и браузера
честных fps/батареи не бывает — только модель (она уже посчитана: scripts/bg3d-measure.mjs).

Чтобы снять НАСТОЯЩИЕ числа, на машине с Chrome:

  1) cd site && npm i -D playwright && npx playwright install chromium
  2) npm run build && BG3D_LAB=1 node dist/server/entry.mjs        # стенд на http://localhost:4321
  3) node scripts/bg3d-device-metrics.mjs --headed                  # 4 профиля × 2 варианта
  4) для настоящих телефонов (иначе P3/P4 — эмуляция, GPU хостовый):
       на Android: chrome://flags → Remote debugging, USB-отладка,
       adb forward tcp:9222 localabstract:chrome_devtools_remote
       node scripts/bg3d-device-metrics.mjs --attach http://127.0.0.1:9222 --profiles P3,P4

Результаты лягут в evaluation/round30-bg-3d/device-metrics/*.json — их нужно приложить
к отчёту и заменить ими строки «модель» в verdict.md.
`);
  process.exit(2);
}

/* ------------------------------------------------------------------ */
const { mod, chromium } = driver;
const results = [];
const browser = ATTACH && typeof chromium.connectOverCDP === 'function'
  ? await chromium.connectOverCDP(ATTACH)
  : await chromium.launch({ headless: !HEADED, args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });

if (ATTACH) console.log(`подключено к устройству: ${ATTACH} (реальные fps/батарея)`);
else console.log(`драйвер: ${mod}, ${HEADED ? 'headed' : 'headless'} — GPU хостовый, мобильные профили эмулируются (CPU троттлинг через CDP)`);

const want = (p) => !ONLY || ONLY.includes(p.id);

for (const p of PROFILES.filter(want)) {
  for (const variant of VARIANTS) {
    const ctx = await browser.newContext({
      viewport: p.viewport,
      deviceScaleFactor: p.dpr,
      userAgent: p.ua ?? undefined,
      isMobile: p.mobile,
      hasTouch: p.touch,
    });
    const page = await ctx.newPage();
    let cdp = null;
    try { cdp = await ctx.newCDPSession(page); } catch { cdp = null; }
    if (cdp) {
      try { await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpuThrottle }); } catch { /* не все браузеры */ }
    }
    const url = `${BASE}/lab/bg3d?bench=1&variant=${variant}&seconds=${SECONDS}&cycles=${CYCLES}`;
    const row = { profile: p.id, profileName: p.name, variant, url, cpuThrottle: p.cpuThrottle, emulated: !ATTACH };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      /* ждём, пока стенд сам отработает bench + cycles и выставит заголовок */
      await page.waitForFunction(() => document.title === 'BENCH DONE', { timeout: (SECONDS + CYCLES + 60) * 1000 });
      row.bench = await page.evaluate(() => window.__bg3dBench ?? null);
      row.cycles = await page.evaluate(() => window.__bg3dCycles ?? null);
      if (cdp) {
        try { row.cdpMemory = await cdp.send('Memory.getDOMCounters'); } catch { row.cdpMemory = null; }
        try { row.cdpMetrics = (await cdp.send('Performance.getMetrics')).metrics; } catch { row.cdpMetrics = null; }
      }

      /* --- сценарий: prefers-reduced-motion → движение обязано отсутствовать --- */
      const p2 = await ctx.newPage();
      await p2.emulateMedia({ reducedMotion: 'reduce' });
      await p2.goto(`${BASE}/lab/bg3d?bench=1&variant=${variant}&seconds=4`, { waitUntil: 'load' });
      await p2.waitForFunction(() => document.title === 'BENCH DONE', { timeout: 90000 });
      const rm = await p2.evaluate(() => window.__bg3dBench ?? null);
      row.reducedMotion = { motion: rm?.decision?.motion ?? null, frames: rm?.frame?.frames ?? null, fps: rm?.frame?.fps ?? null, tier: rm?.decision?.tier ?? null };
      await p2.close();

      /* --- сценарий: saveData → фон обязан быть выключен --- */
      const p3 = await ctx.newPage();
      await p3.addInitScript(() => {
        const c = { effectiveType: '2g', saveData: true, downlink: 0.3, rtt: 100 };
        Object.defineProperty(navigator, 'connection', { value: c, configurable: true });
      });
      await p3.goto(`${BASE}/lab/bg3d?bench=1&variant=${variant}&seconds=4`, { waitUntil: 'load' });
      await p3.waitForFunction(() => document.title === 'BENCH DONE', { timeout: 90000 });
      const sd = await p3.evaluate(() => window.__bg3dBench ?? null);
      row.saveData = { tier: sd?.decision?.tier ?? null, reasons: sd?.decision?.reasons ?? null, frames: sd?.frame?.frames ?? null };
      await p3.close();

      /* --- сценарий: пауза вне экрана (скролл вниз) и кнопка «выключить» --- */
      const p4 = await ctx.newPage();
      await p4.goto(`${BASE}/lab/bg3d?variant=${variant}`, { waitUntil: 'load' });
      await p4.waitForTimeout(1500);
      const before = await p4.evaluate(() => window.__bg3dDebug?.stats?.() ?? null);
      await p4.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
      await p4.waitForTimeout(1500);
      const after = await p4.evaluate(() => window.__bg3dDebug?.stats?.() ?? null);
      row.offscreenPause = { framesBefore: before?.frames ?? null, framesAfter: after?.frames ?? null, runningAfter: after?.running ?? null, pauses: after?.pauses ?? null };
      const btn = await p4.$('.bg3d-off');
      if (btn) {
        await btn.click();
        await p4.waitForTimeout(900);
        const off = await p4.evaluate(() => ({ state: document.querySelector('[data-bg3d]')?.dataset.bg3dState ?? null, ls: localStorage.getItem('ats.bg3d') }));
        row.offButton = off;
      }
      await p4.close();
    } catch (e) {
      row.error = String(e.message ?? e).slice(0, 500);
      row.hint = 'стенд должен отвечать на ' + BASE + ' и быть собран с BG3D_LAB=1 (иначе /lab/bg3d отдаёт 404)';
    }
    await ctx.close();
    results.push(row);
    const f = row.bench?.frame;
    console.log(`  ${p.id} ${variant}: ${row.error ? 'ОШИБКА ' + row.error.slice(0, 120)
      : `fps ${f?.fps ?? '?'} (потолок ${f?.fpsCap ?? '?'}) · кадр ${f?.drawWidth ?? '?'}×${f?.drawHeight ?? '?'} · ${f?.frameMsAvg ?? '?'} мс средн., p95 ${f?.frameMsP95 ?? '?'} · GPU ${f?.gpuMs ?? 'нет таймера'} мс · куча ${row.bench?.heapMb?.end ?? '?'} МБ · батарея ${row.bench?.battery?.api ? `${row.bench.battery.levelStart}→${row.bench.battery.levelEnd}` : 'API недоступен'}`}`);
    if (row.reducedMotion) console.log(`      reduced-motion: ${row.reducedMotion.motion}, кадров ${row.reducedMotion.frames} · saveData: ${row.saveData?.tier} · пауза вне экрана: ${row.offscreenPause.runningAfter === false ? 'работает' : JSON.stringify(row.offscreenPause)} · кнопка: ${JSON.stringify(row.offButton ?? null)}`);
    if (row.cycles) console.log(`      память за ${row.cycles.cycles} циклов: ${row.cycles.heapMb.start} → ${row.cycles.heapMb.end} МБ (Δ ${row.cycles.heapMb.delta}), живых экземпляров ${row.cycles.liveInstancesAfter}`);
  }
}

await browser.close?.();
mkdirSync(OUT, { recursive: true });
for (const r of results) writeFileSync(join(OUT, `${r.profile}-${r.variant}.json`), JSON.stringify(r, null, 2));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, attach: ATTACH, seconds: SECONDS, cycles: CYCLES, results }, null, 2));
console.log(`\nотчёты: ${OUT} (${results.length} файлов + summary.json)`);
console.log('Эти числа заменяют строки «модель» в evaluation/round30-bg-3d/verdict.md — перенесите их туда.');
process.exit(results.some((r) => r.error) ? 1 : 0);
