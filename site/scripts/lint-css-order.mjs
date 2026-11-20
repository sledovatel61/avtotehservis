/**
 * Линтер порядка CSS (M2, раунд 9).
 *
 * Класс дефекта: внутри одного файла @media-блок стоит ВЫШЕ базового правила
 * того же селектора. При равной специфичности побеждает то, что ниже, — базовое
 * правило перебивает медиа-переопределение (именно так «пропали» бургер и меню
 * в раунде 8). Правило: для каждого селектора внутри @media в файле
 * src/styles/*.css не должно существовать базового правила с тем же селектором
 * НИЖЕ этого @media-блока в том же файле.
 *
 * Использование: node scripts/lint-css-order.mjs [файлы.css ...]
 * Без аргументов проверяет все src/styles/*.css. Выход 1 при нарушениях.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Замена комментариев пробелами с сохранением номеров строк. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const norm = (sel) => sel.replace(/\s+/g, ' ').trim();

/**
 * Разбор одного уровня: возвращает правила [{selector, line, body, atRule?}].
 * `pos` — смещение в тексте; парсер идёт до конца строки или до закрывающей }.
 */
function parseRules(css, start, end, baseLine) {
  const rules = [];
  let i = start;
  let selStart = i;
  while (i < end) {
    const c = css[i];
    if (c === '{') {
      const selector = norm(css.slice(selStart, i));
      const line = baseLine + css.slice(0, i).split('\n').length - 1;
      // найти парную }
      let depth = 1;
      let j = i + 1;
      while (j < end && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      rules.push({ selector, line, bodyStart: i + 1, bodyEnd: j - 1 });
      i = j;
      selStart = j;
    } else if (c === ';') {
      // at-rule без тела (@import и т.п.)
      i += 1;
      selStart = i;
    } else {
      i += 1;
    }
  }
  return rules;
}

/**
 * Проверить один файл. Возвращает список нарушений:
 * {file, selector, mediaLine, baseLine}
 */
export function lintCssFile(file) {
  const css = stripComments(readFileSync(file, 'utf8'));
  const violations = [];
  const top = parseRules(css, 0, css.length, 1);

  // базовые (не at-) правила: селектор → список строк
  const baseLines = new Map();
  for (const r of top) {
    if (r.selector.startsWith('@')) continue;
    for (const sel of r.selector.split(',')) {
      const s = norm(sel);
      if (!baseLines.has(s)) baseLines.set(s, []);
      baseLines.get(s).push(r.line);
    }
  }

  for (const r of top) {
    // интересуют только @media (вложенность @supports/@layer не используется)
    if (!r.selector.startsWith('@media')) continue;
    // prefers-reduced-motion пропускаем: там !important, порядок не влияет на каскад ширин
    if (r.selector.includes('prefers-reduced-motion')) continue;
    const inner = parseRules(css, r.bodyStart, r.bodyEnd, 1);
    for (const ir of inner) {
      if (ir.selector.startsWith('@')) continue;
      for (const sel of ir.selector.split(',')) {
        const s = norm(sel);
        const bases = baseLines.get(s);
        if (!bases) continue;
        for (const bl of bases) {
          if (bl > r.line) {
            violations.push({ file, selector: s, mediaLine: r.line, baseLine: bl });
          }
        }
      }
    }
  }
  return violations;
}

export function lintStylesDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
  return files.flatMap((f) => lintCssFile(resolve(dir, f)));
}

// CLI-режим
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const files = args.length
    ? args.map((a) => resolve(a))
    : readdirSync(join(HERE, '..', 'src', 'styles'))
        .filter((f) => f.endsWith('.css'))
        .map((f) => join(HERE, '..', 'src', 'styles', f));
  const violations = files.flatMap((f) => lintCssFile(f));
  if (violations.length === 0) {
    console.log(`lint-css-order: OK, ${files.length} файлов, нарушений порядка нет`);
  } else {
    for (const v of violations) {
      console.error(
        `lint-css-order: ${v.file}: селектор «${v.selector}» — @media на строке ${v.mediaLine}, ` +
          `но базовое правило ниже, на строке ${v.baseLine} (базовое перебивает медиа)`,
      );
    }
    console.error(`lint-css-order: FAIL, нарушений: ${violations.length}`);
    process.exit(1);
  }
}
