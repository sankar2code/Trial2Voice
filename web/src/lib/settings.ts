"use client";
// Per-browser settings. The API key is stored only in this browser's
// localStorage. The Anthropic key goes only to api.anthropic.com, the
// ElevenLabs key only to api.elevenlabs.io.
import { useSyncExternalStore } from "react";
import { DEFAULT_BUILD_MODEL } from "./script/builder";
import { DEFAULT_CALL_MODEL } from "./call/llmInterpreter";
import { DEFAULT_ELEVEN_MODEL } from "./voice/elevenlabs";

export type Settings = {
  apiKey: string;
  buildModel: string;
  callModel: string;
  useLlmInCalls: boolean;
  actor: string;
  voice: { en: string; es: string }; // browser voice names
  ttsProvider: "browser" | "elevenlabs";
  elevenApiKey: string;
  elevenModel: string;
  elevenVoice: { en: string; es: string }; // ElevenLabs voice IDs
};

const KEY = "t2v.settings";
const DEFAULTS: Settings = { apiKey: "", buildModel: DEFAULT_BUILD_MODEL, callModel: DEFAULT_CALL_MODEL, useLlmInCalls: true, actor: "Demo admin", voice: { en: "", es: "" },
  ttsProvider: "browser", elevenApiKey: "", elevenModel: DEFAULT_ELEVEN_MODEL, elevenVoice: { en: "", es: "" },
};
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
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
