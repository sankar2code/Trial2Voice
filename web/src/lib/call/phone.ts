// Phone number capture (Addendum G11 §4): US numbers from speech or typing.
//
// VALIDITY DECISION: `valid` is a structural NANP check only — 10 digits, area
// code and exchange each starting with 2-9 (NXX NXX XXXX). We deliberately do
// NOT use libphonenumber-js's isValid(), which checks assigned ranges and
// rejects fictional numbers, because the public demo must be able to complete a
// call with a fictional number. So (555) 555-0123, (212) 555-0100 and
// (555) 234-5678 are valid; 555-123-4567 is not (exchange starts with 1). Note the addendum's display placeholder
// "(555) 010-0000" is NOT structurally valid (exchange starts with 0); it is a
// label on the demo referral, not something a caller needs to enter.

import type { Lang } from "./types";

const UNITS: Record<string, string> = {
  // EN ("oh"/"o" handled separately)
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  // ES
  cero: "0", uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9",
};

const TEENS: Record<string, string> = {
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  diez: "10", once: "11", doce: "12", trece: "13", catorce: "14", quince: "15", dieciseis: "16", diecisiete: "17", dieciocho: "18", diecinueve: "19",
  veintiuno: "21", veintidos: "22", veintitres: "23", veinticuatro: "24", veinticinco: "25", veintiseis: "26", veintisiete: "27", veintiocho: "28", veintinueve: "29",
};

const TENS: Record<string, string> = {
  twenty: "2", thirty: "3", forty: "4", fifty: "5", sixty: "6", seventy: "7", eighty: "8", ninety: "9",
  veinte: "2", treinta: "3", cuarenta: "4", cincuenta: "5", sesenta: "6", setenta: "7", ochenta: "8", noventa: "9",
};

const MULTIPLIERS: Record<string, number> = { double: 2, doble: 2, triple: 3 };

/** Single-digit value of a token, if it is one (numeral or word). */
function singleDigit(tok: string | undefined): string | null {
  if (!tok) return null;
  if (/^\d$/.test(tok)) return tok;
  return UNITS[tok] ?? null;
}

function isDigitish(tok: string | undefined): boolean {
  if (!tok) return false;
  return /^\d+$/.test(tok) || tok in UNITS || tok in TEENS || tok in TENS || tok in MULTIPLIERS;
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    // Split runs of digits from adjacent letters ("555abc", "x123").
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Extract every digit spoken or typed in the text, in order. */
function extractDigits(text: string): string {
  const toks = tokenize(text);
  let out = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];

    if (/^\d+$/.test(t)) { out += t; continue; }

    // "oh"/"o" → 0 only next to other digits, so "oh, it's five five five…" or
    // Spanish "o" (= "or") between words doesn't add a stray zero.
    if (t === "oh" || t === "o") {
      if (isDigitish(toks[i - 1]) || isDigitish(toks[i + 1])) out += "0";
      continue;
    }

    if (t in MULTIPLIERS) {
      const nextTok = toks[i + 1] === "oh" || toks[i + 1] === "o" ? "0" : toks[i + 1];
      const d = singleDigit(nextTok);
      if (d) { out += d.repeat(MULTIPLIERS[t]); i++; }
      continue;
    }

    if (t in UNITS) { out += UNITS[t]; continue; }
    if (t in TEENS) { out += TEENS[t]; continue; }

    if (t in TENS) {
      // "fifty five" → 55, "cincuenta y cinco" → 55, "fifty" → 50.
      let j = i + 1;
      if (toks[j] === "y") j++;
      const unit = singleDigit(toks[j]);
      if (unit && unit !== "0") { out += TENS[t] + unit; i = j; }
      else out += TENS[t] + "0";
      continue;
    }

    if (t === "hundred" || t === "cien" || t === "ciento") { out += t === "hundred" ? "00" : "100"; continue; }
    if (t === "thousand" || t === "mil") { out += "000"; continue; }
    // Everything else ("my", "number", "is", "mi", "numero", "es", "plus"…) is filler.
  }
  return out;
}

/** Structural NANP check: NXX NXX XXXX with N = 2-9. See VALIDITY DECISION above. */
function isNanp(digits: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits);
}

/**
 * Parse a US phone number from speech or typing. Returns null when no digits
 * were found at all. `digits` is the cleaned digit string (a leading country
 * code 1 is dropped when 11 digits were given); `valid` is the NANP check.
 */
export function parsePhone(text: string): { digits: string; valid: boolean } | null {
  let digits = extractDigits(text);
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return { digits, valid: isNanp(digits) };
}

/** "(555) 123-4567" for 10 digits; anything else is returned unchanged. */
export function formatPhone(digits: string): string {
  if (!/^\d{10}$/.test(digits)) return digits;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const SPOKEN: Record<Lang, string[]> = {
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
  es: ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"],
};

/**
 * Text the agent speaks to read a number back digit by digit, in groups of
 * 3-3-4 separated by commas (a natural TTS pause): "five five five, one two
 * three, four five six seven". Non-10-digit input is read as one group.
 */
export function phoneReadBack(digits: string, lang: Lang): string {
  const clean = digits.replace(/\D/g, "");
  const words = (s: string) => s.split("").map((d) => SPOKEN[lang][Number(d)]).join(" ");
  if (clean.length !== 10) return words(clean);
  return [clean.slice(0, 3), clean.slice(3, 6), clean.slice(6)].map(words).join(", ");
}
