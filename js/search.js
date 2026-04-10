import { escHtml } from './utils.js?v=14';

const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const searchResults = document.getElementById('searchResults');

let searchTimeout = null;

async function searchPlaces(query) {
  if (!query || query.length < 2) { hideSearchResults(); return; }
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    showSearchResults(data);
  } catch (e) {
    hideSearchResults();
  }
}

function showSearchResults(results) {
  if (!results.length) { hideSearchResults(); return; }
  searchResults.innerHTML = results.map((r, i) => `
    <div class="sr-item" data-idx="${i}">
      <div class="sr-name">${escHtml(r.display_name.split(',')[0])}</div>
      <div class="sr-detail">${escHtml(r.display_name.split(',').slice(1, 3).join(',').trim())}</div>
    </div>
  `).join('');
  searchResults.classList.add('visible');
  searchResults.querySelectorAll('.sr-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      const r = results[i];
      const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
      searchInput.value = r.display_name.split(',')[0];
      hideSearchResults();
      // Use the wrapped version from app.js (sets lastLoadedCenter/Zoom)
      (window.loadNearbyAt || (() => {}))(lat, lon);
    });
  });
}

export function hideSearchResults() {
  searchResults.classList.remove('visible');
  searchResults.innerHTML = '';
}

// Wire up search input events
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  searchClear.style.display = q ? 'block' : 'none';
  searchTimeout = setTimeout(() => searchPlaces(q), 300);
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length >= 2) searchPlaces(searchInput.value.trim());
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  hideSearchResults();
});
