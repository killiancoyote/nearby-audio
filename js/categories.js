export const CATEGORIES = [
  { id: 'museum',    color: '#8B5CF6', keywords: /museum|gallery|exhibit|art\s+center/i,
    icon: '<path d="M2 20h20v2H2zm2-2h16V8l-8-5-8 5zm2-2v-6h12v6zm4-4v4h4v-4z"/>' },
  { id: 'park',      color: '#22C55E', keywords: /park|garden|forest|nature|lake|river|beach|botanical|zoo|wildlife|wetland|reserve/i,
    icon: '<path d="M17 8c.7 0 1.38.1 2.02.27C18.13 5.26 15.31 3 12 3 8.1 3 4.87 5.88 4.15 9.73A5.5 5.5 0 001 15a5.5 5.5 0 005.5 5.5h10A5.5 5.5 0 0022 15c0-2.64-1.83-4.86-4.3-5.42A6.97 6.97 0 0017 8z"/>' },
  { id: 'religion',  color: '#F59E0B', keywords: /church|cathedral|mosque|synagogue|temple|chapel|monastery|basilica|parish|convent|abbey|priory|shrine/i,
    icon: '<path d="M11 2v4H8v2h3v3H8l4 4 4-4h-3V8h3V6h-3V2zm-6 9l-4 4h3v7h2v-7h3zm14 0l-4 4h3v7h2v-7h3z"/>' },
  { id: 'education', color: '#3B82F6', keywords: /school|university|college|academy|library|institute|campus/i,
    icon: '<path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/>' },
  { id: 'transport', color: '#6B7280', keywords: /station|railway|railroad|airport|bridge|tunnel|ferry|subway|metro|terminal|port|highway|pier/i,
    icon: '<path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h12v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-4-4-8-4zm-3 14c-.83 0-1.5-.67-1.5-1.5S8.17 13 9 13s1.5.67 1.5 1.5S9.83 16 9 16zm6 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM18 11H6V6h12v5z"/>' },
  { id: 'building',  color: '#EF4444', keywords: /building|skyscraper|tower|complex|plaza|center|centre|arena|stadium|venue|hall|palace|castle|fort/i,
    icon: '<path d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z"/>' },
  { id: 'historic',  color: '#D97706', keywords: /historic|monument|memorial|statue|landmark|cemetery|heritage|battlefield|ruins|archaeological/i,
    icon: '<path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>' },
  { id: 'residence', color: '#EC4899', keywords: /house|residence|home|apartment|estate|mansion|villa|cottage/i,
    icon: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>' },
  { id: 'food',      color: '#F97316', keywords: /restaurant|cafe|bar|brewery|bakery|diner|pub|bistro|tavern/i,
    icon: '<path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>' },
  { id: 'health',    color: '#10B981', keywords: /hospital|clinic|medical|health|fire\s+station|police|post\s+office/i,
    icon: '<path d="M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z"/>' },
];

export const DEFAULT_CAT = { id: 'default', color: '#94A3B8',
  icon: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>'
};

export function classifyArticle(description) {
  if (!description) return DEFAULT_CAT;
  for (const cat of CATEGORIES) {
    if (cat.keywords.test(description)) return cat;
  }
  return DEFAULT_CAT;
}

export function makePinIcon(cat, delay, size) {
  size = size || 32;
  const half = size / 2;
  return L.divIcon({
    className: '',
    html: `<div class="cat-pin" style="background:${cat.color};animation-delay:${delay}ms;width:${size}px;height:${size}px"><svg viewBox="0 0 24 24">${cat.icon}</svg></div>`,
    iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half + 2],
  });
}
