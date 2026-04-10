import { chunkText, escHtml, toast, hideToast } from './utils.js?v=14';
import { fetchFullArticle } from './api.js?v=14';
import { state } from './state.js?v=14';
import { highlightPlayingMarker, clearPlayingMarker } from './map.js?v=14';

// DOM refs
const player = document.getElementById('player');
const playerTitle = document.getElementById('playerTitle');
const playerSectionLabel = document.getElementById('playerSectionLabel');
const playerProgressFill = document.getElementById('playerProgressFill');
const playerProgressText = document.getElementById('playerProgressText');
const playPauseIcon = document.getElementById('playPauseIcon');
const speedBtn = document.getElementById('speedBtn');
const sectionsList = document.getElementById('sectionsList');
const playerText = document.getElementById('playerText');
const playerThumbImg = document.getElementById('playerThumbImg');

export const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5];
export let speedIdx = 1;
export let playerExpanded = false;
let utteranceGen = 0; // generation counter to ignore stale onend/onerror callbacks
let cachedVoice = null; // best voice, resolved once voices load

// ── Cloud TTS (HD Voice) ──────────────────────────────────────────────
const TTS_WORKER_URL = 'https://tts-proxy.killianc.workers.dev';
const HD_VOICE = 'en-US-Chirp3-HD-Charon';
let useHDVoice = false;
let hdAudioCache = new Map(); // "si-ci" → Blob URL for instant replay
let prefetchedAudio = null;   // { key, url } — next chunk's audio, fetched ahead
let currentHDAudio = null;    // currently playing Audio element
// Persistent Audio element — reusing one element avoids iOS Safari autoplay blocks
// (initial user tap "unlocks" it, subsequent .play() calls succeed)
const hdAudioEl = new Audio();

export function toggleHDVoice() {
  useHDVoice = !useHDVoice;
  hdAudioCache.clear();
  prefetchedAudio = null;
  const btn = document.getElementById('hdVoiceBtn');
  if (btn) btn.classList.toggle('active', useHDVoice);
  localStorage.setItem('hdVoice', useHDVoice ? '1' : '0');
  // If playing, restart current chunk with new voice
  if (state.isPlaying) {
    utteranceGen++;
    window.speechSynthesis.cancel();
    hdAudioEl.pause(); currentHDAudio = null;
    speakNextChunk();
  }
}

// Fetch MP3 from Cloud TTS worker
async function fetchCloudAudio(text) {
  const res = await fetch(TTS_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: HD_VOICE }),
  });
  if (!res.ok) throw new Error(`TTS error ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Prefetch the next chunk's audio while current chunk plays
function prefetchNextChunk() {
  const nextCI = state.currentChunkIdx + 1;
  const si = state.currentSectionIdx;
  if (nextCI >= state.currentChunks.length) return; // section boundary — skip prefetch
  const key = `${si}-${nextCI}`;
  if (hdAudioCache.has(key)) { prefetchedAudio = { key, url: hdAudioCache.get(key) }; return; }
  const text = state.currentChunks[nextCI];
  fetchCloudAudio(text).then(url => {
    hdAudioCache.set(key, url);
    prefetchedAudio = { key, url };
  }).catch(() => {}); // fail silently — will fetch on demand
}

// Pick the best English voice: Premium/Enhanced > named favorites > any en-US
function pickBestVoice(voices) {
  const en = voices.filter(v => /^en/i.test(v.lang));
  // Premium / Enhanced (user-downloaded high-quality voices on iOS)
  const premium = en.find(v => /premium|enhanced/i.test(v.name));
  if (premium) return premium;
  // Named system voices known to sound decent
  const named = en.find(v => /samantha|alex|karen|daniel|zoe|ava|tom/i.test(v.name));
  if (named) return named;
  // Any English voice
  return en[0] || null;
}

// Safari doesn't have voices ready immediately — listen for the async load
function initVoices() {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) {
    cachedVoice = pickBestVoice(voices);
    if (cachedVoice) console.log('TTS voice:', cachedVoice.name);
  }
}
initVoices();
window.speechSynthesis.onvoiceschanged = initVoices;

// Restore HD voice preference
if (localStorage.getItem('hdVoice') === '1') {
  useHDVoice = true;
  requestAnimationFrame(() => {
    const btn = document.getElementById('hdVoiceBtn');
    if (btn) btn.classList.add('active');
  });
}

// Pan map so pin is centered in the visible strip above the tray (top ~22%)
function panToVisibleCenter(lat, lon) {
  if (!state.map || lat == null || lon == null) return;
  const mapH = state.map.getSize().y;
  const visibleH = mapH * 0.22; // top 22% is visible when tray is open
  // Offset = difference between map center and visible strip center
  const offsetY = (mapH / 2) - (visibleH / 2);
  const point = state.map.latLngToContainerPoint([lat, lon]);
  const shifted = state.map.containerPointToLatLng([point.x, point.y + offsetY]);
  state.map.panTo(shifted, { animate: true, duration: 0.3 });
}

// Open article in the player without auto-playing (read mode)
export async function openArticle(article) {
  stopPlayback();
  toast('Loading full article\u2026');
  let full;
  try {
    const sections = await fetchFullArticle(article.title);
    full = { ...article, sections };
  } catch (e) {
    toast('Failed to load: ' + e.message, 'error');
    return;
  }
  if (!full.sections.length) { toast('No content found', 'error'); return; }
  hideToast();
  state.currentArticle = full;
  state.currentSectionIdx = 0;
  state.currentChunks = chunkText(full.sections[0].text);
  state.currentChunkIdx = 0;
  // Close popup and recenter map to the article's pin
  if (state.map) {
    state.map.closePopup();
    if (full.lat != null && full.lon != null) {
      panToVisibleCenter(full.lat, full.lon);
    }
  }
  showPlayer();
  updatePlayerUI();
}

export async function startArticle(article) {
  stopPlayback();
  toast('Loading full article\u2026');
  let full;
  try {
    const sections = await fetchFullArticle(article.title);
    full = { ...article, sections };
  } catch (e) {
    toast('Failed to load: ' + e.message, 'error');
    return;
  }
  if (!full.sections.length) { toast('No content found', 'error'); return; }
  hideToast();
  state.currentArticle = full;
  state.currentSectionIdx = 0;
  highlightPlayingMarker(full.title);
  // Close popup and recenter map to the article's pin
  if (state.map) {
    state.map.closePopup();
    if (full.lat != null && full.lon != null) {
      panToVisibleCenter(full.lat, full.lon);
    }
  }
  playCurrentSection();
  showPlayer();
}

export function playCurrentSection() {
  const art = state.currentArticle;
  if (!art) return;
  const section = art.sections[state.currentSectionIdx];
  if (!section) { stopPlayback(); return; }
  state.currentChunks = chunkText(section.text);
  state.currentChunkIdx = 0;
  state.isPlaying = true;
  updatePlayerUI();
  speakNextChunk();
  refreshActivePopupButton();
}

export function speakNextChunk() {
  if (!state.isPlaying) return;
  if (state.currentChunkIdx >= state.currentChunks.length) {
    state.currentSectionIdx++;
    if (state.currentSectionIdx < state.currentArticle.sections.length) {
      playCurrentSection();
    } else {
      stopPlayback();
    }
    return;
  }

  const gen = utteranceGen;
  const chunk = state.currentChunks[state.currentChunkIdx];

  if (useHDVoice) {
    speakChunkHD(chunk, gen);
  } else {
    speakChunkLocal(chunk, gen);
  }
}

function speakChunkLocal(chunk, gen) {
  const utter = new SpeechSynthesisUtterance(chunk);
  utter.rate = SPEEDS[speedIdx]; utter.pitch = 1.0; utter.lang = 'en-US';
  if (cachedVoice) utter.voice = cachedVoice;
  utter.onend = () => { if (gen === utteranceGen && state.isPlaying) { state.currentChunkIdx++; updateArticleTextHighlight(); speakNextChunk(); } };
  utter.onerror = () => { if (gen === utteranceGen && state.isPlaying) { state.currentChunkIdx++; speakNextChunk(); } };
  window.speechSynthesis.speak(utter);
}

async function speakChunkHD(chunk, gen) {
  const key = `${state.currentSectionIdx}-${state.currentChunkIdx}`;
  try {
    // Use prefetched or cached audio if available, else fetch now
    let url;
    if (prefetchedAudio && prefetchedAudio.key === key) {
      url = prefetchedAudio.url;
      prefetchedAudio = null;
    } else if (hdAudioCache.has(key)) {
      url = hdAudioCache.get(key);
    } else {
      url = await fetchCloudAudio(chunk);
      hdAudioCache.set(key, url);
    }

    if (gen !== utteranceGen) return; // stale — user skipped or stopped

    // Reuse persistent Audio element to avoid iOS autoplay blocks
    // (initial user tap "unlocks" it; subsequent .src swaps + .play() work)
    hdAudioEl.pause();
    hdAudioEl.src = url;
    hdAudioEl.playbackRate = SPEEDS[speedIdx];
    currentHDAudio = hdAudioEl;

    // Start prefetching the next chunk while this one plays
    prefetchNextChunk();

    hdAudioEl.onended = () => {
      currentHDAudio = null;
      if (gen === utteranceGen && state.isPlaying) {
        state.currentChunkIdx++;
        updateArticleTextHighlight();
        speakNextChunk();
      }
    };
    hdAudioEl.onerror = () => {
      currentHDAudio = null;
      // Fallback to local voice on error
      if (gen === utteranceGen && state.isPlaying) speakChunkLocal(chunk, gen);
    };
    try {
      await hdAudioEl.play();
    } catch (playErr) {
      console.warn('HD audio play failed:', playErr.message);
      currentHDAudio = null;
      // Fallback to local voice (autoplay blocked or other issue)
      if (gen === utteranceGen && state.isPlaying) speakChunkLocal(chunk, gen);
    }
  } catch (fetchErr) {
    console.warn('HD audio fetch failed:', fetchErr.message);
    // Network error — fallback to local voice
    if (gen === utteranceGen && state.isPlaying) speakChunkLocal(chunk, gen);
  }
}

export function stopPlayback() {
  state.isPlaying = false;
  utteranceGen++;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  hdAudioEl.pause(); hdAudioEl.src = ''; currentHDAudio = null;
  hdAudioCache.clear();
  prefetchedAudio = null;
  clearPlayingMarker();
  state.currentArticle = null;
  state.currentSectionIdx = 0;
  state.currentChunks = [];
  state.currentChunkIdx = 0;
  hidePlayer();
  refreshActivePopupButton();
}

export function togglePause() {
  if (!state.currentArticle) return;
  if (state.isPlaying) {
    if (currentHDAudio) hdAudioEl.pause();
    else window.speechSynthesis.pause();
    state.isPlaying = false;
    updatePlayerUI();
  } else {
    // If TTS was never started (e.g. opened in read mode), start from current position
    const hasPendingSpeech = currentHDAudio || window.speechSynthesis.speaking || window.speechSynthesis.pending;
    if (hasPendingSpeech) {
      if (currentHDAudio) hdAudioEl.play();
      else window.speechSynthesis.resume();
      state.isPlaying = true;
      updatePlayerUI();
    } else {
      // Nothing queued — start playing from current chunk
      state.isPlaying = true;
      highlightPlayingMarker(state.currentArticle.title);
      updatePlayerUI();
      speakNextChunk();
      refreshActivePopupButton();
    }
  }
}

export function skipSection(dir) {
  if (!state.currentArticle) return;
  utteranceGen++;
  window.speechSynthesis.cancel();
  hdAudioEl.pause(); currentHDAudio = null;
  prefetchedAudio = null;
  state.currentSectionIdx += dir;
  if (state.currentSectionIdx < 0) state.currentSectionIdx = 0;
  if (state.currentSectionIdx >= state.currentArticle.sections.length) stopPlayback();
  else playCurrentSection();
}

export function jumpToSection(idx) {
  if (!state.currentArticle) return;
  utteranceGen++;
  window.speechSynthesis.cancel();
  hdAudioEl.pause(); currentHDAudio = null;
  prefetchedAudio = null;
  state.currentSectionIdx = idx;
  playCurrentSection();
}

export function cycleSpeed() {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  speedBtn.textContent = SPEEDS[speedIdx] + 'x';
  if (state.isPlaying) {
    if (currentHDAudio) {
      // HD voice: just change playback rate, no restart needed
      hdAudioEl.playbackRate = SPEEDS[speedIdx];
    } else {
      utteranceGen++;
      window.speechSynthesis.cancel();
      speakNextChunk();
    }
  }
}

// Snap points: translateY values (0 = fully visible, larger = more hidden)
function getSnapPoints() {
  return {
    hidden: window.innerHeight,
    open: 0,       // bottom-aligned, short height
    expanded: 0,   // bottom-aligned, full height
  };
}

export function snapTo(name, animate = true) {
  const snaps = getSnapPoints();
  const y = snaps[name];
  if (y == null) return;
  if (animate) {
    player.classList.remove('dragging');
    player.classList.add('snapping');
    const onDone = () => { player.classList.remove('snapping'); player.removeEventListener('transitionend', onDone); };
    player.addEventListener('transitionend', onDone);
  }
  player.style.transform = `translateY(${y}px)`;
  player.classList.remove('expanded', 'open');
  if (name === 'expanded') {
    playerExpanded = true;
    player.classList.add('expanded');
    player.style.height = '100vh';
    playerText.style.display = 'block';
    updateArticleTextHighlight();
  } else if (name === 'open') {
    playerExpanded = false;
    player.classList.add('open');
    player.style.height = '78vh';
    playerText.style.display = 'block';
    updateArticleTextHighlight();
  } else {
    playerExpanded = false;
    player.style.height = '100vh';
  }
}

export function expandPlayer() { snapTo('expanded'); }
export function collapsePlayer() { snapTo('hidden'); }
export function togglePlayerExpanded() {
  if (playerExpanded) snapTo('open');
  else expandPlayer();
}

export function showPlayer() {
  renderSectionsList();
  renderArticleText();
  // Show thumbnail if article has one
  const thumb = state.currentArticle?.thumb;
  if (thumb) {
    playerThumbImg.src = thumb;
    playerThumbImg.classList.add('visible');
  } else {
    playerThumbImg.src = '';
    playerThumbImg.classList.remove('visible');
  }
  playerText.style.display = 'block';
  // Hide "Search this area" while player is open
  document.getElementById('searchAreaBtn')?.classList.remove('visible');
  snapTo('open');
  updatePlayerUI();
}

export function hidePlayer() {
  snapTo('hidden');
  playerThumbImg.classList.remove('visible');
}

export function renderArticleText() {
  if (!state.currentArticle) return;
  let html = '';
  state.currentArticle.sections.forEach((sec, si) => {
    html += `<p class="pt-section-heading" data-si="${si}">${escHtml(sec.heading)}</p>`;
    const chunks = chunkText(sec.text);
    chunks.forEach((chunk, ci) => {
      html += `<p class="pt-chunk" data-si="${si}" data-ci="${ci}">${escHtml(chunk)}</p>`;
    });
  });
  playerText.innerHTML = html;
  playerText.querySelectorAll('.pt-chunk').forEach(el => {
    el.addEventListener('click', () => {
      const si = parseInt(el.dataset.si);
      const ci = parseInt(el.dataset.ci);
      utteranceGen++;
      window.speechSynthesis.cancel();
      hdAudioEl.pause(); currentHDAudio = null;
      prefetchedAudio = null;
      state.currentSectionIdx = si;
      const sec = state.currentArticle.sections[si];
      state.currentChunks = chunkText(sec.text);
      state.currentChunkIdx = ci;
      state.isPlaying = true;
      updatePlayerUI();
      speakNextChunk();
      refreshActivePopupButton();
    });
  });
}

export function updateArticleTextHighlight() {
  playerText.querySelectorAll('.pt-chunk').forEach(el => {
    const si = parseInt(el.dataset.si);
    const ci = parseInt(el.dataset.ci);
    el.classList.remove('active', 'done');
    if (si < state.currentSectionIdx) {
      el.classList.add('done');
    } else if (si === state.currentSectionIdx) {
      if (ci < state.currentChunkIdx) el.classList.add('done');
      else if (ci === state.currentChunkIdx) el.classList.add('active');
    }
  });
  playerText.querySelectorAll('.pt-section-heading').forEach(el => {
    const si = parseInt(el.dataset.si);
    el.style.color = si <= state.currentSectionIdx ? '#1a1a1a' : '#ccc';
  });
  const activeEl = playerText.querySelector('.pt-chunk.active');
  if (activeEl && playerExpanded) {
    scrollToChunk(activeEl);
  }
}

// Scroll playerText so a chunk is centered.
// Both el and playerText share the same offsetParent (#player),
// so subtracting their offsetTops gives position within the scroll area.
function scrollToChunk(el, smooth = true) {
  const posInContainer = el.offsetTop - playerText.offsetTop;
  const target = posInContainer - playerText.clientHeight / 2 + el.offsetHeight / 2;
  if (smooth) {
    playerText.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  } else {
    playerText.scrollTop = Math.max(0, target);
  }
}

// Kept as no-op for backwards compat with app.js exports
export function switchPlayerTab() {}

export function updatePlayerUI() {
  if (!state.currentArticle) return;
  playerTitle.textContent = state.currentArticle.title;
  const sec = state.currentArticle.sections[state.currentSectionIdx];
  const total = state.currentArticle.sections.length;
  const current = state.currentSectionIdx + 1;
  playerSectionLabel.textContent = sec ? sec.heading : '';
  const pct = total > 0 ? (current / total) * 100 : 0;
  playerProgressFill.style.width = pct + '%';
  playerProgressText.textContent = `${current} of ${total}`;
  playPauseIcon.innerHTML = state.isPlaying
    ? '<path d="M6 19h4V5H6zm8-14v14h4V5z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  updateSectionsList();
  updateArticleTextHighlight();
}

export function renderSectionsList() {
  if (!state.currentArticle) return;
  sectionsList.innerHTML = state.currentArticle.sections.map((sec, i) => `
    <div class="ps-item${i === state.currentSectionIdx ? ' active' : ''}${i < state.currentSectionIdx ? ' done' : ''}" data-idx="${i}">
      <div class="ps-num">${i + 1}</div>
      <div class="ps-name">${escHtml(sec.heading)}</div>
    </div>
  `).join('');
  sectionsList.querySelectorAll('.ps-item').forEach(el => {
    el.addEventListener('click', () => jumpToSection(parseInt(el.dataset.idx)));
  });
}

function updateSectionsList() {
  sectionsList.querySelectorAll('.ps-item').forEach((el, i) => {
    el.className = 'ps-item' +
      (i === state.currentSectionIdx ? ' active' : '') +
      (i < state.currentSectionIdx ? ' done' : '');
  });
  // Scroll active pill into view
  const active = sectionsList.querySelector('.ps-item.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function refreshActivePopupButton() {
  const root = document.querySelector('.leaflet-popup-content');
  if (!root) return;
  const btn = root.querySelector('#popupPlayBtn');
  const titleEl = root.querySelector('.popup-title');
  if (!btn || !titleEl) return;
  const title = titleEl.textContent;
  if (state.currentArticle && state.currentArticle.title === title && state.isPlaying) {
    btn.textContent = '\u23f9 Stop';
    btn.classList.add('playing');
  } else {
    btn.textContent = '\u25b6 Play article';
    btn.classList.remove('playing');
  }
}
