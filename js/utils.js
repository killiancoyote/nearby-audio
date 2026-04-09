const toastEl = document.getElementById('toast');
let toastTimer = null;

export function toast(msg, type, duration = 3000) {
  toastEl.textContent = msg;
  toastEl.className = 'toast visible' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(() => toastEl.classList.remove('visible'), duration);
}

export function hideToast() {
  toastEl.classList.remove('visible');
}

export function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

export function chunkText(text) {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) || [text];
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > 200 && buf) { chunks.push(buf.trim()); buf = s; }
    else buf += s;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

export function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('sup, table, style, script, .reference, .mw-editsection').forEach(el => el.remove());
  return (div.textContent || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
}
