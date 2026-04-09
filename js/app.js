import { state } from './state.js';
import { CATEGORIES, DEFAULT_CAT, classifyArticle, makePinIcon } from './categories.js';
import { escHtml, formatDistance, chunkText, toast, hideToast } from './utils.js';
import { fetchNearby, fetchFullArticle } from './api.js';
import {
  SPEEDS, startArticle, playCurrentSection, speakNextChunk,
  stopPlayback, togglePause, skipSection, jumpToSection, cycleSpeed,
  expandPlayer, collapsePlayer, togglePlayerExpanded,
  showPlayer, hidePlayer, renderArticleText, updateArticleTextHighlight,
  switchPlayerTab, updatePlayerUI, renderSectionsList, snapTo,
} from './player.js';
import { buildFilterBar, applyFilters, toggleFilterSheet, closeFilterSheet } from './filters.js';
import { initMap, setUserLocation, loadNearbyAt, initWithMyLocation, openArticlePopup, highlightPlayingMarker, clearPlayingMarker } from './map.js';
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
  switchPlayerTab, updatePlayerUI, renderSectionsList, snapTo,
  buildFilterBar, applyFilters, toggleFilterSheet, closeFilterSheet,
  initMap, setUserLocation, loadNearbyAt, initWithMyLocation, openArticlePopup, highlightPlayingMarker, clearPlayingMarker,
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
playerHandle.addEventListener('click', () => {
  togglePlayerExpanded();
  // After toggle, update search btn suppression based on new state
  if (playerExpanded) suppressSearchBtn(); else unsuppressSearchBtn();
});
playerClose.addEventListener('click', stopPlayback);
document.getElementById('playerMinimize').addEventListener('click', collapsePlayer);
tabText.addEventListener('click', () => switchPlayerTab('text'));
tabSections.addEventListener('click', () => switchPlayerTab('sections'));

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
  // Switch to expanded layout so content is visible during drag
  player.classList.add('expanded');
  player.classList.remove('peek');

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
  const playerH = player.offsetHeight;
  const peekY = playerH - 160;

  // Project position forward based on momentum
  const projected = currentY + velocity * 200;

  // Find nearest snap: expanded (0), peek (peekY), hidden (playerH)
  const snaps = [
    { name: 'expanded', y: 0 },
    { name: 'peek', y: peekY },
    { name: 'hidden', y: playerH },
  ];

  // Velocity-based override: fast flick always goes to next snap
  const FLICK_THRESHOLD = 0.5;
  let target;

  if (velocity > FLICK_THRESHOLD) {
    // Flicking down
    if (playerExpanded) target = 'peek';
    else target = 'hidden';
  } else if (velocity < -FLICK_THRESHOLD) {
    // Flicking up
    if (playerPeek || !playerExpanded) target = 'expanded';
    else target = 'expanded';
  } else {
    // No strong flick — snap to nearest based on projected position
    let closest = snaps[0];
    for (const s of snaps) {
      if (Math.abs(projected - s.y) < Math.abs(projected - closest.y)) closest = s;
    }
    target = closest.name;
  }

  if (target === 'hidden') {
    stopPlayback();
    unsuppressSearchBtn();
  } else {
    snapTo(target, true);
    if (target === 'expanded') suppressSearchBtn(); else unsuppressSearchBtn();
  }
}

// Use touchstart with passive:false so we can preventDefault on touchmove
playerHandle.addEventListener('touchstart', onDragStart, { passive: true });
document.addEventListener('touchmove', (e) => { if (isDragging) onDragMove(e); }, { passive: false });
document.addEventListener('touchend', (e) => { if (isDragging) onDragEnd(e); });

// Player top bar is also draggable (for expanded state)
const playerTop = document.querySelector('.player-top');
if (playerTop) playerTop.addEventListener('touchstart', onDragStart, { passive: true });

// --- Map controls ---
zoomInBtn.addEventListener('click', () => state.map.zoomIn());
zoomOutBtn.addEventListener('click', () => state.map.zoomOut());
recenterBtn.addEventListener('click', () => { if (state.userLatLng) state.map.setView(state.userLatLng, 16); });

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
  return dist > 300 || zoomDelta >= 2;
}

function updateSearchBtnVisibility() {
  if (searchBtnSuppressed) {
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
  await _origLoadNearbyAt(lat, lon, zoom, opts);
  lastLoadedCenter = L.latLng(lat, lon);
  lastLoadedZoom = state.map.getZoom();
  searchAreaBtn.classList.remove('visible');
};
// Override the window-exposed version too
window.loadNearbyAt = wrappedLoadNearbyAt;

searchAreaBtn.addEventListener('click', () => {
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
