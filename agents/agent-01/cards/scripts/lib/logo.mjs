/* Знак сайта site/public/img/logo.svg — только масштаб и цвет, пропорции не меняем.
   Здесь он пересобран как набор операций, чтобы попасть и в SVG (плоско, без
   градиентов — для печати), и в PNG тем же кодом. Геометрия 1:1 с logo.svg:
   viewBox 72×44, все числа взяты из файла сайта. */
import { ops } from './ops.mjs';

export const LOGO_VB = { w: 72, h: 44 };

function grad(id, stops) {
  const s = stops.map(([off, col]) => `<stop offset="${off}" stop-color="${col}"/>`).join('');
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${s}</linearGradient>`;
}

/* Внутренности logo.svg (без обёртки <svg>) — для SVG-ветки: градиенты как на сайте. */
export function logoSvgInner() {
  return `<defs>
${grad('shield', [[0, '#142720'], ['.55', '#0E1B16'], [1, '#0A120E']])}
${grad('brass', [[0, '#F2C994'], ['.5', '#E0A96D'], [1, '#C87F45']])}
${grad('body', [[0, '#F8F5EE'], ['.58', '#E6E8E1'], [1, '#C7D3CC']])}
${grad('rim', [[0, '#F2C994'], [1, '#C87F45']])}
</defs>
<rect x="1" y="1" width="70" height="42" rx="11" fill="url(#shield)" stroke="url(#brass)" stroke-width="1.65"/>
<rect x="3" y="3" width="66" height="38" rx="9.2" fill="none" stroke="#E0A96D" stroke-opacity=".24" stroke-width=".65"/>
<path fill="url(#body)" d="M 6.2 29.8 L 9.6 28.5 L 7.8 26.8 C 10.6 24.4, 15.2 22.1, 20.8 20.3 C 26.6 16.5, 33.4 14.9, 41.2 15.1 C 47.6 15.3, 53.4 17.0, 58.2 19.3 L 64.6 16.4 L 62.6 20.3 L 64.4 21.1 L 63.8 23.6 L 65.5 24.1 L 63.4 28.0 L 65.1 27.6 L 62.4 29.8 L 58.3 29.8 A 6.6 6.6 0 0 0 45.1 29.8 L 26.1 29.8 A 6.5 6.5 0 0 0 13.1 29.8 Z"/>
<path d="M12.5 28.6 A 7.1 7.1 0 0 1 26.7 28.6" fill="none" stroke="#0E1B16" stroke-width=".65" stroke-opacity=".55"/>
<path d="M44.5 28.6 A 7.2 7.2 0 0 1 58.9 28.6" fill="none" stroke="#0E1B16" stroke-width=".65" stroke-opacity=".55"/>
<path fill="#0D1914" d="M 23.2 20.1 C 28.2 17.1, 34.4 16.0, 41.2 16.3 C 45.2 16.5, 48.8 17.4, 51.4 18.7 L 45.4 20.8 L 25.0 20.9 Z"/>
<line x1="36.2" y1="16.1" x2="33.8" y2="21.0" stroke="url(#body)" stroke-width="1.25"/>
<path fill="#0D1914" d="M 41.4 22.0 L 45.8 19.6 L 43.4 26.9 L 39.8 26.9 Z"/>
<path d="M 26.8 23.2 L 41.4 22.0 M 27.6 26.9 L 43.2 26.9 L 45.8 19.6" fill="none" stroke="#0D1914" stroke-width=".85" stroke-opacity=".75" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M 28.0 28.4 L 43.6 28.4" fill="none" stroke="#0D1914" stroke-width=".7" stroke-opacity=".55" stroke-linecap="round"/>
<polygon points="8.6,27.0 12.2,26.4 10.6,28.7" fill="#0D1914"/>
<g>
<circle cx="19.6" cy="29.4" r="5.5" fill="#0A120E"/>
<circle cx="19.6" cy="29.4" r="4.25" fill="none" stroke="url(#rim)" stroke-width="1.05"/>
<circle cx="19.6" cy="29.4" r="3.45" fill="#12221B"/>
<g stroke="url(#rim)" stroke-width="1.05" stroke-linecap="round">
<line x1="19.6" y1="29.4" x2="19.6" y2="25.5"/><line x1="19.6" y1="29.4" x2="23.3" y2="28.2"/><line x1="19.6" y1="29.4" x2="21.9" y2="32.55"/>
<line x1="19.6" y1="29.4" x2="17.3" y2="32.55"/><line x1="19.6" y1="29.4" x2="15.9" y2="28.2"/>
</g>
<circle cx="19.6" cy="29.4" r="1.15" fill="url(#rim)"/>
<circle cx="51.7" cy="29.4" r="5.6" fill="#0A120E"/>
<circle cx="51.7" cy="29.4" r="4.35" fill="none" stroke="url(#rim)" stroke-width="1.05"/>
<circle cx="51.7" cy="29.4" r="3.55" fill="#12221B"/>
<g stroke="url(#rim)" stroke-width="1.05" stroke-linecap="round">
<line x1="51.7" y1="29.4" x2="51.7" y2="25.4"/><line x1="51.7" y1="29.4" x2="55.5" y2="28.15"/><line x1="51.7" y1="29.4" x2="54.05" y2="32.6"/>
<line x1="51.7" y1="29.4" x2="49.35" y2="32.6"/><line x1="51.7" y1="29.4" x2="47.9" y2="28.15"/>
</g>
<circle cx="51.7" cy="29.4" r="1.15" fill="url(#rim)"/>
</g>
<path d="M 9.5 36.8 C 24 37.6, 48 37.6, 62.5 36.8" fill="none" stroke="url(#brass)" stroke-width=".95" stroke-linecap="round" stroke-opacity=".68"/>`;
}

/* Тот же знак плоскими цветами (для растра и для варианта «в одну краску»).
   mode: 'full' — цвета сайта; 'mono' — один цвет тоном (для светлых сторон). */
export function logoOps({ x = 0, y = 0, scale = 0.5, mode = 'full', mono = '#0B1410' }) {
  const P = (px, py) => [x + px * scale, y + py * scale];
  const W = (v) => v * scale;
  const out = [];
  const ink = mode === 'full' ? '#0A120E' : mono;
  out.push(ops.rect(x + W(1), y + W(1), W(70), W(42), { rx: W(11), fill: mode === 'full' ? '#101E18' : 'none', stroke: mode === 'full' ? '#E0A96D' : mono, sw: W(1.65) }));
  if (mode === 'full') {
    out.push(ops.rect(x + W(3), y + W(3), W(66), W(38), { rx: W(9.2), stroke: '#E0A96D', strokeOpacity: 0.24, sw: W(0.65) }));
    // кузов: градиент #F8F5EE→#C7D3CC заменён плоским тёплым светом (без градиентов в печати)
    out.push(ops.raw('M 6.2 29.8 L 9.6 28.5 L 7.8 26.8 C 10.6 24.4 15.2 22.1 20.8 20.3 C 26.6 16.5 33.4 14.9 41.2 15.1 C 47.6 15.3 53.4 17 58.2 19.3 L 64.6 16.4 L 62.6 20.3 L 64.4 21.1 L 63.8 23.6 L 65.5 24.1 L 63.4 28 L 65.1 27.6 L 62.4 29.8 L 58.3 29.8 A 6.6 6.6 0 0 0 45.1 29.8 L 26.1 29.8 A 6.5 6.5 0 0 0 13.1 29.8 Z', { fill: '#EFEDE4' }));
    out.push(ops.raw('M 23.2 20.1 C 28.2 17.1 34.4 16 41.2 16.3 C 45.2 16.5 48.8 17.4 51.4 18.7 L 45.4 20.8 L 25 20.9 Z', { fill: '#0D1914' }));
    out.push(ops.raw('M 41.4 22 L 45.8 19.6 L 43.4 26.9 L 39.8 26.9 Z', { fill: '#0D1914' }));
    out.push(ops.raw('M 26.8 23.2 L 41.4 22 M 27.6 26.9 L 43.2 26.9 L 45.8 19.6 M 28 28.4 L 43.6 28.4 M 12.5 28.6 A 7.1 7.1 0 0 1 26.7 28.6 M 44.5 28.6 A 7.2 7.2 0 0 1 58.9 28.6', { stroke: '#0D1914', sw: W(0.8), strokeOpacity: 0.6 }));
    out.push(ops.raw('M 36.2 16.1 L 33.8 21', { stroke: '#EFEDE4', sw: W(1.25) }));
    out.push(ops.poly([[8.6, 27], [12.2, 26.4], [10.6, 28.7]].map(([a, b]) => P(a, b)), { fill: '#0D1914' }));
    for (const cx of [19.6, 51.7]) {
      out.push(ops.circle(x + W(cx), y + W(29.4), W(5.5), { fill: '#0A120E' }));
      out.push(ops.circle(x + W(cx), y + W(29.4), W(4.3), { stroke: '#E0A96D', sw: W(1.05) }));
      for (let k = 0; k < 5; k++) {
        const a = (-90 + k * 72) * Math.PI / 180;
        out.push(ops.line(x + W(cx), y + W(29.4), x + W(cx + Math.cos(a) * 3.9), y + W(29.4 + Math.sin(a) * 3.9), { stroke: '#E0A96D', sw: W(1.05) }));
      }
      out.push(ops.circle(x + W(cx), y + W(29.4), W(1.15), { fill: '#E0A96D' }));
    }
    out.push(ops.raw('M 9.5 36.8 C 24 37.6 48 37.6 62.5 36.8', { stroke: '#E0A96D', sw: W(0.95), strokeOpacity: 0.68 }));
  } else {
    // одноцветная версия: тот же контур, обводкой (для меди/латуни/слоновой кости)
    out.push(ops.raw('M 6.2 29.8 L 9.6 28.5 L 7.8 26.8 C 10.6 24.4 15.2 22.1 20.8 20.3 C 26.6 16.5 33.4 14.9 41.2 15.1 C 47.6 15.3 53.4 17 58.2 19.3 L 64.6 16.4 L 62.6 20.3 L 64.4 21.1 L 63.8 23.6 L 65.5 24.1 L 63.4 28 L 65.1 27.6 L 62.4 29.8 L 58.3 29.8 A 6.6 6.6 0 0 0 45.1 29.8 L 26.1 29.8 A 6.5 6.5 0 0 0 13.1 29.8 Z', { fill: mono, fillOpacity: 0.14, stroke: mono, sw: W(0.9) }));
    for (const cx of [19.6, 51.7]) {
      out.push(ops.circle(x + W(cx), y + W(29.4), W(4.7), { stroke: mono, sw: W(0.9) }));
      out.push(ops.circle(x + W(cx), y + W(29.4), W(1), { fill: mono }));
    }
    out.push(ops.raw('M 9.5 36.8 C 24 37.6 48 37.6 62.5 36.8', { stroke: mono, sw: W(0.8), strokeOpacity: 0.8 }));
  }
  return out;
}
