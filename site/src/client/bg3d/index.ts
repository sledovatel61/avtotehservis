/**
 * Точка входа 3D-фона: решение «рисовать ли», монтаж, кнопка «выключить», память выбора.
 *
 * Подключается динамически только на тех страницах, где фон разрешён (`Bg3dLayer.astro`),
 * поэтому в общий бандл публичных страниц не попадает вовсе: маржинальная цена фона —
 * вес одного чанка (замер: scripts/bg3d-measure.mjs).
 *
 * Жизненный цикл привязан к навигации. Сайт использует `@view-transition{navigation:auto}`
 * (motion.css:9) — это нативные MPA-переходы: скрипт выполняется заново на каждой странице,
 * старый документ уничтожается вместе с контекстом. Но если позже включат клиентский роутер
 * Astro (`<ClientRouter />`), скрипт останется жить между переходами, и без явного `dispose()`
 * на `astro:before-swap` контексты и слушатели начнут копиться. Оба случая закрыты.
 *
 * Важно про уборку: `dispose()` снимает не только слушатели движка, но и слушатель кнопки
 * «выключить», который вешается здесь. Без этого N перезапусков фона на одной странице
 * оставили бы N обработчиков клика — ровно та утечка, которую ищет тест на 20 переходов.
 */
import { Bg3d, type Bg3dStats, type Variant } from './engine.ts';
import { collectEnv, decideTier, readBattery, type Bg3dDecision } from './gate.ts';

/** Выбор пользователя: 'off' — выключил кнопкой, 'on' — включил обратно, null — не выбирал. */
export const LS_KEY = 'ats.bg3d';
/** Автоотключение watchdog'ом: только на сессию — после перезагрузки даём железу второй шанс. */
export const SS_KEY = 'ats.bg3d.blocked';

export interface Mounted {
  inst: Bg3d | null;
  decision: Bg3dDecision;
  host: HTMLElement;
  variant: Variant;
  stats(): Bg3dStats | null;
  /** выключить фон (как кнопка, но из кода) */
  off(): void;
  /** включить обратно */
  on(): void;
  /** полная уборка: движок, слушатель кнопки, пометки в DOM */
  dispose(): void;
}

/**
 * Реестр смонтированных слоёв: нужен лаборатории, тесту на 20 переходов и `unmountAll()`.
 *
 * Важно, что здесь лежат ВСЕ слои, а не только рисующие. Слой, который не стартовал
 * (слабое железо, saveData, пользователь уже выключал фон) и слой, который погас
 * (кнопка «выключить», watchdog, низкая батарея), всё равно держит слушатель клика
 * на кнопке — её ведь можно нажать, чтобы включить фон обратно. Если такой слой
 * не попадёт в реестр, `unmountAll()` его не уберёт, и при клиентской навигации
 * слушатели начнут копиться: по одному на переход. Именно это и ловил тест
 * tests/bg3d.test.ts («нет WebGL — слой не стартует и не оставляет следов»).
 */
export const registry: Mounted[] = [];

/** Сколько слоёв сейчас реально рисует (движок жив). Для лаборатории и отчётов. */
export function liveInstances(): number { return registry.filter((m) => m.inst?.alive).length; }

function lsGet(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string | null): void {
  try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* приватный режим */ }
}
function ssGet(k: string): string | null {
  try { return window.sessionStorage.getItem(k); } catch { return null; }
}
function ssSet(k: string, v: string | null): void {
  try { if (v === null) window.sessionStorage.removeItem(k); else window.sessionStorage.setItem(k, v); } catch { /* ignore */ }
}

export interface MountOpts {
  host: HTMLElement;
  variant: Variant;
  /** флаг владельца/сборки: без него фон не включится никогда */
  featureEnabled: boolean;
  /** переопределения для лаборатории: форсировать профиль, масштаб, частоту, стресс */
  force?: Partial<Pick<Bg3dDecision, 'quality' | 'fpsCap' | 'renderScale' | 'dprCap' | 'tier' | 'motion'>> & { stress?: number };
  onAutoOff?: (reason: string) => void;
  onStats?: (s: Bg3dStats) => void;
  /** не гасить сцену по низкому fps: нужно стенду, который сам меряет fps */
  noWatchdog?: boolean;
}

/** Собрать экземпляр по разметке хоста: канвас и кнопка уже в DOM (см. Bg3dLayer.astro). */
export function mount(opts: MountOpts): Mounted {
  const { host, variant } = opts;
  const canvas = host.querySelector<HTMLCanvasElement>('canvas.bg3d-canvas') ?? undefined;
  const btn = host.querySelector<HTMLButtonElement>('.bg3d-off') ?? null;
  const userOff = lsGet(LS_KEY) === 'off';
  /* демо-показ без GPU (сервер выставил BG3D_DEMO=1 → data-bg3d-demo="1").
     Тогда же не блокируем программный растеризатор и не гасим сцену по низкому fps:
     иначе на машине без видеокарты владелец не увидит фона вообще. */
  const demo = host.dataset.bg3dDemo === '1';
  const env = collectEnv(document, window, {
    featureEnabled: opts.featureEnabled,
    userOff,
    /* в демо автоотключение прошлой сессии не учитываем: показ должен быть воспроизводимым */
    sessionBlocked: demo ? false : ssGet(SS_KEY) === '1',
  });
  if (demo) env.demo = true;
  const base = decideTier(env);
  const decision: Bg3dDecision = opts.force ? { ...base, ...opts.force } : base;

  let btnHandler: (() => void) | null = null;

  const mounted: Mounted = {
    inst: null,
    decision,
    host,
    variant,
    stats: () => mounted.inst?.stats() ?? null,
    off: () => {
      lsSet(LS_KEY, 'off');
      syncBtn(true);
      /* гасим плавно: экземпляр сам вызовет destroy() в конце fade-out,
         а onDestroyed уберёт его из реестра */
      mounted.inst?.fadeOutThenDestroy();
    },
    on: () => {
      lsSet(LS_KEY, 'on');
      ssSet(SS_KEY, null);
      mounted.decision = opts.force ? { ...decideTier({ ...env, userOff: false, sessionBlocked: false }), ...opts.force }
        : decideTier({ ...env, userOff: false, sessionBlocked: false });
      boot();
      syncBtn(false);
    },
    dispose: () => {
      const i = registry.indexOf(mounted);
      if (i >= 0) registry.splice(i, 1);
      mounted.inst?.destroy();
      mounted.inst = null;
      if (btn && btnHandler) btn.removeEventListener('click', btnHandler);
      btnHandler = null;
      delete host.dataset.bg3dState;
      delete host.dataset.bg3dTier;
      delete host.dataset.bg3dMounted;
    },
  };

  function syncBtn(isOff: boolean): void {
    if (!btn) return;
    const text = isOff ? 'Включить 3D-фон' : 'Выключить 3D-фон';
    btn.setAttribute('aria-pressed', String(!isOff));
    /* aria-label дублирует подпись: на узких экранах текст спрятан (bg3d.css),
       а доступное имя кнопки обязано остаться */
    btn.setAttribute('aria-label', text);
    const label = btn.querySelector('.bg3d-off-text');
    if (label) label.textContent = text;
    host.classList.toggle('is-off', isOff);
  }

  function boot(): void {
    if (decision0().tier === 'off') { syncBtn(true); host.dataset.bg3dState = 'off'; return; }
    if (mounted.inst?.alive) return;
    const inst = new Bg3d({
      host,
      canvas,
      variant,
      tier: mounted.decision.tier,
      quality: mounted.decision.quality,
      fpsCap: mounted.decision.fpsCap,
      renderScale: mounted.decision.renderScale,
      dprCap: mounted.decision.dprCap,
      motion: mounted.decision.motion,
      stress: opts.force?.stress ?? 1,
      noWatchdog: demo || opts.noWatchdog === true,
      opsPerPx: mounted.decision.opsPerPx,
      opsBudget: mounted.decision.opsBudget,
      onStats: opts.onStats,
      onDestroyed: () => {
        /* движок погас, но слой остаётся в реестре: слушатель кнопки жив, и её можно
           нажать, чтобы включить фон обратно. Из реестра убирает только dispose(). */
        mounted.inst = null;
        host.dataset.bg3dState = 'off';
      },
      onAutoOff: (reason) => {
        ssSet(SS_KEY, '1');
        syncBtn(true);
        host.dataset.bg3dAutooff = reason;
        opts.onAutoOff?.(reason);
      },
    });
    if (!inst.init()) {
      /* контекст не получен — страница остаётся с обычным градиентом, следов нет */
      inst.destroy();
      host.dataset.bg3dFail = 'no-webgl-context';
      syncBtn(true);
      return;
    }
    mounted.inst = inst;
    host.dataset.bg3dTier = mounted.decision.tier;
    host.dataset.bg3dState = 'on';
    syncBtn(false);
    inst.start();

    /* Батарея отдаётся промисом, поэтому решение принимается без неё, а при низком
       заряде фон гаснет сразу после старта. Battery API есть только в Chromium. */
    void readBattery(window).then((b) => {
      if (!b || b.charging || b.level >= 0.2) return;
      if (!mounted.inst?.alive) return;
      host.dataset.bg3dAutooff = `батарея ${(b.level * 100).toFixed(0)}% и не на зарядке`;
      syncBtn(true);
      mounted.inst.fadeOutThenDestroy();
    });
  }

  function decision0(): Bg3dDecision { return mounted.decision; }

  /* в реестр — до boot(): слой регистрируется независимо от того, стартовал ли движок */
  registry.push(mounted);

  /* Кнопка видна только когда есть чем управлять: фон работает ИЛИ пользователь сам его
     выключил (тогда подпись — «Включить 3D-фон»). Если WebGL нет, устройство слабое,
     включён Data Saver или экран узкий — кнопка осталась бы мёртвой: нажатие снова
     уперлось бы в то же решение gate.ts. В лаборатории (force) показываем всегда. */
  const canToggle = mounted.decision.tier !== 'off' || userOff || opts.force !== undefined;

  if (btn) {
    btn.type = 'button';
    btn.hidden = !canToggle;
    btnHandler = (): void => {
      if (mounted.inst?.alive) mounted.off();
      else mounted.on();
    };
    btn.addEventListener('click', btnHandler);
  }

  /* userOff уже учтён в env: при выключенном фоне base.tier === 'off', и boot() просто гасит кнопку */
  boot();
  return mounted;
}

/** Пройти по всем `[data-bg3d]` на странице. Вызывается из bg3d.ts и после навигации. */
export function mountAll(featureEnabled: boolean): Mounted[] {
  const out: Mounted[] = [];
  document.querySelectorAll<HTMLElement>('[data-bg3d]').forEach((host) => {
    if (host.dataset.bg3dMounted === '1') return;
    host.dataset.bg3dMounted = '1';
    const variant: Variant = host.dataset.bg3d === 'silhouette' ? 'silhouette' : 'depth';
    out.push(mount({ host, variant, featureEnabled }));
  });
  return out;
}

/** Убрать все экземпляры: вызов перед сменой страницы и в тесте на 20 переходов. */
export function unmountAll(): void {
  while (registry.length) registry[registry.length - 1].dispose();
}
