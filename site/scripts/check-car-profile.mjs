#!/usr/bin/env node
/**
 * Гейт формы машины (круг 31, задание №52).
 *
 * Что проверяет: силуэт Voyah Free обязан держать паспортные числа и отношения
 * из задания с допуском ±2 %, а «мутант» (растянутая длина, опущенная крыша,
 * мелкие колёса, арка без зазора, кабина вперёд) — обязана ломать эти числа.
 *
 * Почему по картинке, а не по данным: `car-profile.mjs` рисует машину в чистом
 * орто 1200×500 и меряет пиксели. Значит, гейт ловит и ошибку в таблице точек,
 * и ошибку в GLSL (например, забытый габаритный срез): числа считаются по тому,
 * что реально нарисовано.
 *
 * Запуск:
 *   LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/check-car-profile.mjs
 *   LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/check-car-profile.mjs --self-test
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { CAR } from '../src/client/car-profile.ts';
import { renderSilhouette, measure } from './car-profile.mjs';

/* эталон §2 задания: габариты, клиренс, колесо, база, зазор арки */
const EXPECT = [
  { name: 'длина', unit: 'м', want: 4.905, tol: 0.02, abs: false, get: (n) => n.length },
  { name: 'высота', unit: 'м', want: 1.645, tol: 0.02, abs: false, get: (n) => n.height },
  { name: 'диаметр колеса', unit: 'м', want: 0.7375, tol: 0.03, abs: false, get: (n) => n.wheelD },
  { name: 'база', unit: 'м', want: 2.96, tol: 0.02, abs: false, get: (n) => n.wheelbase },
  { name: 'клиренс', unit: 'м', want: 0.18, tol: 0.02, abs: true, get: (n) => n.clearance },
  { name: 'зазор арки', unit: 'м', want: 0.035, tol: 0.012, abs: true, get: (n) => n.archGap },
  { name: 'длина/высота', unit: '', want: 2.98, tol: 0.02, abs: false, get: (n) => n.length / n.height },
  { name: 'база/длина', unit: '', want: 0.603, tol: 0.02, abs: false, get: (n) => n.wheelbase / n.length },
  { name: 'колесо/высота', unit: '', want: 0.448, tol: 0.03, abs: false, get: (n) => n.wheelD / n.height },
  /* «кабина сдвинута назад»: пик крыши — примерно 58 % длины от носа */
  { name: 'пик крыши, доля от носа', unit: '', want: 0.581, tol: 0.035, abs: true, get: (n) => n.roofPeakFrac },
];

function check(nums) {
  return EXPECT.map((e) => {
    const got = e.get(nums);
    const ok = Number.isFinite(got)
      && (e.abs ? Math.abs(got - e.want) <= e.tol : Math.abs(got - e.want) / e.want <= e.tol);
    return { name: e.name, want: e.want, got: +got.toFixed(3), ok };
  });
}

const fmt = (v, unit) => (unit === '' ? String(v) : `${v.toFixed(3)} ${unit}`);

function report(title, rows, problems) {
  console.log(`\n${title}`);
  for (const [i, r] of rows.entries()) {
    const e = EXPECT[i];
    const mark = r.ok ? '  ok ' : ' FAIL';
    const delta = e.abs ? r.got - e.want : (r.got - e.want) / e.want * 100;
    const d = e.abs ? `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}` : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %`;
    console.log(`  [${mark}] ${e.name.padEnd(24)} ${fmt(r.got, e.unit).padStart(11)}  эталон ${fmt(e.want, e.unit).padStart(11)}  ${d}`);
  }
  if (problems.length) for (const p of problems) console.log(`  ✗ ${p}`);
}

/* ------------------------------- мутанты ---------------------------------- */
/* Каждый мутант — правка «в данных», как будто кто-то ошибся в таблице точек
   или в GLSL. Гейт обязан это увидеть. */

const scaleX = (car, k) => {
  car.top = car.top.map(([x, y]) => [x * k, y]);
  car.bottom = car.bottom.map(([x, y]) => [x * k, y]);
  car.length *= k;
  car.wheelbase *= k;
  car.roofPeakX *= k;
  return car;
};

const MUTANTS = [
  {
    name: 'длина +12 %',
    must: 'длина',
    make: () => scaleX(structuredClone(CAR), 1.12),
  },
  {
    name: 'крыша −10 см',
    must: 'высота',
    make: () => {
      const car = structuredClone(CAR);
      car.top = car.top.map(([x, y]) => [x, y >= 1.45 ? y - 0.1 : y]);
      return car;
    },
  },
  {
    name: 'колёса −15 %',
    must: 'диаметр колеса',
    make: () => {
      const car = structuredClone(CAR);
      car.wheelD *= 0.85;
      return car;
    },
  },
  {
    name: 'арка без зазора',
    must: 'зазор арки',
    make: () => {
      const car = structuredClone(CAR);
      car.archGap = 0;
      return car;
    },
  },
  {
    name: 'кабина вперёд на 30 см',
    must: 'пик крыши, доля от носа',
    make: () => {
      const car = structuredClone(CAR);
      car.top = car.top.map(([x, y]) => [y >= 1.3 ? x + 0.3 : x, y]);
      car.roofPeakX += 0.3;
      return car;
    },
  },
];

/* --------------------------------- прогон --------------------------------- */

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell',
  protocolTimeout: 60000,
});

let failed = 0;
try {
  const base = await measure(await renderSilhouette(browser));
  const rows = check(base);
  report('Эталон (данные car-profile.ts → орто-силуэт → пиксели):', rows,
    rows.filter((r) => !r.ok).map((r) => `${r.name}: ${r.got} вместо ${r.want}`));
  if (rows.some((r) => !r.ok)) { failed += 1; console.log('\n✗ эталон не проходит допуски'); }

  if (process.argv.includes('--self-test')) {
    for (const m of MUTANTS) {
      let rows2 = [];
      let err = '';
      try {
        rows2 = check(await measure(await renderSilhouette(browser, m.make())));
      } catch (e) {
        err = e.message;
      }
      const caught = err !== '' || rows2.some((r) => !r.ok);
      const hit = rows2.filter((r) => !r.ok).map((r) => r.name);
      console.log(`\nМутант «${m.name}»: ${caught ? 'поймал' : 'ПРОПУСТИЛ'} — ${err ? 'ошибка замера: ' + err : hit.join(', ')}`);
      if (!caught) failed += 1;
      else if (!hit.includes(m.must) && err === '') {
        console.log(`  ✗ сломалось не то, что ожидалось: ждали «${m.must}»`);
        failed += 1;
      }
    }
  }
} finally {
  await browser.close();
}

if (failed) {
  console.log(`\n✗ провалов: ${failed}`);
  process.exit(1);
}
console.log('\n✓ силуэт держит эталон, мутанты падают');
