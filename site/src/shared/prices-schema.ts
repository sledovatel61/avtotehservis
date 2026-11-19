export interface PriceItem {
  id: string;
  name: string;
  note: string;
  price: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface PriceGroup {
  id: string;
  title: string;
  service: string;
  items: PriceItem[];
  [key: string]: unknown;
}

export interface TyreSetRow {
  id: string;
  radius: string;
  passenger: string;
  crossover: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface TyreRepairRow {
  id: string;
  radius: string;
  range?: string;
  price: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface TyreExtraRow {
  id: string;
  name: string;
  note: string;
  price: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface VoyahItem {
  id: string;
  name: string;
  note: string;
  price: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface FeaturedChip {
  id: string;
  ref: string;
  title: string;
  note: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface PricesFile {
  version: 1;
  updated_at: string;
  groups: PriceGroup[];
  tyres: {
    set: TyreSetRow[];
    repair: TyreRepairRow[];
    extra: TyreExtraRow[];
    [key: string]: unknown;
  };
  voyah: VoyahItem[];
  featured: FeaturedChip[];
  [key: string]: unknown;
}

export const PRICE_LIMITS = {
  name: [2, 120],
  note: [0, 160],
  price: [1, 40],
  title: [2, 80],
  radius: [2, 20],
  id: [2, 48],
  maxGroupItems: 40,
  maxVoyahItems: 40,
} as const;

const RU_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugifyRu(text: string): string {
  const slug = String(text ?? '')
    .toLowerCase()
    .trim()
    .split('')
    .map((ch) => (ch in RU_MAP ? RU_MAP[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PRICE_LIMITS.id[1])
    .replace(/-+$/g, '');
  return slug || 'poziciya';
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const inRange = (s: string, [min, max]: readonly [number, number]): boolean =>
  s.length >= min && s.length <= max;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function extractPriceNumbers(price: string): number[] {
  const compact = String(price ?? '').replace(/(\d)[\s\u00a0]+(?=\d{3}(?:\D|$))/g, '$1');
  const matches = compact.match(/\d+/g);
  if (!matches) return [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

function validateId(
  raw: unknown,
  path: string,
  seenIds: Set<string>,
  errors: Record<string, string>,
): string {
  const id = str(raw);
  if (!inRange(id, PRICE_LIMITS.id) || !ID_RE.test(id)) {
    errors[path] = 'Идентификатор: латиница, цифры и дефис (2–48 символов)';
    return id;
  }
  if (seenIds.has(id)) {
    errors[path] = `Дублирующийся идентификатор «${id}»`;
  } else {
    seenIds.add(id);
  }
  return id;
}

function validatePriceValue(raw: unknown, path: string, errors: Record<string, string>): string {
  const price = str(raw);
  if (!inRange(price, PRICE_LIMITS.price)) {
    errors[path] = `Цена должна быть от ${PRICE_LIMITS.price[0]} до ${PRICE_LIMITS.price[1]} символов`;
    return price;
  }
  const nums = extractPriceNumbers(price);
  if (nums.length === 0) {
    errors[path] = 'Цена должна содержать хотя бы одну цифру';
    return price;
  }
  if (/(?:^|[^а-яёa-z])(?:руб\.?|rub)(?:$|[^а-яёa-z])/i.test(price)) {
    errors[path] = 'Используйте символ \u20bd вместо «руб.» или «RUB»';
    return price;
  }
  const hasPositive = nums.some((n) => n > 0);
  if (!hasPositive && !/(?:^|\s)от(?:\s|$)/i.test(price)) {
    errors[path] = 'Нулевая цена без пометки «от» не допускается';
    return price;
  }
  return price;
}

function validateItem(
  raw: unknown,
  basePath: string,
  seenIds: Set<string>,
  errors: Record<string, string>,
): PriceItem {
  if (!isRecord(raw)) {
    errors[basePath] = 'Позиция прайса должна быть объектом';
    return { id: '', name: '', note: '', price: '' };
  }
  const id = validateId(raw.id, `${basePath}.id`, seenIds, errors);
  const name = str(raw.name);
  if (!inRange(name, PRICE_LIMITS.name)) {
    errors[`${basePath}.name`] = `Название работы: ${PRICE_LIMITS.name[0]}–${PRICE_LIMITS.name[1]} символов`;
  }
  const note = raw.note === undefined || raw.note === null ? '' : str(raw.note);
  if (!inRange(note, PRICE_LIMITS.note)) {
    errors[`${basePath}.note`] = `Примечание: до ${PRICE_LIMITS.note[1]} символов`;
  }
  const price = validatePriceValue(raw.price, `${basePath}.price`, errors);
  const out: PriceItem = { ...(raw as Record<string, unknown>), id, name, note, price };
  if (typeof raw.hidden === 'boolean') out.hidden = raw.hidden;
  return out;
}

export function validatePrices(
  value: unknown,
): { ok: true; value: PricesFile } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!isRecord(value)) {
    return { ok: false, errors: { root: 'Файл прайса должен быть объектом' } };
  }
  if (value.version !== undefined && value.version !== 1) {
    errors.version = 'Поддерживается только версия схемы 1';
  }
  const updated_at = str(value.updated_at);
  if (!isValidCalendarDate(updated_at)) {
    errors.updated_at = 'Дата обновления: реальная дата ГГГГ-ММ-ДД';
  }

  const seenIds = new Set<string>();
  const seenGroupIds = new Set<string>();
  const groups: PriceGroup[] = [];

  if (!Array.isArray(value.groups) || value.groups.length === 0) {
    errors.groups = 'Список групп прайса должен быть непустым массивом';
  } else {
    value.groups.forEach((g, gi) => {
      const gPath = `groups.${gi}`;
      if (!isRecord(g)) {
        errors[gPath] = 'Группа должна быть объектом';
        return;
      }
      const gid = str(g.id);
      if (!inRange(gid, PRICE_LIMITS.id) || !ID_RE.test(gid)) {
        errors[`${gPath}.id`] = 'Идентификатор группы: латиница, цифры и дефис';
      } else if (seenGroupIds.has(gid) || seenIds.has(gid)) {
        errors[`${gPath}.id`] = `Дублирующийся идентификатор группы «${gid}»`;
      } else {
        seenGroupIds.add(gid);
        seenIds.add(gid);
      }
      const title = str(g.title);
      if (!inRange(title, PRICE_LIMITS.title)) {
        errors[`${gPath}.title`] = `Заголовок группы: ${PRICE_LIMITS.title[0]}–${PRICE_LIMITS.title[1]} символов`;
      }
      const service = str(g.service);
      if (!inRange(service, PRICE_LIMITS.id) || !ID_RE.test(service)) {
        errors[`${gPath}.service`] = 'Слаг услуги должен быть корректным идентификатором';
      }
      const items: PriceItem[] = [];
      if (!Array.isArray(g.items)) {
        errors[`${gPath}.items`] = 'Позиции группы должны быть массивом';
      } else {
        if (g.items.length > PRICE_LIMITS.maxGroupItems) {
          errors[`${gPath}.items`] = `В группе не более ${PRICE_LIMITS.maxGroupItems} позиций`;
        }
        g.items.forEach((it, ii) => {
          items.push(validateItem(it, `${gPath}.items.${ii}`, seenIds, errors));
        });
      }
      groups.push({ ...(g as Record<string, unknown>), id: gid, title, service, items });
    });
  }

  const tyresSet: TyreSetRow[] = [];
  const tyresRepair: TyreRepairRow[] = [];
  const tyresExtra: TyreExtraRow[] = [];

  if (!isRecord(value.tyres)) {
    errors.tyres = 'Раздел шин (tyres) должен быть объектом';
  } else {
    if (!Array.isArray(value.tyres.set)) {
      errors['tyres.set'] = 'tyres.set должен быть массивом';
    } else {
      if (value.tyres.set.length > PRICE_LIMITS.maxGroupItems) {
        errors['tyres.set'] = `Не более ${PRICE_LIMITS.maxGroupItems} строк в таблице комплектов`;
      }
      value.tyres.set.forEach((r, ri) => {
        const rPath = `tyres.set.${ri}`;
        if (!isRecord(r)) {
          errors[rPath] = 'Строка комплекта должна быть объектом';
          return;
        }
        const id = validateId(r.id, `${rPath}.id`, seenIds, errors);
        const radius = str(r.radius);
        if (!inRange(radius, PRICE_LIMITS.radius)) {
          errors[`${rPath}.radius`] = `Радиус: ${PRICE_LIMITS.radius[0]}–${PRICE_LIMITS.radius[1]} символов`;
        }
        const passenger = validatePriceValue(r.passenger, `${rPath}.passenger`, errors);
        const crossover = validatePriceValue(r.crossover, `${rPath}.crossover`, errors);
        const row: TyreSetRow = { ...(r as Record<string, unknown>), id, radius, passenger, crossover };
        if (typeof r.hidden === 'boolean') row.hidden = r.hidden;
        tyresSet.push(row);
      });
    }

    if (!Array.isArray(value.tyres.repair)) {
      errors['tyres.repair'] = 'tyres.repair должен быть массивом';
    } else {
      if (value.tyres.repair.length > PRICE_LIMITS.maxGroupItems) {
        errors['tyres.repair'] = `Не более ${PRICE_LIMITS.maxGroupItems} строк в таблице ремонта колеса`;
      }
      value.tyres.repair.forEach((r, ri) => {
        const rPath = `tyres.repair.${ri}`;
        if (!isRecord(r)) {
          errors[rPath] = 'Строка ремонта должна быть объектом';
          return;
        }
        const id = validateId(r.id, `${rPath}.id`, seenIds, errors);
        const radius = str(r.radius !== undefined ? r.radius : r.range);
        if (!inRange(radius, PRICE_LIMITS.radius)) {
          errors[`${rPath}.radius`] = `Радиус: ${PRICE_LIMITS.radius[0]}–${PRICE_LIMITS.radius[1]} символов`;
        }
        const price = validatePriceValue(r.price, `${rPath}.price`, errors);
        const row: TyreRepairRow = {
          ...(r as Record<string, unknown>),
          id,
          radius,
          range: str(r.range !== undefined ? r.range : radius),
          price,
        };
        if (typeof r.hidden === 'boolean') row.hidden = r.hidden;
        tyresRepair.push(row);
      });
    }

    if (!Array.isArray(value.tyres.extra)) {
      errors['tyres.extra'] = 'tyres.extra должен быть массивом';
    } else {
      if (value.tyres.extra.length > PRICE_LIMITS.maxGroupItems) {
        errors['tyres.extra'] = `Не более ${PRICE_LIMITS.maxGroupItems} строк в дополнительных работах по шинам`;
      }
      value.tyres.extra.forEach((r, ri) => {
        tyresExtra.push(validateItem(r, `tyres.extra.${ri}`, seenIds, errors));
      });
    }
  }

  const voyah: VoyahItem[] = [];
  const voyahIds = new Set<string>();
  if (!Array.isArray(value.voyah)) {
    errors.voyah = 'Раздел voyah должен быть массивом';
  } else {
    if (value.voyah.length > PRICE_LIMITS.maxVoyahItems) {
      errors.voyah = `В разделе Voyah не более ${PRICE_LIMITS.maxVoyahItems} позиций`;
    }
    value.voyah.forEach((it, ii) => {
      const item = validateItem(it, `voyah.${ii}`, seenIds, errors);
      if (item.id) voyahIds.add(item.id);
      voyah.push(item);
    });
  }

  const featured: FeaturedChip[] = [];
  if (!Array.isArray(value.featured)) {
    errors.featured = 'Раздел featured должен быть массивом';
  } else {
    value.featured.forEach((ch, ci) => {
      const cPath = `featured.${ci}`;
      if (!isRecord(ch)) {
        errors[cPath] = 'Плашка должна быть объектом';
        return;
      }
      const id = validateId(ch.id, `${cPath}.id`, seenIds, errors);
      const ref = str(ch.ref);
      if (!ref || (!voyahIds.has(ref) && !seenIds.has(ref))) {
        errors[`${cPath}.ref`] = `Ссылка ref «${ref}» не найдена в списке позиций`;
      }
      const title = str(ch.title);
      if (!inRange(title, PRICE_LIMITS.title)) {
        errors[`${cPath}.title`] = `Заголовок плашки: ${PRICE_LIMITS.title[0]}–${PRICE_LIMITS.title[1]} символов`;
      }
      const note = ch.note === undefined || ch.note === null ? '' : str(ch.note);
      if (!inRange(note, PRICE_LIMITS.note)) {
        errors[`${cPath}.note`] = `Примечание плашки: до ${PRICE_LIMITS.note[1]} символов`;
      }
      const chip: FeaturedChip = { ...(ch as Record<string, unknown>), id, ref, title, note };
      if (typeof ch.hidden === 'boolean') chip.hidden = ch.hidden;
      featured.push(chip);
    });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      ...(value as Record<string, unknown>),
      version: 1,
      updated_at,
      groups,
      tyres: {
        ...(value.tyres as Record<string, unknown>),
        set: tyresSet,
        repair: tyresRepair,
        extra: tyresExtra,
      },
      voyah,
      featured,
    },
  };
}

function formatNumRub(n: number): string {
  const rounded = Math.round(n);
  return rounded >= 10000 ? String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : String(rounded);
}

function formatMinRub(n: number): string {
  return `от ${formatNumRub(n)} \u20bd`;
}

export function minPrice(prices: PricesFile, groupId: string): string | null {
  if (!prices || !groupId) return null;
  const priceStrings: string[] = [];

  const collectTyres = () => {
    for (const r of prices.tyres?.set ?? []) {
      if (!r.hidden) priceStrings.push(r.passenger, r.crossover);
    }
    for (const r of prices.tyres?.repair ?? []) {
      if (!r.hidden) priceStrings.push(r.price);
    }
    for (const r of prices.tyres?.extra ?? []) {
      if (!r.hidden) priceStrings.push(r.price);
    }
  };

  if (groupId === 'voyah') {
    for (const it of prices.voyah ?? []) {
      if (!it.hidden) priceStrings.push(it.price);
    }
  } else if (groupId === 'shiny' || groupId === 'tyres' || groupId === 'shinomontazh' || groupId === 'balansirovka') {
    const directGroup = (prices.groups ?? []).find((g) => g.id === groupId || g.service === groupId);
    if (directGroup) {
      for (const it of directGroup.items ?? []) {
        if (!it.hidden) priceStrings.push(it.price);
      }
    }
    collectTyres();
  } else {
    const directGroup = (prices.groups ?? []).find((g) => g.id === groupId);
    if (directGroup) {
      for (const it of directGroup.items ?? []) {
        if (!it.hidden) priceStrings.push(it.price);
      }
    } else {
      const byService = (prices.groups ?? []).filter((g) => g.service === groupId);
      if (byService.length === 0) return null;
      for (const g of byService) {
        for (const it of g.items ?? []) {
          if (!it.hidden) priceStrings.push(it.price);
        }
      }
    }
  }

  let min = Infinity;
  for (const s of priceStrings) {
    for (const n of extractPriceNumbers(s)) {
      if (n > 0 && n < min) min = n;
    }
  }

  return Number.isFinite(min) ? formatMinRub(min) : null;
}

export function priceIndexOf(prices: PricesFile): Map<string, string> {
  const map = new Map<string, string>();
  if (!prices) return map;

  for (const g of prices.groups ?? []) {
    for (const it of g.items ?? []) {
      if (it.id) map.set(it.id, it.price);
      if (it.name) {
        const alias = slugifyRu(it.name);
        if (!map.has(alias)) map.set(alias, it.price);
      }
    }
  }
  for (const r of prices.tyres?.set ?? []) {
    if (r.id) {
      map.set(r.id, r.passenger);
      map.set(`${r.id}-pass`, r.passenger);
      map.set(`${r.id}-cross`, r.crossover);
      map.set(`${r.id}a`, r.passenger);
      map.set(`${r.id}b`, r.crossover);
    }
  }
  for (const r of prices.tyres?.repair ?? []) {
    if (r.id) map.set(r.id, r.price);
    const label = r.radius || r.range;
    if (label) {
      const alias = `remont-${slugifyRu(label)}`;
      if (!map.has(alias)) map.set(alias, r.price);
    }
  }
  for (const r of prices.tyres?.extra ?? []) {
    if (r.id) map.set(r.id, r.price);
    if (r.name) {
      const alias = slugifyRu(r.name);
      if (!map.has(alias)) map.set(alias, r.price);
    }
  }
  for (const it of prices.voyah ?? []) {
    if (it.id) map.set(it.id, it.price);
    if (it.name) {
      const alias = slugifyRu(it.name);
      if (!map.has(alias)) map.set(alias, it.price);
    }
  }
  for (const ch of prices.featured ?? []) {
    if (ch.id && ch.ref && map.has(ch.ref) && !map.has(ch.id)) {
      map.set(ch.id, map.get(ch.ref)!);
    }
  }
  return map;
}

const TOKEN_RE = /\{\{(price|from|From|span|between|pair|sum|tyre):([^{}\s]+)\}\}/g;

export function fillPrices(text: string, prices: PricesFile): string {
  if (!text || !text.includes('{{')) return text ?? '';
  const idx = priceIndexOf(prices);
  return text.replace(TOKEN_RE, (full, kind: string, arg: string, offset: number, src: string) => {
    if (kind === 'price') {
      const val = idx.get(arg);
      return val !== undefined ? val : full;
    }
    if (kind === 'from' || kind === 'From') {
      const raw = idx.get(arg);
      if (raw === undefined) return full;
      const nums = extractPriceNumbers(raw).filter((n) => n > 0);
      if (nums.length === 0) return full;
      const min = Math.min(...nums);
      const before = src.slice(Math.max(0, offset - 4), offset);
      const cap = kind === 'From' || /[.!?]\s+$/.test(before);
      return `${cap ? 'От' : 'от'} ${formatNumRub(min)} \u20bd`;
    }
    if (kind === 'span' || kind === 'between' || kind === 'pair') {
      const parts = arg.split('..');
      if (parts.length !== 2 || !parts[0] || !parts[1]) return full;
      const rawA = idx.get(parts[0]);
      const rawB = idx.get(parts[1]);
      if (rawA === undefined || rawB === undefined) return full;
      const numsA = extractPriceNumbers(rawA).filter((n) => n > 0);
      const numsB = extractPriceNumbers(rawB).filter((n) => n > 0);
      if (numsA.length === 0 || numsB.length === 0) return full;
      const a = Math.min(...numsA);
      const b = Math.max(...numsB);
      if (kind === 'between') return `от ${formatNumRub(a)} до ${formatNumRub(b)} \u20bd`;
      if (kind === 'pair') return `${formatNumRub(a)} и ${formatNumRub(b)} \u20bd`;
      return `${formatNumRub(a)}–${formatNumRub(b)} \u20bd`;
    }
    if (kind === 'sum') {
      const parts = arg.split('+');
      if (parts.length < 2 || parts.some((p) => !p)) return full;
      let total = 0;
      for (const p of parts) {
        const raw = idx.get(p);
        if (raw === undefined) return full;
        const nums = extractPriceNumbers(raw).filter((n) => n > 0);
        if (nums.length === 0) return full;
        total += Math.min(...nums);
      }
      return `${formatNumRub(total)} \u20bd`;
    }
    if (kind === 'tyre') {
      const rawPass = idx.get(`${arg}-pass`);
      const rawCross = idx.get(`${arg}-cross`);
      if (rawPass === undefined || rawCross === undefined) return full;
      const numsA = extractPriceNumbers(rawPass).filter((n) => n > 0);
      const numsB = extractPriceNumbers(rawCross).filter((n) => n > 0);
      if (numsA.length === 0 || numsB.length === 0) return full;
      const a = Math.min(...numsA);
      const b = Math.max(...numsB);
      return `${formatNumRub(a)}–${formatNumRub(b)} \u20bd`;
    }
    return full;
  });
}

export function missingPriceRefs(text: string, prices: PricesFile): string[] {
  if (!text || !text.includes('{{')) return [];
  const idx = priceIndexOf(prices);
  const missing: string[] = [];
  const addMissing = (id: string) => {
    if (!missing.includes(id)) missing.push(id);
  };
  for (const m of text.matchAll(TOKEN_RE)) {
    const kind = m[1];
    const arg = m[2];
    if (kind === 'price' || kind === 'from' || kind === 'From') {
      if (!idx.has(arg)) addMissing(arg);
    } else if (kind === 'span' || kind === 'between' || kind === 'pair') {
      const parts = arg.split('..');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        addMissing(arg);
      } else {
        if (!idx.has(parts[0])) addMissing(parts[0]);
        if (!idx.has(parts[1])) addMissing(parts[1]);
      }
    } else if (kind === 'sum') {
      const parts = arg.split('+');
      if (parts.length < 2 || parts.some((p) => !p)) {
        addMissing(arg);
      } else {
        for (const p of parts) {
          if (!idx.has(p)) addMissing(p);
        }
      }
    } else if (kind === 'tyre') {
      if (!idx.has(`${arg}-pass`) || !idx.has(`${arg}-cross`)) addMissing(arg);
    }
  }
  return missing;
}
