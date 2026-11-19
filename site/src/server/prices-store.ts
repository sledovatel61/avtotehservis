import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  type PricesFile,
  type PriceKind,
  type AnyPriceItem,
  type PriceItemPatch,
  validatePrices,
  fillPrices,
  minPrice,
  missingPriceRefs,
  priceIndexOf,
  slugifyRu,
  PRICE_LIMITS,
  TOKEN_RE,
  findPriceItem as schemaFindPriceItem,
  removePriceItem as schemaRemovePriceItem,
  renamePriceItem as schemaRenamePriceItem,
} from '../shared/prices-schema.ts';

export {
  type PricesFile,
  type PriceKind,
  type AnyPriceItem,
  type PriceItemPatch,
  validatePrices,
  fillPrices,
  minPrice,
  missingPriceRefs,
  priceIndexOf,
  slugifyRu,
  PRICE_LIMITS,
  TOKEN_RE,
};

export function pricesFilePath(): string {
  const custom = process.env.PRICES_FILE?.trim();
  if (custom) return resolve(custom);
  const direct = resolve(process.cwd(), 'content/prices.json');
  if (existsSync(direct)) return direct;
  const nested = resolve(process.cwd(), 'site/content/prices.json');
  if (existsSync(nested)) return nested;
  return direct;
}

let cachedPath = '';
let cachedMtime = -1;
let cachedSize = -1;
let cachedFile: PricesFile | null = null;

export function clearPricesCache(): void {
  cachedPath = '';
  cachedMtime = -1;
  cachedSize = -1;
  cachedFile = null;
}

export function getPrices(): PricesFile {
  const path = pricesFilePath();
  if (!existsSync(path)) {
    throw new Error(`Файл прайса не найден: ${path}`);
  }
  const st = statSync(path);
  if (cachedFile && cachedPath === path && cachedMtime === st.mtimeMs && cachedSize === st.size) {
    return cachedFile;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `Ошибка разбора JSON в файле прайса (${path}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const checked = validatePrices(parsed);
  if (!checked.ok) {
    const details = Object.entries(checked.errors)
      .map(([k, v]) => `${k} (${v})`)
      .join('; ');
    throw new Error(`Некорректный файл прайса (${path}): ${details}`);
  }
  cachedPath = path;
  cachedMtime = st.mtimeMs;
  cachedSize = st.size;
  cachedFile = checked.value;
  return cachedFile;
}

export const readPricesFile = getPrices;

export function writePricesFile(next: PricesFile): PricesFile {
  const checked = validatePrices(next);
  if (!checked.ok) {
    const first = Object.values(checked.errors)[0] ?? 'Некорректные данные прайса';
    const err = new Error(first) as Error & { errors?: Record<string, string> };
    err.errors = checked.errors;
    throw err;
  }
  const path = pricesFilePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(checked.value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  const st = statSync(path);
  cachedPath = path;
  cachedMtime = st.mtimeMs;
  cachedSize = st.size;
  cachedFile = checked.value;
  return checked.value;
}

export function findPriceItem(kind: PriceKind, catId: string, id: string): AnyPriceItem | undefined;
export function findPriceItem(
  prices: PricesFile,
  kind: PriceKind,
  catId: string,
  id: string,
): AnyPriceItem | undefined;
export function findPriceItem(
  a: PricesFile | PriceKind,
  b: PriceKind | string,
  c: string,
  d?: string,
): AnyPriceItem | undefined {
  if (typeof a === 'string') {
    return schemaFindPriceItem(getPrices(), a, b as string, c);
  }
  return schemaFindPriceItem(a, b as PriceKind, c, d ?? '');
}

export function removePriceItem(kind: PriceKind, catId: string, id: string): PricesFile {
  const current = getPrices();
  const res = schemaRemovePriceItem(current, kind, catId, id);
  if (!res.ok) {
    const err = new Error(res.errors.join('; ')) as Error & { errors?: string[] };
    err.errors = res.errors;
    throw err;
  }
  return writePricesFile(res.value);
}

export function renamePriceItem(
  kind: PriceKind,
  catId: string,
  id: string,
  patch: PriceItemPatch,
): PricesFile {
  const current = getPrices();
  const res = schemaRenamePriceItem(current, kind, catId, id, patch);
  if (!res.ok) {
    const err = new Error(res.errors.join('; ')) as Error & { errors?: string[] };
    err.errors = res.errors;
    throw err;
  }
  return writePricesFile(res.value);
}
