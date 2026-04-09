import { chunkText, escHtml, toast, hideToast } from './utils.js';
import { fetchFullArticle } from './api.js';
import { state } from './state.js';

// DOM refs
const player = document.getElementById('player');
const playerTitle = document.getElementById('playerTitle');
const playerSectionLabel = document.getElementById('playerSectionLabel');
const playerProgressFill = document.getElementById('playerProgressFill');
const playerProgressText = document.getElementById('playerProgressText');
const playPauseIcon = document.getElementById('playPauseIcon');
const speedBtn = document.getElementById('speedBtn');
const sleepBtn = document.getElementById('sleepBtn');
const sectionsList = document.getElementById('sectionsList');
const playerText = document.getElementById('playerText');
const tabText = document.getElementById('tabText');
const tabSections = document.getElementById('tabSections');

export const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5];
export let speedIdx = 1;
export let playerExpanded = false;
export let playerPeek = false;
let activePlayerTab = 'text';
let utteranceGen = 0; // generation counter to ignore stale onend/onerror callbacks

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
    if (state.currentSectionIdx < state.currentArticle.sections.length) playCurrentSection();
    else stopPlayback();
    return;
  }
  const chunk = state.currentChunks[state.currentChunkIdx];
  const utter = new SpeechSynthesisUtterance(chunk);
  utter.rate = SPEEDS[speedIdx]; utter.pitch = 1.0; utter.lang = 'en-US';
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /en[-_]US/i.test(v.lang) && /samantha|alex|karen|daniel/i.test(v.name))
                 || voices.find(v => /en[-_]US/i.test(v.lang));
  if (preferred) utter.voice = preferred;
  const gen = utteranceGen;
  utter.onend = () => { if (gen === utteranceGen && state.isPlaying) { state.currentChunkIdx++; updateArticleTextHighlight(); speakNextChunk(); } };
  utter.onerror = () => { if (gen === utteranceGen && state.isPlaying) { state.currentChunkIdx++; speakNextChunk(); } };
  window.speechSynthesis.speak(utter);
}

export function stopPlayback() {
  state.isPlaying = false;
  utteranceGen++;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
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
    window.speechSynthesis.pause();
    state.isPlaying = false;
  } else {
    window.speechSynthesis.resume();
    state.isPlaying = true;
  }
  updatePlayerUI();
}

export function skipSection(dir) {
  if (!state.currentArticle) return;
  utteranceGen++;
  window.speechSynthesis.cancel();
  state.currentSectionIdx += dir;
  if (state.currentSectionIdx < 0) state.currentSectionIdx = 0;
  if (state.currentSectionIdx >= state.currentArticle.sections.length) stopPlayback();
  else playCurrentSection();
}

export function jumpToSection(idx) {
  if (!state.currentArticle) return;
  utteranceGen++;
  window.speechSynthesis.cancel();
  state.currentSectionIdx = idx;
  playCurrentSection();
}

export function cycleSpeed() {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  speedBtn.textContent = SPEEDS[speedIdx] + 'x';
  if (state.isPlaying) {
    utteranceGen++;
    window.speechSynthesis.cancel();
    speakNextChunk();
  }
}

// Snap points: translateY values (0 = fully visible, larger = more hidden)
// These are computed relative to the player's 85vh height
function getSnapPoints() {
  const playerH = player.offsetHeight || window.innerHeight * 0.85;
  return {
    hidden: playerH,             // fully offscreen
    peek: playerH - 160,         // ~160px visible (handle + title + first chunk)
    expanded: 0,                 // fully visible
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
  // Update state classes after transition
  if (name === 'expanded') {
    playerExpanded = true;
    playerPeek = false;
    player.classList.add('expanded');
    player.classList.remove('peek');
    switchPlayerTab(activePlayerTab);
    updateArticleTextHighlight();
  } else if (name === 'peek') {
    playerExpanded = false;
    playerPeek = true;
    player.classList.remove('expanded');
    player.classList.add('peek');
    playerText.style.display = activePlayerTab === 'text' ? 'block' : 'none';
    document.getElementById('playerSections').style.display = activePlayerTab === 'sections' ? 'block' : 'none';
  } else {
    playerExpanded = false;
    playerPeek = false;
    player.classList.remove('expanded', 'peek');
  }
}

export function expandPlayer() { snapTo('expanded'); }
export function collapsePlayer() { snapTo('peek'); }
export function togglePlayerExpanded() {
  if (playerExpanded) collapsePlayer();
  else expandPlayer();
}

export function showPlayer() {
  renderSectionsList();
  renderArticleText();
  activePlayerTab = 'text';
  playerText.style.display = 'block';
  document.getElementById('playerSections').style.display = 'none';
  snapTo('peek');
  updatePlayerUI();
}

export function hidePlayer() {
  snapTo('hidden');
  activePlayerTab = 'text';
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
  const activeChunk = playerText.querySelector('.pt-chunk.active');
  if (activeChunk && playerExpanded) {
    activeChunk.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export function switchPlayerTab(tab) {
  activePlayerTab = tab;
  tabText.classList.toggle('active', tab === 'text');
  tabSections.classList.toggle('active', tab === 'sections');
  if (!playerExpanded && !playerPeek) return;
  if (tab === 'text') {
    playerText.style.display = 'block';
    document.getElementById('playerSections').style.display = 'none';
  } else {
    playerText.style.display = 'none';
    document.getElementById('playerSections').style.display = 'block';
  }
}

export function updatePlayerUI() {
  if (!state.currentArticle) return;
  playerTitle.textContent = state.currentArticle.title;
  const sec = state.currentArticle.sections[state.currentSectionIdx];
  const total = state.currentArticle.sections.length;
  const current = state.currentSectionIdx + 1;
  playerSectionLabel.textContent = sec ? sec.heading : '';
  sleepBtn.textContent = `${current}/${total}`;
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
