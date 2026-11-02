"use client";
// Per-browser settings. The API key is stored only in this browser's
// localStorage and is sent only to api.anthropic.com. ElevenLabs voices are
// provided by the site (server-side key), so visitors never enter one.
import { useSyncExternalStore } from "react";
import { DEFAULT_BUILD_MODEL } from "./script/builder";
import { DEFAULT_CALL_MODEL } from "./call/llmInterpreter";

export type Settings = {
  apiKey: string;
  buildModel: string;
  callModel: string;
  useLlmInCalls: boolean;
  actor: string;
  voice: { en: string; es: string }; // browser voice names
  ttsProvider: "browser" | "elevenlabs"; // "elevenlabs" = the site's voices when available
  elevenVoice: { en: string; es: string }; // ElevenLabs voice IDs ("" = site default)
};

const KEY = "t2v.settings";
const DEFAULTS: Settings = { apiKey: "", buildModel: DEFAULT_BUILD_MODEL, callModel: DEFAULT_CALL_MODEL, useLlmInCalls: true, actor: "Demo admin", voice: { en: "", es: "" },
  ttsProvider: "elevenlabs", elevenVoice: { en: "", es: "" },
};
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) : {};
    // Earlier versions let visitors save their own ElevenLabs key; drop it.
    if ("elevenApiKey" in stored || "elevenModel" in stored) {
      delete stored.elevenApiKey;
      delete stored.elevenModel;
      window.localStorage.setItem(KEY, JSON.stringify(stored));
    }
    cache = { ...DEFAULTS, ...stored };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function getSettings(): Settings {
  return typeof window === "undefined" ? DEFAULTS : read();
}

export function saveSettings(patch: Partial<Settings>) {
  cache = { ...read(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage blocked: keep in memory for this session */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSettings,
    () => DEFAULTS,
  );
}
