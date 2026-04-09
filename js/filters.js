import { CATEGORIES, DEFAULT_CAT } from './categories.js';
import { state } from './state.js';

const filterBtn = document.getElementById('filterBtn');
const filterSheet = document.getElementById('filterSheet');

export const activeFilters = new Set([...CATEGORIES.map(c => c.id), 'default']);
export let allFetchedArticles = [];
let filterSheetOpen = false;

export function setAllFetchedArticles(articles) {
  allFetchedArticles = articles;
}

export function buildFilterBar() {
  renderFilterSheet();
}

function renderFilterSheet() {
  const allCats = [...CATEGORIES, DEFAULT_CAT];
  filterSheet.innerHTML = allCats.map(c => {
    const label = c.id === 'default' ? 'Other' : c.id.charAt(0).toUpperCase() + c.id.slice(1);
    const on = activeFilters.has(c.id);
    return `<div class="filter-row ${on ? 'on' : 'off'}" data-cat="${c.id}">
      <span class="fr-dot" style="background:${c.color}"></span>
      <span class="fr-label">${label}</span>
      <span class="fr-check"></span>
    </div>`;
  }).join('');
  filterSheet.querySelectorAll('.filter-row').forEach(el => {
    el.addEventListener('click', () => {
      const cat = el.dataset.cat;
      if (activeFilters.has(cat)) activeFilters.delete(cat);
      else activeFilters.add(cat);
      el.classList.toggle('on', activeFilters.has(cat));
      el.classList.toggle('off', !activeFilters.has(cat));
      applyFilters();
      updateFilterBtnState();
    });
  });
}

export function toggleFilterSheet() {
  filterSheetOpen = !filterSheetOpen;
  filterSheet.classList.toggle('visible', filterSheetOpen);
}

export function closeFilterSheet() {
  filterSheetOpen = false;
  filterSheet.classList.remove('visible');
}

function updateFilterBtnState() {
  const totalCats = CATEGORIES.length + 1;
  filterBtn.classList.toggle('has-filter', activeFilters.size < totalCats);
}

export function applyFilters() {
  state.articleMarkers.forEach((m, i) => {
    const a = allFetchedArticles[i];
    if (!a) return;
    const cat = a._category || DEFAULT_CAT;
    if (activeFilters.has(cat.id)) {
      if (m.getElement()) m.getElement().style.display = '';
      m.setOpacity(1);
    } else {
      m.setOpacity(0);
      if (m.getElement()) m.getElement().style.display = 'none';
    }
  });
}
