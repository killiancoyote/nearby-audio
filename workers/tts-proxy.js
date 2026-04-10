/**
 * Cloudflare Worker: TTS Proxy for Google Cloud Text-to-Speech
 *
 * Keeps the API key secret. Accepts POST requests with {text, voice},
 * calls Google Cloud TTS, returns MP3 audio bytes.
 *
 * Deploy:
 *   npx wrangler deploy workers/tts-proxy.js --name tts-proxy
 *   npx wrangler secret put GOOGLE_TTS_API_KEY
 *
 * Environment variables (set via wrangler secret):
 *   GOOGLE_TTS_API_KEY — your Google Cloud API key
 */

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

// Allowed origins (update with your domain)
const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'https://killiancoyote.github.io',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders(origin) });
    }

    const { text, voice = 'en-US-Chirp3-HD-Charon' } = body;
    if (!text || typeof text !== 'string' || text.length > 5000) {
      return new Response('Invalid text (max 5000 chars)', { status: 400, headers: corsHeaders(origin) });
    }

    // Call Google Cloud TTS
    const googleRes = await fetch(`${GOOGLE_TTS_URL}?key=${env.GOOGLE_TTS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.substring(0, 5), name: voice },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });

    if (!googleRes.ok) {
      const err = await googleRes.text();
      console.error('Google TTS error:', err);
      return new Response('TTS synthesis failed', { status: 502, headers: corsHeaders(origin) });
    }

    const { audioContent } = await googleRes.json();
    // audioContent is base64-encoded MP3 — decode to binary
    const audioBytes = Uint8Array.from(atob(audioContent), c => c.charCodeAt(0));

    return new Response(audioBytes, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400', // cache 24h
      },
    });
  },
};
