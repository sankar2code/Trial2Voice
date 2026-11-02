"use client";
// One place that decides which voice speaks a line. ElevenLabs is used when
// it's selected and set up; any failure falls back to the browser voice so a
// call never goes silent.
import type { Lang } from "../call/types";
import { getSettings } from "../settings";
import { speak as speakBrowser, stopSpeaking as stopBrowser } from "./webspeech";
import { speakEleven, stopEleven, ElevenLabsError } from "./elevenlabs";

export type SpeakResult = { provider: "browser" | "elevenlabs"; fallbackReason?: string };

export function elevenReady(): boolean {
  const s = getSettings();
  return s.ttsProvider === "elevenlabs" && Boolean(s.elevenApiKey);
}

export async function speakLine(text: string, lang: Lang, rate: number): Promise<SpeakResult> {
  const s = getSettings();
  const voiceId = s.elevenVoice[lang];
  if (s.ttsProvider === "elevenlabs" && s.elevenApiKey && voiceId) {
    try {
      await speakEleven(text, { apiKey: s.elevenApiKey, voiceId, model: s.elevenModel, speed: rate });
      return { provider: "elevenlabs" };
    } catch (e) {
      const reason = e instanceof ElevenLabsError ? e.message : "ElevenLabs failed.";
      await speakBrowser(text, lang, rate, s.voice[lang] || undefined);
      return { provider: "browser", fallbackReason: reason };
    }
  }
  const reason = s.ttsProvider === "elevenlabs" ? (s.elevenApiKey ? `No ElevenLabs voice chosen for ${lang === "es" ? "Spanish" : "English"}.` : "No ElevenLabs key saved.") : undefined;
  await speakBrowser(text, lang, rate, s.voice[lang] || undefined);
  return { provider: "browser", fallbackReason: reason };
}

export function stopAllSpeech() {
  stopEleven();
  stopBrowser();
}
