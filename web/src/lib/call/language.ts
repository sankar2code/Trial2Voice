// Per-turn language detection for English ↔ Spanish switching (PRD §4 P1).
// Deterministic and cautious: short or ambiguous turns ("no", "ok", a name)
// never switch the call.
import type { Lang } from "./types";

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const ES = new Set([
  "si", "tengo", "tiene", "tuve", "anos", "meses", "semanas", "hace", "nunca", "nada", "para", "por", "mi", "mis", "mama", "papa", "hijo", "hija",
  "esposo", "esposa", "quiero", "estoy", "esta", "estan", "usted", "favor", "espanol", "el", "la", "los", "las", "que", "pero", "tambien", "creo",
  "soy", "yo", "con", "sin", "una", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "bueno", "claro", "gracias",
  "puede", "repetir", "entiendo", "significa", "medico", "doctor", "diabetes", "embarazada", "manana", "tarde", "noche", "ninguno", "ninguna", "he", "ha",
]);
const EN = new Set([
  "yes", "yeah", "yep", "i", "im", "have", "had", "dont", "didnt", "years", "months", "weeks", "ago", "never", "my", "the", "is", "and", "but", "want",
  "for", "with", "think", "sure", "about", "doctor", "told", "me", "it", "its", "that", "this", "what", "can", "you", "repeat", "mean", "pregnant",
  "morning", "afternoon", "evening", "none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "was", "been", "am", "do",
]);
// "no", "doctor", "diabetes" etc. appear in both — they're excluded by the margin rule below.

/** Explicit request to change language, e.g. "en español, por favor" or "English please". */
export function languageRequest(text: string): Lang | null {
  const t = strip(text);
  if (/\b(en espanol|habla(s)? espanol|hablo espanol|spanish( please)?|in spanish)\b/.test(t)) return "es";
  if (/\b(in english|english please|en ingles|speak english|hablo ingles)\b/.test(t)) return "en";
  return null;
}

/** True when the turn is only a language request, with no answer in it. */
export function isOnlyLanguageRequest(text: string): boolean {
  const t = strip(text).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return languageRequest(text) !== null && t.split(" ").length <= 5 && !/\b(yes|no|si|never|nunca|\d)\b/.test(t);
}

export function detectLanguage(text: string): Lang | null {
  const req = languageRequest(text);
  if (req) return req;
  const raw = text.toLowerCase();
  const words = strip(text).replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
  }
  if (/[ñ¿¡]/.test(raw)) es += 2;
  if (/[áéíóú]/.test(raw)) es += 1;
  if (/\b(i'm|don't|didn't|it's)\b/.test(raw)) en += 1;
  if (es >= 2 && es >= en + 2) return "es";
  if (en >= 2 && en >= es + 2) return "en";
  return null;
}
