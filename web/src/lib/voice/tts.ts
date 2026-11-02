"use client";
// One place that decides which voice speaks a line. The site's ElevenLabs
// voices are used when this site provides them and the visitor hasn't chosen
// browser voices; any failure falls back to the browser voice so a call never
// goes silent.
import type { Lang } from "../call/types";
import { getSettings } from "../settings";
import { speak as speakBrowser, stopSpeaking as stopBrowser } from "./webspeech";
import { getSiteVoices, speakEleven, stopEleven, ElevenLabsError } from "./elevenlabs";

export type SpeakResult = { provider: "browser" | "elevenlabs"; fallbackReason?: string };

/** The ElevenLabs voice to use for a language, or null for browser voices. */
export async function siteVoiceFor(lang: Lang): Promise<string | null> {
  const s = getSettings();
  if (s.ttsProvider !== "elevenlabs") return null;
  const site = await getSiteVoices();
  if (!site.configured || !site.voices.length) return null;
  const chosen = s.elevenVoice[lang];
  if (chosen && site.voices.some((v) => v.id === chosen)) return chosen;
  return site.defaults?.[lang] ?? site.voices[0].id;
}

export async function speakLine(text: string, lang: Lang, rate: number): Promise<SpeakResult> {
  const s = getSettings();
  const voiceId = await siteVoiceFor(lang);
  if (voiceId) {
    try {
      await speakEleven(text, { voiceId, speed: rate });
      return { provider: "elevenlabs" };
    } catch (e) {
      const reason = e instanceof ElevenLabsError ? e.message : "ElevenLabs failed.";
      await speakBrowser(text, lang, rate, s.voice[lang] || undefined);
      return { provider: "browser", fallbackReason: reason };
    }
  }
  await speakBrowser(text, lang, rate, s.voice[lang] || undefined);
  return { provider: "browser" };
}

export function stopAllSpeech() {
  stopEleven();
  stopBrowser();
}
