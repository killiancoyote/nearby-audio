import { state } from './state.js';
import { CATEGORIES, DEFAULT_CAT, classifyArticle, makePinIcon } from './categories.js';
import { escHtml, formatDistance, chunkText, toast, hideToast } from './utils.js';
import { fetchNearby, fetchFullArticle } from './api.js';
import {
  SPEEDS, startArticle, playCurrentSection, speakNextChunk,
  stopPlayback, togglePause, skipSection, jumpToSection, cycleSpeed,
  expandPlayer, collapsePlayer, togglePlayerExpanded,
  showPlayer, hidePlayer, renderArticleText, updateArticleTextHighlight,
  switchPlayerTab, updatePlayerUI, renderSectionsList,
} from './player.js';
import { buildFilterBar, applyFilters, toggleFilterSheet, closeFilterSheet } from './filters.js';
import { initMap, setUserLocation, loadNearbyAt, initWithMyLocation, openArticlePopup } from './map.js';
import { hideSearchResults } from './search.js';

// --- Expose on window for tests ---
Object.assign(window, {
  state, CATEGORIES, DEFAULT_CAT, classifyArticle, makePinIcon,
  escHtml, formatDistance, chunkText,
  fetchNearby, fetchFullArticle,
  SPEEDS, startArticle, playCurrentSection, speakNextChunk,
  stopPlayback, togglePause, skipSection, jumpToSection, cycleSpeed,
  expandPlayer, collapsePlayer, togglePlayerExpanded,
  showPlayer, hidePlayer, renderArticleText, updateArticleTextHighlight,
  switchPlayerTab, updatePlayerUI, renderSectionsList,
  buildFilterBar, applyFilters, toggleFilterSheet, closeFilterSheet,
  initMap, setUserLocation, loadNearbyAt, initWithMyLocation, openArticlePopup,
  hideSearchResults,
});

// speedIdx needs special handling since it's a let (re-exported as live binding)
// Tests access it via eval, so define as a getter on window
import { speedIdx, playerExpanded, playerPeek } from './player.js';
Object.defineProperty(window, 'speedIdx', { get() { return speedIdx; } });
Object.defineProperty(window, 'playerExpanded', { get() { return playerExpanded; } });
Object.defineProperty(window, 'playerPeek', { get() { return playerPeek; } });

// --- DOM refs for event wiring ---
const player = document.getElementById('player');
const playerHandle = document.getElementById('playerHandle');
const playerClose = document.getElementById('playerClose');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevSectionBtn = document.getElementById('prevSectionBtn');
const nextSectionBtn = document.getElementById('nextSectionBtn');
const speedBtn = document.getElementById('speedBtn');
const tabText = document.getElementById('tabText');
const tabSections = document.getElementById('tabSections');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const recenterBtn = document.getElementById('recenterBtn');
const searchAreaBtn = document.getElementById('searchAreaBtn');
const filterBtn = document.getElementById('filterBtn');

// --- Player controls ---
playPauseBtn.addEventListener('click', togglePause);
nextSectionBtn.addEventListener('click', () => skipSection(1));
prevSectionBtn.addEventListener('click', () => skipSection(-1));
speedBtn.addEventListener('click', cycleSpeed);
playerHandle.addEventListener('click', togglePlayerExpanded);
playerClose.addEventListener('click', stopPlayback);
tabText.addEventListener('click', () => switchPlayerTab('text'));
tabSections.addEventListener('click', () => switchPlayerTab('sections'));

// --- Drag gesture on player handle + mini area ---
let dragStartY = 0, dragStartH = 0, isDragging = false;
const SNAP_PEEK = 0.3;
const SNAP_FULL = 0.75;

function onDragStart(clientY) {
  isDragging = true;
  dragStartY = clientY;
  dragStartH = player.offsetHeight;
  player.style.transition = 'none';
}

function onDragMove(clientY) {
  if (!isDragging) return;
  const dy = dragStartY - clientY;
  const newH = Math.max(0, Math.min(window.innerHeight * 0.9, dragStartH + dy));
  player.style.maxHeight = newH + 'px';
}

function onDragEnd(clientY) {
  if (!isDragging) return;
  isDragging = false;
  const dy = dragStartY - clientY;
  const currentH = player.offsetHeight;
  const vh = window.innerHeight;

  if (dy > 50 && !playerExpanded) {
    player.style.maxHeight = currentH + 'px';
    requestAnimationFrame(() => {
      player.style.transition = 'max-height 0.3s ease';
      player.style.maxHeight = '';
      expandPlayer();
      setTimeout(() => { player.style.transition = ''; }, 300);
    });
  } else if (dy < -50 && playerExpanded) {
    player.style.maxHeight = currentH + 'px';
    requestAnimationFrame(() => {
      player.style.transition = 'max-height 0.3s ease';
      collapsePlayer();
      setTimeout(() => { player.style.transition = ''; player.style.maxHeight = ''; }, 300);
    });
  } else if (dy < -50 && playerPeek && !playerExpanded) {
    player.style.maxHeight = currentH + 'px';
    requestAnimationFrame(() => {
      player.style.transition = 'max-height 0.3s ease';
      collapsePlayer();
      setTimeout(() => { player.style.transition = ''; player.style.maxHeight = ''; }, 300);
    });
  } else {
    const targetH = playerExpanded ? vh * SNAP_FULL : (playerPeek ? vh * SNAP_PEEK : currentH);
    player.style.maxHeight = currentH + 'px';
    requestAnimationFrame(() => {
      player.style.transition = 'max-height 0.3s ease';
      player.style.maxHeight = targetH + 'px';
      setTimeout(() => { player.style.transition = ''; player.style.maxHeight = ''; }, 300);
    });
  }
}

playerHandle.addEventListener('touchstart', e => onDragStart(e.touches[0].clientY), { passive: true });
playerHandle.addEventListener('touchmove', e => onDragMove(e.touches[0].clientY), { passive: true });
playerHandle.addEventListener('touchend', e => onDragEnd(e.changedTouches[0].clientY), { passive: true });

const playerMini = document.querySelector('.player-mini');
playerMini.addEventListener('touchstart', e => onDragStart(e.touches[0].clientY), { passive: true });
playerMini.addEventListener('touchmove', e => onDragMove(e.touches[0].clientY), { passive: true });
playerMini.addEventListener('touchend', e => onDragEnd(e.changedTouches[0].clientY), { passive: true });

// --- Map controls ---
zoomInBtn.addEventListener('click', () => state.map.zoomIn());
zoomOutBtn.addEventListener('click', () => state.map.zoomOut());
recenterBtn.addEventListener('click', () => { if (state.userLatLng) state.map.setView(state.userLatLng, 16); });

// Close search results and filter sheet when tapping map
document.getElementById('map').addEventListener('click', () => { hideSearchResults(); closeFilterSheet(); });
filterBtn.addEventListener('click', toggleFilterSheet);

// --- "Search this area" button ---
let lastLoadedCenter = null;

function onMapMoveEnd() {
  if (!lastLoadedCenter) return;
  const center = state.map.getCenter();
  const dist = state.map.distance(center, lastLoadedCenter);
  if (dist > 300) {
    searchAreaBtn.classList.add('visible');
  } else {
    searchAreaBtn.classList.remove('visible');
  }
}

const _origLoadNearbyAt = loadNearbyAt;
const wrappedLoadNearbyAt = async function(lat, lon, zoom) {
  await _origLoadNearbyAt(lat, lon, zoom);
  lastLoadedCenter = L.latLng(lat, lon);
  searchAreaBtn.classList.remove('visible');
};
// Override the window-exposed version too
window.loadNearbyAt = wrappedLoadNearbyAt;

searchAreaBtn.addEventListener('click', () => {
  const center = state.map.getCenter();
  wrappedLoadNearbyAt(center.lat, center.lng, state.map.getZoom());
});

// --- Initialize ---
buildFilterBar();
initMap(40.7308, -73.9544);
state.map.on('moveend', onMapMoveEnd);
initWithMyLocation();

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
  window.speechSynthesis.getVoices();
}
