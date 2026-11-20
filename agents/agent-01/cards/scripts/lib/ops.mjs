/* Список операций карточки. Один и тот же список уходит в SVG (вектор) и в PNG.
   Координаты — миллиметры от верхнего левого угла холста 96×56 (y вниз). */
import { toPathD } from './text.mjs';

const style = (o = {}) => ({
  fill: o.fill ?? 'none',
  stroke: o.stroke ?? 'none',
  sw: o.sw ?? 0,
  dash: o.dash ?? null,
  opacity: o.opacity ?? 1,
  transform: o.transform ?? null,
  fillOpacity: o.fill == null || o.fill === 'none' ? 0 : (o.fillOpacity ?? 1),
  strokeOpacity: o.stroke === 'none' || o.stroke == null ? 0 : (o.strokeOpacity ?? 1),
});

export const ops = {
  rect(x, y, w, h, o = {}) { return { t: 'rect', x, y, w, h, rx: o.rx ?? 0, ...style(o) }; },
  circle(cx, cy, r, o = {}) { return { t: 'circle', cx, cy, r, ...style(o) }; },
  line(x1, y1, x2, y2, o = {}) { return { t: 'path', d: `M${num(x1)} ${num(y1)}L${num(x2)} ${num(y2)}`, ...style(o) }; },
  poly(points, o = {}) { return { t: 'path', d: 'M' + points.map((p) => p.map(num).join(' ')).join('L') + 'Z', ...style(o) }; },
  path(cmds, o = {}) { return { t: 'path', d: toPathD(cmds), ...style(o) }; },
  raw(d, o = {}) { return { t: 'path', d, ...style(o) }; },
  image(o) { return { t: 'image', ...o }; }, // {href, x, y, w, h}
  group(children, o = {}) {
    return { t: 'g', children: children.map((c) => ({
      fill: 'none', stroke: 'none', sw: 0, dash: null, transform: null,
      ...c, fillOpacity: c.fillOpacity ?? (c.fill && c.fill !== 'none' ? 1 : 0), strokeOpacity: c.strokeOpacity ?? (c.stroke && c.stroke !== 'none' ? 1 : 0), opacity: c.opacity ?? 1,
    })), ...style(o) };
  },
  /* Узоры — отдельным слоем в <defs>, на операцию они не влияют. */
  pattern(o) { return { t: 'pattern', ...o }; },
};

const num = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function svgDoc({ w, h, ops: list, defs = [], rawGroups = [], title, desc }) {
  const body = list.map((o) => svgEl(o)).join('\n');
  const raw = rawGroups.map((g) => `<g transform="translate(${num(g.x)} ${num(g.y)}) scale(${num(g.scale)})"${g.opacity != null && g.opacity < 1 ? ` opacity="${num(g.opacity)}"` : ''}>${g.inner}</g>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<desc>${esc(desc)}</desc>
<defs>
${defs.map(svgDef).join('\n')}
</defs>
${body}
${raw}
</svg>
`;
}
function svgDef(d) {
  if (d.t === 'pattern') return `<pattern id="${d.id}" width="${num(d.w)}" height="${num(d.h)}" patternUnits="${d.units ?? 'userSpaceOnUse'}"${d.transform ? ` patternTransform="${d.transform}"` : ''}>${d.children.map(svgEl).join('')}</pattern>`;
  if (d.t === 'grad') return `<linearGradient id="${d.id}" x1="0" y1="0" x2="${d.x2 ?? 1}" y2="${d.y2 ?? 1}">${d.stops.map(([off, col, op]) => `<stop offset="${off}" stop-color="${col}"${op != null ? ` stop-opacity="${op}"` : ''}/>`).join('')}</linearGradient>`;
  throw new Error('неизвестное определение ' + d.t);
}
function svgEl(o) {
  const tr = o.transform ? ` transform="${o.transform}"` : '';
  if (o.t === 'g') return `<g ${attrStyle(o)}${tr}>${o.children.map(svgEl).join('')}</g>`;
  if (o.t === 'rect') return `<rect x="${num(o.x)}" y="${num(o.y)}" width="${num(o.w)}" height="${num(o.h)}"${o.rx ? ` rx="${num(o.rx)}"` : ''} ${attrStyle(o)}${tr}/>`;
  if (o.t === 'circle') return `<circle cx="${num(o.cx)}" cy="${num(o.cy)}" r="${num(o.r)}" ${attrStyle(o)}${tr}/>`;
  if (o.t === 'path') return `<path d="${o.d}" ${attrStyle(o)}${tr}/>`;
  if (o.t === 'image') return `<image href="${o.href}" x="${num(o.x)}" y="${num(o.y)}" width="${num(o.w)}" height="${num(o.h)}" preserveAspectRatio="none"${tr}/>`;
  throw new Error('неизвестная операция ' + o.t);
}
function attrStyle(o) {
  let a = `fill="${o.fill}"`;
  if (o.stroke && o.stroke !== 'none') {
    a += ` stroke="${o.stroke}" stroke-width="${num(o.sw)}" stroke-linecap="round" stroke-linejoin="round"`;
    if (o.dash) a += ` stroke-dasharray="${o.dash}"`;
  }
  if (o.opacity != null && o.opacity < 1) a += ` opacity="${num(o.opacity)}"`;
  if (o.fill && o.fill !== 'none' && o.fillOpacity != null && o.fillOpacity < 1) a += ` fill-opacity="${num(o.fillOpacity)}"`;
  if (o.stroke && o.stroke !== 'none' && o.strokeOpacity != null && o.strokeOpacity < 1) a += ` stroke-opacity="${num(o.strokeOpacity)}"`;
  return a;
}
