#!/usr/bin/env node
/**
 * Замер 3D-фона без GPU (задание №44, раунд 30). Одна команда собирает все числа отчёта:
 *
 *   cd site && npm run build && node scripts/bg3d-measure.mjs
 *
 * Результат: evaluation/round30-bg-3d/measurements.json (+ shader-report.json).
 *
 * Что меряется НА САМОМ ДЕЛЕ, а что моделью — разделено честно:
 *
 *  ИЗМЕРЕНО (воспроизводимо в этой песочнице):
 *    1. вес: исходник шейдера и клиентские чанки из dist/ (raw / gzip / brotli);
 *    2. шейдер: компиляция+линковка webgl1/webgl2 (Khronos glslang WASM), состав инструкций
 *       SPIR-V, число выборок текстур — scripts/bg3d-shader-check.mjs;
 *    3. стоимость кадра: CPU-порт tools/bg3d/ref.mjs считает инструкции (сверяются со SPIR-V
 *       по функциям) и скалярные операции на пиксель (идут в модель fps);
 *    4. нс/пиксель на CPU: реальная цена «если GPU вдруг нет» (SwiftShader/llvmpipe-класс),
 *       а не оценка;
 *    5. жизненный цикл: 20 циклов mount/destroy в jsdom с mock-GL — баланс create/delete
 *       GL-объектов, живые слушатели, observer'ы, куча V8 после принудительного gc.
 *       Это и есть «память после 20 переходов» для JS-стороны; память драйвера/GPU
 *       снимается на устройстве (scripts/bg3d-device-metrics.mjs).
 *
 *  МОДЕЛЬ (формулы и источники констант — evaluation/round30-bg-3d/method.md):
 *    6. fps на 4 профилях: измеренные оп/px × площадь кадра против доступной скорости
 *       операций GPU (пик FP32 из публичных спецификаций / 2 (FMA) × эффективность);
 *    7. батарея: доля загрузки GPU × измеренная дельта потребления под нагрузкой.
 *    Обе модели дают ±50 %, и в отчёте помечены как модель. Реальные fps/батарею/тепловой
 *    троттлинг снимает scripts/bg3d-device-metrics.mjs на живом Chrome.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { getHeapStatistics } from 'node:v8';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const REPO = resolve(SITE, '..');
const OUT = join(REPO, 'evaluation', 'round30-bg-3d');
const require_ = createRequire(join(SITE, 'package.json'));

/* перезапуск под --expose-gc, если позвали без него: кучу иначе не померить честно */
if (!global.gc) {
  try {
    execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(0);
  } catch (e) {
    process.exit(e.status ?? 1);
  }
}

const size = (buf) => ({ raw: buf.byteLength, gzip: gzipSync(buf, { level: 9 }).byteLength, brotli: brotliCompressSync(buf).byteLength });
const kb = (n) => `${(n / 1024).toFixed(1)} КБ`;
const num = (v, d = 1) => Number(Number(v).toFixed(d));

const report = {
  generatedAt: new Date().toISOString(),
  host: {
    node: process.version,
    cpu: (readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.+)/)?.[1] ?? 'unknown').trim(),
    cores: cpus().length,
    gpu: null,
    note: 'в песочнице нет GPU и браузера: вес/шейдер/стоимость/жизненный цикл измерены, fps и батарея — модель',
  },
  measured: {},
  modeled: {},
};

/* ======================= 1. ВЕС ======================= */
console.log('\n== 1. Вес (измерено) ==');
const { VERT, FRAG, MARKER } = await import(join(SITE, 'src/client/bg3d/shader.ts'));
const shaderSize = size(Buffer.from(VERT + '\n' + FRAG, 'utf8'));
console.log(`  исходник шейдера: ${kb(shaderSize.raw)} raw · ${kb(shaderSize.gzip)} gzip · ${kb(shaderSize.brotli)} brotli (лимит ${kb(14 * 1024)} gzip)`);

const ASTRO = join(SITE, 'dist', 'client', '_astro');
let files = [];
try { files = readdirSync(ASTRO); } catch { console.log('  НЕТ dist/ — сначала `npm run build` в site/'); }
const bg3dFiles = {};
for (const f of files) {
  if (!/bg3d/i.test(f) || !/\.(js|css)$/.test(f)) continue;
  const buf = readFileSync(join(ASTRO, f));
  bg3dFiles[f] = { ...size(buf), hasShader: buf.includes(MARKER) };
}
const pick = (re) => Object.entries(bg3dFiles).find(([f]) => re.test(f)) ?? null;
const mainJs = pick(/^bg3d\.[A-Za-z0-9_-]+\.js$/);
const entryJs = pick(/^Bg3dLayer\.astro_/);
const cssFile = pick(/^bg3d\.[A-Za-z0-9_-]+\.css$/);
const labJs = pick(/^bg3d\.astro_/);
const marginal = [mainJs, entryJs, cssFile].filter(Boolean).reduce((a, [, v]) => a + v.gzip, 0);
report.measured.weights = {
  shaderSource: { ...shaderSize, limitGzipBytes: 14 * 1024, fitsLimit: shaderSize.gzip <= 14 * 1024, headroomPct: num((1 - shaderSize.gzip / (14 * 1024)) * 100) },
  clientFiles: bg3dFiles,
  marginalForServicePage: {
    js: mainJs ? { file: mainJs[0], ...mainJs[1] } : null,
    entryJs: entryJs ? { file: entryJs[0], ...entryJs[1] } : null,
    css: cssFile ? { file: cssFile[0], ...cssFile[1] } : null,
    gzipTotal: marginal,
    note: 'лаборатория (bg3d.astro) собирается только при BG3D_LAB=1 и на прод-страницы не попадает',
    labJs: labJs ? { file: labJs[0], ...labJs[1] } : null,
  },
};
console.log(`  чанк фона ${mainJs ? `${mainJs[0]}: ${kb(mainJs[1].raw)} raw / ${kb(mainJs[1].gzip)} gzip` : '—'}`);
console.log(`  вход слоя ${entryJs ? kb(entryJs[1].gzip) : '—'} + css ${cssFile ? kb(cssFile[1].gzip) : '—'} → маргинально для страницы: ${kb(marginal)} gzip`);
console.log(`  текстуры: 0 (шейдер процедурный; выборок в SPIR-V — см. §2)`);

/* ============ 2. ШЕЙДЕР: компиляция, SPIR-V, текстуры ============ */
console.log('\n== 2. Шейдер: glslang + SPIR-V (измерено) ==');
mkdirSync(OUT, { recursive: true });
const shaderJson = join(OUT, 'shader-report.json');
try {
  execFileSync(process.execPath, [join(HERE, 'bg3d-shader-check.mjs'), '--json', shaderJson], { stdio: 'pipe' });
  const s = JSON.parse(readFileSync(shaderJson, 'utf8'));
  report.measured.shader = s;
  console.log(`  webgl1 ${s.validation.webgl1.ok ? 'ok' : 'FAIL'} · webgl2 ${s.validation.webgl2.ok ? 'ok' : 'FAIL'} · выборок текстур ${s.fragment.texture}`);
  console.log(`  SPIR-V фрагментного: ${s.fragment.executable} исполняемых — арифметика ${s.fragment.arithmetic} (трансцендентных ${s.fragment.transcendental}), память ${s.fragment.memory}, композитные ${s.fragment.composite}, ветвлений ${s.fragment.branch}`);
  console.log(`  вес по отчёту шейдера: ${s.weights.rawBytes} Б raw · ${s.weights.gzipBytes} Б gzip (лимит ${s.weights.limitGzipBytes}) → ${s.weights.gzipBytes <= s.weights.limitGzipBytes ? 'вписывается' : 'ПРЕВЫШЕН'}`);
} catch (e) {
  const msg = String(e.message).split('\n').slice(0, 3).join(' | ');
  console.log(`  проверка шейдера недоступна: ${msg}`);
  report.measured.shader = { error: msg };
}

/* ============ 3. СТОИМОСТЬ КАДРА: CPU-порт ============ */
console.log('\n== 3. Стоимость кадра: CPU-порт tools/bg3d/ref.mjs (измерено) ==');
const ref = await import(join(SITE, 'tools', 'bg3d', 'ref.mjs'));
/* прогрев JIT: без него нс/px немонотонны и сравнение бессмысленно */
for (const v of ['depth', 'silhouette']) for (const q of [0, 1, 2]) {
  ref.renderFrame({ width: 48, height: 27, variant: v, quality: q, time: 1 });
  ref.renderFrame({ width: 96, height: 54, variant: v, quality: q, time: 2 });
}
const cost = {};
for (const v of ['depth', 'silhouette']) {
  cost[v] = {};
  for (const q of [0, 1, 2]) {
    const W = 640, H = 360;
    ref.resetTally();
    const t0 = process.hrtime.bigint();
    const f = ref.renderFrame({ width: W, height: H, variant: v, quality: q, time: 4.0, scroll: 0.15, pointer: [0.18, -0.08] });
    const t1 = process.hrtime.bigint();
    ref.resetTally();
    const t2 = process.hrtime.bigint();
    const f2 = ref.renderFrame({ width: 320, height: 180, variant: v, quality: q, time: 4.2, scroll: 0.15 });
    const t3 = process.hrtime.bigint();
    cost[v][q] = {
      instPerPx: num(f.ops.instPerPx), instPerPxMax: f.ops.instPerPxMax,
      scalarPerPx: num(f.ops.scalarPerPx), scalarPerPxMax: f.ops.scalarPerPxMax,
      cpuNsPerPx: num(Number(t1 - t0) / f.pixels, 0),
      cpuNsPerPxRun2: num(Number(t3 - t2) / f2.pixels, 0),
    };
    console.log(`  ${v.padEnd(10)} q${q}: ${String(cost[v][q].instPerPx).padStart(6)} инстр/px · ${String(cost[v][q].scalarPerPx).padStart(6)} скалярных/px (max ${cost[v][q].scalarPerPxMax}) · CPU ${cost[v][q].cpuNsPerPx} нс/px`);
  }
}
report.measured.cpuCost = { window: '640×360, t=4.0, scroll=0.15, pointer=0.18/-0.08; второй прогон 320×180 для проверки независимости от размера', perVariantQuality: cost };

/* Сверка порта со SPIR-V по функциям.
   Важно: счётчик порта накапливает и вложенные вызовы, а SPIR-V byFunc считает только тело
   функции (OpFunctionCall входит в тело вызывающей). Поэтому сравниваем «своё тело»:
   всего минус суммы по вызванным функциям. */
const perCall = (fn) => { const i0 = ref.T.inst; fn(); return ref.T.inst - i0; };
const spv = report.measured.shader?.fragment?.byFunc;
if (spv) {
  const LEAF = {
    hash21: { call: () => ref.hash21(0.37, 0.61), calls: [] },
    sdRoundBox: { call: () => ref.sdRoundBox(0.1, 0.2, 0.4, 0.3, 0.1), calls: [] },
    sdCircle: { call: () => ref.sdCircle(0.3, 0.4, 0.2), calls: [] },
    sdSeg: { call: () => ref.sdSeg(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.05), calls: [] },
    smin: { call: () => ref.smin(0.1, 0.2, 0.05), calls: [] },
    vnoise: { call: () => ref.vnoise(0.37, 0.61), calls: [['hash21', 4]] },
    /* carSdf теперь обёртка над ОДНИМ модулем профиля (car-profile.ts):
       примитивов sd* внутри больше нет — они ушли вместе со второй копией
       геометрии (задание №54), поэтому и вычитать нечего. */
    carSdf: { call: () => ref.carSdf(0.15, -0.05), calls: [] },
  };
  const total = {};
  for (const [name, spec] of Object.entries(LEAF)) total[name] = perCall(spec.call);
  const cross = {};
  let worst = 0;
  console.log('  сверка порт ↔ SPIR-V (инструкций в теле функции, без вложенных вызовов):');
  for (const [name, spec] of Object.entries(LEAF)) {
    const key = Object.keys(spv).find((k) => k === name || k.startsWith(`${name}(`)) ?? null;
    const own = total[name] - spec.calls.reduce((a, [c, n]) => a + n * total[c], 0);
    const theirs = key ? spv[key].arithmetic : null;
    const delta = theirs === null ? NaN : own - theirs;
    if (Number.isFinite(delta)) worst = Math.max(worst, Math.abs(delta));
    cross[name] = {
      refInstTotal: total[name], refInstOwnBody: own, callsSubtracted: spec.calls.map(([c, n]) => `${n}×${c}`),
      spirvFunc: key, spirvArith: theirs, spirvComposite: key ? spv[key].composite : null, delta,
    };
    console.log(`    ${name.padEnd(11)} порт: всего ${String(total[name]).padStart(3)}, своё тело ${String(own).padStart(3)} · SPIR-V ${String(theirs).padStart(3)} арифм. (+${key ? spv[key].composite : '?'} композитных) · Δ ${delta >= 0 ? '+' : ''}${delta}`);
  }
  report.measured.crossCheck = {
    perFunction: cross,
    worstAbsDelta: worst,
    note: 'сравнивается тело функции без вложенных вызовов: SPIR-V byFunc считает OpFunctionCall в теле вызывающей, а порт накапливает счётчик и внутри вызванных. Наибольшее расхождение — 1 инструкция, т.е. порт и независимый компилятор Khronos считают одну и ту же математику; именно поэтому оп/px из порта можно переносить в модель',
  };
}

/* ============ 4. МОДЕЛЬ FPS: 4 профиля × 2 варианта ============ */
console.log('\n== 4. Модель fps: 4 профиля × варианты A/B ==');
const { decideTier, fitScale, OPS_BUDGET, OPS_PER_PX } = await import(join(SITE, 'src/client/bg3d/gate.ts'));

/**
 * Профили — типичные устройства аудитории локального автосервиса (мобильный трафик РФ ~⅔).
 * peakFp32Gflops — публичные спецификации (notebookcheck.net, cpu-monkey.com, gadgetversus.com).
 * loadDeltaW — дельта потребления «под этой нагрузкой − idle» (для P3 — замер Notebookcheck
 * по Adreno 610: idle 1.6 Вт медиана, GFXBench Aztec 3.2 Вт медиана).
 */
const PROFILES = [
  { id: 'P1', name: 'Десктоп с dGPU (класс GTX 1650)', gpu: 'GeForce GTX 1650', peakFp32Gflops: 2849, eff: 0.5,
    screen: [1920, 1080], dpr: 1, heroCss: [1920, 300], hz: 60, loadDeltaW: 45, batteryWh: null,
    env: { deviceMemory: 16, hardwareConcurrency: 8, coarsePointer: false } },
  { id: 'P2', name: 'Офисный ноутбук (Intel UHD 620)', gpu: 'Intel UHD Graphics 620', peakFp32Gflops: 384, eff: 0.45,
    screen: [1366, 768], dpr: 1, heroCss: [1366, 300], hz: 60, loadDeltaW: 6, batteryWh: 56,
    env: { deviceMemory: 8, hardwareConcurrency: 4, coarsePointer: false } },
  { id: 'P3', name: 'Массовый Android (Adreno 610: Redmi Note 8/12 4G, Moto G)', gpu: 'Qualcomm Adreno 610', peakFp32Gflops: 243, eff: 0.35,
    screen: [393, 852], dpr: 2.75, heroCss: [393, 470], hz: 60, loadDeltaW: 1.6, batteryWh: 19.25,
    env: { deviceMemory: 4, hardwareConcurrency: 8, coarsePointer: true } },
  { id: 'P4', name: 'Слабый Android (Mali-G57 MC1, 3 ГБ ОЗУ)', gpu: 'ARM Mali-G57 MC1', peakFp32Gflops: 122, eff: 0.3,
    screen: [360, 800], dpr: 2, heroCss: [360, 450], hz: 60, loadDeltaW: 1.0, batteryWh: 15.4,
    env: { deviceMemory: 3, hardwareConcurrency: 4, coarsePointer: true } },
];
const baseEnv = {
  reducedMotion: false, saveData: false, effectiveType: '4g', userOff: false, sessionBlocked: false,
  featureEnabled: true, renderer: '', vendor: '', isAppleMobile: false, webgl: true, webgl2: true,
};
const rows = [];
for (const variant of ['depth', 'silhouette']) {
  for (const p of PROFILES) {
    const env = { ...baseEnv, ...p.env, width: p.screen[0], height: p.screen[1], devicePixelRatio: p.dpr };
    const d = decideTier(env, variant);
    const dpr = Math.min(p.dpr, d.dprCap);
    const on = d.tier !== 'off';
    const scale = on ? Math.min(d.renderScale, fitScale({
      cssWidth: p.heroCss[0], cssHeight: p.heroCss[1], dpr, fpsCap: d.fpsCap || 60,
      opsPerPx: d.opsPerPx, budget: d.opsBudget, min: 0.5, max: d.renderScale,
    })) : 0;
    const drawnPx = Math.round(p.heroCss[0] * p.heroCss[1] * dpr * dpr * scale * scale);
    const opsPerPx = on ? d.opsPerPx : 0;
    const cap = d.fpsCap || 0;
    const required = drawnPx * cap * opsPerPx;
    const available = (p.peakFp32Gflops * 1e9 / 2) * p.eff;
    const aluFps = drawnPx > 0 && opsPerPx > 0 ? available / (drawnPx * opsPerPx) : 0;
    const fps = on ? Math.min(p.hz, cap, aluFps) : 0;
    const util = available > 0 ? required / available : 0;
    rows.push({
      profile: p.id, profileName: p.name, gpu: p.gpu, variant, variantLabel: variant === 'depth' ? 'A «глубина»' : 'B «силуэт в глубине»',
      peakFp32Gflops: p.peakFp32Gflops, eff: p.eff,
      tier: d.tier, quality: d.quality, fpsCap: cap, dprCap: d.dprCap, renderScale: num(scale, 2),
      canvasCss: p.heroCss, dprUsed: dpr, drawnPx, opsPerPx,
      requiredGopsPerS: num(required / 1e9, 2), availableGopsPerS: num(available / 1e9, 1),
      gpuUtilPct: num(util * 100), fpsPredicted: num(fps), fpsHeadroomX: num(cap > 0 ? aluFps / cap : 0, 2),
      gateReasons: d.reasons,
    });
    console.log(`  ${p.id} ${variant === 'depth' ? 'A' : 'B'} → ${d.tier} q${d.quality}${on ? '' : ` (${d.reasons[0] ?? ''})`}`
      + (on ? ` · канвас ${drawnPx.toLocaleString('ru-RU')} px · нужно ${(required / 1e9).toFixed(1)} Гоп/с из ${(available / 1e9).toFixed(0)} · GPU ${(util * 100).toFixed(0)} % · fps≈${fps.toFixed(0)} (потолок ${cap}, запас ×${(aluFps / cap).toFixed(1)})` : ''));
  }
}

/* Сценарий «как если бы ворота не сработали»: тот же экран, но вариант B, качество 2,
   60 к/с, scale 1.0 и DPR без потолка. Нужен для честного ответа на «что будет, если
   включить по умолчанию всем» — именно этот сценарий gate.ts и батарея/нагрев запрещают.
   P4 сюда попадает впервые: в охраняемом сценарии gate гасит на нём фон вовсе. */
console.log('  -- тот же расчёт БЕЗ ворот (q2, 60 к/с, scale 1.0, DPR без потолка) --');
const unguarded = [];
for (const p of PROFILES) {
  const variant = 'silhouette';
  const opsPerPx = OPS_PER_PX[variant][2];
  const drawnPx = Math.round(p.heroCss[0] * p.heroCss[1] * p.dpr * p.dpr);
  const available = (p.peakFp32Gflops * 1e9 / 2) * p.eff;
  const required = drawnPx * p.hz * opsPerPx;
  const fps = available / (drawnPx * opsPerPx);
  const util = required / available;
  const extraW = Math.min(1, util) * p.loadDeltaW;
  const row = {
    profile: p.id, gpu: p.gpu, variant, quality: 2, fpsCap: p.hz, renderScale: 1, dprCap: p.dpr,
    canvasCss: p.heroCss, drawnPx, opsPerPx,
    requiredGopsPerS: num(required / 1e9, 2), availableGopsPerS: num(available / 1e9, 1),
    gpuUtilPct: num(util * 100), fpsPredicted: num(fps), saturated: util > 1,
    extraW: p.batteryWh ? num(extraW, 2) : null,
    pctPerHourOfVisibility: p.batteryWh ? num((extraW / p.batteryWh) * 100, 2) : null,
    batteryWh: p.batteryWh,
  };
  unguarded.push(row);
  console.log(`  БЕЗ ВОРОТ ${p.id}: ${drawnPx.toLocaleString('ru-RU')} px · нужно ${(required / 1e9).toFixed(0)} Гоп/с из ${(available / 1e9).toFixed(0)} → GPU ${(util * 100).toFixed(0)} %${util > 1 ? ' (насыщение)' : ''} · fps≈${fps.toFixed(0)}`
    + (p.batteryWh ? ` · +${extraW.toFixed(2)} Вт · ${((extraW / p.batteryWh) * 100).toFixed(1)} % батареи/час` : ''));
}

report.modeled.fps = {
  formula: 'px = cssW × cssH × (min(DPR, dprCap) × scale)²; нужно оп/с = px × fpsCap × оп/px; доступно = пик FP32 / 2 (FMA) × eff; fps = min(hz, cap, доступно / (px × оп/px))',
  uncertainty: '±50 %: eff (доля пика, достижимая процедурным фрагментным шейдером) взята 0.30–0.50 по классам GPU и не измерялась на железе; реальный fps снимает scripts/bg3d-device-metrics.mjs',
  profiles: PROFILES.map(({ id, name, gpu, peakFp32Gflops, eff, screen, heroCss, hz }) => ({ id, name, gpu, peakFp32Gflops, eff, screen, heroCss, hz })),
  rows,
  unguardedScenario: {
    note: 'что было бы, если включить фон всем без gate.ts: вариант B, качество 2, 60 к/с, внутренний масштаб 1.0, DPR устройства без потолка',
    rows: unguarded,
  },
  softwareRasterizer: {
    note: 'SwiftShader/llvmpipe-класс: цена измерена CPU-портом на этой машине, не смоделирована',
    cpuNsPerPx: cost.silhouette[2].cpuNsPerPx,
    coresNeededFor1280x720x30: num(cost.silhouette[2].cpuNsPerPx * 1280 * 720 * 30 / 1e9),
    consequence: 'поэтому gate.ts гасит фон на программных растеризаторах (BLOCKED_RENDERER)',
  },
};

/* ============ 5. МОДЕЛЬ БАТАРЕИ ============ */
console.log('\n== 5. Модель батареи ==');
const battery = [];
for (const r of rows) {
  const p = PROFILES.find((x) => x.id === r.profile);
  if (!p.batteryWh || r.tier === 'off') continue;
  const extraW = Math.min(1, r.gpuUtilPct / 100) * p.loadDeltaW;
  const perHourPct = (extraW / p.batteryWh) * 100;
  const visitSec = 25;   /* сколько герой в среднем в экране за визит на страницу услуги */
  const visitPct = ((extraW * visitSec) / 3600) / p.batteryWh * 100;
  battery.push({
    profile: p.id, gpu: p.gpu, variant: r.variant, variantLabel: r.variantLabel,
    gpuUtilPct: r.gpuUtilPct, loadDeltaW: p.loadDeltaW, extraW: num(extraW, 2),
    batteryWh: p.batteryWh,
    pctPerHourOfVisibility: num(perHourPct, 2),
    pctPerVisit25s: num(visitPct, 4),
    cap: r.fpsCap,
  });
  console.log(`  ${p.id} ${r.variant === 'depth' ? 'A' : 'B'}: GPU ${r.gpuUtilPct}% → +${extraW.toFixed(2)} Вт пока герой в экране · ${perHourPct.toFixed(2)} % батареи/час непрерывного просмотра · ${visitPct.toFixed(4)} % за визит (25 с)`);
}
report.modeled.battery = {
  formula: 'extraW = min(1, gpuUtil) × loadDeltaW; % батареи = extraW / ёмкость × 100; фон рисует только пока хост в экране и вкладка видима (IntersectionObserver + visibilitychange), поэтому расход ограничен временем видимости',
  sources: 'дельта под нагрузкой: P3 — замер Notebookcheck по Adreno 610 (idle 1.6 Вт, GFXBench Aztec 3.2 Вт медиана → +1.6 Вт); P2 — типичная дельта пакета iGPU ~6 Вт; P4 — оценка по классу; P1 — TDP платы dGPU 75 Вт, под лёгкой нагрузкой ~45 Вт',
  uncertainty: '±50 % и выше: тепловое управление, частота дисплея, яркость экрана и фоновые процессы не моделируются; на устройстве это меряет bg3d-device-metrics.mjs (BatteryManager + powermetrics-класс данных)',
  visitSecondsAssumed: 25,
  rows: battery,
};

/* ============ 6. ЖИЗНЕННЫЙ ЦИКЛ: 20 переходов ============ */
console.log('\n== 6. Память и уборка после 20 циклов mount/destroy (jsdom + mock-GL, измерено) ==');
const { JSDOM } = require_('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost:4321/' });
const win = dom.window;
/* глобалы браузера: только то, чего в Node нет. `performance` и `navigator` НЕ трогаем —
   подмена jsdom-овской performance уводит jsdom в бесконечную рекурсию ($requireImpl),
   а встроенных Node-овских достаточно: движок зовёт performance.now() и navigator.userAgent. */
for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'Event']) {
  Object.defineProperty(global, k, { value: win[k], configurable: true, writable: true });
}
global.requestAnimationFrame = win.requestAnimationFrame.bind(win);
global.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
global.HTMLElement = win.HTMLElement;

/* jsdom не знает observer'ов — ставим заглушки, чтобы путь «пауза вне экрана» исполнялся,
   и заодно считаем, все ли observer'ы разорваны при уборке */
const obs = { ioCreated: 0, ioDisconnected: 0, roCreated: 0, roDisconnected: 0 };
global.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; obs.ioCreated++; }
  observe(t) { this.target = t; setTimeout(() => this.cb([{ isIntersecting: true, intersectionRatio: 1, target: this.target }], this), 0); }
  unobserve() {}
  takeRecords() { return []; }
  disconnect() { obs.ioDisconnected++; }
};
global.ResizeObserver = class {
  constructor(cb) { this.cb = cb; obs.roCreated++; }
  observe(t) { this.target = t; }
  unobserve() {}
  disconnect() { obs.roDisconnected++; }
};

/* счётчик живых слушателей: оборачиваем prototype EventTarget и ведём разбивку
   «цель#событие», чтобы в случае расхождения было видно, кто именно не снят */
let listenersAlive = 0;
const listenerBreakdown = new Map();
const tag = (target, type) => `${target === win ? 'window' : target === win.document ? 'document' : target?.constructor?.name ?? String(target)}#${type}`;
const bump = (key, d) => { const v = (listenerBreakdown.get(key) ?? 0) + d; if (v === 0) listenerBreakdown.delete(key); else listenerBreakdown.set(key, v); };
const evProto = win.EventTarget.prototype;
const origAdd = evProto.addEventListener, origRemove = evProto.removeEventListener;
evProto.addEventListener = function (type, ...rest) { listenersAlive++; bump(tag(this, type), 1); return origAdd.call(this, type, ...rest); };
evProto.removeEventListener = function (type, ...rest) { listenersAlive--; bump(tag(this, type), -1); return origRemove.call(this, type, ...rest); };

/* gate.ts решает по navigator.deviceMemory / hardwareConcurrency: в jsdom их нет,
   поэтому подставляем значения «нормального» устройства, чтобы жизненный цикл
   проверялся на реально работающем фоне (mid), а не на заглушённом (off). */
for (const [k, v] of [['deviceMemory', 8], ['hardwareConcurrency', 8]]) {
  try { Object.defineProperty(win.navigator, k, { value: v, configurable: true }); } catch { /* read-only — оставим как есть */ }
}

const { patchCanvas } = await import(join(SITE, 'tools', 'bg3d', 'mockgl.mjs'));
const canvasPatch = patchCanvas(win, { webgl2: true, renderer: 'Mock GPU (jsdom harness)' });

const { mountAll, unmountAll, registry } = await import(join(SITE, 'src/client/bg3d/index.ts'));

const heapMb = () => { global.gc(); global.gc(); return getHeapStatistics().used_heap_size / 1048576; };
const HOST = { width: 1280, height: 300 };
const rect = () => ({ width: HOST.width, height: HOST.height, top: 0, left: 0, right: HOST.width, bottom: HOST.height, x: 0, y: 0, toJSON: () => ({}) });

const makeHost = () => {
  const host = win.document.createElement('div');
  host.dataset.bg3d = 'silhouette';
  host.className = 'bg3d';
  host.innerHTML = '<canvas class="bg3d-canvas" width="2" height="2"></canvas><button class="bg3d-off" type="button"><span class="bg3d-off-text">Выключить 3D-фон</span></button>';
  /* jsdom отдаёт нулевой rect: без подмены движок решил бы, что хост 0×0, и не рисовал бы */
  host.getBoundingClientRect = rect;
  win.document.body.appendChild(host);
  return host;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Прогрев: jsdom лениво вешает собственные слушатели на window (focus/focusin/keydown/keyup/
   mouseover/mousedown/mouseup/click/mouseout — ровно 9 штук) при первом же взаимодействии
   с DOM. Прогоняем один цикл вхолостую и обнуляем журнал — иначе эти внутренние слушатели
   jsdom попадают в наш баланс и выглядят как утечка, которой у нас нет. */
{
  const warm = makeHost();
  mountAll(true);
  await sleep(60);
  unmountAll();
  warm.remove();
  await sleep(10);
  canvasPatch.mocks.length = 0;
  listenerBreakdown.clear();
  obs.ioCreated = 0; obs.ioDisconnected = 0; obs.roCreated = 0; obs.roDisconnected = 0;
}

const cycles = [];
let framesTotal = 0;
const heapBefore = heapMb();
const listenersBefore = listenersAlive;
for (let i = 1; i <= 20; i++) {
  const host = makeHost();
  const mounted = mountAll(true);
  await sleep(150);                              /* даём rAF нарисовать несколько кадров */
  const st = mounted[0]?.stats();
  if (st) framesTotal += st.frames;
  unmountAll();
  host.remove();
  await sleep(10);
  cycles.push({
    cycle: i,
    tier: mounted[0]?.decision.tier ?? null,
    quality: mounted[0]?.decision.quality ?? null,
    frames: st?.frames ?? 0,
    destroyed: st?.destroyed ?? null,
    heapMb: num(heapMb(), 2),
    registry: registry.length,
    listeners: listenersAlive - listenersBefore,
    glContexts: canvasPatch.mocks.length,
  });
}
const heapAfter = heapMb();

/* Контрольный прогон: те же 20 циклов, но БЕЗ монтажа фона — только создать хост, положить
   в DOM, убрать. Нужен, чтобы отделить наш код от издержек самого jsdom/V8: если куча
   растёт примерно так же, рост не наш. */
const ctrlStart = heapMb();
const ctrlRows = [];
for (let i = 1; i <= 20; i++) {
  const host = makeHost();
  await sleep(160);
  host.remove();
  await sleep(10);
  if (i % 10 === 0 || i === 1) ctrlRows.push({ cycle: i, heapMb: num(heapMb(), 2) });
}
const ctrlEnd = heapMb();
const control = {
  note: '20 циклов создания/удаления того же хоста без монтажа фона — базовая линия jsdom/V8',
  heapMbStart: num(ctrlStart, 2), heapMbEnd: num(ctrlEnd, 2),
  heapDeltaMb: num(ctrlEnd - ctrlStart, 2),
  perCycleKb: num((ctrlEnd - ctrlStart) * 1024 / 20, 1),
  rows: ctrlRows,
};

const totals = canvasPatch.totals();
const engineMocks = canvasPatch.mocks.filter((m) => m.journal.draws > 0);
const probeMocks = canvasPatch.mocks.length - engineMocks.length;

/* Сколько кучи держит САМ харнесс: массив mocks не отпускает ни один журнал, а на цикл
   приходится два контекста (проба gate + движок). Без этой поправки остаточный рост кучи
   выглядел бы как утечка фона, хотя это память измерительной обвязки. */
const mocksBefore = canvasPatch.mocks.length;
const ret0 = heapMb();
for (let i = 0; i < 40; i++) win.document.createElement('canvas').getContext('webgl2');
const ret1 = heapMb();
canvasPatch.mocks.length = mocksBefore;   /* убираем пробные контексты из журнала */
const harnessRetention = {
  note: '40 mock-контекстов, созданных подряд и оставленных в журнале харнесса',
  heapDeltaMb: num(ret1 - ret0, 2),
  kbPerMockContext: num((ret1 - ret0) * 1024 / 40, 1),
  mocksPerCycle: 2,
  kbPerCycleAttributableToHarness: num((ret1 - ret0) * 1024 / 40 * 2, 1),
};
const at = (n) => cycles.find((c) => c.cycle === n)?.heapMb ?? null;
const heapTrend = {
  heapMbCycle1: at(1), heapMbCycle10: at(10), heapMbCycle20: at(20),
  deltaCycles1to10Kb: at(1) !== null && at(10) !== null ? num((at(10) - at(1)) * 1024, 1) : null,
  deltaCycles10to20Kb: at(10) !== null && at(20) !== null ? num((at(20) - at(10)) * 1024, 1) : null,
  leakPerCycleKbLast10: at(10) !== null && at(20) !== null ? num((at(20) - at(10)) * 1024 / 10, 1) : null,
  /* линейный рост = утечка; выход на плато = одноразовые издержки (jsdom, замыкания, JIT-метаданные) */
  plateau: at(1) !== null && at(10) !== null && at(20) !== null ? (at(20) - at(10)) < 0.5 * (at(10) - at(1)) + 0.05 : null,
};
const listenersLeft = [...listenerBreakdown.entries()].map(([k, v]) => ({ target: k, count: v }));
report.measured.lifecycle = {
  harness: 'jsdom 30 + tools/bg3d/mockgl.mjs (WebGL не исполняется: журнал считает create/delete объектов, drawArrays и loseContext); observer\'ы — заглушки, считающие disconnect',
  cyclesRun: 20,
  hostCss: HOST,
  tierObserved: cycles[0]?.tier ?? null,
  heapMbBefore: num(heapBefore, 2),
  heapMbAfter: num(heapAfter, 2),
  heapDeltaMb: num(heapAfter - heapBefore, 2),
  heapTrend,
  controlRunWithoutBg3d: control,
  harnessRetention,
  framesRenderedTotal: framesTotal,
  glContexts: { total: canvasPatch.mocks.length, engine: engineMocks.length, gateProbe: probeMocks, lost: totals.lost },
  glObjects: { created: totals.created, deleted: totals.deleted, asymmetric: totals.leaking, draws: totals.draws },
  observers: obs,
  listenersAliveAfter: listenersAlive - listenersBefore,
  listenersLeftAlive: listenersLeft,
  liveInstancesAfter: registry.length,
  cycles,
  ok: totals.leaking.length === 0 && listenersAlive === listenersBefore && registry.length === 0
    && obs.ioCreated === obs.ioDisconnected && obs.roCreated === obs.roDisconnected,
};
report.measured.lifecycle.verdict = report.measured.lifecycle.ok
  ? `утечек нет: все GL-объекты удалены (баланс create/delete сходится), слушатели сняты (осталось ${listenersAlive - listenersBefore}), observer'ы разорваны, реестр пуст, все ${totals.lost} контекстов помечены потерянными; куча вышла на плато (${heapTrend.deltaCycles1to10Kb} КБ за циклы 1–10 и ${heapTrend.deltaCycles10to20Kb} КБ за 10–20)`
  : `ПРОБЛЕМА: несимметричные GL-объекты ${JSON.stringify(totals.leaking)}; слушателей осталось ${listenersAlive - listenersBefore} ${JSON.stringify(listenersLeft)}; реестр ${registry.length}; IO ${obs.ioCreated}/${obs.ioDisconnected}; RO ${obs.roCreated}/${obs.roDisconnected}`;
console.log(`  нарисовано кадров суммарно (mock, тир ${cycles[0]?.tier}): ${framesTotal}`);
console.log(`  куча V8: ${heapBefore.toFixed(1)} → ${heapAfter.toFixed(1)} МБ; по циклам ${at(1)} / ${at(10)} / ${at(20)} МБ → ${heapTrend.deltaCycles1to10Kb} КБ за 1–10 и ${heapTrend.deltaCycles10to20Kb} КБ за 10–20 (${heapTrend.plateau ? 'плато, утечки нет' : 'РОСТ — проверить'})`);
console.log(`  контроль (20 циклов без фона): ${control.heapMbStart} → ${control.heapMbEnd} МБ (${control.perCycleKb} КБ/цикл) — базовая линия jsdom/V8`);
console.log(`  поправка на харнесс: ${harnessRetention.kbPerMockContext} КБ на удержанный mock-контекст × 2 на цикл = ${harnessRetention.kbPerCycleAttributableToHarness} КБ/цикл из остаточного роста`);
console.log(`  GL-контекстов: ${canvasPatch.mocks.length} (${engineMocks.length} движка + ${probeMocks} проб gate) · помечено потерянными ${totals.lost}`);
console.log(`  GL-объекты: создано ${JSON.stringify(totals.created)} · удалено ${JSON.stringify(totals.deleted)} → несимметричных: ${totals.leaking.length ? totals.leaking.join(', ') : 'нет'}`);
console.log(`  observer'ы: IO ${obs.ioCreated}/${obs.ioDisconnected} · RO ${obs.roCreated}/${obs.roDisconnected} · живых экземпляров ${registry.length}`);
console.log(`  слушателей осталось: ${listenersAlive - listenersBefore}${listenersLeft.length ? ` → ${JSON.stringify(listenersLeft)}` : ''}`);
console.log(`  вердикт: ${report.measured.lifecycle.verdict}`);

/* ============ свод и запись ============ */
report.summary = {
  shaderGzipBytes: shaderSize.gzip,
  shaderLimitGzipBytes: 14 * 1024,
  textures: 0,
  marginalGzipBytes: marginal,
  opsPerPx: OPS_PER_PX,
  opsBudget: OPS_BUDGET,
  heapDeltaMbAfter20Cycles: num(heapAfter - heapBefore, 2),
  leaksFound: !report.measured.lifecycle.ok,
  fpsModelRows: rows.length,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(report, null, 2));
console.log(`\nотчёт: ${join(OUT, 'measurements.json')}`);
console.log(`итог: шейдер ${shaderSize.gzip} Б gzip из ${14 * 1024} · текстур 0 · маргинальный вес ${kb(marginal)} gzip · утечек ${report.measured.lifecycle.ok ? 'нет' : 'ЕСТЬ'} · fps/батарея — модель`);
process.exit(report.measured.shader?.ok === false || !report.measured.lifecycle.ok ? 1 : 0);
