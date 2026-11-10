/**
 * Решение «рисовать ли 3D-фон вообще, и если да — в каком качестве».
 *
 * Вынесено в отдельный модуль без единого обращения к WebGL и DOM: всё читается из
 * plain-объекта `Bg3dEnv`. Это сделано намеренно — правила отключения можно покрыть
 * тестами в Node (tests/bg3d.test.ts), не поднимая браузер, и именно здесь живёт
 * «автоотключение на слабых устройствах» из задания №44.
 *
 * Порядок правил важен: сначала то, что запрещает фон безусловно (сохранение данных,
 * reduced-motion, явный отказ пользователя), потом оценка железа, потом бюджет качества.
 */

export type Tier = 'off' | 'low' | 'mid' | 'high';

export interface Bg3dEnv {
  /** navigator.deviceMemory (ГБ, округлено браузером; undefined если API нет) */
  deviceMemory?: number;
  /** navigator.hardwareConcurrency */
  hardwareConcurrency?: number;
  /** navigator.connection.saveData */
  saveData?: boolean;
  /** navigator.connection.effectiveType: 'slow-2g' | '2g' | '3g' | '4g' */
  effectiveType?: string;
  /** matchMedia('(prefers-reduced-motion: reduce)').matches */
  reducedMotion: boolean;
  /** matchMedia('(prefers-reduced-motion: no-preference)') — для iOS, где reduce не всегда отдаётся */
  webgl: boolean;
  webgl2: boolean;
  /** UNMASKED_RENDERER_WEBGL, если расширение WEBGL_debug_renderer_info доступно */
  renderer?: string;
  /** UNMASKED_VENDOR_WEBGL */
  vendor?: string;
  /** navigator.getBattery(): уровень 0..1 и зарядка (undefined, если API нет) */
  batteryLevel?: number;
  batteryCharging?: boolean;
  /** window.innerWidth / innerHeight в CSS-пикселях */
  width: number;
  height: number;
  devicePixelRatio: number;
  /** тач-устройство ( coarse pointer ) — мобильные GPU и батарея */
  coarsePointer: boolean;
  /** iOS/iPadOS — Safari отдаёт контекст с особенностями по памяти */
  isAppleMobile: boolean;
  /** пользователь уже выключил фон кнопкой (localStorage) */
  userOff: boolean;
  /** фон уже автоматически отключался в этой сессии (watchdog) */
  sessionBlocked: boolean;
  /** флаг сборки/владельца: включать ли фон на этой странице вообще */
  featureEnabled: boolean;
  /** navigator.userAgent — только для детекта программных растеризаторов и старых WebView */
  userAgent?: string;
}

/**
 * Измеренная стоимость кадра: скалярные операции на пиксель, среднее по кадру 640×360
 * (t=4.0, скролл 0.15, указатель 0.18/-0.08). Источник: CPU-порт tools/bg3d/ref.mjs,
 * замер 10.11.2026 (scripts/bg3d-measure.mjs повторяет его при каждом прогоне).
 * Индексы массива = quality (0/1/2). Эти числа — единственное место, где стоимость
 * шейдера попадает в решение «сколько пикселей себе позволить».
 */
export const OPS_PER_PX: Record<VariantLike, [number, number, number]> = {
  depth: [374, 415, 460],
  silhouette: [770, 811, 941],
};
type VariantLike = 'depth' | 'silhouette';

/**
 * Бюджет скорости операций (скалярные оп/с), который фон имеет право занять.
 *
 * Выведен из публичных пиковых FP32-значений GPU (notebookcheck / cpu-monkey /
 * gadgetversus, см. evaluation/round30-bg-3d/method.md) с двумя поправками: FMA даёт
 * 2 оп → делим пик на 2, и реальная эффективность процедурного фрагментного шейдера
 * 30–50 % → берём середину. Получается:
 *
 *   P1 dGPU GTX 1650      2849 GFLOPS → ~712 Гоп/с
 *   P2 iGPU Intel UHD 620  384 GFLOPS → ~ 86 Гоп/с
 *   P3 Adreno 610 (SD 662) 243 GFLOPS → ~ 43 Гоп/с
 *   P4 Mali-G57 MC1        122 GFLOPS → ~ 18 Гоп/с
 *
 * high держим ниже P2 (86), mid — около 60 % P3 (43), low — около 55 % P4 (18):
 * фон не имеет права выедать половину кадра даже на самом слабом устройстве,
 * которое ещё прошло ворота gate.ts.
 */
export const OPS_BUDGET: Record<Tier, number> = {
  high: 60e9,
  mid: 25e9,
  low: 10e9,
  off: 0,
};

/** Масштаб, при котором пиксельный бюджет сходится для данных размеров канваса. */
export function fitScale(opts: {
  cssWidth: number; cssHeight: number; dpr: number; fpsCap: number;
  opsPerPx: number; budget: number; min?: number; max?: number;
}): number {
  const { cssWidth, cssHeight, dpr, fpsCap, opsPerPx, budget } = opts;
  const rate = Math.max(1, fpsCap) * Math.max(1, opsPerPx);
  const full = cssWidth * cssHeight * dpr * dpr;
  if (full <= 0 || budget <= 0) return opts.max ?? 1;
  const fit = Math.sqrt(budget / (full * rate));
  return Math.min(opts.max ?? 1, Math.max(opts.min ?? 0.5, fit));
}

export interface Bg3dDecision {
  tier: Tier;
  /** какой вариант качества: 0/1/2 → uniform uQuality */
  quality: 0 | 1 | 2;
  /** ограничение частоты кадра, Гц */
  fpsCap: number;
  /** доля внутреннего разрешения: канвас рисуется в scale × (CSS-размер × DPR) */
  renderScale: number;
  /** потолок devicePixelRatio */
  dprCap: number;
  /** 'animate' — движение; 'static' — один кадр без движения (reduced-motion) */
  motion: 'animate' | 'static';
  /** скалярные оп/пиксель для выбранного варианта и качества (из OPS_PER_PX) */
  opsPerPx: number;
  /** бюджет оп/с для выбранного тира (из OPS_BUDGET) */
  opsBudget: number;
  /** человекочитаемые причины решения: нужны и в отчёте, и в лаборатории */
  reasons: string[];
}

/** Программные растеризаторы и GPU, на которых полноэкранный фрагментный шейдер — это
 *  guaranteed тормоза. Список намеренно короткий и проверяемый: всё, что не попало,
 *  оценивается по deviceMemory/hardwareConcurrency. */
const BLOCKED_RENDERER = [
  'swiftshader', 'llvmpipe', 'softpipe', 'software', 'basic render',
  'microsoft basic', 'virtualbox', 'vmware svga', 'parallels',
  'mali-4', 'mali-t6', 'mali-t7', 'adreno (tm) 3', 'adreno (tm) 4',
  'adreno 3', 'adreno 4', 'adreno 505', 'adreno 504', 'powervr sgx',
  'intel(r) hd graphics 4', 'intel(r) hd graphics 5',
];

/** Тач-устройства, где фон не нужен вовсе: экран узкий, силуэт не читается, батарея важнее. */
const NARROW_OFF = 380;

export function isBlockedRenderer(renderer?: string, vendor?: string): boolean {
  const s = `${vendor ?? ''} ${renderer ?? ''}`.toLowerCase();
  if (!s.trim()) return false;
  return BLOCKED_RENDERER.some((m) => s.includes(m));
}

/**
 * Решение по окружению. Функция чистая: одинаковый env → одинаковый вердикт.
 */
export function decideTier(env: Bg3dEnv, variant: VariantLike = 'silhouette'): Bg3dDecision {
  const reasons: string[] = [];
  const off = (why: string): Bg3dDecision => {
    reasons.push(why);
    return { tier: 'off', quality: 0, fpsCap: 0, renderScale: 0, dprCap: 1, motion: 'static', opsPerPx: 0, opsBudget: 0, reasons };
  };

  /* 1. Безусловные запреты — до всякой оценки железа. */
  if (!env.featureEnabled) return off('feature-flag: фон выключен на этой странице');
  if (env.userOff) return off('пользователь выключил фон кнопкой');
  if (env.sessionBlocked) return off('watchdog уже гасил фон в этой сессии');
  if (env.saveData) return off('Data Saver (saveData) — экономим трафик и батарею');
  if (env.effectiveType && ['slow-2g', '2g'].includes(env.effectiveType)) {
    return off(`сеть ${env.effectiveType} — фон не грузим`);
  }
  if (!env.webgl && !env.webgl2) return off('WebGL недоступен');
  if (isBlockedRenderer(env.renderer, env.vendor)) {
    return off(`программный/слабый растеризатор: ${(env.renderer ?? '').slice(0, 48) || 'неизвестно'}`);
  }
  if (env.batteryLevel !== undefined && !env.batteryCharging && env.batteryLevel < 0.2) {
    return off(`батарея ${(env.batteryLevel * 100).toFixed(0)}% и не на зарядке`);
  }

  /* 2. reduced-motion — не «выключить», а «не двигать»: один кадр, дальше тишина.
        Фон остаётся как статичная глубина, требование WCAG 2.2.2 закрыто и так
        (движения нет), а кнопка «выключить» всё равно есть. */
  const motion: 'animate' | 'static' = env.reducedMotion ? 'static' : 'animate';
  if (env.reducedMotion) reasons.push('prefers-reduced-motion: один статичный кадр, без анимации');

  /* 3. Оценка железа. Баллы, а не «вердикт по одному признаку»: одно слабое место
        (например 4 потока на старом десктопе) не должно гасить фон. */
  let score = 0;
  const mem = env.deviceMemory;
  if (mem !== undefined) {
    if (mem <= 2) score -= 3;
    else if (mem <= 4) score -= 1;
    else if (mem >= 8) score += 2;
    else score += 1;
    reasons.push(`deviceMemory=${mem} ГБ`);
  } else {
    /* API нет (Safari, Firefox) — полагаемся на остальное */
    reasons.push('deviceMemory недоступен');
  }
  const cores = env.hardwareConcurrency ?? 0;
  if (cores > 0) {
    if (cores <= 2) score -= 3;
    else if (cores <= 4) score -= 1;
    else if (cores >= 8) score += 2;
    else score += 1;
    reasons.push(`hardwareConcurrency=${cores}`);
  }
  if (env.coarsePointer) { score -= 1; reasons.push('тач-устройство'); }
  if (env.isAppleMobile) { score -= 1; reasons.push('iOS/iPadOS: лимит памяти на контекст'); }
  if (env.effectiveType === '3g') { score -= 1; reasons.push('сеть 3g'); }
  if (env.webgl2) { score += 1; reasons.push('WebGL2'); } else { reasons.push('только WebGL1'); }

  /* 4. Слишком слабое железо или слишком узкий экран — фон не включаем. */
  if (score <= -3) return off(`слабое устройство (оценка ${score})`);
  if (env.width < NARROW_OFF) return off(`ширина ${env.width}px < ${NARROW_OFF}px — силуэт не читается`);

  /* 5. Бюджет качества. Пикселей на кадр — главный множитель стоимости, поэтому
        мобильные и слабые профили режут внутреннее разрешение, а не частоту:
        фон мягкий, растянутая канвас-текстура на глаз не отличается. */
  const px = env.width * env.height * Math.min(env.devicePixelRatio, 3) ** 2;
  let tier: Tier;
  let quality: 0 | 1 | 2;
  let fpsCap: number;
  let renderScale: number;
  let dprCap: number;

  if (score >= 3 && !env.coarsePointer) {
    tier = 'high'; quality = 2; fpsCap = 60; renderScale = 1.0; dprCap = 2;
  } else if (score >= 1) {
    tier = 'mid'; quality = env.coarsePointer ? 1 : 2; fpsCap = 30; renderScale = env.coarsePointer ? 0.75 : 0.9; dprCap = env.coarsePointer ? 1.5 : 2;
  } else {
    tier = 'low'; quality = env.isAppleMobile ? 0 : 1; fpsCap = 24; renderScale = 0.6; dprCap = 1.25;
  }

  /* Огромный экран × высокий DPR: даже на сильном GPU площадь кадра зашкаливает,
     поэтому дополнительно режем масштаб. 4K-монитор не должен греть видеокарту фоном. */
  const budgetPx = 1920 * 1080;
  const drawnPx = px * renderScale * renderScale;
  if (drawnPx > budgetPx * 1.35) {
    const fit = Math.sqrt((budgetPx * 1.35) / px);
    renderScale = Math.max(0.5, Math.min(renderScale, fit));
    reasons.push(`площадь кадра ограничена до ${Math.round(renderScale * 100)}% (экран ${env.width}×${env.height}@${env.devicePixelRatio})`);
  }

  if (motion === 'static') { fpsCap = 0; }

  const opsPerPx = OPS_PER_PX[variant][quality];
  reasons.push(`итог: ${tier}, качество ${quality}, ${fpsCap ? `${fpsCap} к/с` : 'один кадр'}, масштаб ${Math.round(renderScale * 100)}%`);
  reasons.push(`бюджет: ${opsPerPx} оп/px × ${fpsCap || 1} к/с, потолок ${Math.round(OPS_BUDGET[tier] / 1e9)} Гоп/с (итоговый масштаб уточняет движок по размеру канваса)`);
  return { tier, quality, fpsCap, renderScale, dprCap, motion, opsPerPx, opsBudget: OPS_BUDGET[tier], reasons };
}

/** Собрать окружение из браузера. Все API опциональны и обернуты: приватный режим,
 *  старый WebView и отключённые API не должны ронять страницу. */
export function collectEnv(doc: Document, win: Window, opts: { featureEnabled: boolean; userOff: boolean; sessionBlocked: boolean }): Bg3dEnv {
  const nav = win.navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  };
  const mq = (q: string): boolean => { try { return win.matchMedia(q).matches; } catch { return false; } };

  /* Наличие WebGL проверяем на временном контексте 1×1: createContext стоит дорого,
     а нам нужно только «умеет ли браузер». Контекст сразу гасим. */
  let webgl = false, webgl2 = false, renderer: string | undefined, vendor: string | undefined;
  try {
    const c = doc.createElement('canvas');
    c.width = 1; c.height = 1;
    const probe = (name: string): WebGLRenderingContext | WebGL2RenderingContext | null =>
      (c.getContext(name, { failIfMajorPerformanceCaveat: false }) as WebGLRenderingContext | WebGL2RenderingContext | null);
    const gl2 = probe('webgl2');
    webgl2 = !!gl2;
    const gl1 = gl2 ?? probe('webgl') ?? probe('experimental-webgl');
    webgl = !!gl1;
    const gl = gl2 ?? gl1;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '');
        vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? '');
      }
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
  } catch { webgl = false; webgl2 = false; }

  const ua = nav.userAgent ?? '';
  return {
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    saveData: nav.connection?.saveData ?? false,
    effectiveType: nav.connection?.effectiveType,
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    webgl,
    webgl2,
    renderer,
    vendor,
    width: win.innerWidth || doc.documentElement.clientWidth || 1280,
    height: win.innerHeight || doc.documentElement.clientHeight || 720,
    devicePixelRatio: win.devicePixelRatio || 1,
    coarsePointer: mq('(pointer: coarse)'),
    isAppleMobile: /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && mq('(pointer: coarse)')),
    userOff: opts.userOff,
    sessionBlocked: opts.sessionBlocked,
    featureEnabled: opts.featureEnabled,
    userAgent: ua,
  };
}

/** Асинхронная добавка: батарея. Battery API есть только в Chromium и отдаётся промисом,
 *  поэтому решение принимается сначала без него, а при «< 20% и не на зарядке» фон гаснет
 *  уже после старта — через onLowBattery. */
export async function readBattery(win: Window): Promise<{ level: number; charging: boolean } | null> {
  const nav = win.navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
  if (typeof nav.getBattery !== 'function') return null;
  try {
    const b = await nav.getBattery();
    return { level: b.level, charging: b.charging };
  } catch { return null; }
}
