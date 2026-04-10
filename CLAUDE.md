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

### Cloud TTS
- **Cloudflare Worker** at `https://tts-proxy.killianc.workers.dev` proxies to Google Cloud TTS Chirp 3 HD
- API key stored as Cloudflare secret (`GOOGLE_TTS_API_KEY`), never exposed to browser
- Deploy with `cd workers && npx wrangler deploy`
- 1M free chars/month, ~$0.09-0.15 per article after that

## Dev setup

```bash
# Local server (test on phone via local network)
python3 -m http.server 8000
# Then open http://<your-mac-ip>:8000 on your phone
```

## Preview & debugging (IMPORTANT — read before using Claude Preview)

### The ES module caching problem

The preview browser aggressively caches ES modules and CSS. `location.reload(true)`, `cache: 'no-store'` fetches, restarting the preview server, and `?v=N` query params on `index.html` **do NOT bust the module cache**. The browser caches each module by its full URL, and sub-imports (e.g. `map.js` importing `categories.js`) are cached independently from the parent.

### What DOES work to bust the cache

1. **Stop the preview server, then start it again** — sometimes works for CSS but rarely for JS modules.
2. **For CSS only**: Add `?v=N` to the `<link>` tag in `index.html`, reload, then remove it after testing. This works because CSS isn't part of the module graph.
3. **For JS modules**: The only reliable approach is to **change the filename** of every module in the import chain:
   - Copy the changed files to new names (e.g. `categories.js` → `categories2.js`)
   - Update all `import` statements to reference the new names
   - Update `index.html` if `app.js` was renamed
   - Test with the new filenames
   - After verifying, rename everything back and delete the copies
4. **Dynamic import for quick checks**: `import('/js/foo.js?' + Date.now())` can verify the file content is correct on disk, but this only affects the dynamically imported module — it does NOT update references held by other cached modules.

### Recommended workflow for previewing changes

1. Make your code changes to the real files (e.g. `categories.js`, `map.js`, `styles.css`)
2. For a **quick CSS-only check**: add `?v=N` to the stylesheet link, screenshot, then revert
3. For **JS changes**: copy changed files to temp names, update imports, test, then clean up
4. **Always verify the new code is active** before testing behavior:
   - Check function `.length` (param count) for modified functions
   - Check `document.querySelectorAll('.new-class').length` for new DOM elements
   - Use `fetch('/js/file.js', {cache:'no-store'}).then(r=>r.text()).then(t=>console.log(t.includes('newFunction')))` to verify the file on disk is correct
5. **After testing**: revert all temp filenames, remove cache-bust params, ensure `git diff` only shows real changes

### Other preview gotchas

- **Python HTTP server caching**: `python3 -m http.server` can serve stale files. Restarting the server helps but doesn't fix browser-side module cache.
- **`fetch()` vs module cache**: `fetch('/js/file.js', {cache:'no-store'})` bypasses HTTP cache and returns fresh content, but the ES module loader has its own separate cache that `fetch()` cannot clear.
- **Screenshot failures**: `preview_screenshot` occasionally fails with "Current display surface not available for capture". Just retry — it usually works on the second attempt.
- **`preview_eval` variable conflicts**: Variables declared with `const`/`let` in eval persist across calls. Use IIFEs `(() => { ... })()` to avoid "Identifier already declared" errors.
- **Wikipedia image URLs**: Some Wikipedia thumbnail URLs fail to load in the preview browser (return 0x0 natural dimensions). Test with a known-good URL like `https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/120px-Apple_logo_black.svg.png` first to isolate image loading issues from CSS issues.

## Testing

Open `tests.html` in a browser. Tests run automatically via an iframe that loads the app. All functions are accessible on `window` for testing (exposed by `app.js`).
