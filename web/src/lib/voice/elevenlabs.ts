"use client";
// ElevenLabs text-to-speech, called straight from the browser with the user's
// own key (Track A; the API allows cross-origin requests). Only the agent's
// voice goes through ElevenLabs — listening and the call logic stay local.
// Before real patient calls this needs a BAA and a server-side key (Track B).

const API = "https://api.elevenlabs.io";

export const DEFAULT_ELEVEN_MODEL = "eleven_v4_turbo";

export class ElevenLabsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export type ElevenVoice = { id: string; name: string; label: string };

function explain(status: number): string {
  if (status === 401) return "ElevenLabs rejected the API key.";
  if (status === 402 || status === 429) return "ElevenLabs quota or rate limit reached.";
  if (status === 422) return "ElevenLabs didn't accept the request (check the model ID).";
  return `ElevenLabs error ${status}.`;
}

/** The account's voices (premade, cloned and designed), up to 300. */
export async function listElevenVoices(apiKey: string, signal?: AbortSignal): Promise<ElevenVoice[]> {
  const out: ElevenVoice[] = [];
  let token: string | null = null;
  for (let page = 0; page < 3; page++) {
    const url = new URL(`${API}/v2/voices`);
    url.searchParams.set("page_size", "100");
    url.searchParams.set("sort", "name");
    url.searchParams.set("sort_direction", "asc");
    if (token) url.searchParams.set("next_page_token", token);
    const res = await fetch(url, { headers: { "xi-api-key": apiKey }, signal });
    if (!res.ok) throw new ElevenLabsError(explain(res.status), res.status);
    const body = (await res.json()) as {
      voices: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    for (const v of body.voices) {
      const bits = [v.labels?.accent, v.labels?.gender, v.category].filter(Boolean);
      out.push({ id: v.voice_id, name: v.name, label: bits.length ? `${v.name} (${bits.join(", ")})` : v.name });
    }
    if (!body.has_more || !body.next_page_token) break;
    token = body.next_page_token;
  }
  return out;
}

// Repeated lines (disclosure, "One moment.", fixed replies) are cached for the
// session, like the PRD's pre-rendered greeting and consent audio.
const cache = new Map<string, Promise<Blob>>();
const MAX_CACHE = 60;

async function synthesize(text: string, o: { apiKey: string; voiceId: string; model: string; speed: number }): Promise<Blob> {
  const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(o.voiceId)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": o.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: o.model,
      // Keep speed in the range ElevenLabs has historically accepted.
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, o.speed)) },
    }),
  });
  if (!res.ok) throw new ElevenLabsError(explain(res.status), res.status);
  return res.blob();
}

function getAudio(text: string, o: { apiKey: string; voiceId: string; model: string; speed: number }): Promise<Blob> {
  const key = `${o.model}|${o.voiceId}|${o.speed.toFixed(2)}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = synthesize(text, o);
  p.catch(() => cache.delete(key)); // don't keep failures
  cache.set(key, p);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let currentDone: (() => void) | null = null;

export function stopEleven() {
  if (current) {
    current.pause();
    current.src = "";
  }
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  current = null;
  currentUrl = null;
  currentDone?.();
  currentDone = null;
}

/** Speak one line. Resolves when playback ends; throws if ElevenLabs fails. */
export async function speakEleven(text: string, o: { apiKey: string; voiceId: string; model: string; speed: number }): Promise<void> {
  const blob = await getAudio(text, o);
  stopEleven();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  current = audio;
  currentUrl = url;
  await new Promise<void>((resolve, reject) => {
    currentDone = resolve;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new ElevenLabsError("Couldn't play the ElevenLabs audio."));
    audio.play().catch((e) => reject(new ElevenLabsError(e instanceof Error ? e.message : "Playback was blocked.")));
  });
  if (current === audio) {
    URL.revokeObjectURL(url);
    current = null;
    currentUrl = null;
    currentDone = null;
  }
}
