"use client";
// ElevenLabs voices provided by the site. The browser never holds an
// ElevenLabs key: it asks this site's /api/voices and /api/tts routes, and the
// server adds the site owner's key (see src/lib/server/elevenlabs.ts).

export class ElevenLabsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export type ElevenVoice = { id: string; label: string };
export type SiteVoices = {
  configured: boolean;
  model?: string;
  defaults?: { en: string | null; es: string | null };
  voices: ElevenVoice[];
  error?: string;
};

let siteVoices: Promise<SiteVoices> | null = null;

/** Whether this site provides ElevenLabs voices, and which ones. Cached per page load. */
export function getSiteVoices(): Promise<SiteVoices> {
  if (!siteVoices) {
    siteVoices = fetch("/api/voices", { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as Partial<SiteVoices>;
        return { configured: Boolean(body.configured), model: body.model, defaults: body.defaults, voices: body.voices ?? [], error: r.ok ? undefined : body.error ?? `Error ${r.status}` };
      })
      .catch(() => ({ configured: false, voices: [], error: "Couldn't reach this site's voice service." }));
    // Retry after a failure on the next request.
    siteVoices.then((v) => { if (v.error) siteVoices = null; });
  }
  return siteVoices;
}

// Repeated lines (disclosure, "One moment.", fixed replies) are cached for the
// session, like the PRD's pre-rendered greeting and consent audio.
const cache = new Map<string, Promise<Blob>>();
const MAX_CACHE = 60;

function explain(status: number, fallback?: string): string {
  if (status === 429) return "This site's voice limit was reached for now.";
  if (status === 503) return "ElevenLabs isn't set up on this site.";
  if (status === 403) return "That voice isn't available.";
  return fallback ?? `Voice service error ${status}.`;
}

async function synthesize(text: string, o: { voiceId: string; speed: number }): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId: o.voiceId, speed: o.speed }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ElevenLabsError(explain(res.status, body.error), res.status);
  }
  return res.blob();
}

function getAudio(text: string, o: { voiceId: string; speed: number }): Promise<Blob> {
  const key = `${o.voiceId}|${o.speed.toFixed(2)}|${text}`;
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

/** Speak one line with a site voice. Resolves when playback ends; throws on failure. */
export async function speakEleven(text: string, o: { voiceId: string; speed: number }): Promise<void> {
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
