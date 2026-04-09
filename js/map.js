import { state } from './state.js';
import { classifyArticle, makePinIcon, DEFAULT_CAT } from './categories.js';
import { escHtml, formatDistance, toast } from './utils.js';
import { fetchNearby } from './api.js';
import { startArticle, stopPlayback } from './player.js';
import { closeFilterSheet, applyFilters, setAllFetchedArticles } from './filters.js';

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
    const pinSize = len > 300 ? 36 : len > 100 ? 32 : 26;
    const icon = makePinIcon(cat, i * 40, pinSize);
    const marker = L.marker([a.lat, a.lon], { icon }).addTo(state.map);
    marker.on('click', () => openArticlePopup(marker, a));
    state.articleMarkers.push(marker);
  });
  applyFilters();
}

export function openArticlePopup(marker, article) {
  const isCurrent = state.currentArticle && state.currentArticle.title === article.title;
  const safeTitle = escHtml(article.title || '');
  const safeExtract = escHtml(article.extract || '');
  const cat = article._category || DEFAULT_CAT;
  const catLabel = cat.id !== 'default' ? cat.id.charAt(0).toUpperCase() + cat.id.slice(1) : '';
  const metaParts = [formatDistance(article.distance)];
  if (catLabel) metaParts.push(catLabel);
  const playIcon = isCurrent && state.isPlaying
    ? '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const html = `
    <div class="popup">
      ${article.thumb ? `<div class="popup-thumb"><img src="${escHtml(article.thumb)}" alt="" onload="this.parentElement.style.background='none'" onerror="this.parentElement.remove()"></div>` : ''}
      <div class="popup-body">
        <h3 class="popup-title">${safeTitle}</h3>
        <p class="popup-meta">${metaParts.join(' \u00b7 ')}</p>
        <p class="popup-extract">${safeExtract}</p>
        <div class="popup-actions">
          <button class="popup-play ${isCurrent && state.isPlaying ? 'playing' : ''}" id="popupPlayBtn">${playIcon}</button>
          <div class="popup-spacer"></div>
          <a class="popup-link-icon" href="https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}" target="_blank" title="Wikipedia">
            <svg viewBox="0 0 24 24"><path d="M14.97 18.95L12 12.52l-2.97 6.43a.5.5 0 01-.91-.01L4.58 9.68a.5.5 0 01.91-.42L9 17.05l2.54-5.5a.5.5 0 01.91 0L15 17.05l3.51-7.79a.5.5 0 01.91.42l-3.54 9.26a.5.5 0 01-.91.01z"/></svg>
          </a>
          <a class="popup-link-icon" href="https://www.google.com/maps/dir/?api=1&destination=${article.lat},${article.lon}" target="_blank" title="Directions">
            <svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 00-1.42 0l-9 9a1 1 0 000 1.42l9 9a1 1 0 001.42 0l9-9a1 1 0 000-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 011-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>
          </a>
        </div>
      </div>
    </div>
  `;
  if (marker.getPopup()) marker.unbindPopup();
  marker.bindPopup(html, { maxWidth: 260, minWidth: 220, closeButton: true }).openPopup();
  searchAreaBtn.classList.remove('visible');
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

export async function loadNearbyAt(lat, lon, zoom) {
  emptyState.classList.remove('visible');
  toast('Finding nearby articles\u2026');
  setUserLocation(lat, lon);
  state.map.setView([lat, lon], zoom != null ? zoom : 16);
  try {
    const articles = await fetchNearby(lat, lon);
    renderArticleMarkers(articles);
    sub.textContent = `${articles.length} articles nearby \u00b7 tap a pin to play`;
    if (articles.length > 0) toast(`Found ${articles.length} articles`, 'ok', 2000);
    else toast('No articles found here', '', 3000);
  } catch (e) {
    toast('Error: ' + e.message, 'error', 5000);
  }
}

export async function initWithMyLocation() {
  toast('Getting your location\u2026');
  try {
    const c = await getLocation();
    await loadNearbyAt(c.latitude, c.longitude);
  } catch (e) {
    toast('Location unavailable \u2014 showing Greenpoint', 'error', 3000);
    await loadNearbyAt(40.7308, -73.9544);
  }
}
