// Tiny markdown renderer: headings, paragraphs, lists, code fences, tables,
// blockquotes (callouts), inline code/bold/italic/links. Content is authored by us.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
      const ext = /^https?:/.test(href);
      return `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`;
    })
    .replace(/→/g, '<span class="arrow">→</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

export function md(src) {
  if (!src) return '';
  const lines = src.replace(/^\n+|\s+$/g, '').split('\n');
  // strip common indentation so template literals can be indented in source
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const L = lines.map((l) => l.slice(indent));
  let html = '';
  let i = 0;
  while (i < L.length) {
    const line = L[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < L.length && !L[i].startsWith('```')) buf.push(L[i++]);
      i++;
      html += `<pre class="code" data-lang="${esc(lang)}"><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; i++; continue; }
    if (line.startsWith('>')) {
      const buf = [];
      while (i < L.length && L[i].startsWith('>')) buf.push(L[i++].replace(/^>\s?/, ''));
      html += `<div class="callout">${md(buf.join('\n'))}</div>`;
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < L.length && L[i].startsWith('|')) rows.push(L[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(rows[1] && /^\|[\s:-|]+$/.test(rows[1]) ? 2 : 1);
      html += '<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' + body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>';
      continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\d+\./.test(line.trim());
      const items = [];
      while (i < L.length && /^([-*]|\d+\.)\s+/.test(L[i])) {
        let item = L[i++].replace(/^([-*]|\d+\.)\s+/, '');
        while (i < L.length && /^\s{2,}\S/.test(L[i]) && !/^([-*]|\d+\.)\s+/.test(L[i])) item += ' ' + L[i++].trim();
        items.push(item);
      }
      const tag = ordered ? 'ol' : 'ul';
      html += `<${tag}>` + items.map((it) => `<li>${inline(it)}</li>`).join('') + `</${tag}>`;
      continue;
    }
    const buf = [];
    while (i < L.length && L[i].trim() && !/^(```|#{1,4}\s|>|\||([-*]|\d+\.)\s)/.test(L[i])) buf.push(L[i++]);
    html += `<p>${inline(buf.join(' '))}</p>`;
  }
  return html;
}
