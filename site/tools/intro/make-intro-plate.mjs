/* Круг 33 (A12): фото-пластина из эталона hero-front-red.png.
 * ВРЕМЕННЫЙ инструмент сборки ассетов site/public/img/intro/ (продукт — сами webp).
 *
 *   node tools/intro/make-intro-plate.mjs
 *
 * Слои:
 *   body-*.webp     — силуэт по маске ref-mask.png, СВЕТ И ДЕТАЛИ ФОТО СОХРАНЕНЫ;
 *                     полоса ДХО и знак вычищены (их рисует код шейдера),
 *                     альфа — маска с пером ~1 px; кроп [372..1553]×[67..1080] hero;
 *   plate-bg-*.webp — фон: за силуэтом ряд за рядом достроен квадратичной аппроксимацией
 *                     по пикселям фона того же ряда (пятно света продолжается под машину),
 *                     ниже y = 700 — тёмный пул пола медианой ряда плюс слабый боковой градиент.
 * Оба слоя препкомпенсированы обратным тонмаппингом композита COMP_FS
 * (pow(c, 0.9) и виньетка 1−0,55·dot(q,q)), чтобы после композита кадр совпадал с фото.
 * Размеры 1600 и 800 по ширине, webp q82.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const REF = '/home/user/avtotehservis/docs/brand/voyah/refs/r31/hero-front-red.png';
const MASK = '/home/user/avtotehservis/docs/reports/r32-brief/ref-mask.png';
const OUT = '/home/user/avtotehservis/site/public/img/intro';
const W = 1920, H = 1080;
/* кроп body-пластины в hero-координатах */
const CX0 = 372, CY0 = 67, CX1 = 1553, CY1 = 1080;

const ss = (e0, e1, x) => { const d = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return d * d * (3 - 2 * d); };
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* ---------- вход ---------- */
const photo = await sharp(REF).removeAlpha().raw().toBuffer();
const maskSmall = await sharp(MASK).grayscale().raw().toBuffer();   /* 960×540 */
const MSW = 960, MSH = 540;
const mask = new Float64Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    /* билинейно из 960×540 — сразу мягкое перо ~1 px */
    const fx = (x + 0.5) * MSW / W - 0.5, fy = (y + 0.5) * MSH / H - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (xi, yi) => maskSmall[Math.min(MSH - 1, Math.max(0, yi)) * MSW + Math.min(MSW - 1, Math.max(0, xi))] / 255;
    mask[y * W + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty)
                    + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  }
}
const P = (x, y, c) => photo[(y * W + x) * 3 + c];

/* Маска снята порогом isCar, поэтому красные перо капота, полоса ДХО и знак
   рассекают силуэт на горизонтальные полосы (r−b > 18 не проходит порог).
   Заливаем(span-fill по столбцам: от верхнего пикселя маски до нижнего): rgb
   внутри всё равно берётся из фото, поэтому «залитые» красные перо остаются
   своим цветом, а силуэт становится целостным. */
for (let x = 0; x < W; x++) {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < H; y++) if (mask[y * W + x] > 0.5) { if (y0 < 0) y0 = y; y1 = y; }
  for (let y = y0 < 0 ? 0 : y0; y <= y1; y++) mask[y * W + x] = 1;
}
/* «силуэт без фона»: маска после span-fill. По ней красим rgb кузова (фото внутри),
   а альфу берём из дилатации на 2 px — она нужна, чтобы кромка силуэта не садилась
   на самий край маски. */
const silh = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) silh[i] = mask[i] > 0.5 ? 1 : 0;

/* Альфа кузова: силуэт после span-fill -> дилатация на 4 px, бинарно. Перо у самого
   борта смешивало последний тексель с ярко-красным фоном (r−b ≈ 100), и порог
   силуэта гейта (r−b < 18) на кромке не находил пиксель — столбцы у борта давали
   t = −1 и «релинги» выскакивали в 95 px. Сглаживание кромки делает шейдер (aSharp)
   по билинейной выборке текстуры. */
let alphaBin = null;
{
  const bin = silh;
  const RAD = 4;
  const dil1 = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let dy = -RAD; dy <= RAD && !m; dy++) for (let dx = -RAD; dx <= RAD; dx++) {
      const xi = x + dx, yi = y + dy;
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
      if (bin[yi * W + xi]) { m = 1; break; }
    }
    dil1[y * W + x] = m;
  }
  alphaBin = dil1;
}

/* страховка: замкнутые дыры (если останутся) заливаем компонентой из границы */
{
  const out = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const push = (x, y) => { const i = y * W + x; if (!out[i] && mask[i] < 0.5) { out[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  let filled = 0;
  for (let i = 0; i < W * H; i++) if (!out[i] && mask[i] < 0.5) { mask[i] = 1; filled++; }
  console.log(`маска: залито дыр ${filled} px`);
}

/* ---------- инпейнт полосы ДХО и знака в кузове ---------- */
const body = Float64Array.from(photo, (v) => v);
const marked = new Uint8Array(W * H);
const sy = (x) => {                                   /* кривая линии из шейдера круга 32 */
  const mx = Math.abs(x - 960);
  const knee = Math.min(1, Math.max(0, (540 - mx) / 252));
  return 447.7 - 31.2 * (1 - ss(0, 1, knee));
};
for (let x = 400; x <= 1520; x++) {
  const c = sy(x);
  for (let y = Math.max(0, Math.round(c) - 34); y <= Math.min(H - 1, Math.round(c) + 34); y++) {
    if (luma(P(x, y, 0), P(x, y, 1), P(x, y, 2)) > 6) marked[y * W + x] = 1;
  }
}
for (let y = 425; y <= 555; y++) {
  for (let x = 905; x <= 1020; x++) {
    if (luma(P(x, y, 0), P(x, y, 1), P(x, y, 2)) > 10) marked[y * W + x] = 1;
  }
}
const fillColumn = (x, y) => {
  let up = y - 1, dn = y + 1;
  while (up >= 0 && marked[up * W + x]) up--;
  while (dn < H && marked[dn * W + x]) dn++;
  const a = up >= 0 ? up : dn, b = dn < H ? dn : up;
  const w = b === a ? 0 : (y - a) / (b - a);
  for (let c = 0; c < 3; c++) body[(y * W + x) * 3 + c] = P(x, a, c) * (1 - w) + P(x, b, c) * w;
};
/* fillColumn отключён по заданию №61 §1 — см. пояснение у void sm ниже. */
/* заплату пригладить: среднее 3×3 только по помеченным */
const sm = Float64Array.from(body);
for (let y = 1; y < H - 1; y++) {
  for (let x = 561; x < 1360; x++) {
    if (!marked[y * W + x]) continue;
    for (let c = 0; c < 3; c++) {
      let s2 = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { s2 += body[((y + dy) * W + x + dx) * 3 + c]; n++; }
      sm[(y * W + x) * 3 + c] = s2 / n;
    }
  }
}
/* Задание №61 §1: пластина — полное фото, инпейнт запрещён. Штампование
   (fillColumn по столбцам) дорисовывало на кузове несуществующие детали:
   полоса ДХО утолщалась до 7,2 px, ореол раздувался до 28 L, штрихи знака
   слипались (38 %). Смуз-массив sm остаётся только источником для кромки —
   в тело кузова он больше не идёт. */
void sm;

/* ---------- фон: достройка под силуэтом ---------- */
/* маска, раздутая на 10 px (разделимый max), чтобы перо кузова легло на достроенный фон */
const dil = new Float64Array(W * H);
{
  const tmp = new Float64Array(W * H);
  const R = 10;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let k = -R; k <= R; k += 2) m = Math.max(m, mask[y * W + Math.min(W - 1, Math.max(0, x + k))]);
    tmp[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let k = -R; k <= R; k += 2) m = Math.max(m, tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x]);
    dil[y * W + x] = m;
  }
}
const bg = Float64Array.from(photo, (v) => v);
for (let y = 0; y < H; y++) {
  /* пролёт силуэта ищем только в габарите машины (380…1540 hero): у маски бывают
     тёмные блобы у краёв кадра (углы зала проходят порог isCar) — без ограничени
     ряд достраивался бы от левого края до правого */
  let x0 = -1, x1 = -1;
  for (let x = 360; x <= 1560; x++) if (dil[y * W + x] > 0.5) { if (x0 < 0) x0 = x; x1 = x; }
  if (x0 < 0) continue;
  x0 = Math.max(0, x0 - 2); x1 = Math.min(W - 1, x1 + 2);
  if (y < 700) {
    /* квадратичная аппроксимация ряда по фону снаружи: пятно света продолжается под машину */
    let n = 0, sx = 0, sx2 = 0, sx3 = 0, sx4 = 0;
    const sr = [0, 0, 0], sg = [0, 0, 0], sb = [0, 0, 0];
    for (let x = 12; x < W - 12; x += 2) {
      if (dil[y * W + x] > 0.5) continue;
      if (x > x0 - 90 && x < x1 + 90) continue;         /* только дальний фон */
      const t1 = x, t2 = x * x;
      n++; sx += t1; sx2 += t2; sx3 += t2 * t1; sx4 += t2 * t2;
      for (let c = 0; c < 3; c++) { const v = P(x, y, c); sr[c] += v * 1; sg[c] += v * t1; sb[c] += v * t2; }
    }
    if (n < 24) continue;
    /* нормальные уравнения 3×3 (Гаусс) */
    const M = [[n, sx, sx2], [sx, sx2, sx3], [sx2, sx3, sx4]];
    const solve = (B) => {
      const A = M.map((r, i) => [...r, B[i]]);
      for (let i = 0; i < 3; i++) {
        let p = i;
        for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
        [A[i], A[p]] = [A[p], A[i]];
        for (let k = 0; k < 3; k++) {
          if (k === i) continue;
          const f = A[k][i] / A[i][i];
          for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
        }
      }
      return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
    };
    for (let c = 0; c < 3; c++) {
      const [a0, a1, a2] = solve([sr[c], sg[c], sb[c]]);
      for (let x = x0; x <= x1; x++) bg[(y * W + x) * 3 + c] = Math.min(255, Math.max(0, a0 + a1 * x + a2 * x * x));
    }
  } else {
    /* пул пола: медиана ряда внутри силуэта + слабый боковой градиент фона */
    const med = [0, 0, 0].map((_, c) => {
      const v = [];
      for (let x = x0; x <= x1; x += 3) if (mask[y * W + x] > 0.5) v.push(P(x, y, c));
      v.sort((a, b) => a - b);
      return v.length ? v[v.length >> 1] : 0;
    });
    const side = (x, c) => {
      const l = P(Math.max(4, x0 - 40), y, c), r = P(Math.min(W - 5, x1 + 40), y, c);
      return l + (r - l) * (x - x0) / Math.max(1, x1 - x0);
    };
    const sideMed = [0, 1, 2].map((c) => (P(Math.max(4, x0 - 40), y, c) + P(Math.min(W - 5, x1 + 40), y, c)) / 2);
    for (let x = x0; x <= x1; x++) {
      for (let c = 0; c < 3; c++) bg[(y * W + x) * 3 + c] = Math.min(255, Math.max(0, med[c] + (side(x, c) - sideMed[c]) * 0.25));
    }
  }
}

/* ---------- препкомпенсация композита: pow(c,0.9) и виньетка COMP_FS ---------- */
const pre = (src) => {
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const qy = (y + 0.5) / H - 0.5;
    for (let x = 0; x < W; x++) {
      const qx = (x + 0.5) / W - 0.5;
      const vig = 1 - 0.55 * (qx * qx + qy * qy);
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v = src[i + c] / 255;
        out[i + c] = Math.round(255 * Math.min(1, Math.pow(v, 1 / 0.9) / vig));
      }
    }
  }
  return out;
};
const bodyPre = pre(body);
const bgPre = pre(bg);

/* ---------- сборка webp ---------- */
await mkdir(OUT, { recursive: true });
const CW = CX1 - CX0, CH = CY1 - CY0;
/* Цвет кузова. Внутри силуэта rgb — фото без изменений (красное перо капота,
   ловящее свет r≈220, обязано остаться: иначе падает «подсветка кромки капота»).
   Снаружи силуэта (дилатационное кольцо, его видит билинейная выборка на кромке)
   цвет тянется наружу от «надёжного» ядра — эрозии силуэта на 2 px: у самого борта
   фото — ярко-красный фон (r≈90, r−b≈85), и кольцо из него краснило кромку до
   r−b = 32, гейт не находил силуэт и «релинги» уходили в 95 px. */
const bodyRGBA = Buffer.alloc(CW * CH * 4);
{
  const near = new Float32Array(W * H * 3);
  const mark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ok = 1;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xi = x + dx, yi = y + dy;
        if (xi < 0 || yi < 0 || xi >= W || yi >= H || !silh[yi * W + xi]) { ok = 0; break; }
      }
      if (!ok) continue;
      const i3 = (y * W + x) * 3;
      near[i3] = bodyPre[i3]; near[i3 + 1] = bodyPre[i3 + 1]; near[i3 + 2] = bodyPre[i3 + 2];
      mark[y * W + x] = 1;
    }
    let last = -1;
    const fwd = new Int32Array(W), bwd = new Int32Array(W);
    for (let x = 0; x < W; x++) { if (mark[y * W + x]) last = x; fwd[x] = last; }
    last = -1;
    for (let x = W - 1; x >= 0; x--) { if (mark[y * W + x]) last = x; bwd[x] = last; }
    for (let x = 0; x < W; x++) {
      if (mark[y * W + x]) continue;
      const a = fwd[x], b = bwd[x];
      const src = a < 0 ? b : b < 0 ? a : (x - a <= b - x ? a : b);
      if (src < 0) continue;
      const i3 = (y * W + x) * 3;
      near[i3] = near[(y * W + src) * 3]; near[i3 + 1] = near[(y * W + src) * 3 + 1]; near[i3 + 2] = near[(y * W + src) * 3 + 2];
      mark[y * W + x] = 1;
    }
  }
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const sx0 = CX0 + x, sy0 = CY0 + y, si = sy0 * W + sx0, o = (y * CW + x) * 4;
    let r = bodyPre[si * 3], g = bodyPre[si * 3 + 1], b = bodyPre[si * 3 + 2];
    /* Внутри тела обязан стоять сам фото-пиксель. near[] — цвет эрозии, он нужен
       только там, где фото на кромке яркое (фон/блик): иначе билинейная выборка
       тянет красный фон. Замер: hero(408,410) в фото (22,6,6) — r−b=16, силуэт
       проходит, — а из near[] приходило (36,9,21) с r−b=15, и в кадре пиксель
       выпадал: гейт терял кромку и брал серый блик левее (G/R 0,33). */
    const insideBody = silh[si] && alphaBin[si];
    const edgeDark = !silh[si] && alphaBin[si]
      && bodyPre[si * 3] < 60 && bodyPre[si * 3] - bodyPre[si * 3 + 2] <= 18;
    if (!insideBody && !edgeDark) {
      r = near[si * 3]; g = near[si * 3 + 1]; b = near[si * 3 + 2];
    }
    /* тёмная кромка: билинейная выборка на борту подмешивает фон (r−b ≈ 100) и
       выносит r−b к 30 — порог силуэта гейта требует r−b < 18. Поднимаем синий
       только у тёмных пикселей кромки; яркое красное перо капота (r > 60) не трогаем */
    /* Страховка синего — только на светлой кромке, куда дилатация подмешала
       яркий фон (r−b > 18 при тёмном r). Глухое r < 60 поднимало синий и на
       честном тёмном борту: фото (22,6,6) -> (36,9,21), и пиксель выпадал
       из силуэта в кадре. */
    const edgeBand = !silh[si] && alphaBin[si] && !edgeDark;
    if (edgeBand && r < 60 && r - b > 18) b = Math.max(b, r - 12);
    bodyRGBA[o] = Math.round(r); bodyRGBA[o + 1] = Math.round(g); bodyRGBA[o + 2] = Math.round(b);
    bodyRGBA[o + 3] = alphaBin[si] ? 255 : 0;
  }
}
const jobs = [
  [bodyRGBA, CW, CH, CW, `${OUT}/body-1600.webp`],
  [bodyRGBA, CW, CH, Math.round(CW * 800 / 1181), `${OUT}/body-800.webp`],
  [bgPre, W, H, 1600, `${OUT}/plate-bg-1600.webp`],
  [bgPre, W, H, 800, `${OUT}/plate-bg-800.webp`],
];
const toRGBA = (buf, w, h) => {
  const o = Buffer.alloc(w * h * 4);
  for (let i = 0, o0 = 0; i < w * h; i++, o0 += 4) {
    o[o0] = buf[i * 3]; o[o0 + 1] = buf[i * 3 + 1]; o[o0 + 2] = buf[i * 3 + 2]; o[o0 + 3] = 255;
  }
  return o;
};
for (const [buf, w, h, tw, file] of jobs) {
  const rgba = buf.length === w * h * 3 ? toRGBA(buf, w, h) : buf;
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .resize({ width: tw, kernel: 'lanczos3' })
    .webp({ quality: 92, effort: 6, smartSubsampling: false, alphaQuality: 100 })
    .toFile(file);
  const st = await sharp(file).metadata();
  const { size } = await (await import('node:fs/promises')).stat(file);
  console.log(`${file.split('/').pop()}: ${st.width}×${st.height}, ${(size / 1024).toFixed(1)} КБ`);
}
