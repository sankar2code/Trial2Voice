"use client";
// Browser speech (Track A). Chrome's SpeechRecognition sends audio to Google's
// servers — fine for a demo, never for real PHI. Track B replaces this with
// LiveKit + a BAA-covered STT/TTS. Firefox has no SpeechRecognition: the call
// page falls back to typed input.
import type { Lang } from "../call/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- Web Speech API typings are not in lib.dom */
type Recognition = any;

const LOCALE: Record<Lang, string> = { en: "en-US", es: "es-US" };

export function speechInputSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang === LOCALE[lang] ? 4 : 0) + (/natural|neural|premium|enhanced|google/i.test(v.name) ? 3 : 0) + (/samantha|paulina|monica|ava|allison/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0];
}

/** Voices load asynchronously in some browsers. */
export function loadVoices(): Promise<void> {
  if (!speechOutputSupported()) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

export function speak(text: string, lang: Lang, rate = 1): Promise<void> {
  if (!speechOutputSupported()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALE[lang];
    u.rate = rate;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}

export type ListenHandlers = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onSilence: () => void;
  onError: (message: string) => void;
};

/**
 * Listen for one caller turn. Resolves after a final result, silence or error.
 * Silence = no speech within `silenceMs` (G5: 8 seconds).
 */
export function listenOnce(lang: Lang, h: ListenHandlers, silenceMs = 8000): () => void {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    h.onError("Speech input isn't supported in this browser.");
    return () => {};
  }
  const rec: Recognition = new Ctor();
  rec.lang = LOCALE[lang];
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let settled = false;
  let heard = false;
  let finalText = "";
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn();
  };
  const timer = setTimeout(() => {
    if (!heard) {
      settle(h.onSilence);
      try { rec.abort(); } catch { /* already stopped */ }
    }
  }, silenceMs);

  rec.onresult = (e: any) => {
    heard = true;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) h.onInterim(interim);
  };
  rec.onerror = (e: any) => {
    if (e.error === "no-speech") settle(h.onSilence);
    else if (e.error === "aborted") return;
    else settle(() => h.onError(e.error === "not-allowed" ? "Microphone access was blocked." : `Speech input error: ${e.error}`));
  };
  rec.onend = () => {
    if (finalText.trim()) settle(() => h.onFinal(finalText.trim()));
    else if (heard) settle(h.onSilence);
  };
  try {
    rec.start();
  } catch {
    settle(() => h.onError("Couldn't start the microphone."));
  }
  return () => {
    settled = true;
    clearTimeout(timer);
    try { rec.abort(); } catch { /* already stopped */ }
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
