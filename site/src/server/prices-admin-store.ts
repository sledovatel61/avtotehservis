/**
 * Хранилище цен для серверной админки: чтение, атомарная запись, правка отдельных строк.
 *
 * Источник правды — `content/prices.json` (единственный файл). Второго источника нет:
 * SQLite здесь только для журнала действий, сами цены в базу не кладутся.
 *
 * ── Про этот файл ────────────────────────────────────────────────────────────
 * По заданию 85-1 (Агент 10) чтение/запись и схема живут в `src/server/prices-store.ts`
 * и `src/shared/prices-schema.ts`. В ветке `agent/85-prices-admin` их ещё нет, поэтому
 * здесь ВРЕМЕННАЯ тонкая обёртка ровно по контракту §2 задания 85-2. Когда Агент 10
 * влит свой модуль, отсюда надо оставить только `saveGroup`/`saveAll` (они вызывают
 * чтение и запись хранилища), а `readPrices`, `validatePrices`, `slugifyRu`,
 * `uniqueId` — удалить и импортировать из `prices-store.ts`. Второй экземпляр
 * валидации в проекте остаться не должен.
 *
 * ── Почему запись такая осторожная ──────────────────────────────────────────
 * Файл правят с двух сторон: из этой админки и из раздела «Цены» на /manage/
 * (GitHub Pages). Между «прочитал» и «записал» чужая правка может приехать, поэтому:
 *   1) перед записью файл перечитывается;
 *   2) к СВЕЖЕЙ версии применяются только те строки, которые менял мастер
 *      (last-write-wins по строке, а не по файлу целиком);
 *   3) запись идёт в `prices.json.tmp` и подменяет файл через `rename` — атомарно
 *      в пределах одной файловой системы: читатель видит либо старый файл целиком,
 *      либо новый целиком, но не половину.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------- типы контракта §2 ---------- */

export interface PriceItem { id: string; name: string; price: string; hidden?: boolean }
export interface PriceGroup { id: string; title: string; service: string; items: PriceItem[] }
export interface TyreSet { id: string; radius: string; passenger: string; crossover: string }
export interface TyreRepair { id: string; range: string; price: string }
export interface TyreExtra { id: string; name: string; price: string; hidden?: boolean }
export interface VoyahItem { id: string; name: string; note: string; price: string }
export interface FeaturedItem { id: string; ref: string; title: string; note: string }

export interface Prices {
  updated_at: string;
  groups: PriceGroup[];
  tyres: { set: TyreSet[]; repair: TyreRepair[]; extra: TyreExtra[] };
  voyah: VoyahItem[];
  featured: FeaturedItem[];
}

/** Категории, которые мастер видит на экране. Ключ — то, что уходит в форму и журнал. */
export type CategoryKey =
  | `group:${string}`
  | 'tyres:set' | 'tyres:repair' | 'tyres:extra'
  | 'voyah';

export const CATEGORY_LABEL: Record<string, string> = {
  'tyres:set': 'Шиномонтаж комплекта',
  'tyres:repair': 'Ремонт колёс',
  'tyres:extra': 'Колёса и балансировка',
  voyah: 'Voyah Free',
};

/* ---------- путь к файлу ---------- */

const HERE = dirname(fileURLToPath(import.meta.url));
/** `site/content/prices.json`; DATA_DIR не влияет — файл лежит в репозитории рядом с кодом. */
export const PRICES_PATH = resolve(HERE, '../../content/prices.json');

export function pricesPath(): string {
  return process.env.PRICES_FILE ? resolve(process.env.PRICES_FILE) : PRICES_PATH;
}

/* ---------- чтение ---------- */

export class PricesError extends Error {}

export function readPrices(): Prices {
  const p = pricesPath();
  if (!existsSync(p)) throw new PricesError('Файл цен не найден');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    throw new PricesError('Файл цен повреждён — цены не прочитаны');
  }
  return validatePrices(raw);
}

/* ---------- проверка формы файла ---------- */

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Проверка формы файла цен. Не «мягкая»: битый файл ловится здесь, а не на странице,
 * потому что иначе мастер увидит пустой прайс и решит, что цены пропали.
 * Возвращает проверенный объект, бросает `PricesError` с русским текстом.
 */
export function validatePrices(raw: unknown): Prices {
  if (!isObj(raw)) throw new PricesError('Файл цен повреждён: ожидался набор цен');
  const bad = (what: string): never => { throw new PricesError(`Файл цен повреждён: ${what}`); };

  if (!isStr(raw.updated_at) || !DATE_RE.test(raw.updated_at)) bad('не указана дата подтверждения цен');

  const seen = new Set<string>();
  const takeId = (v: unknown, where: string): string => {
    if (!isStr(v) || !v.trim()) bad(`у позиции ${where} нет имени для ссылок`);
    const id = v as string;
    if (seen.has(id)) bad(`имя для ссылок «${id}» повторяется`);
    seen.add(id);
    return id;
  };

  if (!Array.isArray(raw.groups)) bad('нет групп прайса');
  const groups = (raw.groups as unknown[]).map((g, gi) => {
    if (!isObj(g)) bad(`группа №${gi + 1} записана неверно`);
    const gg = g as Record<string, unknown>;
    if (!isStr(gg.title) || !gg.title.trim()) bad(`у группы №${gi + 1} нет названия`);
    if (!isStr(gg.service)) bad(`у группы «${String(gg.title)}» не указана услуга`);
    if (!Array.isArray(gg.items)) bad(`у группы «${String(gg.title)}» нет списка работ`);
    const items = (gg.items as unknown[]).map((it, ii) => {
      if (!isObj(it)) bad(`работа №${ii + 1} в группе «${String(gg.title)}» записана неверно`);
      const o = it as Record<string, unknown>;
      if (!isStr(o.name) || !o.name.trim()) bad(`у работы №${ii + 1} в группе «${String(gg.title)}» нет названия`);
      if (!isStr(o.price)) bad(`у работы «${String(o.name)}» нет цены`);
      return {
        id: takeId(o.id, `«${String(o.name)}»`),
        name: o.name as string,
        price: o.price as string,
        ...(o.hidden === true ? { hidden: true } : {}),
      } satisfies PriceItem;
    });
    return { id: takeId(gg.id, `группа «${String(gg.title)}»`), title: gg.title as string, service: gg.service as string, items };
  });

  const tyres = isObj(raw.tyres) ? raw.tyres as Record<string, unknown> : bad('нет раздела шин');
  const arr = (v: unknown, where: string): unknown[] => (Array.isArray(v) ? v : bad(`нет списка: ${where}`));

  const set = arr(tyres.set, 'шины по радиусу').map((r, i) => {
    const o = (isObj(r) ? r : bad(`строка шин №${i + 1} записана неверно`)) as Record<string, unknown>;
    if (!isStr(o.radius)) bad(`у строки шин №${i + 1} нет радиуса`);
    if (!isStr(o.passenger)) bad(`у радиуса ${String(o.radius)} нет цены для легковых`);
    if (!isStr(o.crossover)) bad(`у радиуса ${String(o.radius)} нет цены для кроссоверов`);
    return { id: takeId(o.id, `шины ${String(o.radius)}`), radius: o.radius as string, passenger: o.passenger as string, crossover: o.crossover as string } satisfies TyreSet;
  });
  const repair = arr(tyres.repair, 'ремонт колёс').map((r, i) => {
    const o = (isObj(r) ? r : bad(`строка ремонта колёс №${i + 1} записана неверно`)) as Record<string, unknown>;
    if (!isStr(o.range)) bad(`у строки ремонта №${i + 1} нет диапазона радиусов`);
    if (!isStr(o.price)) bad(`у ремонта ${String(o.range)} нет цены`);
    return { id: takeId(o.id, `ремонт ${String(o.range)}`), range: o.range as string, price: o.price as string } satisfies TyreRepair;
  });
  const extra = arr(tyres.extra, 'колёса и балансировка').map((r, i) => {
    const o = (isObj(r) ? r : bad(`строка «колёса и балансировка» №${i + 1} записана неверно`)) as Record<string, unknown>;
    if (!isStr(o.name)) bad(`у строки №${i + 1} в «колёсах и балансировке» нет названия`);
    if (!isStr(o.price)) bad(`у работы «${String(o.name)}» нет цены`);
    return {
      id: takeId(o.id, `«${String(o.name)}»`),
      name: o.name as string,
      price: o.price as string,
      ...(o.hidden === true ? { hidden: true } : {}),
    } satisfies TyreExtra;
  });

  const voyah = arr(raw.voyah, 'прайс Voyah Free').map((r, i) => {
    const o = (isObj(r) ? r : bad(`строка Voyah №${i + 1} записана неверно`)) as Record<string, unknown>;
    if (!isStr(o.name)) bad(`у строки Voyah №${i + 1} нет названия`);
    if (!isStr(o.price)) bad(`у работы «${String(o.name)}» нет цены`);
    return { id: takeId(o.id, `«${String(o.name)}»`), name: o.name as string, note: isStr(o.note) ? o.note : '', price: o.price as string } satisfies VoyahItem;
  });

  const featured = arr(raw.featured, 'плашки на главной').map((r, i) => {
    const o = (isObj(r) ? r : bad(`плашка №${i + 1} записана неверно`)) as Record<string, unknown>;
    if (!isStr(o.title)) bad(`у плашки №${i + 1} нет названия`);
    if (!isStr(o.ref)) bad(`у плашки «${String(o.title)}» не указана позиция прайса Voyah`);
    return { id: takeId(o.id, `плашка «${String(o.title)}»`), ref: o.ref as string, title: o.title as string, note: isStr(o.note) ? o.note : '' } satisfies FeaturedItem;
  });

  /* Плашки на главной берут цену из позиции Voyah: ссылка обязана существовать,
     иначе на главной будет плашка без числа. */
  const voyahIds = new Set(voyah.map((v) => v.id));
  for (const f of featured) {
    if (!voyahIds.has(f.ref)) bad(`плашка «${f.title}» ссылается на позицию Voyah «${f.ref}», которой нет`);
  }

  return { updated_at: raw.updated_at as string, groups, tyres: { set, repair, extra }, voyah, featured };
}

/* ---------- служебное ---------- */

/** Русское название → латинский id: «Замена масла» → `zamena-masla`. */
export function slugifyRu(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const latin = name.toLowerCase().trim()
    .split('')
    .map((ch) => (ch in map ? map[ch] : ch))
    .join('');
  return latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'poziciya';
}

/** Свободный id: `zamena-masla`, при занятости — `zamena-masla-2`, `-3`, … */
export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new PricesError('Не удалось подобрать имя для новой строки');
}

/** Все занятые id файла — чтобы новый id не совпал ни с чем. */
export function allIds(p: Prices): Set<string> {
  const out = new Set<string>();
  for (const g of p.groups) { out.add(g.id); for (const it of g.items) out.add(it.id); }
  for (const k of ['set', 'repair', 'extra'] as const) for (const r of p.tyres[k]) out.add(r.id);
  for (const v of p.voyah) out.add(v.id);
  for (const f of p.featured) out.add(f.id);
  return out;
}

/* ---------- проверка значений от мастера ---------- */

/** Цена: 1–40 символов, содержит цифру, не «0 ₽» без слова «от». */
export function checkPrice(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Укажите цену — например: 1200 ₽';
  if (v.length > 40) return 'Слишком длинно для цены. Напишите короче, например: 1200 ₽';
  if (!/\d/.test(v)) return 'Похоже, это не цена. Напишите, например: 1200 ₽';
  /* «0 ₽» — не цена: работа за ноль рублей выглядит как ошибка, а не как подарок.
     Исключение — «от 0 ₽» и диапазоны вида «0–500 ₽»: там ноль это нижняя граница. */
  if (/^0(\s*₽|\s*руб)?\.?$/i.test(v) && !/^от/i.test(v)) return 'Похоже, это не цена. Напишите, например: 1200 ₽';
  return null;
}

/** Название работы: 2–120 символов. */
export function checkName(raw: string): string | null {
  const v = raw.trim();
  if (v.length < 2) return 'Название слишком короткое — напишите, как для клиента';
  if (v.length > 120) return 'Название слишком длинное — сократите до 120 символов';
  return null;
}

/* ---------- запись ---------- */

/**
 * Атомарная запись: tmp → rename. `mode` 0o644 — как у остальных файлов контента,
 * иначе после записи из-под root файл станет недоступен сборке сайта.
 */
export function writePrices(next: Prices): void {
  const p = pricesPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  const body = JSON.stringify(next, null, 2) + '\n';
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, p);
}

/** Что мастер поменял в одной строке. Ключ — id строки. */
export interface RowPatch {
  /** Новая цена. Для шин по радиусу — обе колонки в `tyre`. */
  price?: string;
  /** Для «шин по радиусу»: легковые и кроссовер. */
  tyre?: { passenger?: string; crossover?: string };
  /** Скрыть строку (без физического удаления). */
  hidden?: boolean;
  /** Новая строка: вставить в конец категории. */
  add?: { id: string; name: string };
}

export interface SaveResult { changed: number; added: number; hidden: number }

/**
 * Применяет правки к СВЕЖЕЙ версии файла и пишет её атомарно.
 *
 * Перечитывание перед записью — не формальность: мастер мог править цены, пока
 * параллельно их меняли из раздела «Цены» на /manage/. Last-write-wins по строке
 * означает, что чужие строки останутся чужими, а не откатятся к нашей копии.
 */
export function applyChanges(category: CategoryKey, patches: Record<string, RowPatch>, when = new Date()): SaveResult {
  const fresh = readPrices();
  let changed = 0, added = 0, hidden = 0;
  const taken = allIds(fresh);
  const stamp = isoDate(when);

  const patchItem = <T extends { id: string }>(rows: T[], make: (row: T, patch: RowPatch) => T): T[] => {
    const out: T[] = [];
    for (const row of rows) {
      const patch = patches[row.id];
      if (!patch) { out.push(row); continue; }
      const nextRow = make(row, patch);
      if (JSON.stringify(nextRow) !== JSON.stringify(row)) changed++;
      if (patch.hidden === true) hidden++;
      out.push(nextRow);
    }
    return out;
  };

  if (category.startsWith('group:')) {
    const gid = category.slice('group:'.length);
    const g = fresh.groups.find((x) => x.id === gid);
    if (!g) throw new PricesError('Категория не найдена');
    g.items = patchItem(g.items, (row, patch) => {
      const next: PriceItem = { ...row };
      if (typeof patch.price === 'string' && patch.price.trim()) next.price = patch.price.trim();
      /* hidden: true — скрыть, hidden: false — вернуть на прайс (пометку снимаем,
         саму строку не воссоздаём: она всё время лежала в файле). */
      if (patch.hidden === true) next.hidden = true;
      else if (patch.hidden === false) delete next.hidden;
      return next;
    });
    /* Добавление — в конец категории. Новый id уже выдан вызывающим кодом. */
    for (const patch of Object.values(patches)) {
      if (!patch.add) continue;
      if (taken.has(patch.add.id)) continue;  /* кто-то успел занять id — строку не дублируем */
      g.items.push({ id: patch.add.id, name: patch.add.name.trim(), price: (patch.price ?? '').trim() });
      added++;
    }
  } else if (category === 'tyres:set') {
    fresh.tyres.set = patchItem(fresh.tyres.set, (row, patch) => {
      const next = { ...row };
      if (patch.tyre?.passenger?.trim()) next.passenger = patch.tyre.passenger.trim();
      if (patch.tyre?.crossover?.trim()) next.crossover = patch.tyre.crossover.trim();
      return next;
    });
  } else if (category === 'tyres:repair') {
    fresh.tyres.repair = patchItem(fresh.tyres.repair, (row, patch) => {
      const next = { ...row };
      if (typeof patch.price === 'string' && patch.price.trim()) next.price = patch.price.trim();
      return next;
    });
  } else if (category === 'tyres:extra') {
    fresh.tyres.extra = patchItem(fresh.tyres.extra, (row, patch) => {
      const next: TyreExtra = { ...row };
      if (typeof patch.price === 'string' && patch.price.trim()) next.price = patch.price.trim();
      if (patch.hidden === true) next.hidden = true;
      else if (patch.hidden === false) delete next.hidden;
      return next;
    });
    for (const patch of Object.values(patches)) {
      if (!patch.add) continue;
      if (taken.has(patch.add.id)) continue;
      fresh.tyres.extra.push({ id: patch.add.id, name: patch.add.name.trim(), price: (patch.price ?? '').trim() });
      added++;
    }
  } else if (category === 'voyah') {
    fresh.voyah = patchItem(fresh.voyah, (row, patch) => {
      const next = { ...row };
      if (typeof patch.price === 'string' && patch.price.trim()) next.price = patch.price.trim();
      return next;
    });
    for (const patch of Object.values(patches)) {
      if (!patch.add) continue;
      if (taken.has(patch.add.id)) continue;
      fresh.voyah.push({ id: patch.add.id, name: patch.add.name.trim(), note: '', price: (patch.price ?? '').trim() });
      added++;
    }
  } else {
    throw new PricesError('Неизвестная категория');
  }

  if (changed || added || hidden) {
    /* Дата меняется только когда что-то действительно поменялось: иначе «Цифры
       подтверждены …» на прайсе будет обновляться от каждого открытия админки. */
    fresh.updated_at = stamp;
    validatePrices(fresh);
    writePrices(fresh);
  }
  return { changed, added, hidden };
}

/** ГГГГ-ММ-ДД по местному времени: дату видит клиент на /prices. */
export function isoDate(d: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** «19.11.2026» из «2026-11-19» — для подписи в админке. */
export function dateRu(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Категории со списком строк — то, что показывает экран. */
export function categories(p: Prices): { key: CategoryKey; title: string; count: number; hidden: number }[] {
  const out: { key: CategoryKey; title: string; count: number; hidden: number }[] = p.groups.map((g) => ({
    key: `group:${g.id}` as CategoryKey,
    title: g.title,
    count: g.items.length,
    hidden: g.items.filter((i) => i.hidden).length,
  }));
  out.push(
    { key: 'tyres:set', title: CATEGORY_LABEL['tyres:set'], count: p.tyres.set.length, hidden: 0 },
    { key: 'tyres:repair', title: CATEGORY_LABEL['tyres:repair'], count: p.tyres.repair.length, hidden: 0 },
    { key: 'tyres:extra', title: CATEGORY_LABEL['tyres:extra'], count: p.tyres.extra.length, hidden: p.tyres.extra.filter((i) => i.hidden).length },
    { key: 'voyah', title: CATEGORY_LABEL.voyah, count: p.voyah.length, hidden: 0 },
  );
  return out;
}
