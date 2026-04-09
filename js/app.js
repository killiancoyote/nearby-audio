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
playerHandle.addEventListener('click', togglePlayerExpanded);
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
  } else {
    snapTo(target, true);
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
