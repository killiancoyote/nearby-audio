import { escHtml } from './utils.js';

export async function fetchNearby(lat, lon) {
  const geoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=1000&gslimit=30`;
  const res = await fetch(geoUrl);
  if (!res.ok) throw new Error('Geosearch HTTP ' + res.status);
  const data = await res.json();
  const pages = (data.query && data.query.geosearch) || [];
  const summaries = await Promise.all(pages.map(async p => {
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.title)}`);
      if (!r.ok) return null;
      const s = await r.json();
      return {
        title: p.title, lat: p.lat, lon: p.lon, distance: p.dist,
        extract: s.extract || '',
        thumb: s.thumbnail ? s.thumbnail.source : null,
        description: s.description || '',
      };
    } catch { return null; }
  }));
  return summaries.filter(s => s && s.extract && s.title);
}

export async function fetchFullArticle(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Article fetch HTTP ' + res.status);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('sup, table, style, script, .reference, .mw-editsection, .mw-empty-elt, figure, .infobox, .navbox, .sidebar, .metadata, .shortdescription, .mw-disambiguation, [style*="display:none"], .hatnote, .geo, .coordinates').forEach(el => el.remove());
  const sections = [];
  const sectionEls = doc.querySelectorAll('section');
  const SKIP = /^(references?|external links?|see also|notes?|further reading|bibliography|citations?|footnotes?|sources?)$/i;
  if (sectionEls.length > 0) {
    sectionEls.forEach((sec, i) => {
      const headingEl = sec.querySelector('h1, h2, h3, h4');
      const heading = headingEl ? headingEl.textContent.trim() : (i === 0 ? 'Introduction' : 'Section');
      if (headingEl) headingEl.remove();
      if (SKIP.test(heading)) return;
      const text = (sec.textContent || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
      if (text.length > 0) sections.push({ heading, text });
    });
  } else {
    const body = (doc.body.textContent || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (body.length > 0) sections.push({ heading: 'Introduction', text: body });
  }
  return sections;
}
