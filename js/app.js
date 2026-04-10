import { state } from './state.js?v=13';
import { CATEGORIES, DEFAULT_CAT, classifyArticle, makePinIcon } from './categories.js?v=13';
import { escHtml, formatDistance, chunkText, toast, hideToast } from './utils.js?v=13';
import { fetchNearby, fetchFullArticle } from './api.js?v=13';
import {
  SPEEDS, startArticle, openArticle, playCurrentSection, speakNextChunk,
  stopPlayback, togglePause, skipSection, jumpToSection, cycleSpeed,
  expandPlayer, collapsePlayer, togglePlayerExpanded,
  showPlayer, hidePlayer, renderArticleText, updateArticleTextHighlight,
  switchPlayerTab, updatePlayerUI, renderSectionsList, snapTo,
  toggleHDVoice,
} from './player.js?v=13';
import { buildFilterBar, applyFilters, toggleFilterSheet, closeFilterSheet } from './filters.js?v=13';
import { initMap, setUserLocation, loadNearbyAt, initWithMyLocation, recenterOnUser, openArticlePopup, highlightPlayingMarker, clearPlayingMarker } from './map.js?v=13';
import { hideSearchResults } from './search.js?v=13';

// --- Expose on window for tests ---
Object.assign(window, {
  state, CATEGORIES, DEFAULT_CAT, classifyArticle, makePinIcon,
  escHtml, formatDistance, chunkText,
  fetchNearby, fetchFullArticle,
  SPEEDS, startArticle, openArticle, playCurrentSection, speakNextChunk,
  stopPlayback, togglePause, skipSection, jumpToSection, cycleSpeed,
  expandPlayer, collapsePlayer, togglePlayerExpanded,
  showPlayer, hidePlayer, renderArticleText, updateArticleTextHighlight,
  switchPlayerTab, updatePlayerUI, renderSectionsList, snapTo, toggleHDVoice,
  buildFilterBar, applyFilters, toggleFilterSheet, closeFilterSheet,
  initMap, setUserLocation, loadNearbyAt, initWithMyLocation, recenterOnUser, openArticlePopup, highlightPlayingMarker, clearPlayingMarker,
  hideSearchResults,
});

// speedIdx needs special handling since it's a let (re-exported as live binding)
// Tests access it via eval, so define as a getter on window
import { speedIdx, playerExpanded } from './player.js?v=13';
Object.defineProperty(window, 'speedIdx', { get() { return speedIdx; } });
Object.defineProperty(window, 'playerExpanded', { get() { return playerExpanded; } });

// --- DOM refs for event wiring ---
const player = document.getElementById('player');
const playerHandle = document.getElementById('playerHandle');
const playerClose = document.getElementById('playerClose');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevSectionBtn = document.getElementById('prevSectionBtn');
const nextSectionBtn = document.getElementById('nextSectionBtn');
const speedBtn = document.getElementById('speedBtn');
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
document.getElementById('hdVoiceBtn').addEventListener('click', toggleHDVoice);
playerHandle.addEventListener('click', () => {
  togglePlayerExpanded();
  // After toggle, update search btn suppression based on new state
  if (playerExpanded) suppressSearchBtn(); else unsuppressSearchBtn();
});
playerClose.addEventListener('click', stopPlayback);
document.getElementById('playerMinimize').addEventListener('click', collapsePlayer);

// --- Drag gesture (translateY-based bottom sheet) ---
let dragStartY = 0, dragStartTranslateY = 0, isDragging = false;
let lastTouchY = 0, lastTouchTime = 0, velocity = 0;

function getCurrentTranslateY() {
  const transform = getComputedStyle(player).transform;
  if (!transform || transform === 'none') return 0;
  const m = transform.match(/matrix.*\((.+)\)/);
  if (!m) return 0;
  const values = m[1].split(',').map(Number);
  return values[5] || 0;
}

function onDragStart(e) {
  isDragging = true;
  player.classList.add('dragging');
  player.classList.remove('snapping');

  const clientY = e.touches[0].clientY;
  dragStartY = clientY;
  dragStartTranslateY = getCurrentTranslateY();
  lastTouchY = clientY;
  lastTouchTime = Date.now();
  velocity = 0;
}

function onDragMove(e) {
  if (!isDragging) return;
  e.preventDefault();
  const clientY = e.touches[0].clientY;
  const dy = clientY - dragStartY;
  const playerH = player.offsetHeight;

  // newY: 0 = fully visible, playerH = fully hidden
  let newY = dragStartTranslateY + dy;
  // Clamp: rubber-band above 0, hard stop at playerH
  if (newY < 0) newY = newY * 0.3;
  if (newY > playerH) newY = playerH;

  player.style.transform = `translateY(${newY}px)`;

  // Track velocity for momentum
  const now = Date.now();
  const dt = now - lastTouchTime;
  if (dt > 0) {
    const instantV = (clientY - lastTouchY) / dt;
    velocity = 0.7 * instantV + 0.3 * velocity;
  }
  lastTouchY = clientY;
  lastTouchTime = now;
}

function onDragEnd(e) {
  if (!isDragging) return;
  isDragging = false;
  player.classList.remove('dragging');

  const currentY = getCurrentTranslateY();
  const playerH = window.innerHeight;

  // Project position forward based on momentum
  const projected = currentY + velocity * 200;

  // Two drag targets: back to open/expanded (y=0) or hidden (y=playerH)
  const FLICK_THRESHOLD = 0.5;
  let target;

  if (velocity > FLICK_THRESHOLD) {
    // Flicking down — dismiss
    target = 'hidden';
  } else if (velocity < -FLICK_THRESHOLD) {
    // Flicking up — expand to full screen
    target = 'expanded';
  } else {
    // No strong flick — snap to nearest between open (0) and hidden
    target = projected < playerH * 0.35 ? 'open' : 'hidden';
  }

  if (target === 'hidden') {
    stopPlayback();
    unsuppressSearchBtn();
  } else {
    snapTo(target, true);
    if (target === 'expanded' || target === 'open') suppressSearchBtn(); else unsuppressSearchBtn();
  }
}

// Use touchstart with passive:false so we can preventDefault on touchmove
playerHandle.addEventListener('touchstart', onDragStart, { passive: true });
document.addEventListener('touchmove', (e) => { if (isDragging) onDragMove(e); }, { passive: false });
document.addEventListener('touchend', (e) => { if (isDragging) onDragEnd(e); });

// Only the drag handle controls the tray — player-top and article text scroll normally

// Scroll-to-dismiss: when article text is at scroll-top and user overscrolls down, close tray
const playerTextEl = document.getElementById('playerText');
let scrollDismissStartY = null;
playerTextEl.addEventListener('touchstart', (e) => {
  scrollDismissStartY = playerTextEl.scrollTop <= 0 ? e.touches[0].clientY : null;
}, { passive: true });
playerTextEl.addEventListener('touchmove', (e) => {
  if (scrollDismissStartY === null || isDragging) return;
  if (playerTextEl.scrollTop > 0) { scrollDismissStartY = null; return; }
  const dy = e.touches[0].clientY - scrollDismissStartY;
  if (dy > 80) {
    // User pulled down 80px while at top — dismiss tray
    scrollDismissStartY = null;
    stopPlayback();
    unsuppressSearchBtn();
  }
}, { passive: true });

// --- Map controls ---
zoomInBtn.addEventListener('click', () => state.map.zoomIn());
zoomOutBtn.addEventListener('click', () => state.map.zoomOut());
recenterBtn.addEventListener('click', () => recenterOnUser());

// Close search results and filter sheet when tapping map
document.getElementById('map').addEventListener('click', () => { hideSearchResults(); closeFilterSheet(); });
filterBtn.addEventListener('click', toggleFilterSheet);

// --- "Search this area" button (smart visibility) ---
let lastLoadedCenter = null;
let lastLoadedZoom = null;
let searchBtnSuppressed = false; // temporarily suppressed by popup/player

function shouldShowSearchBtn() {
  if (!lastLoadedCenter) return false;
  // Show if user panned far enough OR changed zoom significantly
  const center = state.map.getCenter();
  const dist = state.map.distance(center, lastLoadedCenter);
  const zoomDelta = lastLoadedZoom != null ? Math.abs(state.map.getZoom() - lastLoadedZoom) : 0;
  return dist > 300 || zoomDelta >= 1;
}

function updateSearchBtnVisibility() {
  // Always hide when player is open or suppressed
  if (searchBtnSuppressed || player.classList.contains('open') || player.classList.contains('expanded')) {
    searchAreaBtn.classList.remove('visible');
    return;
  }
  if (shouldShowSearchBtn()) {
    searchAreaBtn.classList.add('visible');
  } else {
    searchAreaBtn.classList.remove('visible');
  }
}

// Suppress button when popup is open or player is expanded
function suppressSearchBtn() {
  searchBtnSuppressed = true;
  searchAreaBtn.classList.remove('visible');
}

function unsuppressSearchBtn() {
  searchBtnSuppressed = false;
  updateSearchBtnVisibility();
}

function onMapMoveEnd() {
  updateSearchBtnVisibility();
}

const _origLoadNearbyAt = loadNearbyAt;
const wrappedLoadNearbyAt = async function(lat, lon, zoom, opts) {
  // Set these BEFORE the async load so moveend doesn't flash the button
  lastLoadedCenter = L.latLng(lat, lon);
  lastLoadedZoom = zoom || state.map.getZoom();
  searchAreaBtn.classList.remove('visible');
  await _origLoadNearbyAt(lat, lon, zoom, opts);
};
// Override the window-exposed version too
window.loadNearbyAt = wrappedLoadNearbyAt;

searchAreaBtn.addEventListener('click', () => {
  searchAreaBtn.classList.remove('visible'); // hide immediately for responsiveness
  const center = state.map.getCenter();
  wrappedLoadNearbyAt(center.lat, center.lng, state.map.getZoom(), { keepView: true });
});

// --- Initialize ---
buildFilterBar();
initMap(40.7308, -73.9544);
state.map.on('moveend', onMapMoveEnd);

// Suppress "search this area" when popup opens; unsuppress when it closes
state.map.on('popupopen', suppressSearchBtn);
state.map.on('popupclose', unsuppressSearchBtn);

// Suppress when player expands, unsuppress when it collapses or hides
const _origExpandPlayer = expandPlayer;
const _origCollapsePlayer = collapsePlayer;
const _origStopPlayback = stopPlayback;

const wrappedExpandPlayer = function() { suppressSearchBtn(); _origExpandPlayer(); };
const wrappedCollapsePlayer = function() { unsuppressSearchBtn(); _origCollapsePlayer(); };
const wrappedStopPlayback = function() { unsuppressSearchBtn(); _origStopPlayback(); };

// Re-wire controls to use wrapped versions
document.getElementById('playerMinimize').removeEventListener('click', collapsePlayer);
document.getElementById('playerMinimize').addEventListener('click', wrappedCollapsePlayer);
playerClose.removeEventListener('click', stopPlayback);
playerClose.addEventListener('click', wrappedStopPlayback);

// Override window exposure
window.expandPlayer = wrappedExpandPlayer;
window.collapsePlayer = wrappedCollapsePlayer;
window.stopPlayback = wrappedStopPlayback;

initWithMyLocation();

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
  window.speechSynthesis.getVoices();
}
