import { escHtml } from './utils.js?v=8';

// Haversine distance (meters) — used when bbox results don't include dist field
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Single-point geosearch (radius fallback for initial load)
async function geoSearchAt(lat, lon, radius) {
  const r = Math.max(10, Math.min(10000, Math.round(radius)));
  const geoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=${r}&gslimit=50`;
  const res = await fetch(geoUrl);
  if (!res.ok) throw new Error('Geosearch HTTP ' + res.status);
  const data = await res.json();
  return (data.query && data.query.geosearch) || [];
}

// Bounding box geosearch — query a single rectangle
async function geoSearchBBox(north, west, south, east, limit = 30) {
  const geoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gsbbox=${north}%7C${west}%7C${south}%7C${east}&gslimit=${limit}`;
  const res = await fetch(geoUrl);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.query && data.query.geosearch) || [];
}

// Grid search: subdivide viewport into 3×3 cells, query each generously
async function geoSearchGrid(north, west, south, east) {
  const COLS = 3, ROWS = 3;
  const PER_CELL = 30; // ~30 per cell × 9 cells = ~270 candidates
  const dLat = (north - south) / ROWS;
  const dLon = (east - west) / COLS;

  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells.push({
        n: south + dLat * (r + 1),
        s: south + dLat * r,
        w: west + dLon * c,
        e: west + dLon * (c + 1),
      });
    }
  }

  const results = await Promise.all(
    cells.map(cell => geoSearchBBox(cell.n, cell.w, cell.s, cell.e, PER_CELL))
  );

  // Deduplicate by page ID
  const seen = new Set();
  const allPages = [];
  for (const pages of results) {
    for (const p of pages) {
      if (!seen.has(p.pageid)) {
        seen.add(p.pageid);
        allPages.push(p);
      }
    }
  }
  return allPages;
}

// Greedy distance-based selection: walk score-sorted articles,
// add each only if it's far enough from all already-picked pins.
// Produces natural-looking spacing biased toward the best articles.
function selectSpread(articles, bounds, maxCount = 50) {
  const { north, south, east, west } = bounds;
  // Min distance = ~viewport diagonal / 10 (in degrees, rough but fast)
  const dLat = north - south;
  const dLon = east - west;
  const diag = Math.sqrt(dLat * dLat + dLon * dLon);
  const minDist = diag / 14;

  const selected = [];
  for (const a of articles) {
    // Check distance to all already-selected pins (in degree space)
    let tooClose = false;
    for (const s of selected) {
      const dy = a.lat - s.lat;
      const dx = a.lon - s.lon;
      if (dy * dy + dx * dx < minDist * minDist) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      selected.push(a);
      if (selected.length >= maxCount) break;
    }
  }

  // If we didn't reach maxCount (sparse area or tight spacing),
  // do a second pass with halved minDist to fill in gaps
  if (selected.length < maxCount) {
    const minDist2 = minDist / 2;
    for (const a of articles) {
      if (selected.includes(a)) continue;
      let tooClose = false;
      for (const s of selected) {
        const dy = a.lat - s.lat;
        const dx = a.lon - s.lon;
        if (dy * dy + dx * dx < minDist2 * minDist2) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        selected.push(a);
        if (selected.length >= maxCount) break;
      }
    }
  }

  return selected;
}

// Score article by notability (applied after summaries are fetched)
function scoreArticle(article) {
  const extractLen = (article.extract || '').length;
  const hasThumb = article.thumb ? 1 : 0;
  const descLen = (article.description || '').length;

  // Log scale for extract length so very long articles don't dominate
  const extractScore = Math.min(100, Math.log1p(extractLen) * 10);
  const thumbScore = hasThumb * 20;
  const descScore = Math.min(10, descLen / 5);

  return extractScore + thumbScore + descScore;
}

// Batch-fetch summaries using Wikipedia's query API (up to 50 per request)
async function batchFetchSummaries(pages, userLat, userLon) {
  const results = [];
  for (let i = 0; i < pages.length; i += 50) {
    const batch = pages.slice(i, i + 50);
    const ids = batch.map(p => p.pageid).join('|');
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
      `&pageids=${ids}&prop=extracts|pageimages|description` +
      `&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=600&redirects=1`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    const pagesMap = data.query?.pages || {};

    for (const p of batch) {
      const info = pagesMap[p.pageid];
      if (!info || info.missing != null) continue;
      const title = info.title || p.title || '';
      if (!title) continue;
      results.push({
        title,
        lat: p.lat, lon: p.lon,
        distance: p.dist != null ? p.dist : haversineDistance(userLat, userLon, p.lat, p.lon),
        extract: info.extract || '',
        thumb: info.thumbnail ? info.thumbnail.source : null,
        description: info.description || '',
      });
    }
  }
  return results;
}

export async function fetchNearby(lat, lon, radiusOrBounds = 1000, { onPlaceholders, userLatLon } = {}) {
  if (typeof radiusOrBounds === 'object' && radiusOrBounds.north != null) {
    const { north, south, east, west } = radiusOrBounds;

    // Step 1: Fetch candidate coordinates from 3×3 grid (~500ms, 9 parallel calls)
    const candidates = await geoSearchGrid(north, west, south, east);

    // Step 2: Select ~50 spatially spread candidates (by position only, instant)
    const selected = selectSpread(
      candidates.map(p => ({ ...p, lat: p.lat, lon: p.lon })),
      radiusOrBounds, 50
    );

    // Step 3: Show placeholder pins immediately (same locations as final pins)
    if (onPlaceholders && selected.length > 0) {
      onPlaceholders(selected.map(p => ({
        title: p.title || '', lat: p.lat, lon: p.lon,
        extract: '', thumb: null, description: '',
      })));
    }

    // Step 4: Fetch summaries for ONLY the selected ~50 (1 API call, ~300ms)
    // Use user's GPS position for distance calc (not map center)
    const distLat = userLatLon ? userLatLon[0] : lat;
    const distLon = userLatLon ? userLatLon[1] : lon;
    const articles = await batchFetchSummaries(selected, distLat, distLon);
    return articles;
  }

  // Radius fallback (initial load before map is ready)
  const r = Math.max(10, Math.min(10000, Math.round(radiusOrBounds)));
  const pages = await geoSearchAt(lat, lon, r);
  const distLat = userLatLon ? userLatLon[0] : lat;
  const distLon = userLatLon ? userLatLon[1] : lon;
  return batchFetchSummaries(pages, distLat, distLon);
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
      const heading = headingEl ? headingEl.textContent.trim() : (i === 0 ? 'Overview' : 'Section');
      if (headingEl) headingEl.remove();
      if (SKIP.test(heading)) return;
      const text = (sec.textContent || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
      if (text.length === 0) return;
      sections.push({ heading, text });
    });
  } else {
    const text = (doc.body.textContent || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      sections.push({ heading: 'Overview', text });
    }
  }
  return sections;
}
