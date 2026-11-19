import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOKEN_RE,
  priceIndexOf,
  slugifyRu,
  validatePrices,
} from '../../src/shared/prices-schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SITE_ROOT = resolve(HERE, '../..');

const SRC_EXT_RE = /\.(?:astro|ts|tsx|js|md|mdx)$/i;
const CONTENT_EXT_RE = /\.(?:json|md)$/i;
const ANY_SUPPORTED_EXT_RE = /\.(?:astro|ts|tsx|js|md|mdx|json)$/i;

export function isAdminPath(relPath) {
  const norm = String(relPath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^site\//, '');
  return (
    norm.startsWith('src/pages/admin/') ||
    norm === 'src/pages/admin' ||
    norm.startsWith('src/client/admin') ||
    norm.startsWith('public/manage/') ||
    norm === 'public/manage' ||
    norm === 'src/server/prices-admin-store.ts'
  );
}

function matchesExclude(relPath, absPath, exclude) {
  if (!exclude) return false;
  if (typeof exclude === 'function') return Boolean(exclude(relPath, absPath));
  if (exclude instanceof RegExp) return exclude.test(relPath) || exclude.test(absPath);
  if (typeof exclude === 'string') {
    const normEx = exclude.replace(/\\/g, '/').replace(/^\/+/, '');
    return relPath === normEx || relPath.startsWith(`${normEx}/`) || absPath === exclude;
  }
  if (Array.isArray(exclude) || exclude instanceof Set) {
    for (const item of exclude) {
      if (matchesExclude(relPath, absPath, item)) return true;
    }
  }
  return false;
}

function walkDir(dir) {
  if (!existsSync(dir)) return [];
  const st = statSync(dir);
  if (st.isFile()) return [dir];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

export function buildOwnerMap(prices) {
  const idx = priceIndexOf(prices);
  const ownerMap = new Map();
  if (!prices) return ownerMap;

  for (const g of prices.groups ?? []) {
    for (const it of g.items ?? []) {
      if (it.id && idx.has(it.id)) {
        ownerMap.set(it.id, { id: it.id, matched: 'id' });
      }
      if (it.name && it.id) {
        const alias = slugifyRu(it.name);
        if (!ownerMap.has(alias) && idx.has(alias)) {
          ownerMap.set(alias, { id: it.id, matched: 'alias' });
        }
      }
    }
  }
  for (const r of prices.tyres?.set ?? []) {
    if (r.id) {
      ownerMap.set(r.id, { id: r.id, matched: 'id' });
      ownerMap.set(`${r.id}-pass`, { id: r.id, matched: 'id' });
      ownerMap.set(`${r.id}-cross`, { id: r.id, matched: 'id' });
      ownerMap.set(`${r.id}a`, { id: r.id, matched: 'id' });
      ownerMap.set(`${r.id}b`, { id: r.id, matched: 'id' });
    }
  }
  for (const r of prices.tyres?.repair ?? []) {
    if (r.id && idx.has(r.id)) {
      ownerMap.set(r.id, { id: r.id, matched: 'id' });
    }
    const label = r.radius || r.range;
    if (label && r.id) {
      const alias = `remont-${slugifyRu(label)}`;
      if (!ownerMap.has(alias) && idx.has(alias)) {
        ownerMap.set(alias, { id: r.id, matched: 'alias' });
      }
    }
  }
  for (const r of prices.tyres?.extra ?? []) {
    if (r.id && idx.has(r.id)) {
      ownerMap.set(r.id, { id: r.id, matched: 'id' });
    }
    if (r.name && r.id) {
      const alias = slugifyRu(r.name);
      if (!ownerMap.has(alias) && idx.has(alias)) {
        ownerMap.set(alias, { id: r.id, matched: 'alias' });
      }
    }
  }
  for (const it of prices.voyah ?? []) {
    if (it.id && idx.has(it.id)) {
      ownerMap.set(it.id, { id: it.id, matched: 'id' });
    }
    if (it.name && it.id) {
      const alias = slugifyRu(it.name);
      if (!ownerMap.has(alias) && idx.has(alias)) {
        ownerMap.set(alias, { id: it.id, matched: 'alias' });
      }
    }
  }
  for (const ch of prices.featured ?? []) {
    if (ch.id && ch.ref && ownerMap.has(ch.ref) && !ownerMap.has(ch.id)) {
      ownerMap.set(ch.id, { id: ownerMap.get(ch.ref).id, matched: 'id' });
    }
  }
  return ownerMap;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function keysFromToken(kind, arg) {
  if (kind === 'price' || kind === 'from' || kind === 'From') return [arg];
  if (kind === 'span' || kind === 'between' || kind === 'pair') {
    const parts = arg.split('..');
    return parts.length === 2 && parts[0] && parts[1] ? parts : [];
  }
  if (kind === 'sum') {
    const parts = arg.split('+');
    return parts.length >= 2 && parts.every(Boolean) ? parts : [];
  }
  if (kind === 'tyre') return [arg];
  return [];
}

export function collectPriceRefs(prices, options = {}) {
  const siteRoot = options.siteRoot ? resolve(options.siteRoot) : DEFAULT_SITE_ROOT;
  const exclude = options.exclude;
  const ownerMap = buildOwnerMap(prices);

  const fileEntries = [];

  if (options.files) {
    if (Array.isArray(options.files)) {
      for (const f of options.files) {
        const rel = String(f.file ?? f.path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
        const text = String(f.content ?? f.text ?? '');
        if (!rel || rel === 'content/prices.json' || isAdminPath(rel)) continue;
        if (matchesExclude(rel, rel, exclude)) continue;
        fileEntries.push({ rel, text });
      }
    } else if (typeof options.files === 'object') {
      for (const [k, v] of Object.entries(options.files)) {
        const rel = String(k).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || rel === 'content/prices.json' || isAdminPath(rel)) continue;
        if (matchesExclude(rel, rel, exclude)) continue;
        fileEntries.push({ rel, text: String(v ?? '') });
      }
    }
  } else {
    const rawRoots =
      Array.isArray(options.roots) && options.roots.length > 0
        ? options.roots
        : [join(siteRoot, 'src'), join(siteRoot, 'content')];

    const customBase =
      !options.siteRoot &&
      Array.isArray(options.roots) &&
      options.roots.length === 1 &&
      typeof options.roots[0] === 'string' &&
      existsSync(resolve(options.roots[0])) &&
      statSync(resolve(options.roots[0])).isDirectory() &&
      !resolve(options.roots[0]).startsWith(DEFAULT_SITE_ROOT)
        ? resolve(options.roots[0])
        : siteRoot;

    const seenAbs = new Set();
    for (const r of rawRoots) {
      if (r && typeof r === 'object' && ('file' in r || 'path' in r)) {
        const rel = String(r.file ?? r.path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
        const text = String(r.content ?? r.text ?? '');
        if (!rel || rel === 'content/prices.json' || isAdminPath(rel)) continue;
        if (matchesExclude(rel, rel, exclude)) continue;
        fileEntries.push({ rel, text });
        continue;
      }
      const absRoot = resolve(siteRoot, String(r));
      for (const absFile of walkDir(absRoot)) {
        if (seenAbs.has(absFile)) continue;
        seenAbs.add(absFile);
        let rel = relative(customBase, absFile).replace(/\\/g, '/');
        if (rel.startsWith('..')) {
          rel = relative(siteRoot, absFile).replace(/\\/g, '/');
        }
        if (rel === 'content/prices.json' || rel.endsWith('/content/prices.json')) continue;
        if (isAdminPath(rel)) continue;
        if (matchesExclude(rel, absFile, exclude)) continue;

        if (rel.startsWith('src/')) {
          if (!SRC_EXT_RE.test(rel)) continue;
        } else if (rel.startsWith('content/')) {
          if (!CONTENT_EXT_RE.test(rel)) continue;
        } else {
          if (!ANY_SUPPORTED_EXT_RE.test(rel)) continue;
        }
        fileEntries.push({ rel, text: readFileSync(absFile, 'utf8') });
      }
    }
  }

  /** @type {Record<string, Array<{ file: string; line: number; token: string; matched: 'id' | 'alias' }>>} */
  const refs = {};
  const tokenRe = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);

  for (const { rel, text } of fileEntries) {
    if (!text.includes('{{')) continue;
    for (const match of text.matchAll(tokenRe)) {
      const token = match[0];
      const kind = match[1];
      const arg = match[2];
      const line = lineNumberAt(text, match.index ?? 0);
      const keys = keysFromToken(kind, arg);

      for (const key of keys) {
        const resolved =
          ownerMap.get(key) ??
          (kind === 'tyre' ? ownerMap.get(`${key}-pass`) : undefined);
        if (!resolved) continue;
        const list = (refs[resolved.id] ??= []);
        const dup = list.some(
          (entry) =>
            entry.file === rel &&
            entry.line === line &&
            entry.token === token &&
            entry.matched === resolved.matched,
        );
        if (!dup) {
          list.push({
            file: rel,
            line,
            token,
            matched: resolved.matched,
          });
        }
      }
    }
  }

  /** @type {Record<string, string[]>} */
  const featured = {};
  for (const ch of prices?.featured ?? []) {
    if (ch && typeof ch === 'object' && ch.ref && ch.id) {
      const refId = String(ch.ref).trim();
      const chipId = String(ch.id).trim();
      if (refId && chipId) {
        (featured[refId] ??= []).push(chipId);
      }
    }
  }

  const updatedAt = String(prices?.updated_at || new Date().toISOString().slice(0, 10));
  return {
    generated_at: updatedAt,
    prices_updated_at: String(prices?.updated_at || ''),
    refs,
    featured,
  };
}

/**
 * @param {{ siteRoot?: string }} [options]
 */
export async function buildPriceRefs(options = {}) {
  const siteRoot = options.siteRoot ?? DEFAULT_SITE_ROOT;
  const root = resolve(siteRoot);
  const pricesPath = join(root, 'content/prices.json');
  const raw = JSON.parse(readFileSync(pricesPath, 'utf8'));
  const checked = validatePrices(raw);
  const prices = checked.ok ? checked.value : raw;
  return collectPriceRefs(prices, { siteRoot: root });
}

/**
 * @param {{ siteRoot?: string; outFile?: string }} [options]
 */
export async function writePriceRefs(options = {}) {
  const siteRoot = options.siteRoot ?? DEFAULT_SITE_ROOT;
  const outFile = options.outFile;
  const root = resolve(siteRoot);
  const target = outFile ? resolve(outFile) : join(root, 'public/manage/price-refs.json');
  const data = await buildPriceRefs({ siteRoot: root });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}
