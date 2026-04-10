import { state } from './state.js?v=4';
import { classifyArticle, makePinIcon, DEFAULT_CAT } from './categories.js?v=4';
import { escHtml, formatDistance, toast } from './utils.js?v=4';
import { fetchNearby } from './api.js?v=4';
import { startArticle, openArticle, stopPlayback } from './player.js?v=4';
import { closeFilterSheet, applyFilters, setAllFetchedArticles } from './filters.js?v=4';

const emptyState = document.getElementById('emptyState');
const sub = document.getElementById('sub');
const filterBtn = document.getElementById('filterBtn');
const searchAreaBtn = document.getElementById('searchAreaBtn');

export function initMap(lat, lon) {
  state.map = L.map('map', { zoomControl: false }).setView([lat, lon], 16);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, attribution: '\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \u00a9 <a href="https://carto.com/">CARTO</a>',
  }).addTo(state.map);
  setUserLocation(lat, lon);
  // Hide labels when zoomed out to reduce clutter
  state.map.on('zoomend', () => {
    const show = state.map.getZoom() >= 14;
    document.querySelectorAll('.pin-label').forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  });
}

export function setUserLocation(lat, lon) {
  state.userLatLng = [lat, lon];
  const icon = L.divIcon({
    className: '', html: '<div class="user-dot"></div>',
    iconSize: [18, 18], iconAnchor: [9, 9],
  });
  if (state.userMarker) state.userMarker.setLatLng([lat, lon]);
  else state.userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(state.map);
}

function clearArticleMarkers() {
  state.articleMarkers.forEach(m => state.map.removeLayer(m));
  state.articleMarkers = [];
}

function renderArticleMarkers(articles) {
  clearArticleMarkers();
  setAllFetchedArticles(articles);
  if (articles.length === 0) {
    emptyState.classList.add('visible');
    filterBtn.classList.remove('visible');
  } else {
    emptyState.classList.remove('visible');
    filterBtn.classList.add('visible');
  }
  closeFilterSheet();
  articles.forEach((a, i) => {
    const cat = classifyArticle(a.description);
    a._category = cat;
    const len = (a.extract || '').length;
    const pinSize = a.thumb
      ? (len > 300 ? 44 : 36)
      : (len > 300 ? 42 : len > 100 ? 32 : 22);
    const icon = makePinIcon(cat, i * 40, pinSize, a.thumb, a.title);
    const marker = L.marker([a.lat, a.lon], { icon }).addTo(state.map);
    marker._articleData = a;
    marker.on('click', () => openArticlePopup(marker, a));
    state.articleMarkers.push(marker);
  });
  applyFilters();
}

export function openArticlePopup(marker, article) {
  const isCurrent = state.currentArticle && state.currentArticle.title === article.title;
  const cleanTitle = (article.title || '').replace(/\s*\([^)]+\)\s*$/, '');
  const safeTitle = escHtml(cleanTitle);
  const safeExtract = escHtml(article.extract || '');
  const cat = article._category || DEFAULT_CAT;
  const catLabel = cat.id !== 'default' ? cat.id.charAt(0).toUpperCase() + cat.id.slice(1) : '';
  // Estimate listening time: ~150 words per minute for TTS
  const wordCount = (article.extract || '').split(/\s+/).filter(Boolean).length;
  const listenMin = Math.max(1, Math.round(wordCount / 150));
  const metaParts = [];
  if (catLabel) metaParts.push(catLabel);
  metaParts.push(formatDistance(article.distance));
  if (wordCount > 0) metaParts.push(`~${listenMin} min read`);
  const playIcon = isCurrent && state.isPlaying
    ? '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const wikiBtn = `<a class="popup-icon-btn" href="https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}" target="_blank" title="Wikipedia"><svg viewBox="0 0 24 24"><path d="M14.97 18.95L12 12.52l-2.97 6.43a.5.5 0 01-.91-.01L4.58 9.68a.5.5 0 01.91-.42L9 17.05l2.54-5.5a.5.5 0 01.91 0L15 17.05l3.51-7.79a.5.5 0 01.91.42l-3.54 9.26a.5.5 0 01-.91.01z"/></svg></a>`;
  const dirBtn = `<a class="popup-icon-btn" href="https://www.google.com/maps/dir/?api=1&destination=${article.lat},${article.lon}" target="_blank" title="Directions"><svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 00-1.42 0l-9 9a1 1 0 000 1.42l9 9a1 1 0 001.42 0l9-9a1 1 0 000-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 011-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg></a>`;
  const extractContent = safeExtract
    ? `<p class="popup-text">${safeExtract}</p>`
    : `<p class="popup-text popup-text-hint">Tap to read this article</p>`;
  const extractArea = `<div class="popup-extract-area" id="popupExtractArea">${extractContent}</div>`;

  const closeHtml = `<button class="popup-close" aria-label="Close">\u00d7</button>`;
  const html = article.thumb ? `
    <div class="popup popup-has-img">
      ${closeHtml}
      <div class="popup-top-row">
        <div class="popup-img-wrap"><img class="popup-img" src="${escHtml(article.thumb)}" alt="" onerror="this.parentElement.remove()"></div>
        <div class="popup-header-info">
          <h3 class="popup-title">${safeTitle}</h3>
          <p class="popup-meta">${metaParts.join(' \u2022 ')}</p>
          <div class="popup-actions popup-actions-compact">
            <button class="popup-listen popup-listen-compact ${isCurrent && state.isPlaying ? 'playing' : ''}" id="popupPlayBtn">${playIcon} Listen</button>
            ${wikiBtn}${dirBtn}
          </div>
        </div>
      </div>
      ${extractArea}
    </div>
  ` : `
    <div class="popup popup-no-img">
      ${closeHtml}
      <div class="popup-header-info">
        <h3 class="popup-title">${safeTitle}</h3>
        <p class="popup-meta">${metaParts.join(' \u2022 ')}</p>
      </div>
      <div class="popup-actions popup-actions-full">
        <button class="popup-listen popup-listen-flex ${isCurrent && state.isPlaying ? 'playing' : ''}" id="popupPlayBtn">${playIcon} Listen</button>
        ${wikiBtn}${dirBtn}
      </div>
      ${extractArea}
    </div>
  `;
  if (marker.getPopup()) marker.unbindPopup();
  marker.bindPopup(html, { maxWidth: 300, minWidth: 260, closeButton: false, className: 'popup-wrapper' }).openPopup();
  setTimeout(() => {
    const px = state.map.latLngToContainerPoint([article.lat, article.lon]);
    const topPad = 80 + 200;
    if (px.y < topPad) {
      state.map.panBy([0, px.y - topPad], { animate: true, duration: 0.3 });
    }
  }, 100);
  setTimeout(() => {
    const popup = marker.getPopup();
    if (!popup) return;
    const el = popup.getElement();
    if (!el) return;
    const btn = el.querySelector('#popupPlayBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (state.currentArticle && state.currentArticle.title === article.title && state.isPlaying) {
          stopPlayback();
        } else {
          startArticle(article);
        }
      });
    }
    const closeBtn = el.querySelector('.popup-close');
    if (closeBtn) closeBtn.addEventListener('click', () => marker.closePopup());
    const extractArea = el.querySelector('#popupExtractArea');
    if (extractArea) {
      extractArea.addEventListener('click', () => {
        if (!state.currentArticle || state.currentArticle.title !== article.title) {
          openArticle(article);
        }
      });
    }
  }, 0);
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      p => resolve(p.coords),
      e => reject(e),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

// Get visible map bounds as {north, south, east, west} for bbox queries
function viewportBounds() {
  if (!state.map) return null;
  const b = state.map.getBounds();
  return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
}

export async function loadNearbyAt(lat, lon, zoom, opts = {}) {
  emptyState.classList.remove('visible');
  toast('Finding nearby articles\u2026');
  // Only move user dot + re-center when it's an initial load, not "search this area"
  if (!opts.keepView) {
    setUserLocation(lat, lon);
    state.map.setView([lat, lon], zoom != null ? zoom : 16);
  }
  // Use viewport bounding box for even coverage; fall back to radius if map not ready
  const bounds = viewportBounds();
  try {
    // Render placeholder pins as soon as coordinates are known (before summaries load)
    const onPlaceholders = (placeholders) => {
      renderArticleMarkers(placeholders);
      toast('Loading details\u2026');
    };
    const articles = await fetchNearby(lat, lon, bounds || 1000, { onPlaceholders, userLatLon: state.userGpsLatLng || state.userLatLng });
    // Replace placeholders with fully enriched markers (thumbnails, descriptions)
    renderArticleMarkers(articles);
    sub.textContent = `${articles.length} articles nearby \u00b7 tap a pin to play`;
    if (articles.length > 0) toast(`Found ${articles.length} articles`, 'ok', 2000);
    else toast('No articles found here', '', 3000);
  } catch (e) {
    toast('Error: ' + e.message, 'error', 5000);
  }
}

export function highlightPlayingMarker(title) {
  clearPlayingMarker();
  for (const m of state.articleMarkers) {
    if (m._articleData && m._articleData.title === title) {
      const el = m.getElement();
      if (el) {
        const pin = el.querySelector('.cat-pin');
        if (pin) pin.classList.add('playing');
      }
      break;
    }
  }
}

export function clearPlayingMarker() {
  for (const m of state.articleMarkers) {
    const el = m.getElement();
    if (el) {
      const pin = el.querySelector('.cat-pin');
      if (pin) pin.classList.remove('playing');
    }
  }
}

// Start continuous location tracking — silently moves the blue dot
function startWatching() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    p => { state.userGpsLatLng = [p.coords.latitude, p.coords.longitude]; setUserLocation(p.coords.latitude, p.coords.longitude); },
    () => {}, // silently ignore errors (tunnel, airplane mode, etc.)
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

// Re-request fresh location, pan to it, and reload articles
export async function recenterOnUser() {
  toast('Getting your location\u2026');
  try {
    const c = await getLocation();
    state.userGpsLatLng = [c.latitude, c.longitude];
    const zoom = Math.max(state.map.getZoom(), 15);
    // Use window.loadNearbyAt so app.js wrapper runs (sets lastLoadedCenter/Zoom)
    await (window.loadNearbyAt || loadNearbyAt)(c.latitude, c.longitude, zoom);
  } catch (e) {
    // Fall back to last known position
    if (state.userLatLng) {
      await (window.loadNearbyAt || loadNearbyAt)(state.userLatLng[0], state.userLatLng[1], 16);
    } else {
      toast('Location unavailable', 'error', 2000);
    }
  }
}

export async function initWithMyLocation() {
  toast('Getting your location\u2026');
  try {
    const c = await getLocation();
    state.userGpsLatLng = [c.latitude, c.longitude];
    // Use window.loadNearbyAt so app.js wrapper runs (sets lastLoadedCenter/Zoom)
    await (window.loadNearbyAt || loadNearbyAt)(c.latitude, c.longitude);
    startWatching(); // begin continuous tracking after initial fix
  } catch (e) {
    toast('Location unavailable \u2014 showing Greenpoint', 'error', 3000);
    await (window.loadNearbyAt || loadNearbyAt)(40.7308, -73.9544);
  }
}
