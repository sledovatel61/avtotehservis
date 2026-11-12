/**
 * Минимальный безопасный Markdown → HTML.
 * Сырой HTML экранируется (никакого HTML из ввода не исполняется), поддерживаются:
 * # / ## / ###, списки (- и 1.), цитата >, абзацы, **жирный**, *курсив*, `код`,
 * [текст](ссылка) — только http(s)/mailto/tel и относительные /,
 * таблицы GFM (| шапка |, |---|, строки) — в обёртке .post-table-wrap.
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    if (/^(https?:|mailto:|tel:|\/)/i.test(url)) {
      const rel = /^https?:/i.test(url) ? ' rel="noopener noreferrer nofollow" target="_blank"' : '';
      return `<a href="${url}"${rel}>${text}</a>`;
    }
    return text; // небезопасная ссылка — оставляем только текст
  });
  return out;
}

/* Таблицы (круг 69): строка вида |…|, под ней разделитель |---|, дальше строки тела. */
const isTableRow = (line: string): boolean => /^\|.*\|$/.test(line.trim());
const isTableSep = (line: string): boolean =>
  isTableRow(line) && tableCells(line).every((c) => /^:?-{2,}:?$/.test(c));
function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  /* последний <li>: нужен, чтобы подхватывать перенос строки внутри пункта —
     в исходниках статьи переносятся по 85 знаков, и продолжение пункта начинается
     с отступа, а не с новой «-». Без этого список рвался на пункт + абзац. */
  let lastLi = -1;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; lastLi = -1; } };
  const closePara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeList(); closePara();
      const head = tableCells(line);
      const body: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) { body.push(tableCells(lines[j])); j += 1; }
      html.push(
        '<div class="post-table-wrap"><table class="post-table"><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((row) => '<tr>' + head.map((_h, k) => `<td>${inline(row[k] ?? '')}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      );
      i = j - 1;
      continue;
    }
    if (!line.trim()) { closeList(); closePara(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { closeList(); closePara(); const lvl = h[1].length + 1; html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); continue; }
    if (/^>\s?/.test(line)) { closeList(); closePara(); html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) { closePara(); if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; } html.push(`<li>${inline(ul[1])}</li>`); lastLi = html.length - 1; continue; }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) { closePara(); if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${inline(ol[1])}</li>`); lastLi = html.length - 1; continue; }
    if (list && lastLi >= 0 && /^\s{2,}\S/.test(raw)) {
      html[lastLi] = html[lastLi].replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>');
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  closeList(); closePara();
  return html.join('\n');
}
