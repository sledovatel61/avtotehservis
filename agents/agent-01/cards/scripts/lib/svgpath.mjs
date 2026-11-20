/* Мини-парсер SVG-пути → команды PDF. Поддерживает ровно то, что пишет наш
   генератор: M L H V C Q A Z в абсолютной и относительной форме. */
export function parsePath(d) {
  const toks = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const out = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  const num = () => parseFloat(toks[i++]);
  const isCmd = (t) => /^[A-Za-z]$/.test(t);
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') {
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      out.push(['M', x, y]); cx = sx = x; cy = sy = y; cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      out.push(['L', x, y]); cx = x; cy = y;
    } else if (C === 'H') {
      const x = num() + (rel ? cx : 0); out.push(['L', x, cy]); cx = x;
    } else if (C === 'V') {
      const y = num() + (rel ? cy : 0); out.push(['L', cx, y]); cy = y;
    } else if (C === 'C') {
      const a = [num(), num(), num(), num(), num(), num()];
      if (rel) for (let k = 0; k < 6; k += 2) { a[k] += cx; a[k + 1] += cy; }
      out.push(['C', ...a]); cx = a[4]; cy = a[5];
    } else if (C === 'Q') {
      const a = [num(), num(), num(), num()];
      if (rel) for (let k = 0; k < 4; k += 2) { a[k] += cx; a[k + 1] += cy; }
      out.push(['Q', ...a]); cx = a[2]; cy = a[3];
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      let x = num(), y = num();
      if (rel) { x += cx; y += cy; }
      out.push(['A', rx, ry, rot, large, sweep, x, y]); cx = x; cy = y;
    } else if (C === 'Z') {
      out.push(['Z']); cx = sx; cy = sy;
    } else {
      i++; // неизвестная команда — пропускаем
    }
  }
  return out;
}
