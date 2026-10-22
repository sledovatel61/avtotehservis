/**
 * Минимальный безопасный Markdown → HTML.
 * Сырой HTML экранируется (никакого HTML из ввода не исполняется), поддерживаются:
 * # / ## / ###, списки (- и 1.), цитата >, абзацы, **жирный**, *курсив*, `код`,
 * [текст](ссылка) — только http(s)/mailto/tel и относительные /.
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

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  const closePara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); closePara(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { closeList(); closePara(); const lvl = h[1].length + 1; html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); continue; }
    if (/^>\s?/.test(line)) { closeList(); closePara(); html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) { closePara(); if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; } html.push(`<li>${inline(ul[1])}</li>`); continue; }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) { closePara(); if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${inline(ol[1])}</li>`); continue; }
    closeList();
    para.push(line.trim());
  }
  closeList(); closePara();
  return html.join('\n');
}
