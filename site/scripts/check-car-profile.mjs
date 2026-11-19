#!/usr/bin/env node
/**
 * Гейт профиля машины (задание №54).
 *
 * Что и почему именно так:
 *
 *  1. **Габариты ±2 %** — по той же функции, что рисует шейдер
 *     (`carProfileJS`), а не по таблице чисел: таблица может быть верной,
 *     пока кривая врёт.
 *  2. **GLSL ↔ JS, IoU ≥ 0,99** по маске 400×160: шейдер компилируется в
 *     headless Chromium и рендерится в маску. Ловит расхождения, которых не
 *     видно в исходнике (порядок операций, `exp` вместо сплайна, округления).
 *  3. **Компиляция в WebGL1** отдельно: в ESSL 1.00 нет ни массивов с
 *     инициализатором, ни `tanh`, и это уже ловило ошибки в этом круге.
 *  4. **Мутанты.** Гейт, который не умеет падать, ничего не стоит. Каждый
 *     мутант — заведомо неверный профиль; `--self-test` требует, чтобы все
 *     были пойманы, включая «вторую копию геометрии» — ту самую беду, из-за
 *     которой заставка и фон разошлись.
 *
 * Запуск:
 *   node site/scripts/check-car-profile.mjs
 *   node site/scripts/check-car-profile.mjs --self-test
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { compareMasks, numbers, VIEW } from './car-profile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..');
const BASE = await import(join(SITE, 'src/client/car-profile.ts'));

const TOL_PCT = 2;
const IOU_MIN = 0.99;
const MASK = { width: 400, height: 160 };

const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
};

const LAUNCH = {
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader'],
  headless: 'shell',
};

/* ---------- 1. габариты и отношения ---------- */
console.log('\n== габариты (по функции, которая рисует шейдер) ==');
const n = numbers();
const spec = n.spec;
const dLen = ((n.length - spec.length) / spec.length) * 100;
const dHgt = ((n.height - spec.height) / spec.height) * 100;
ok(Math.abs(dLen) <= TOL_PCT, `длина ${n.length.toFixed(3)} м · паспорт ${spec.length} · Δ ${dLen.toFixed(2)} % (допуск ±${TOL_PCT} %)`);
ok(Math.abs(dHgt) <= TOL_PCT, `высота ${n.height.toFixed(3)} м · паспорт ${spec.height} · Δ ${dHgt.toFixed(2)} % (допуск ±${TOL_PCT} %)`);
const lh = spec.length / spec.height;
ok(Math.abs(n.lengthToHeight - lh) / lh <= 0.02, `длина/высота ${n.lengthToHeight.toFixed(3)} · паспорт ${lh.toFixed(3)}`);
const wl = spec.wheelbase / spec.length;
ok(Math.abs(n.wheelbaseToLength - wl) / wl <= 0.02, `база/длина ${n.wheelbaseToLength.toFixed(3)} · паспорт ${wl.toFixed(3)}`);
const wh = spec.tyre / spec.height;
ok(Math.abs(n.wheelToHeight - wh) / wh <= 0.02, `колесо/высота ${n.wheelToHeight.toFixed(4)} · паспорт ${wh.toFixed(4)}`);

/* ---------- 2. масштаб сцены ---------- */
console.log('\n== масштаб сцены (общий с A10) ==');
ok(Math.abs(BASE.CAR.height * BASE.SCALE.bg3d - 0.6) < 1e-9, `высота кузова в сцене ${(BASE.CAR.height * BASE.SCALE.bg3d).toFixed(4)} ед. (ожидание 0,60) — иначе поедут тень и отражение`);
ok(BASE.SCALE.intro === undefined, 'SCALE.intro в интерфейсе нет: машина заставки выведена из задания №54');

/* ---------- 3. контракт модуля ---------- */
console.log('\n== контракт PROFILE_GLSL ==');
for (const name of ['carProfile', 'carCabin', 'carWheels', 'pTop', 'pBottom', 'pBelt', 'pArch']) {
  ok(BASE.PROFILE_GLSL.includes(name), `объявлена ${name}()`);
}
ok(!/#version/.test(BASE.PROFILE_GLSL), 'нет #version (ESSL 1.00)');
ok(!/\bfor\s*\(/.test(BASE.PROFILE_GLSL), 'нет циклов (в ESSL 1.00 границы обязаны быть константами)');
ok(!/\bfloat\s+\w+\s*\[\s*\d/.test(BASE.PROFILE_GLSL), 'нет массивов: в ESSL 1.00 их нельзя инициализировать');
ok(!/\btanh\s*\(/.test(BASE.PROFILE_GLSL), 'нет tanh(): в ESSL 1.00 этой функции нет');
ok(BASE.TOP_SEGMENTS.length > 0 && BASE.TOP_SEGMENTS.length <= 16, `сегментов верха ${BASE.TOP_SEGMENTS.length} (каждый — ветвь ветвления и цена в оп/px)`);
ok(Math.abs(BASE.TOP_SEGMENTS[0].x0 + BASE.TOP_SEGMENTS[0].h * 0 + BASE.CAR.length / 2) < 1e-6, `кривая начинается на габарите кормы (${BASE.TOP_SEGMENTS[0].x0})`);
const lastCurve = BASE.TOP_SEGMENTS[BASE.TOP_SEGMENTS.length - 1];
ok(Math.abs(lastCurve.x0 + lastCurve.h - BASE.CAR.length / 2) < 1e-4, `кривая заканчивается на габарите носа (${(lastCurve.x0 + lastCurve.h).toFixed(4)})`);

/* ---------- 4. GLSL ↔ JS, компиляция ---------- */
console.log('\n== GLSL ↔ JS ==');
const cmp = await compareMasks(MASK);
ok(cmp.iou >= IOU_MIN, `IoU масок ${MASK.width}×${MASK.height} = ${cmp.iou.toFixed(5)} (порог ${IOU_MIN})`);

async function compileWebGL1(glsl) {
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), ...LAUNCH });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    return await page.evaluate((src) => {
      const gl = document.getElementById('c').getContext('webgl');
      if (!gl) return 'нет WebGL1';
      const s = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(s, `precision highp float;\n${src}\nvoid main(){ gl_FragColor = vec4(carProfile(vec2(0.0, 0.8))); }`);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? 'ok' : gl.getShaderInfoLog(s);
    }, glsl);
  } finally {
    await browser.close();
  }
}
const wgl1 = await compileWebGL1(BASE.PROFILE_GLSL);
ok(wgl1 === 'ok', `компиляция в WebGL1 / ESSL 1.00: ${wgl1 === 'ok' ? 'ok' : wgl1}`);

/* ---------- 5. мутанты ---------- */
/**
 * Мутанты подобраны по реальным поломкам этого круга, а не «на всякий случай»:
 * съехавшая крыша, забытый порог, потерянный габарит, арка не той оси,
 * вторая копия геометрии и рассинхрон GLSL с JS.
 */
function withProfile(fn) {
  return {
    carProfileJS: fn,
    CAR: BASE.CAR,
    length: BASE.CAR.length,
    height: BASE.CAR.height,
    wheelbase: BASE.CAR.wheelbase,
    tyre: BASE.CAR.tyre,
  };
}

function makeMutants() {
  return [
    {
      id: 'roof-down-40mm',
      why: 'крыша опущена на 40 мм',
      module: withProfile((x, y) => BASE.carProfileJS(x, y + 0.04)),
    },
    {
      id: 'sill-forgot',
      why: 'забыт порог: низ кузова на земле (0 вместо 0,185)',
      module: withProfile((x, y) => BASE.carProfileJS(x, y - 0.185)),
    },
    {
      id: 'nose-cut',
      why: 'нос обрезан на 300 мм',
      module: withProfile((x, y) => (x > BASE.CAR.length / 2 - 0.3 ? 1 : BASE.carProfileJS(x, y))),
    },
    {
      id: 'arch-missing',
      why: 'потеряны вырезы арок (геометрия без арок)',
      module: withProfile((x, y) => Math.max(BASE.bottomAt(x) - y, y - BASE.topAt(x), -y)),
      probes: [[BASE.CAR.axles[0], BASE.CAR.tyre / 2], [BASE.CAR.axles[1], BASE.CAR.tyre / 2]],
    },
    {
      id: 'second-copy',
      why: 'вторая копия профиля: свой «rbox-силуэт» внутри модуля (беда, из-за которой A5 и A10 разошлись)',
      /* Своя геометрия, живущая рядом с модулем: «кабина» из rbox, выехавшая
         над крышей (так и выглядит вторая копия — свой силуэт, наложенный на
         общий). В кадре появляется второе пятно, и высота выходит за допуск —
         гейт обязан увидеть и то, и другое. */
      module: withProfile((x, y) => {
        const own = (Math.max(Math.abs(x / 0.45), Math.abs((y - 1.95) / 0.14)) - 1) * 0.12;
        return Math.min(BASE.carProfileJS(x, y), own);
      }),
    },
    {
      id: 'glsl-desync',
      why: 'GLSL разошёлся с JS: у шейдера порог ниже на 60 мм (правку сделали в шейдере и забыли в модуле)',
      /* Порог — это низ силуэта на всю длину: 60 мм по нему дают площадь
         расхождения ~2,5 %, то есть IoU ≈ 0,975 < 0,99. Поломка реальная:
         именно так правили шейдер, когда геометрия жила в двух местах. */
      glsl: BASE.PROFILE_GLSL.replace(/return 0\.185 \+/, 'return 0.125 +'),
    },
  ];
}

/** Судья: габариты, связность силуэта и точечные пробы. */
async function judge(module, probes = []) {
  const problems = [];
  const car = module.CAR;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let x = -3; x <= 3; x += 0.006) {
    for (let y = 0; y <= 2; y += 0.006) {
      if (module.carProfileJS(x, y) <= 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return ['пустой силуэт'];
  const length = maxX - minX;
  const height = maxY;
  if (Math.abs(length - car.length) / car.length > 0.02) problems.push(`длина ${length.toFixed(3)} м (Δ ${(((length - car.length) / car.length) * 100).toFixed(1)} %)`);
  if (Math.abs(height - car.height) / car.height > 0.02) problems.push(`высота ${height.toFixed(3)} м (Δ ${(((height - car.height) / car.height) * 100).toFixed(1)} %)`);

  /* связность: вторая машина в кадре — это два и больше пятен маски */
  const W = 300;
  const Hh = 120;
  const mask = new Uint8Array(W * Hh);
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const x = VIEW.x0 + ((i + 0.5) / W) * (VIEW.x1 - VIEW.x0);
      const y = VIEW.y0 + ((j + 0.5) / Hh) * (VIEW.y1 - VIEW.y0);
      mask[j * W + i] = module.carProfileJS(x, y) <= 0 ? 1 : 0;
    }
  }
  const seen = new Uint8Array(W * Hh);
  let blobs = 0;
  for (let i = 0; i < W * Hh; i++) {
    if (!mask[i] || seen[i]) continue;
    blobs++;
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const k = st.pop();
      const x = k % W;
      const y = (k - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= Hh) continue;
        const kk = Y * W + X;
        if (mask[kk] && !seen[kk]) { seen[kk] = 1; st.push(kk); }
      }
    }
  }
  if (blobs > 1) problems.push(`${blobs} отдельных пятен силуэта (должна быть одна машина)`);

  /* Пробы: мутант может сохранить габариты (арки, вторая копия) и всё равно
     быть неверным. Проба — точка, где эталон говорит «кузов», а мутант «нет». */
  for (const [px, py] of probes) {
    const want = BASE.carProfileJS(px, py) <= 0;
    const got = module.carProfileJS(px, py) <= 0;
    if (want !== got) problems.push(`в точке (${px.toFixed(2)}, ${py.toFixed(2)}) мутант «${got ? 'кузов' : 'пусто'}», модуль «${want ? 'кузов' : 'пусто'}»`);
  }
  return problems;
}

if (process.argv.includes('--self-test')) {
  console.log('\n== self-test: мутанты (гейт обязан их отклонить) ==');
  const mutants = makeMutants();
  let caught = 0;
  for (const m of mutants) {
    let problems;
    if (m.glsl) {
      const cmpBad = await compareMasks({ ...MASK, glsl: m.glsl });
      problems = cmpBad.iou < IOU_MIN ? [`GLSL ↔ JS IoU ${cmpBad.iou.toFixed(4)} < ${IOU_MIN}`] : [];
    } else {
      problems = await judge(m.module, m.probes ?? []);
    }
    if (problems.length) caught++;
    console.log(`${problems.length ? 'ok  ' : 'FAIL'}  «${m.id}» ${problems.length ? 'отклонён' : 'ПРОШЁЛ (гейт слепой)'}: ${m.why}${problems.length ? ` → ${problems.join('; ')}` : ''}`);
  }
  ok(caught === mutants.length, `self-test: поймано ${caught} из ${mutants.length} мутантов (задание требует ≥ 5, включая «вторую копию»)`);
}

console.log('');
if (fail.length) {
  console.log(`ПРОВАЛ: ${fail.length}.`);
  for (const f of fail) console.log(`  · ${f}`);
  process.exit(1);
}
console.log('всё сошлось: габариты, контракт, ESSL 1.00 (WebGL1), GLSL ↔ JS.');
