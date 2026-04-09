# Nearby Audio

Audio Wikipedia — a mobile-first web app that finds Wikipedia articles near your location and reads them aloud via TTS.

## What it does

1. Gets user location (or uses preset locations)
2. Queries Wikipedia geosearch API for articles within 1km
3. Displays categorized pins on a Leaflet map (sized by article length)
4. Tapping a pin shows article summary with thumbnail
5. "Play article" fetches full article via HTML API, strips HTML, chunks into sentences, and reads aloud via Web Speech API
6. Pull-up player with lyrics-style text reader, section list, and playback controls

## Architecture

Vanilla HTML/JS app using ES modules. No build step, no framework, no dependencies beyond Leaflet (loaded from CDN). Designed to work as a mobile PWA added to home screen.

### File structure
```
index.html          — Slim HTML shell (markup only, no logic)
css/styles.css      — All styles
js/
  state.js          — Shared app state object
  categories.js     — Article categories, classification, pin icons
  utils.js          — escHtml, formatDistance, chunkText, toast
  api.js            — Wikipedia geosearch + article fetch
  player.js         — TTS playback engine + player UI
  filters.js        — Category filter sheet
  map.js            — Leaflet map, markers, popups, geolocation
  search.js         — Nominatim geocoder + search input
  app.js            — Entry point: imports all modules, event wiring, init
tests.html          — 102 tests via iframe + window access
```

### Module load order
`app.js` is the single entry point (`<script type="module">`). It imports all other modules. For testability, `app.js` exposes key functions and state on `window`.

### APIs used
- **Wikipedia Geosearch**: `action=query&list=geosearch` — finds articles near coordinates
- **Wikipedia REST Summary**: `/page/summary/{title}` — thumbnail + extract for popups
- **Wikipedia REST HTML**: `/page/html/{title}` — full article content for TTS
- **Web Speech API**: `SpeechSynthesisUtterance` for text-to-speech
- **Nominatim**: Geocoding for search

### Key design decisions
- Light theme with CartoDB Voyager map tiles
- iOS-native feel: SF Pro font, backdrop-filter blur, safe-area-inset padding
- 10 article categories with color-coded SVG pin icons, classified from Wikipedia description field
- Pin size varies by article extract length (26/32/36px)
- Text chunked into ~200 char segments to avoid TTS cutting out on long text
- Sections like "References", "See also" are skipped for audio
- Player has three states: hidden → peek (compact, first chunk visible) → expanded (full controls + lyrics reader)

## Dev setup

```bash
# Local server (test on phone via local network)
python3 -m http.server 8000
# Then open http://<your-mac-ip>:8000 on your phone
```

## Testing

Open `tests.html` in a browser. Tests run automatically via an iframe that loads the app. All functions are accessible on `window` for testing (exposed by `app.js`).
