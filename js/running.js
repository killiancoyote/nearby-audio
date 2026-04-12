import { state } from './state.js?v=16';
import { haversineDistance, scoreArticle, fetchNearby, fetchFullArticle } from './api.js?v=16';
import { playCurrentSection, speakNextChunk, stopPlayback, updatePlayerUI, showPlayer } from './player.js?v=16';
import { chunkText, toast } from './utils.js?v=16';
import { highlightPlayingMarker } from './map.js?v=16';

const PROXIMITY_M = 150;        // trigger radius in meters
const EARLY_CUT_M = 200;        // meters past article before early cut
const REFETCH_M = 400;          // meters from last fetch before refetching
const HEADING_WINDOW_MS = 15000; // ms of position history for heading calc
const COOLDOWN_MS = 5000;        // silence between articles when stationary
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

let gpsWatchId = null;
let lastArticleEndTime = 0;

// ── Geo math ─────────────────────────────────────────────────────────

function bearingTo(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function estimateHeading(history) {
  if (history.length < 2) return null;
  const now = history[history.length - 1];
  // Find oldest position within the heading window
  let oldest = null;
  for (const p of history) {
    if (now.ts - p.ts <= HEADING_WINDOW_MS) { oldest = p; break; }
  }
  if (!oldest || oldest === now) return null;
  const dist = haversineDistance(oldest.lat, oldest.lon, now.lat, now.lon);
  if (dist < 5) return null; // too little movement to estimate heading
  return bearingTo(oldest.lat, oldest.lon, now.lat, now.lon);
}

// ── Candidate evaluation ─────────────────────────────────────────────

function evaluateCandidates(articles, lat, lon, heading) {
  const scored = [];
  for (const a of articles) {
    if (state.runSession.playedTitles.has(a.title)) continue;
    const dist = haversineDistance(lat, lon, a.lat, a.lon);
    if (dist > PROXIMITY_M) continue;

    let dirBoost = 1.0;
    if (heading != null) {
      const bearing = bearingTo(lat, lon, a.lat, a.lon);
      const diff = angleDiff(heading, bearing);
      if (diff < 45) dirBoost = 2.0;
      else if (diff < 90) dirBoost = 1.0;
      else dirBoost = 0.3;
    }

    const notability = scoreArticle(a);
    const score = (1 / Math.max(dist, 1)) * dirBoost * notability;
    scored.push({ article: a, dist, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ── Position update (main tick) ──────────────────────────────────────

function onPositionUpdate(pos) {
  const rs = state.runSession;
  if (!rs || !rs.active) return;

  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  state.userGpsLatLng = [lat, lon];

  // Update position history (keep last 20)
  rs.positionHistory.push({ lat, lon, ts: Date.now() });
  if (rs.positionHistory.length > 20) rs.positionHistory.shift();

  // Estimate heading
  rs.heading = estimateHeading(rs.positionHistory);

  // Refetch if moved far enough
  if (rs.lastFetchCenter) {
    const fetchDist = haversineDistance(lat, lon, rs.lastFetchCenter[0], rs.lastFetchCenter[1]);
    if (fetchDist > REFETCH_M) {
      refetchForRunning(lat, lon, rs.heading);
    }
  }

  // Early cut: if currently playing and runner is far past the article
  if (state.isPlaying && state.currentArticle) {
    const artDist = haversineDistance(lat, lon, state.currentArticle.lat, state.currentArticle.lon);
    if (artDist > EARLY_CUT_M) {
      const candidates = evaluateCandidates(rs.nearbyArticles, lat, lon, rs.heading);
      if (candidates.length > 0) {
        // Better article ahead — cut current and switch
        startNextRunArticle(candidates[0].article);
        return;
      }
    }
  }

  // If nothing is playing, check for candidates
  if (!state.isPlaying && !state.currentArticle) {
    // Cooldown after last article to avoid rapid-fire
    if (Date.now() - lastArticleEndTime < COOLDOWN_MS) return;

    const candidates = evaluateCandidates(rs.nearbyArticles, lat, lon, rs.heading);
    if (candidates.length > 0) {
      startNextRunArticle(candidates[0].article);
    }
  }
}

// ── Article playback for running mode ────────────────────────────────

async function startNextRunArticle(article) {
  const rs = state.runSession;
  if (!rs || !rs.active) return;

  // Stop current playback cleanly (without hiding player/clearing state fully)
  if (state.isPlaying) {
    state.isPlaying = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  rs.playedTitles.add(article.title);
  updateHUD(`Coming up: ${article.title}`);

  // Speak preamble
  await speakPreamble(article.title);
  if (!rs.active) return; // stopped during preamble

  // Fetch full article
  let sections;
  try {
    sections = await fetchFullArticle(article.title);
  } catch (e) {
    console.warn('Running mode: failed to fetch', article.title, e);
    lastArticleEndTime = Date.now();
    return;
  }
  if (!sections.length || !rs.active) return;

  const full = { ...article, sections };
  state.currentArticle = full;
  state.currentSectionIdx = 0;
  state.currentChunks = chunkText(sections[0].text);
  state.currentChunkIdx = 0;
  state.isPlaying = true;

  highlightPlayingMarker(full.title);
  updateHUD(article.title);
  showPlayer();
  updatePlayerUI();

  // Set hooks for section/article end
  rs.onSectionEnd = (nextSectionIdx) => {
    // After section 0 (overview), check for queued article
    if (nextSectionIdx >= 1) {
      const [lat, lon] = state.userGpsLatLng || rs.lastFetchCenter || [0, 0];
      const candidates = evaluateCandidates(rs.nearbyArticles, lat, lon, rs.heading);
      if (candidates.length > 0) {
        // Better article waiting — switch to it
        startNextRunArticle(candidates[0].article);
        return false; // don't continue current article
      }
    }
    return true; // continue to next section
  };

  rs.onArticleEnd = () => {
    // Article fully finished
    lastArticleEndTime = Date.now();
    state.currentArticle = null;
    state.isPlaying = false;
    updateHUD('Listening for nearby places...');
    updatePlayerUI();
  };

  speakNextChunk();
}

function speakPreamble(title) {
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(`Coming up: ${title}`);
    utterance.rate = 1.1;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

// ── Refetching ───────────────────────────────────────────────────────

async function refetchForRunning(lat, lon, heading) {
  const rs = state.runSession;
  if (!rs) return;
  rs.lastFetchCenter = [lat, lon];

  // Forward-biased bounding box: 800m ahead, 400m behind/sideways
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(toRad(lat));
  const dLat = 800 / mPerDegLat;
  const dLon = 800 / mPerDegLon;

  const bounds = {
    north: lat + dLat,
    south: lat - dLat * 0.5,
    east: lon + dLon,
    west: lon - dLon,
  };

  try {
    const articles = await fetchNearby(lat, lon, bounds, { userLatLon: [lat, lon] });
    // Merge with existing, dedup by title
    const existing = new Map(rs.nearbyArticles.map(a => [a.title, a]));
    for (const a of articles) {
      if (!existing.has(a.title)) {
        existing.set(a.title, a);
      }
    }
    rs.nearbyArticles = Array.from(existing.values());
  } catch (e) {
    console.warn('Running mode: refetch failed', e);
  }
}

// ── HUD ──────────────────────────────────────────────────────────────

function showRunningHUD() {
  const hud = document.getElementById('runningHud');
  if (hud) hud.style.display = '';
  document.body.classList.add('running-active');
  updateHUD('Listening for nearby places...');
}

function hideRunningHUD() {
  const hud = document.getElementById('runningHud');
  if (hud) hud.style.display = 'none';
  document.body.classList.remove('running-active');
}

function updateHUD(text) {
  const label = document.getElementById('rhLabel');
  if (label) label.textContent = text;
}

// ── Public API ───────────────────────────────────────────────────────

export function startRunningMode() {
  if (state.runSession?.active) return;

  // Get current articles from map markers
  const nearbyArticles = state.articleMarkers
    .map(m => m._articleData)
    .filter(Boolean);

  const [lat, lon] = state.userGpsLatLng || state.userLatLng || [0, 0];

  state.runSession = {
    active: true,
    playedTitles: new Set(),
    positionHistory: [{ lat, lon, ts: Date.now() }],
    heading: null,
    lastFetchCenter: [lat, lon],
    nearbyArticles,
    nextArticle: null,
    onSectionEnd: null,
    onArticleEnd: null,
  };

  // Start tighter GPS tracking for running
  if (navigator.geolocation) {
    gpsWatchId = navigator.geolocation.watchPosition(
      onPositionUpdate,
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
  }

  // Stop any current playback
  stopPlayback();

  showRunningHUD();
  toast('Running mode started', 'ok', 2000);

  // Immediately evaluate candidates
  onPositionUpdate({ coords: { latitude: lat, longitude: lon } });
}

export function stopRunningMode() {
  if (gpsWatchId != null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  if (state.isPlaying) {
    state.isPlaying = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  state.runSession = null;
  state.currentArticle = null;
  state.currentSectionIdx = 0;
  state.currentChunks = [];
  state.currentChunkIdx = 0;
  lastArticleEndTime = 0;

  hideRunningHUD();
  toast('Running mode stopped', '', 2000);
}
