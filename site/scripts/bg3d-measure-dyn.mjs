/**
 * Замер 3D-фона с ДИНАМИЧЕСКОЙ стоимостью профиля кузова (задание №55, фаза 2, §1.2).
 *
 * Зачем отдельный скрипт рядом с `npm run measure:bg3d`
 * -----------------------------------------------------
 * Принятый замер (`scripts/bg3d-measure.mjs` + `tools/bg3d/ref.mjs`) считает обращение
 * к силуэту константой `PROFILE_COST = { inst: 145, scalar: 130 }` — это статика SPIR-V,
 * где в стоимость `pTop` входит ВСЯ if-лесенка из десяти сегментов. На пиксель исполняется
 * только одна ветвь лесенки, поэтому статика — верхняя граница, а не факт.
 *
 * Этот скрипт меряет те же кадры той же сценой, но стоимость профиля считает
 * ПОСТРОЧНО и ПО ТОЧКЕ (`tools/bg3d/profile-port.mjs`): сколько сравнений лесенки
 * реально пройдено при данном x, исполнен ли ранний выход `pBottom`.
 *
 * Порт сцены при этом НЕ переписан и НЕ скопирован: `tools/bg3d/ref-dyn.mjs` —
 * это принятый `tools/bg3d/ref.mjs` с одной заменой (константа → динамический талли).
 * Скрипт ПРОВЕРЯЕТ это сравнением файлов: если владелец поправит свой порт сцены,
 * а копия здесь устареет, замер остановится и скажет, что копий стало две.
 *
 * Вывод: таблица по тирам (A/B/C × low/mid/high) в двух моделях — статика и динамика,
 * разница в % и вердикт против допуска задания (не больше +10 % к 941 оп/px = 1035,1).
 *
 * Запуск: node scripts/bg3d-measure-dyn.mjs [--w 640 --h 360] [--json путь] [--no-fork-check]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = A.indexOf(`--${name}`);
  return i >= 0 && A[i + 1] !== undefined ? A[i + 1] : dflt;
};
const flag = (name) => A.includes(`--${name}`);

const WIDTH = Number(arg('w', 640));
const HEIGHT = Number(arg('h', 360));
/* Окно замера — ровно то, в котором сняты принятые числа (scripts/bg3d-measure.mjs §3):
   640×360, t = 4.0, scroll = 0.15, pointer = (0.18, −0.08). Иначе сравнивать нельзя. */
const WINDOW = { time: 4.0, scroll: 0.15, pointer: [0.18, -0.08] };
const JSON_OUT = arg('json', null);

/* ------------------------------------------------------------------ */
/* 1. Порт сцены: принятый + динамический профиль                      */
/* ------------------------------------------------------------------ */

const OWNER_REF = join(ROOT, 'tools/bg3d/ref.mjs');
const DYN_REF = join(ROOT, 'tools/bg3d/ref-dyn.mjs');

const ownerSrc = readFileSync(OWNER_REF, 'utf8');
const dynSrc = readFileSync(DYN_REF, 'utf8');

/* Замена ровно одна: блок константы PROFILE_COST → динамический талли.
   Всё остальное в файлах обязано совпадать посимвольно. */
const OWNER_BLOCK = `/**
 * Стоимость одного обращения к профилю, посчитанная по SPIR-V
 * (\`scripts/bg3d-shader-check.mjs\`, byFunc), а не на глаз:
 * pTop 101 + pBottom 17 + pArch×2 10 + carProfile 12 + carSdf 5 = 145 арифм.
 * Если профиль в шейдере поменяется, эти числа надо пересчитать — иначе
 * оп/px разойдётся с компилятором, а бюджет держится именно на них.
 */
export const PROFILE_COST = { inst: 145, scalar: 130 };
function profileCalls() { t(PROFILE_COST.inst, PROFILE_COST.scalar); }

/** float carSdf(vec2 q) — единицы сцены → метры модуля → carProfile(). */
export function carSdf(qx, qy) {
  t(4, 4);                                           /* /CAR_UNITS, -CAR_GROUND, вызов, *CAR_UNITS */
  profileCalls();
  return profile.carProfileJS(qx / CAR_SCALE, (qy - CAR_GROUND) / CAR_SCALE) * CAR_SCALE;
}`;

if (!flag('no-fork-check')) {
  if (!ownerSrc.includes(OWNER_BLOCK)) {
    console.error('FAIL  в принятом tools/bg3d/ref.mjs не найден блок PROFILE_COST в том виде,');
    console.error('      в котором его скопировал tools/bg3d/ref-dyn.mjs. Владелец поправил порт');
    console.error('      сцены — перенесите правку в ref-dyn.mjs (иначе замер считает чужой шейдер).');
    console.error('      Временно обойти: --no-fork-check (в отчёте тогда указать, что копия устарела).');
    process.exit(1);
  }
  /* Копия обязана отличаться от принятого файла ТОЛЬКО этим блоком и шапкой.
   * Вырезаем из копии вставленный блок и шапку, из оригинала — его блок, и сравниваем
   * нормализованно (пробелы/переносы не в счёт). */
  const startMark = '/* ---------- ДИНАМИЧЕСКИЙ профиль';
  const endMark = '/* ---------- палитра (из tokens.css) ---------- */';
  const i0 = dynSrc.indexOf(startMark);
  const i1 = dynSrc.indexOf(endMark);
  if (i0 < 0 || i1 < 0) {
    console.error('FAIL  в копии не найдены границы вставленного блока — обновите ref-dyn.mjs');
    process.exit(1);
  }
  const headerEnd = dynSrc.indexOf(ownerSrc.slice(0, 40));
  const dynRest = (headerEnd >= 0 ? dynSrc.slice(headerEnd) : dynSrc).replace(dynSrc.slice(i0, i1), '');
  const ownerRest = ownerSrc.replace(OWNER_BLOCK, '');
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  if (norm(dynRest) !== norm(ownerRest)) {
    console.error('FAIL  tools/bg3d/ref-dyn.mjs разошёлся с принятым tools/bg3d/ref.mjs сильнее,');
    console.error('      чем на блок PROFILE_COST. Перенесите правку владельца в копию.');
    process.exit(1);
  }
  console.log('ok    порт сцены: tools/bg3d/ref-dyn.mjs = принятый ref.mjs + одна замена (PROFILE_COST → динамический талли)');
}

const refStatic = await import('../tools/bg3d/ref.mjs');
const refDyn = await import('../tools/bg3d/ref-dyn.mjs');
const profilePort = await import('../tools/bg3d/profile-port.mjs');

/* ------------------------------------------------------------------ */
/* 1б. Копия порта обязана давать ТОТ ЖЕ кадр — иначе замер считает      */
/*     другую картинку, и сравнивать оп/px бессмысленно                  */
/* ------------------------------------------------------------------ */
const geometry = profilePort.selfCheckGeometry(20000);
console.log(`ok    геометрия профиля против зеркал car-profile.ts (20 000 точек): dTop ${geometry.dTop.toExponential(1)}, `
  + `dBottom ${geometry.dBottom.toExponential(1)}, dArch ${geometry.dArch.toExponential(1)}, dProfile ${geometry.dProfile.toExponential(1)}`);
const FORK_CHECK = {};
{
  const probe = { width: 160, height: 90, variant: 'silhouette', quality: 2, time: 4.0, scroll: 0.15, pointer: [0.18, -0.08] };
  refStatic.resetTally(); refDyn.resetTally();
  const a = refStatic.renderFrame(probe);
  const b = refDyn.renderFrame(probe);
  let diff = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
  if (diff !== 0) {
    console.error(`FAIL  кадр копии порта отличается от принятого: ${diff} байт из ${a.data.length}.`);
    console.error('      Стоимость можно сравнивать только если картинка та же — поправьте ref-dyn.mjs.');
    process.exit(1);
  }
  console.log(`ok    кадр копии совпадает с принятым портом побитово (${a.data.length} байт, различий 0) — отличается только талли`);
  FORK_CHECK.bytes = a.data.length;
  FORK_CHECK.differingBytes = diff;
  FORK_CHECK.geometry = { samples: 20000, dTop: geometry.dTop, dBottom: geometry.dBottom, dArch: geometry.dArch, dProfile: geometry.dProfile };
}

/* ------------------------------------------------------------------ */
/* 2. Тиры — те же, что в принятом гейте и замере                       */
/* ------------------------------------------------------------------ */

/* Варианты и тиры — как в принятом замере: там они называются depth (A, «воздух»)
   и silhouette (B, «силуэт»); A11 в review-2.md приводит числа для silhouette. */
const VARIANTS = [
  { id: 'A', mode: 'depth', label: 'A «глубина/воздух» (без силуэта)' },
  { id: 'B', mode: 'silhouette', label: 'B «силуэт» (значение по умолчанию)' },
];
const QUALITIES = [
  { id: 'low', quality: 0, budget: 60, label: 'low (бюджет 60 Гоп/с)' },
  { id: 'mid', quality: 1, budget: 25, label: 'mid (бюджет 25 Гоп/с)' },
  { id: 'high', quality: 2, budget: 10, label: 'high (бюджет 10 Гоп/с)' },
];

/* Аршины из задания: «до» = 941 оп/px (вариант B, mid, 640×360), допуск +10 % = 1035,1. */
const BASELINE = 941;
const TOLERANCE = 1.10;
const BUDGET_LIMIT = Number((BASELINE * TOLERANCE).toFixed(1));
/* Числа A11 (docs/reports/r31-review/review-2.md): 779,9 / 821 / 954,1 по тирам low/mid/high. */
const A11 = { low: 779.9, mid: 821, high: 954.1 };

function measure(ref, opts) {
  ref.resetTally();
  const t0 = process.hrtime.bigint();
  const frame = ref.renderFrame(opts);
  const t1 = process.hrtime.bigint();
  return {
    ops: frame.ops,
    msPerFrame: Number(t1 - t0) / 1e6,
    nsPerPx: Number(t1 - t0) / frame.pixels,
  };
}

/* JIT-прогрев: первые прогоны Node интерпретирует, цифры плавают (урок раунда 30). */
for (let i = 0; i < 2; i++) {
  measure(refStatic, { width: 96, height: 54, variant: 'silhouette', quality: 2, time: 2 });
  measure(refDyn, { width: 96, height: 54, variant: 'silhouette', quality: 2, time: 2 });
}

console.log(`\n-- 3D-фон: стоимость кадра, ${WIDTH}×${HEIGHT} (${WIDTH * HEIGHT} px), t = ${WINDOW.time}, scroll = ${WINDOW.scroll}, pointer = (${WINDOW.pointer[0]}; ${WINDOW.pointer[1]}) --`);
console.log('  вариант  качество   статика оп/px   динамика оп/px     Δ %   A11 (review-2)   inst/px (дин.)   нс/px (CPU)');

const rows = [];
for (const v of VARIANTS) {
  for (const q of QUALITIES) {
    const opts = {
      width: WIDTH, height: HEIGHT, variant: v.mode, quality: q.quality, ...WINDOW, fade: 1,
    };
    const st = measure(refStatic, opts);
    const dy = measure(refDyn, opts);
    const deltaPct = ((dy.ops.scalarPerPx - st.ops.scalarPerPx) / st.ops.scalarPerPx) * 100;
    rows.push({
      variant: v.id, quality: q.id,
      staticScalarPerPx: Number(st.ops.scalarPerPx.toFixed(1)),
      dynamicScalarPerPx: Number(dy.ops.scalarPerPx.toFixed(1)),
      staticInstPerPx: Number(st.ops.instPerPx.toFixed(1)),
      dynamicInstPerPx: Number(dy.ops.instPerPx.toFixed(1)),
      scalarMaxPerPx: dy.ops.scalarPerPxMax,
      deltaPct: Number(deltaPct.toFixed(1)),
      a11ScalarPerPx: v.id === 'B' ? A11[q.id] : null,
      nsPerPx: Number(dy.nsPerPx.toFixed(0)),
      budget: q.budget,
    });
    console.log(`  ${v.id.padEnd(8)} ${q.id.padEnd(10)} ${st.ops.scalarPerPx.toFixed(1).padStart(15)} `
      + `${dy.ops.scalarPerPx.toFixed(1).padStart(16)} ${deltaPct.toFixed(1).padStart(7)} % `
      + `${(v.id === 'B' ? A11[q.id].toFixed(1) : '—').padStart(15)} ${dy.ops.instPerPx.toFixed(1).padStart(16)} `
      + `${dy.nsPerPx.toFixed(0).padStart(13)}`);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Вердикт по допуску задания                                        */
/* ------------------------------------------------------------------ */

const worst = rows.reduce((a, b) => (b.dynamicScalarPerPx > a.dynamicScalarPerPx ? b : a));
const worstStatic = rows.reduce((a, b) => (b.staticScalarPerPx > a.staticScalarPerPx ? b : a));
console.log(`\n  худший тир (динамика): ${worst.variant}/${worst.quality} — ${worst.dynamicScalarPerPx} оп/px`);
console.log(`  худший тир (статика, как в принятом замере): ${worstStatic.variant}/${worstStatic.quality} — ${worstStatic.staticScalarPerPx} оп/px`);
console.log(`  аршин задания: «до» ${BASELINE} оп/px, допуск +10 % = ${BUDGET_LIMIT} оп/px`);
console.log(`  ${worstStatic.staticScalarPerPx <= BUDGET_LIMIT ? 'ok  ' : 'FAIL'}  статика: ${worstStatic.staticScalarPerPx} ≤ ${BUDGET_LIMIT} `
  + `(${(((worstStatic.staticScalarPerPx - BASELINE) / BASELINE) * 100).toFixed(1)} % к «до»)`);
console.log(`  ${worst.dynamicScalarPerPx <= BUDGET_LIMIT ? 'ok  ' : 'FAIL'}  динамика: ${worst.dynamicScalarPerPx} ≤ ${BUDGET_LIMIT} `
  + `(${(((worst.dynamicScalarPerPx - BASELINE) / BASELINE) * 100).toFixed(1)} % к «до»)`);

/* ------------------------------------------------------------------ */
/* 4. Сколько стоит сам профиль: разбивка и сверка с A11                */
/* ------------------------------------------------------------------ */

const avg = profilePort.profileCostAverage({ n: 64 });
const stat = profilePort.profileCostStatic();
console.log('\n-- стоимость обращения к профилю (carProfile) --');
console.log(`  динамика (исполненная ветвь), среднее по сетке 64×64: ${avg.dynamic.inst.toFixed(1)} inst / ${avg.dynamic.scalar.toFixed(1)} scalar`);
console.log(`    по x: от ${Math.min(...avg.perX.map((r) => r.instPerCall)).toFixed(0)} до ${Math.max(...avg.perX.map((r) => r.instPerCall)).toFixed(0)} inst — лесенка pTop проходит разное число сравнений`);
console.log(`  статика (все ветви подряд): ${stat.inst} inst / ${stat.scalar} scalar`);
console.log(`  статика + обвязка carSdf (4/4 из порта сцены): ${stat.inst + 4} / ${stat.scalar + 4}`);
console.log(`  принятая константа PROFILE_COST: ${refStatic.PROFILE_COST.inst} / ${refStatic.PROFILE_COST.scalar}`);
console.log(`  разбивка A11 (по SPIR-V byFunc): pTop 101 + pBottom 17 + pArch×2 10 + carProfile 12 + carSdf 5 = 145`);
console.log(`  мой подсчёт pTop: статика ${profilePort.pTopStatic.length ? '' : ''}`
  + `${(() => { profilePort.resetProfileTally(); profilePort.pTopStatic(0); return profilePort.profileTally().inst; })()} inst`
  + ` (SPIR-V: 101 арифм.), динамика в середине кузова `
  + `${(() => { profilePort.resetProfileTally(); profilePort.pTopDynamic(0); return profilePort.profileTally().inst; })()} inst`);

/* ------------------------------------------------------------------ */
/* 5. Отражение: на low/mid его быть не должно (§1.2.2)                 */
/* ------------------------------------------------------------------ */

/* Отражение в асфальте — второй вызов carSdf в пикселе (`rq = vec2(qx + wob, rg)`),
   и он живёт за `if (uQuality > 1.5)`. Поэтому число обращений к профилю на пиксель
   прямо показывает, исполнялось ли отражение: 1,000 — нет, > 1 — да, и доля
   превышения есть доля пикселей со вторым проходом. */
console.log('\n-- отражение в асфальте по тирам (§1.2.2) --');
console.log('  качество   обращений к профилю на px   из них второй проход (отражение)   доля px с отражением');
const reflRows = [];
for (const q of QUALITIES) {
  const opts = {
    width: WIDTH, height: HEIGHT, variant: 'silhouette', quality: q.quality, ...WINDOW, fade: 1,
  };
  refDyn.resetTally();
  refDyn.resetCounts();
  const frame = refDyn.renderFrame(opts);
  const callsPerPx = refDyn.COUNT.profileCalls / frame.pixels;
  const reflPx = Math.max(0, refDyn.COUNT.profileCalls - frame.pixels * (callsPerPx > 0 ? 1 : 0));
  const reflRatio = callsPerPx > 0 ? Math.max(0, callsPerPx - 1) : 0;
  reflRows.push({
    quality: q.id, callsPerPx: Number(callsPerPx.toFixed(4)),
    reflectionPixelRatio: Number(reflRatio.toFixed(4)),
    secondPassCalls: reflPx,
    expected: q.quality > 1.5 ? '> 0' : '0',
    ok: q.quality > 1.5 ? reflRatio > 0 : reflRatio === 0,
  });
  console.log(`  ${q.id.padEnd(10)} ${callsPerPx.toFixed(3).padStart(25)} ${reflPx.toFixed(0).padStart(32)} `
    + `${(reflRatio * 100).toFixed(1).padStart(20)} %   ${reflRows[reflRows.length - 1].ok ? 'ok' : 'FAIL'}`);
}
const reflOk = reflRows.every((r) => r.ok);
console.log(`  ${reflOk ? 'ok  ' : 'FAIL'}  отражение исполняется только на high (uQuality > 1.5) и отсутствует на low/mid`);

/* ------------------------------------------------------------------ */
/* 6. Отчёт                                                             */
/* ------------------------------------------------------------------ */

if (JSON_OUT) {
  const report = {
    generatedAt: new Date().toISOString(),
    purpose: '3D-фон: стоимость кадра в двух моделях — статическая (принятая, PROFILE_COST=145/130) и динамическая (построчный порт профиля), задание №55 §1.2',
    frame: { width: WIDTH, height: HEIGHT, pixels: WIDTH * HEIGHT, window: WINDOW },
  forkCheck: FORK_CHECK,
    windowNote: 'то же окно, что в принятом scripts/bg3d-measure.mjs §3: 640×360, t=4.0, scroll=0.15, pointer=(0.18,−0.08)',
    baseline: { opsPerPx: BASELINE, tolerance: TOLERANCE, limit: BUDGET_LIMIT, a11: A11 },
    rows,
    worst: { dynamic: worst, static: worstStatic },
    profileCost: {
      dynamicAverage: avg.dynamic,
      dynamicRangePerX: {
        min: Math.min(...avg.perX.map((r) => r.instPerCall)),
        max: Math.max(...avg.perX.map((r) => r.instPerCall)),
      },
      static: { inst: stat.inst, scalar: stat.scalar },
      staticWithCarSdfWrapper: { inst: stat.inst + 4, scalar: stat.scalar + 4 },
      acceptedConstant: refStatic.PROFILE_COST,
      a11Breakdown: 'pTop 101 + pBottom 17 + pArch×2 10 + carProfile 12 + carSdf 5 = 145',
      perX: avg.perX,
    },
    geometrySelfCheck: profilePort.selfCheckGeometry(5000),
    reflection: reflRows,
  };
  const out = resolve(process.cwd(), JSON_OUT);   /* от cwd: отчёты живут в docs/ корня репозитория */
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nотчёт: ${JSON_OUT}`);
}
