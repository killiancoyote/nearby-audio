# Nearby Audio

Audio Wikipedia — a mobile-first web app that finds Wikipedia articles near your location and reads them aloud via TTS.

## What it does

1. Gets user location (or uses preset locations)
2. Queries Wikipedia geosearch API for articles within 1km
3. Displays pins on a dark-themed Leaflet map
4. Tapping a pin shows article summary with thumbnail
5. "Play article" fetches full article via mobile-sections API, strips HTML, chunks into sentences, and reads aloud via Web Speech API
6. Now-playing bar with pause/resume and skip-section controls

## Architecture

Single-file vanilla HTML/JS app. No build step, no framework, no dependencies beyond Leaflet (loaded from CDN). Designed to work as a mobile PWA added to home screen.

### APIs used
- **Wikipedia Geosearch**: `action=query&list=geosearch` — finds articles near coordinates
- **Wikipedia REST Summary**: `/page/summary/{title}` — thumbnail + extract for popups
- **Wikipedia Mobile Sections**: `/page/mobile-sections/{title}` — full article content for TTS
- **Web Speech API**: `SpeechSynthesisUtterance` for text-to-speech

### Key design decisions
- Dark theme with inverted map tiles (filter: invert + hue-rotate on tile pane)
- iOS-native feel: SF Pro font, backdrop-filter blur, safe-area-inset padding
- Text chunked into ~200 char segments to avoid TTS cutting out on long text
- Sections like "References", "See also" are skipped for audio
- Preset locations for demo/testing without requiring geolocation permission

## Roadmap

### Near-term
- Live location tracking during walks (watchPosition instead of single getCurrentPosition)
- Auto-play on proximity — when you walk within X meters of a pin, start reading
- Better TTS voice selection (prefer higher-quality system voices)
- PWA manifest + service worker for Add to Home Screen + offline map tiles

### Medium-term
- Walking route mode — plan a path and queue articles along it
- Audio controls: playback speed, rewind 15s, section list
- Filter by article type/category
- Cache fetched articles for offline playback

### Long-term
- Native Swift port for background audio, lock screen controls, better TTS
- Multi-language support (Wikipedia exists in 300+ languages)
- Custom audio content beyond Wikipedia

## Dev setup

```bash
# Local server (test on phone via local network)
python3 -m http.server 8000
# Then open http://<your-mac-ip>:8000 on your phone
```
