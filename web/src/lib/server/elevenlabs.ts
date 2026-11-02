// Server-only ElevenLabs proxy. The site owner's key lives in an environment
// variable (ELEVENLABS_API_KEY) and never reaches the browser. Visitors get
// the site's voices without a key of their own.
//
// Guards (this is a public demo, so assume anyone can call it):
// - same-site requests only (Origin/Referer must match the Host)
// - text length cap per request
// - optional voice allowlist (ELEVENLABS_VOICE_IDS)
// - best-effort per-IP rate limit (in memory, per server instance)
// The real spending backstop is a credit limit on the key in ElevenLabs.
import { z } from "zod";

const API = "https://api.elevenlabs.io";

/**
 * Environment variables read here:
 * ELEVENLABS_API_KEY (required to enable voices), ELEVENLABS_MODEL,
 * ELEVENLABS_DEFAULT_VOICE_ID, ELEVENLABS_DEFAULT_VOICE_ID_ES,
 * ELEVENLABS_VOICE_IDS (comma-separated allowlist).
 */
export type TtsEnv = Record<string, string | undefined>;

export const DEFAULT_MODEL = "eleven_v4_turbo";
export const MAX_TEXT = 700; // the longest approved line is ~450 characters
export const RATE_LIMIT = { requests: 240, windowMs: 10 * 60_000 }; // ~6 full calls per 10 minutes per IP

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

/** The key as pasted into a dashboard may carry spaces, newlines or quotes. */
export function cleanKey(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

/** ElevenLabs' short reason code (e.g. "missing_permissions"); never the key or full payload. */
async function upstreamReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: { status?: string; code?: string; message?: string } | string };
    const d = body.detail;
    const code = typeof d === "string" ? d : d?.status ?? d?.code;
    // Keep only a snake_case code like "missing_permissions"; drop free text.
    return code ? String(code).match(/[a-z][a-z0-9_]{2,40}/i)?.[0] ?? "" : "";
  } catch {
    return "";
  }
}

const allowlist = (env: TtsEnv) =>
  (env.ELEVENLABS_VOICE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Same-site only: the browser sends Origin on POST and fetch; Referer as a fallback. */
export function sameSite(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const from = req.headers.get("origin") ?? req.headers.get("referer");
  if (!host || !from) return false;
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}

const hits = new Map<string, number[]>();
export function rateLimited(req: Request, now = Date.now()): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return recent.length > RATE_LIMIT.requests;
}
export function resetRateLimit() {
  hits.clear();
}

// --- GET /api/voices ---------------------------------------------------------

let voiceCache: { at: number; key: string; voices: { id: string; label: string }[] } | null = null;

type RawVoice = { voice_id: string; name: string; category?: string; labels?: Record<string, string> };

async function fetchVoiceList(key: string, fetcher: typeof fetch): Promise<{ voices?: RawVoice[]; status?: number; reason?: string }> {
  const v2 = new URL(`${API}/v2/voices`);
  v2.searchParams.set("page_size", "100");
  let res = await fetcher(v2, { headers: { "xi-api-key": key } });
  // Older endpoint as a fallback if the newer one rejects the request.
  if (!res.ok && res.status !== 401) res = await fetcher(`${API}/v1/voices`, { headers: { "xi-api-key": key } });
  if (!res.ok) return { status: res.status, reason: await upstreamReason(res) };
  const body = (await res.json()) as { voices?: RawVoice[] };
  return { voices: body.voices ?? [] };
}

export async function handleVoices(req: Request, env: TtsEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const key = cleanKey(env.ELEVENLABS_API_KEY);
  if (!key) return json({ configured: false, voices: [] });
  if (!sameSite(req)) return json({ error: "Not allowed." }, 403);
  const allow = allowlist(env);
  const model = (env.ELEVENLABS_MODEL || DEFAULT_MODEL).trim();
  const defEn = env.ELEVENLABS_DEFAULT_VOICE_ID?.trim() || null;
  const defEs = env.ELEVENLABS_DEFAULT_VOICE_ID_ES?.trim() || defEn;

  let listError: string | undefined;
  if (!voiceCache || voiceCache.key !== key || Date.now() - voiceCache.at > 10 * 60_000) {
    const r = await fetchVoiceList(key, fetcher);
    if (r.voices) {
      voiceCache = {
        at: Date.now(),
        key,
        voices: r.voices
          .map((v) => {
            const bits = [v.labels?.accent, v.labels?.gender].filter(Boolean);
            return { id: v.voice_id, label: bits.length ? `${v.name} (${bits.join(", ")})` : v.name };
          })
          .sort((a, b) => a.label.localeCompare(b.label)),
      };
    } else {
      listError = `ElevenLabs error ${r.status}${r.reason ? `: ${r.reason}` : ""}`;
    }
  }

  let voices = voiceCache && voiceCache.key === key ? voiceCache.voices : [];
  if (allow.length) voices = voices.filter((v) => allow.includes(v.id));
  // Listing can fail (e.g. a key without "Voices: read") while speech still
  // works: offer the configured default voices in that case.
  if (!voices.length) {
    const ids = [...new Set([defEn, defEs, ...allow].filter((x): x is string => Boolean(x)))];
    voices = ids.map((id, i) => ({ id, label: id === defEn ? "Site voice (English)" : id === defEs ? "Site voice (Spanish)" : `Site voice ${i + 1}` }));
  }
  if (!voices.length) return json({ configured: true, voices: [], error: listError ?? "No voices available." }, listError ? 502 : 200);
  return json({ configured: true, model, defaults: { en: defEn ?? voices[0].id, es: defEs ?? voices[0].id }, voices, ...(listError ? { warning: listError } : {}) });
}

// --- POST /api/tts -------------------------------------------------------------

const TtsBody = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT),
  voiceId: z.string().regex(/^[A-Za-z0-9]{10,40}$/),
  speed: z.number().min(0.5).max(2).default(1),
});

export async function handleTts(req: Request, env: TtsEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const key = cleanKey(env.ELEVENLABS_API_KEY);
  if (!key) return json({ error: "ElevenLabs isn't set up on this site." }, 503);
  if (!sameSite(req)) return json({ error: "Not allowed." }, 403);
  if (rateLimited(req)) return json({ error: "Too many requests. Try again in a few minutes." }, 429, { "Retry-After": "120" });

  let body: z.infer<typeof TtsBody>;
  try {
    const parsed = TtsBody.safeParse(await req.json());
    if (!parsed.success) return json({ error: `Bad request: ${parsed.error.issues[0]?.message}` }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "Bad request: expected JSON." }, 400);
  }
  const allow = allowlist(env);
  if (allow.length && !allow.includes(body.voiceId)) return json({ error: "That voice isn't available on this site." }, 403);

  const upstream = await fetcher(`${API}/v1/text-to-speech/${encodeURIComponent(body.voiceId)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: body.text,
      model_id: (env.ELEVENLABS_MODEL || DEFAULT_MODEL).trim(),
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, body.speed)) },
    }),
  });
  if (!upstream.ok || !upstream.body) {
    // Don't leak upstream details; the status tells the client whether to fall back.
    const status = upstream.status === 401 ? 502 : upstream.status === 429 || upstream.status === 402 ? 429 : 502;
    const reason = await upstreamReason(upstream);
    return json({ error: `ElevenLabs error ${upstream.status}${reason ? `: ${reason}` : ""}` }, status);
  }
  return new Response(upstream.body, { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
