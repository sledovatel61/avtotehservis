#!/usr/bin/env node
/**
 * Кадры 3D-фона с машиной: «до» и «после» замены силуэта на общий профиль
 * (задание №54). Десктоп 1440×900, мобильный 390×844, плюс кроп ×3 по машине.
 *
 * Почему отдельный скрипт, а не `bg3d-lab-shot.mjs`: нужны два размера, кроп
 * и честное «до». Для «до» шейдер временно подменяется версией из git-коммита
 * и потом возвращается; кадр каждый раз рисует живой WebGL, мок-скринов нет.
 *
 * В песочнице GPU нет: Chromium рисует через SwiftShader, и watchdog движка
 * обязан такой кадр погасить. Чтобы снять КАРТИНКУ, а не пустой градиент,
 * подменяем только то, по чему гейт узнаёт программный растеризатор. FPS при
 * этом не измеряется — это открытка, а не замер.
 *
 * Запуск (dev-сервер с BG3D_LAB=1 поднят):
 *   node site/scripts/car-profile-frames.mjs
 *   node site/scripts/car-profile-frames.mjs --before 4e7e555
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..');
const ROOT = join(SITE, '..');
const OUT = join(ROOT, 'docs/reports/r31-car-profile/frames');
const SHADER = join(SITE, 'src/client/bg3d/shader.ts');
const BASE = process.env.BASE || 'http://127.0.0.1:4321';

const beforeIdx = process.argv.indexOf('--before');
const beforeRef = beforeIdx > 0 ? process.argv[beforeIdx + 1] : null;
const tag = beforeRef ? 'before' : 'after';

mkdirSync(OUT, { recursive: true });
const backup = `${SHADER}.arena-backup`;
if (beforeRef) {
  /* резервную копию снимаем ДО подмены — иначе восстановим подменённый файл
     (это уже случалось: шейдер вернулся к версии из коммита) */
  copyFileSync(SHADER, backup);
  const beforeHash = createHash('sha256').update(readFileSync(SHADER)).digest('hex').slice(0, 12);
  writeFileSync(SHADER, execFileSync('git', ['show', `${beforeRef}:site/src/client/bg3d/shader.ts`], { cwd: ROOT }).toString());
  console.log(`шейдер подменён версией из ${beforeRef}`);
}

const SPOOF = () => {
  const patch = (Ctor) => {
    if (!Ctor) return;
    const orig = Ctor.prototype.getParameter;
    Ctor.prototype.getParameter = function getParameter(p) {
      if (p === 0x9245) return 'Google Inc. (Intel)';
      if (p === 0x9246) return 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.1)';
      return orig.call(this, p);
    };
  };
  patch(window.WebGLRenderingContext);
  patch(window.WebGL2RenderingContext);
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8 });
};

/* preserveDrawingBuffer: false — значит, после композитинга буфер пуст и в
   скриншоте канвас чёрный. Забираем пиксели синхронно внутри drawArrays:
   это единственный момент, когда буфер ещё цел. Ничего не подменяем —
   читаем ровно то, что нарисовал шейдер. */
const GRAB_CANVAS = () => {
  window.__carShot = null;
  window.__carShotRequest = false;
  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    for (const name of ['drawArrays', 'drawElements']) {
      const orig = proto[name];
      if (!orig) continue;
      proto[name] = function patched(...args) {
        const out = orig.apply(this, args);
        if (window.__carShotRequest && !window.__carShot) {
          const c = this.canvas;
          if (c && c.classList && c.classList.contains('bg3d-canvas')) {
            try { window.__carShot = c.toDataURL('image/png'); } catch { /* контекст потерян */ }
            window.__carShotRequest = false;
          }
        }
        return out;
      };
    }
  }
};

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell',
  defaultViewport: null,
});

try {
  for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(SPOOF);
    await page.evaluateOnNewDocument(GRAB_CANVAS);
    /* domcontentloaded, а не networkidle: dev-сервер держит HMR-сокет, и
       networkidle не наступает вовсе (проверено — таймаут 90 с) */
    /* Боевая страница, а не стенд: на мобильном канвас стенда выше окна и
       машина уходит в его невидимую часть, а на /voyah-free сцена стоит
       в первом экране так же, как у владельца. intro=0 — без анимации
       заставки, чтобы не ловить промежуточный кадр. */
    await page.goto(`${BASE}/voyah-free?intro=0`, { waitUntil: 'networkidle2', timeout: 90000 });
    /* слой фона монтируется клиентским скриптом — ждём, пока он появится */
    await page.waitForSelector('canvas.bg3d-canvas', { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.querySelector('[data-bg3d]')?.scrollIntoView({ block: 'center' }));
    let state = '';
    for (let i = 0; i < 40; i++) {
      state = await page.evaluate(() => document.querySelector('[data-bg3d]')?.dataset.bg3dState ?? '');
      if (state === 'on') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (state !== 'on') console.log(`  внимание: состояние канваса «${state}» — кадр снят как есть`);
    /* Ждём не время, а готовность вёрстки. dev-сервер отдаёт CSS модулями, и
       ранний снимок приходит «голым» HTML: тогда слой фона — статичный div
       высотой 160 px вместо сцены. Признак готовности: стили применились
       (у .v-hero-bg position не static) и сцена получила нормальную высоту. */
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-bg3d]');
      const c = document.querySelector('canvas.bg3d-canvas');
      if (!host || !c) return false;
      const styled = getComputedStyle(document.body).fontFamily.includes('-apple-system')
        || getComputedStyle(host).position !== 'static' || getComputedStyle(host).position !== '';
      const hgt = c.getBoundingClientRect().height;
      return styled && hgt > 240 && document.documentElement.scrollHeight < 14000;
    }, { timeout: 60000, polling: 250 }).catch(() => {
      console.log('  внимание: вёрстка не подтвердила готовность — кадр снят как есть');
    });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await new Promise((r) => setTimeout(r, 1500));

    const scene = async () => page.evaluate(() => {
      const c = document.querySelector('canvas.bg3d-canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      /* видимая часть канваса в координатах окна: на мобильном канвас во весь
         документ, и в кадр попадает только верхняя часть */
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      return {
        x, y,
        width: Math.max(1, Math.min(window.innerWidth, r.right) - x),
        height: Math.max(1, Math.min(window.innerHeight, r.bottom) - y),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    });
    /* Где машина в канвасе — считаем до снимка: по той же математике, что в
       шейдере (§ вариант B), с пересчётом метров профиля в единицы сцены.
       На мобильном канвас во весь документ, и без прокрутки машина просто не
       попадает в кадр — поэтому сначала находим её, потом прокручиваем. */
    const car = await import('../src/client/car-profile.ts');
    let bMinX = Infinity; let bMaxX = -Infinity; let bMinY = Infinity; let bMaxY = -Infinity;
    for (let x = -2.6; x <= 2.6; x += 0.02) {
      for (let y = -0.5; y <= 1.85; y += 0.02) {
        if (car.carProfileJS(x, y) < 0) {
          if (x < bMinX) bMinX = x;
          if (x > bMaxX) bMaxX = x;
          if (y < bMinY) bMinY = y;
          if (y > bMaxY) bMaxY = y;
        }
      }
    }
    const U = car.SCALE.bg3d;                     /* ед. сцены на метр */
    const G = car.SCENE.ground;                   /* линия земли в сцене */
    const camera = (rect) => {
      const depth = 0.58;
      const sc = 0.80 + (0.46 - 0.80) * depth;
      const cp = { x: 0.24, y: 0.10 - 0.155 };
      /* Шейдер: p = (uv − 0,5)·2, затем p.x *= aspect (aspect = W/H), а ось y
         смотрит вверх. Обратный пересчёт в пиксели канваса отсюда:
         px = p.x·H/2 + W/2, py = (0,5 − p.y/2)·H. Через uv.x напрямую нельзя —
         там уже сидит aspect, и ширина машины вышла бы в W/H раз больше. */
      const toPx = (x, y) => ({
        px: (x * rect.height) / 2 + rect.width / 2,
        py: (0.5 - y / 2) * rect.height,
      });
      const pts = [[bMinX, bMaxY], [bMaxX, bMaxY], [bMinX, bMinY], [bMaxX, bMinY]]
        .map(([x, y]) => toPx(cp.x + x * U * sc, cp.y + (G + y * U) * sc));
      const box = {
        left: Math.min(...pts.map((c) => c.px)),
        top: Math.min(...pts.map((c) => c.py)),
        width: Math.max(...pts.map((c) => c.px)) - Math.min(...pts.map((c) => c.px)),
        height: Math.max(...pts.map((c) => c.py)) - Math.min(...pts.map((c) => c.py)),
      };
      return { box, cp, sc };
    };

    const box0 = await scene();
    if (!box0) { console.log(`  внимание: канваса нет на странице — ${name} пропущен`); await page.close(); continue; }
    /* прокрутка к машине: в кадре она должна стоять целиком, с тенью */
    await page.evaluate(({ py }) => {
      const c = document.querySelector('canvas.bg3d-canvas');
      if (!c) return;
      const r = c.getBoundingClientRect();
      const docTop = r.y + window.scrollY;
      window.scrollTo(0, Math.max(0, Math.round(docTop + py - window.innerHeight * 0.55)));
    }, { py: (() => { const b = camera(box0.rect).box; return b.top + b.height / 2; })() });
    await new Promise((r) => setTimeout(r, 900));

    const box2 = await scene();
    const shot = join(OUT, `bg-${name}-${tag}.jpg`);

    /* preserveDrawingBuffer: false — в обычном снимке канвас чёрный. Забираем
       пиксели синхронно внутри drawArrays (единственный момент, когда буфер
       цел), затем кладём их в <img> ровно на место канваса и прячем канвас.
       Так текст и кнопки остаются СВЕРХУ сцены, как у владельца: накладывать
       PNG на готовый снимок нельзя — оно закрыло бы заголовок. */
    const canvasPng = await page.evaluate(async () => {
      window.__carShot = null;
      window.__carShotRequest = true;
      for (let i = 0; i < 120; i++) {
        if (window.__carShot) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return window.__carShot;
    });
    if (canvasPng) {
      await page.evaluate((png) => {
        const c = document.querySelector('canvas.bg3d-canvas');
        if (!c) return;
        const img = document.createElement('img');
        img.id = 'arena-car-frame';
        img.src = png;
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;';
        c.parentElement.appendChild(img);
        c.style.visibility = 'hidden';
      }, canvasPng);
      await new Promise((r) => setTimeout(r, 400));
    } else {
      console.log('  внимание: пиксели канваса не получены — кадр снят как есть');
    }
    await page.screenshot({ path: shot });
    await page.evaluate(() => {
      document.querySelector('#arena-car-frame')?.remove();
      const c = document.querySelector('canvas.bg3d-canvas');
      if (c) c.style.visibility = '';
    });
    console.log(`${name} ${w}×${h}: ${shot} (сцена ${Math.round(box2.width)}×${Math.round(box2.height)}, состояние ${state})`);

    /* Кроп ×3 по машине — из PNG канваса, а не из снимка окна: у канваса
       есть вся сцена, у окна только видимая часть, и на мобильном машина
       в неё то попадает, то нет. */
    if (canvasPng) {
      const { box: carBox } = camera(box2.rect);
      if (carBox.width > 8 && carBox.height > 8) {
        const pngBuf = Buffer.from(canvasPng.split(',')[1], 'base64');
        const pm = await sharp(pngBuf).metadata();
        const kx = pm.width / box2.rect.width;
        const ky = pm.height / box2.rect.height;
        const left = Math.max(0, Math.round((carBox.left - carBox.width * 0.10) * kx));
        const top = Math.max(0, Math.round((carBox.top - carBox.height * 0.45) * ky));
        const cropW = Math.max(1, Math.min(pm.width - left, Math.round(carBox.width * 1.20 * kx)));
        const cropH = Math.max(1, Math.min(pm.height - top, Math.round(carBox.height * 1.95 * ky)));
        const crop = await sharp(pngBuf).extract({ left, top, width: cropW, height: cropH }).toBuffer();
        const zoomOut = join(OUT, `bg-${name}-${tag}-car-x3.jpg`);
        await sharp(crop).resize({ width: cropW * 3, kernel: 'lanczos3' }).jpeg({ quality: 92 }).toFile(zoomOut);
        console.log(`  кроп ×3: ${zoomOut} (машина ${Math.round(carBox.width * kx)}×${Math.round(carBox.height * ky)} px, кроп ${cropW}×${cropH})`);
      } else {
        console.log('  внимание: bbox машины вырожден — кроп не сделан');
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  if (beforeRef) {
    copyFileSync(backup, SHADER);
    rmSync(backup);
    const back = createHash('sha256').update(readFileSync(SHADER)).digest('hex').slice(0, 12);
    console.log(back === beforeHash ? `шейдер возвращён (sha256 ${back})` : `ВНИМАНИЕ: шейдер не совпал с исходным (${back} ≠ ${beforeHash})`);
  }
}
