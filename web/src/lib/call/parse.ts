// Keyless interpreter: deterministic rules that turn one caller turn (speech-to-text,
// often messy, English or Spanish) into an Intent. Used when no API key is set and as
// the fallback when the LLM fails. It never decides eligibility; it only reads words.
//
// Design rules (Addendum G2, G5, G6, G7, G10):
// - Meta intents first, then "unsure", then the answer for the expectation.
// - When signals conflict, return "unclear" rather than guess. A false "no" is the
//   costliest error, so a bare "no" buried mid-sentence gets a confidence below the
//   default 0.80 threshold (the engine then treats it as UNSURE, not FAIL).
// - Both languages are accepted regardless of `lang` (callers code-switch); `lang`
//   only breaks ties (decimal separators, Spanish "once" = 11).
// - Caller instructions ("just tell me I qualify") are never obeyed.

import type { AnswerValue, Expectation, Intent, Interpreter, Lang, NumericValue, Relationship, TimeOfDay } from "./types";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "hmm", "hm", "hmmm", "mmm", "ah", "ahh", "eh", "pues"]);

/** Strip diacritics one character at a time, so string indices stay aligned. */
function deaccent(s: string): string {
  let out = "";
  for (const ch of s) {
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += base.length === ch.length ? base : ch.length === 1 ? (base[0] ?? ch) : ch;
  }
  return out;
}

type Norm = { acc: string; plain: string };

/**
 * Lowercase, strip punctuation, collapse spaces, drop fillers. `acc` keeps accents
 * (for names and glossary terms); `plain` is accent-free (for matching). They have
 * the same length, so a match index in `plain` is valid in `acc`.
 */
function normalize(text: string, lang: Lang): Norm {
  let s = (text ?? "").toLowerCase().normalize("NFC");
  s = s.replace(/[’‘`´]/g, "'");
  // Number formatting: "1,000" → 1000; "1,5" → 1.5; Spanish "1.000" → 1000.
  s = s.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  s = s.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2");
  if (lang === "es") s = s.replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2");
  s = s.replace(/(\d)\s*[-–—]\s*(\d)/g, "$1 to $2"); // "40-50" → range
  // Backchannels that look like fillers but carry meaning.
  s = s.replace(/\b(uh[- ]huh|mm[- ]?hmm+|m+hm+)\b/g, " uhhuh ");
  s = s.replace(/\b(nuh[- ]uh|uh-uh)\b/g, " nuhuh ");
  // Filler "like" / "este" only when clearly a filler (followed by a pause, or leading).
  s = s.replace(/\blike\s*(,|\.\.\.|…)/g, " ");
  s = s.replace(/^\s*like\s+/, " ");
  s = s.replace(/\beste\s*(,|\.\.\.|…)/g, " ");
  s = s.replace(/\bo sea\b/g, " ");
  s = s.replace(/'/g, ""); // don't → dont, I'm → im
  s = s.replace(/(\d)\.(?=\d)/g, "$1\u0001"); // protect decimals
  s = s.replace(/[^a-z0-9À-ɏ\u0001\s]/g, " ");
  s = s.replace(/\u0001/g, ".");
  const tokens = s.split(/\s+/).filter((t) => t.length > 0 && !FILLERS.has(deaccent(t)));
  const acc = tokens.join(" ");
  return { acc, plain: deaccent(acc) };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const UNCLEAR: Intent = { type: "unclear" };
const answer = (value: AnswerValue, confidence: number): Intent => ({
  type: "answer",
  value,
  confidence,
});
const anyMatch = (res: RegExp[], s: string) => res.some((r) => r.test(s));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

// ---------------------------------------------------------------------------
// Meta intents
// ---------------------------------------------------------------------------

const STOP_RES = [
  /^(please )?(stop|quit|cancel|enough)( (it|this|now|please|the call|this call|calling|asking|the questions|everything))*( please)?$/,
  /\b(hang up|hanging up|end (the|this) call|end call|i want to (stop|quit|end|hang up)|i wanna stop|lets stop|can we stop|i quit|thats enough|i dont want to (do this|continue|keep going|go on|answer (any more|anymore|these))|i do not want to (do this|continue)|i dont wanna (do this|continue)|no more questions|leave me alone|dont call me|take me off)\b/,
  /\b(im done|i am done)( with this)?$/,
  /^(ok |okay |alright )?(goodbye|bye|bye bye)( now)?$/,
  /\b(ya no quiero (seguir|continuar|hacer esto|contestar)|no quiero (seguir|continuar|hacer esto|contestar)|cuelgue|cuelga|voy a colgar|quiero colgar|terminar (la|esta) llamada|termine (la|esta) llamada|terminemos|ya basta|detengase|no me llame)\b/,
  /^(basta|adios|hasta luego|pare|alto)( ya| por favor)?$/,
];

const ASK_HUMAN_RES = [
  /\b(talk|speak|chat|connect|transfer|put)( me)?( through)? (to|with) (a |an |the |some )?(real |live |actual |human )?(person|human|someone|somebody|operator|representative|agent|rep|people|nurse|doctor|coordinator|study team|staff)\b/,
  /\bget me (a |an )?(real |live )?(person|human|operator|representative)\b/,
  /^(a |an )?(real |live |actual )?(human|person|operator|representative|agent)( please| por favor)?$/,
  /\b(real person|live person|actual person|human being|real human|operator)\b/,
  /\b(a|the|your|customer) representative\b/,
  /\b(hablar|comunicarme|platicar|pasar|transferir|transfiera|comuniqueme|paseme)( me)? (con|a) (una |un |el |la |alguna |algun )?(persona|humano|alguien|operador|operadora|representante|agente|enfermera|doctor|medico|coordinador|coordinadora|equipo)\b/,
  /\b(persona real|un humano|operador|operadora)\b/,
  /\bun representante\b(?! legal)/,
];

const GO_BACK_RES = [
  /\b(go back|going back|back up|previous question|(back to|repeat|ask) the last question|change (my|the|that) (last |previous )?answer|change that( answer)?|i made a mistake|i misspoke|wait i meant|i meant to say|i meant|that was wrong|that last answer was wrong|undo( that)?)\b/,
  /\b(regresar|regrese|regresemos|volver atras|vuelva atras|volvamos|pregunta anterior|ultima pregunta|cambiar (mi|la) respuesta|cambiar mi ultima respuesta|corregir (mi|la) respuesta|me equivoque|quise decir|quiero cambiar)\b/,
];

const REPEAT_RES = [
  /^((sorry|what|huh|pardon|pardon me|excuse me|come again|again|que|como|mande|perdon|perdone|disculpe|como dice|como dijo|que dijo)\s?)+$/,
  /\b(repeat|say (that|it|the question) again|say again|one more time|didnt (hear|catch|get) (that|you|it|the question)|did not (hear|catch)|couldnt hear|cant hear|could not hear|speak up|slow down|slower|what did you say|what was that|what was the question)\b/,
  /\b(repetir|repita|repite|repitame|repitalo|repitala|repetirlo|repetirla|no (le )?(escuche|oi)|no lo (escuche|oi)|no se oye|mas despacio|mas lento|que dijo|como dijo)\b/,
  /\b(puede|podria|diga|digalo|digamelo|dilo)\b.*\b(otra vez|de nuevo)\b/,
  /^(otra vez|de nuevo)( por favor)?$/,
];

const MEDICAL_RES = [
  /\bis (it|this|that|the (drug|medicine|medication|study drug|treatment|device|sensor|shot|injection|study)) (safe|dangerous|risky)\b/,
  /^is (xolair|omalizumab|insulin|the \w+|this \w+|that \w+|\w+) (safe|dangerous|risky)\b/,
  /\b(safe for me|side effects?|adverse effects?|(any|what are the|are there|the) risks?)\b/,
  /\b(will|would|can|could|does|is) (it|this|that|the (drug|medicine|medication|treatment|device|sensor|shot|study)) (help|work|cure|hurt|harm|fix|going to help|going to hurt)\b/,
  /\bshould i (stop|start|keep|continue|change|quit|take|skip|switch|increase|lower|reduce)\b/,
  /\b(can i (still |keep )?(keep )?taking|what dose|which dose|whats the dose|what is the dose|dosage|how much (should|do|can) i take|placebo)\b/,
  /\b(es seguro|sera seguro|es peligroso|efectos? (secundarios?|adversos?)|riesgos|me va a (ayudar|doler|curar|hacer dano)|me ayudara|me curara|me dolera|va a funcionar|funciona (el|la|eso|esto)|(debo|deberia) (dejar|tomar|seguir|parar|cambiar)|puedo seguir tomando|que dosis|la dosis|cuanto debo tomar)\b/,
];

const FAM_EN =
  "mom|mother|mum|mommy|dad|father|daddy|parents?|son|daughter|child|kid|kids|children|husband|wife|partner|spouse|boyfriend|girlfriend|brother|sister|grandmother|grandfather|grandma|grandpa|grandson|granddaughter|aunt|uncle|niece|nephew|cousin|friend|neighbou?r|baby|boy|girl|stepson|stepdaughter|stepmom|stepdad|family member|relative|patient";
const FAM_ES =
  "mama|madre|papa|padre|padres|hijo|hija|hijos|hijas|nino|nina|bebe|esposo|esposa|marido|mujer|pareja|novio|novia|hermano|hermana|abuelo|abuela|nieto|nieta|tio|tia|sobrino|sobrina|primo|prima|amigo|amiga|vecino|vecina|suegro|suegra|familiar|paciente";

const SWITCH_RES = [
  new RegExp(`\\b(actually|really|this is|its|it is|these|those|the answers|im|i am|i was|calling|asking|answering)\\b.*\\b(for|about|on behalf of) (my|our) (${FAM_EN})\\b`),
  /\bnot (for|about) me\b/,
  /\b(actually|really) (its|this is|it is|these are|im answering) (for|about) (me|myself)\b/,
  /\bactually (for|about) someone else\b|\b(its|this is) for someone else\b/,
  new RegExp(`\\b(en realidad|realmente|es|son|estoy|llamo|pregunto|respondo|contesto)\\b.*\\b(para|por|sobre|de parte de) (mi|mis) (${FAM_ES})\\b`),
  /\bno es (para|por) mi$/,
  /\ben realidad es (para|por) mi( mismo| misma)?$/,
];

const UNSURE_STRONG =
  /\b(not sure|unsure|not certain|i dont know|dont know|i do not know|idk|dunno|i dont remember|dont remember|i do not remember|cant remember|cannot remember|cant recall|dont recall|cannot recall|no idea|no clue|hard to say|who knows|i forget|i forgot|no se|no lo se|no sabria|no estoy segur[oa]|no me acuerdo|no recuerdo|ni idea|quien sabe|no tengo idea|no sabe|no lo sabe)\b/;
const HEDGE = /\b(maybe|perhaps|possibly|tal vez|talvez|quizas|quiza|a lo mejor|puede ser|puede que)\b/;

const MANIPULATION_RES = [
  /\btell me (that )?(i|im|i am) (qualify|eligible|in)\b/,
  /\b(put|mark|write|sign|list) me (down )?(as )?(eligible|qualified|a yes|yes|in)\b/,
  /\b(say|answer|put|mark) (yes|si) (to|for) (everything|all|every)/,
  /\bjust (put|say|mark) yes\b/,
  /\byes to (everything|all of (it|them))\b/,
  /\b(make|let) me (qualify|be eligible|eligible)\b/,
  /\bi (should )?qualify right\b/,
  /\bignore (your|the|all|previous|prior) (instructions|rules)\b/,
  /\b(digame|dime) que (califico|soy elegible)\b/,
  /\b(pongame|ponme|marqueme|marcame|apunteme) como (elegible|que si)\b/,
  /\b(ponga|pon|marque|diga) que si a todo\b|\bsi a todo\b/,
];

function detectClarify(plain: string, acc: string): Intent | null {
  const stop = new Set(["that", "this", "it", "eso", "esto", "ese", "esa", "those", "these", "lo", "them", "you", ""]);
  const clean = (start: number, end: number): string | undefined => {
    let t = acc.slice(start, end).trim();
    const tp = () => deaccent(t);
    const lead = /^(the word |the term |la palabra |el termino |a |an |the |el |la |los |las |un |una |unos |unas )/;
    const trail = / (exactly|again|please|por favor|anyway|mean|means|is|are|es|then|entonces|exactamente)$/;
    let changed = true;
    while (changed) {
      changed = false;
      const m1 = lead.exec(tp());
      if (m1) { t = t.slice(m1[0].length); changed = true; }
      const m2 = trail.exec(tp());
      if (m2) { t = t.slice(0, t.length - m2[0].length); changed = true; }
      t = t.trim();
    }
    return stop.has(deaccent(t)) ? undefined : t;
  };
  type Pat = { re: RegExp; g?: number };
  const pats: Pat[] = [
    { re: /\bwhat do you mean(?: by (.+))?$/, g: 1 },
    { re: /\bwhat (?:does|do|did) (.+?) (?:mean|stand for)\b/, g: 1 },
    { re: /\bwhat is meant by (.+)$/, g: 1 },
    { re: /^(?:(?:sorry|ok|okay|wait|but|and|so) )*(?:whats|what is|what are|what s|what was) (.+)$/, g: 1 },
    { re: /\b(?:que|q) (?:significa|quiere decir)(?: (.+))?$/, g: 1 },
    { re: /^(?:(?:perdon|pero|y|disculpe|oiga|y eso) )*que (?:es|son|seria) (.+)$/, g: 1 },
    { re: /\bi (?:dont|do not) (?:understand|know) what (.+?) (?:is|are|means|mean)\b/, g: 1 },
    { re: /\bno (?:se|entiendo|comprendo|entendi) (?:que|lo que) (?:es|son|significa|quiere decir) (.+)$/, g: 1 },
    { re: /\bnot sure what (?!you mean)(.+?) (?:is|are|means|mean)\b/, g: 1 },
    { re: /\bnot sure what you mean\b/ },
    { re: /\b(?:define|explain)(?: (.+))?$/, g: 1 },
    {
      re: /\b(i dont understand|i do not understand|dont understand|i dont get it|i dont follow|im confused|no entiendo|no comprendo|no entendi|a que se refiere|que quiere decir|whats that mean|what does that mean)\b/,
    },
  ];
  for (const p of pats) {
    const m = p.re.exec(plain);
    if (!m) continue;
    if (p.g && m[p.g] !== undefined) {
      const start = m.index + m[0].lastIndexOf(m[p.g]);
      const term = clean(start, start + m[p.g].length);
      return term ? { type: "clarify", term } : { type: "clarify" };
    }
    return { type: "clarify" };
  }
  return null;
}

function detectMeta(n: Norm, expect: Expectation): Intent | null {
  const p = n.plain;
  if (anyMatch(STOP_RES, p)) return { type: "stop" };
  if (anyMatch(ASK_HUMAN_RES, p)) return { type: "ask_human" };
  if (anyMatch(GO_BACK_RES, p)) return { type: "go_back" };
  if (anyMatch(REPEAT_RES, p)) return { type: "repeat" };
  // Medical before clarify so "what are the side effects" is a medical question.
  if (anyMatch(MEDICAL_RES, p)) return { type: "medical_question" };
  const c = detectClarify(p, n.acc);
  if (c) return c;
  if (expect.kind !== "who_for" && expect.kind !== "relationship" && anyMatch(SWITCH_RES, p)) {
    return { type: "switch_respondent" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Yes / no
// ---------------------------------------------------------------------------

type YN = { value: boolean; confidence: number };

const NA_RE =
  /\b(doesnt apply|does not apply|dont apply|do not apply|not applicable|n a|na|no aplica|no se aplica|no corresponde|not relevant|doesnt pertain)\b/;

// Ordered: hedged phrases, then compound forms that contain a yes/no word,
// then strong negatives, then strong positives. Each match is consumed.
const YN_RULES: { re: RegExp; value: boolean; conf: number }[] = [
  {
    re: /\b(i dont think so|dont think so|i do not think so|i dont believe so|i doubt it|probably not|i guess not|not that i know of|not that i remember|not that im aware of|not as far as i know|creo que no|no creo|me parece que no|probablemente no|supongo que no|que yo sepa no|no que yo sepa)\b/g,
    value: false,
    conf: 0.75,
  },
  {
    re: /\b(i think so|i believe so|i guess so|i think i (do|have|did|am|can)|i believe i (do|have)|probably|pretty sure|im pretty sure|likely|sort of|kind of|kinda|sometimes|creo que si|supongo que si|me parece que si|pienso que si|probablemente|a veces)\b/g,
    value: true,
    conf: 0.7,
  },
  { re: /^(oh )?(no problem|sin problema|no hay problema)( at all)?$/g, value: true, conf: 0.9 },
  { re: /\b(no doubt|why not|sin duda|como no)\b/g, value: true, conf: 0.9 },
  { re: new RegExp(NA_RE.source, "g"), value: false, conf: 0.85 },
  { re: /\b(not currently|not now|not right now|not recently|not lately)\b/g, value: false, conf: 0.9 },
  {
    re: /\b(of course not|absolutely not|definitely not|certainly not|not really|not at all|no way|no longer|not anymore|not any more|never|i have not|i havent|ive never|i never|i do not|i dont|i did not|i didnt|i am not|im not|i was not|i wasnt|i cannot|i cant|i will not|i wont|i have no|i had no|i have none|it is not|it isnt|its not|thats not (right|correct|true)|that is not (right|correct|true)|not true|incorrect|wrong|they dont|they do not|they havent|they have not|he doesnt|she doesnt|he hasnt|she hasnt|doesnt|does not|hasnt|has not|isnt|none|nothing|negative|nope|nah|nuhuh|claro que no|para nada|de ninguna manera|en absoluto|nunca|jamas|tampoco|no tengo|no he|no ha|no tiene|no estoy|no esta|no soy|no puedo|no uso|no tomo|ya no|ninguno|ninguna|nada)\b/g,
    value: false,
    conf: 0.95,
  },
  {
    re: /\b(of course|absolutely|definitely|certainly|that is right|thats right|thats correct|that is correct|correct|exactly|true|affirmative|indeed|yes|yeah|yea|yep|yup|yess|sure|uhhuh|i have|ive had|ive been|i had|i do|i did|i was|i can|i will|it is|it does|they do|they have|he does|she does|he has|she has|claro|correcto|asi es|por supuesto|efectivamente|exacto|cierto|desde luego|sip|aja|eso es|de acuerdo|tengo|he tenido|he usado|tiene|estoy|puedo|uso|tomo)\b/g,
    value: true,
    conf: 0.95,
  },
  { re: /^(right|ya|i am|im)$|\b(i am|im)$/g, value: true, conf: 0.9 },
  // A bare "okay" is often an acknowledgement, not an answer: keep it below threshold.
  { re: /\b(okay|ok)\b/g, value: true, conf: 0.75 },
];

function parseYesNo(plain: string): YN | null {
  let t = ` ${plain} `.replace(/\s+/g, " ").trim();
  const yes: number[] = [];
  const no: number[] = [];
  for (const rule of YN_RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(t)) {
      rule.re.lastIndex = 0;
      t = t.replace(rule.re, () => {
        (rule.value ? yes : no).push(rule.conf);
        return " _ ";
      });
      t = t.replace(/\s+/g, " ").trim();
    }
  }
  // Bare "no" / "sí": strong when leading the turn, weak when buried mid-sentence
  // (STT noise, "I know" heard as "no", conditional "si").
  const toks = t.split(" ");
  toks.forEach((tok, i) => {
    if (tok === "no") no.push(i === 0 ? 0.95 : 0.75);
    if (tok === "si") yes.push(i === 0 ? 0.95 : 0.8);
  });
  if (yes.length && no.length) return null;
  if (yes.length) return { value: true, confidence: Math.min(...yes) };
  if (no.length) return { value: false, confidence: Math.min(...no) };
  return null;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const EN_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ES_UNITS: Record<string, number> = {
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const ES_TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const ES_HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
  seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};
const TIME_UNITS = new Set([
  "day", "days", "week", "weeks", "month", "months", "year", "years", "yr", "yrs",
  "dia", "dias", "semana", "semanas", "mes", "meses", "ano", "anos",
]);
const SCALE_WORDS = new Set(["hundred", "thousand", "mil", "ciento", "cien"]);

type Kind = "unit" | "tens" | "hundred" | "thousand";

function wordValue(tok: string, next: string | undefined, lang: Lang): { v: number; kind: Kind } | null {
  if (tok in EN_UNITS) return { v: EN_UNITS[tok], kind: "unit" };
  if (tok in ES_UNITS) return { v: ES_UNITS[tok], kind: "unit" };
  if (tok === "once" && lang === "es") return { v: 11, kind: "unit" }; // EN "once" = one time
  if ((tok === "un" || tok === "una" || tok === "a" || tok === "an") && next && (TIME_UNITS.has(next) || SCALE_WORDS.has(next))) {
    return { v: 1, kind: "unit" };
  }
  if (tok in EN_TENS) return { v: EN_TENS[tok], kind: "tens" };
  if (tok in ES_TENS) return { v: ES_TENS[tok], kind: "tens" };
  if (tok in ES_HUNDREDS) return { v: ES_HUNDREDS[tok], kind: "hundred" };
  if (tok === "hundred") return { v: 100, kind: "hundred" };
  if (tok === "thousand" || tok === "mil") return { v: 1000, kind: "thousand" };
  return null;
}

/** Replace runs of number words (and digits) with digit tokens. */
function digitize(tokens: string[], lang: Lang): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^\d+(\.\d+)?$/.test(tok)) {
      // "2 hundred", "3 mil"
      const nx = tokens[i + 1];
      if (nx === "hundred") { out.push(String(Number(tok) * 100)); i += 2; continue; }
      if (nx === "thousand" || nx === "mil") { out.push(String(Number(tok) * 1000)); i += 2; continue; }
      out.push(tok);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let last: Kind | null = null;
    let j = i;
    let consumed = false;
    while (j < tokens.length) {
      const t = tokens[j];
      const w = wordValue(t, tokens[j + 1], lang);
      if (w) {
        let ok = false;
        if (w.kind === "unit") {
          ok = last === null || last === "hundred" || last === "thousand" || (last === "tens" && w.v < 10);
          if (ok) current += w.v;
        } else if (w.kind === "tens") {
          ok = last === null || last === "hundred" || last === "thousand";
          if (ok) current += w.v;
        } else if (w.kind === "hundred") {
          if (t === "hundred") {
            if (last === null) { current = 100; ok = true; }
            else if (last === "unit" && current % 100 > 0 && current % 100 < 10) {
              current = current - (current % 100) + (current % 100) * 100;
              ok = true;
            }
          } else {
            ok = last === null || last === "thousand";
            if (ok) current += w.v;
          }
        } else {
          ok = last !== "thousand";
          if (ok) { total += (current || 1) * 1000; current = 0; }
        }
        if (!ok) break;
        last = w.kind;
        consumed = true;
        j++;
        continue;
      }
      // Connectors inside a number: "one hundred and five", "sesenta y dos".
      const nxt = tokens[j + 1];
      const nw = nxt ? wordValue(nxt, tokens[j + 2], lang) : null;
      if (consumed && t === "and" && (last === "hundred" || last === "thousand") && nw && nw.kind !== "thousand") { j++; continue; }
      if (consumed && t === "y" && last === "tens" && nw && nw.kind === "unit" && nw.v > 0 && nw.v < 10) { j++; continue; }
      break;
    }
    if (!consumed) {
      out.push(tok);
      i++;
    } else {
      out.push(String(total + current));
      i = j;
    }
  }
  return out;
}

const APPROX_RE =
  /\b(about|around|roughly|approximately|approx|almost|nearly|close to|something like|like|more or less|give or take|ish|or so|maybe|perhaps|probably|i think|i believe|i guess|over|under|more than|less than|at least|at most|just over|just under|como|alrededor de|aproximadamente|casi|unos|unas|cerca de|poco mas|poco menos|mas de|menos de|creo|tal vez|quizas|quiza|a lo mejor|al menos|por lo menos|y pico)\b/;

const DECADE_EN: Record<string, number> = {
  teens: 10, twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60, seventies: 70, eighties: 80, nineties: 90,
};
const TENS_ALL: Record<string, number> = { ...EN_TENS, ...ES_TENS, veinte: 20, veinti: 20 };

function decadeRange(base: number, mod?: string): { min: number; max: number } {
  let lo = base === 10 ? 13 : base;
  let hi = base + 9;
  if (mod === "early") hi = base === 10 ? 15 : base + 3;
  else if (mod === "mid") { lo = base + 3; hi = base + 6; }
  else if (mod === "late") lo = base + 6;
  return { min: lo, max: hi };
}

function parseDecade(t: string): { min: number; max: number } | null {
  let m = /\b(?:(early|mid|late) )?(teens|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties|([1-9])0s)\b/.exec(t);
  if (m) {
    const base = m[3] ? Number(m[3]) * 10 : DECADE_EN[m[2]];
    return decadeRange(base, m[1]);
  }
  m = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety) ?(something|odd|plus)\b/.exec(t);
  if (m) return decadeRange(TENS_ALL[m[1]]);
  m = /\b(veinti|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa) ?(?:i ?|y ?)?(tantos|tanto|tantas|pico|algo)\b/.exec(t);
  if (m) return decadeRange(TENS_ALL[m[1]]);
  m = /\b(?:mis|los) (veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)s?\b/.exec(t);
  if (m) return decadeRange(TENS_ALL[m[1]]);
  return null;
}

type NumUnit = "lb" | "kg";
type NumDetail = { value: NumericValue; approximate: boolean; unit?: NumUnit };

const RANGE_JOINERS = new Set(["to", "and", "or", "through", "thru", "y", "o", "u", "a", "hasta", "or maybe", "to maybe", "o tal vez"]);

function parseNumberDetailed(plain: string, lang: Lang): NumDetail | null {
  const t = plain.replace(/(\d+)ish\b/g, "$1 ish");
  const approximate = APPROX_RE.test(t);
  let unit: NumUnit | undefined;
  if (/\b(pounds?|lbs?|libras?)\b/.test(t)) unit = "lb";
  if (/\b(kilos?|kilograms?|kilogramos?|kgs?)\b/.test(t)) unit = unit ? undefined : "kg";

  const dec = parseDecade(t);
  if (dec) return { value: dec, approximate, unit };

  const toks = digitize(t.split(" ").filter(Boolean), lang);
  const nums: { v: number; i: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!/^\d+(\.\d+)?$/.test(toks[i])) continue;
    let v = Number(toks[i]);
    const rest = toks.slice(i + 1, i + 4).join(" ");
    if (/^(and a half|and half|y medio|y media)\b/.test(rest)) v += 0.5;
    nums.push({ v, i });
  }
  if (nums.length === 0) {
    if (/^(none|zero|ninguno|ninguna|nada|cero)$/.test(t)) return { value: 0, approximate: false, unit };
    return null;
  }
  if (nums.length === 1) return { value: nums[0].v, approximate, unit };
  if (nums.length === 2) {
    const between = toks.slice(nums[0].i + 1, nums[1].i).join(" ");
    const a = nums[0].v;
    const b = nums[1].v;
    if (a === b) return { value: a, approximate, unit };
    if (RANGE_JOINERS.has(between)) {
      return { value: { min: Math.min(a, b), max: Math.max(a, b) }, approximate, unit };
    }
    return null;
  }
  if (nums.every((x) => x.v === nums[0].v)) return { value: nums[0].v, approximate, unit };
  return null;
}

/** Parse a spoken number in EN or ES. Ranges come back as {min, max}. */
export function parseNumber(text: string, lang: Lang): { value: NumericValue; approximate: boolean } | null {
  const r = parseNumberDetailed(normalize(text, lang).plain, lang);
  return r ? { value: r.value, approximate: r.approximate } : null;
}

function normUnit(u: string | null | undefined): NumUnit | undefined {
  if (!u) return undefined;
  const s = u.toLowerCase().trim();
  if (/^(lb|lbs|pound|pounds|libras?)$/.test(s)) return "lb";
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms|kilogramos?)$/.test(s)) return "kg";
  return undefined;
}

// ---------------------------------------------------------------------------
// Months ago
// ---------------------------------------------------------------------------

const UNIT_MONTHS: Record<string, number> = {
  day: 1 / 30, days: 1 / 30, dia: 1 / 30, dias: 1 / 30,
  week: 0.25, weeks: 0.25, semana: 0.25, semanas: 0.25,
  month: 1, months: 1, mes: 1, meses: 1,
  year: 12, years: 12, yr: 12, yrs: 12, ano: 12, anos: 12,
};
const UNIT_ALT = Object.keys(UNIT_MONTHS).join("|");

const MONTH_SPECIALS: { re: RegExp; months: number; approx: boolean }[] = [
  { re: /\b(today|this morning|earlier today|hoy|esta manana)\b/, months: 0, approx: false },
  { re: /\b(day before yesterday|anteayer|antier|antes de ayer)\b/, months: 0.07, approx: false },
  { re: /\b(yesterday|last night|ayer|anoche)\b/, months: 0.03, approx: false },
  { re: /\b(a few days|a couple (of )?days|couple days|the other day|few days|unos (pocos )?dias|pocos dias|el otro dia|un par de dias)\b/, months: 0.1, approx: true },
  { re: /\b(last week|la semana pasada)\b/, months: 0.25, approx: false },
  { re: /\b(this week|esta semana)\b/, months: 0.1, approx: true },
  { re: /\b(a couple (of )?weeks|couple weeks|un par de semanas)\b/, months: 0.5, approx: true },
  { re: /\b(a few weeks|few weeks|unas (pocas |cuantas )?semanas|several weeks|varias semanas)\b/, months: 0.75, approx: true },
  { re: /\b(last month|el mes pasado)\b/, months: 1, approx: false },
  { re: /\b(a couple (of )?months|couple months|un par de meses)\b/, months: 2, approx: true },
  { re: /\b(a few months|few months|several months|unos (pocos |cuantos )?meses|varios meses)\b/, months: 3, approx: true },
  { re: /\b(half a year|half year|medio ano|six months|seis meses)\b/, months: 6, approx: false },
  { re: /\b(a year and a half|year and a half|ano y medio)\b/, months: 18, approx: false },
  { re: /\b(last year|el ano pasado)\b/, months: 12, approx: true },
  { re: /\b(a couple (of )?years|couple years|un par de anos)\b/, months: 24, approx: true },
  { re: /\b(a few years|few years|several years|unos (pocos |cuantos )?anos|varios anos)\b/, months: 36, approx: true },
];

function parseMonthsDetailed(plain: string, lang: Lang): { value: number; approximate: boolean } | null {
  const never = /\b(never|nunca|jamas|not ever|not once|ni una vez)\b/.test(plain);
  // Echoing the question window ("not in the last 6 months") or vague times: no value.
  if (/\b(in|within|during) the (last|past)\b|\ben (los|las) (ultimos|ultimas)\b/.test(plain)) return null;
  if (/\b(a while|long time|a long while|ages ago|hace (tiempo|mucho)|mucho tiempo|recently|recientemente)\b/.test(plain)) return null;
  let approximate = APPROX_RE.test(plain);
  let t = digitize(plain.split(" ").filter(Boolean), lang).join(" ");
  let total = 0;
  let found = false;

  for (const s of MONTH_SPECIALS) {
    if (s.re.test(t)) {
      total += s.months;
      found = true;
      approximate = approximate || s.approx;
      t = t.replace(s.re, " ");
    }
  }
  const N = "(\\d+(?:\\.\\d+)?)";
  const HALF = "(?: (?:and a half|and half|y medio|y media))";
  // Ranges: "2 or 3 months" → midpoint, approximate.
  const rangeRe = new RegExp(`${N}${HALF}? (?:or|to|and|o|u|a|y|or maybe) ${N} (${UNIT_ALT})\\b`, "g");
  t = t.replace(rangeRe, (_m, a: string, b: string, u: string) => {
    total += ((Number(a) + Number(b)) / 2) * UNIT_MONTHS[u];
    found = true;
    approximate = true;
    return " ";
  });
  const compRe = new RegExp(`${N}(${HALF})? (${UNIT_ALT})\\b(${HALF})?`, "g");
  t = t.replace(compRe, (_m, n: string, h1: string | undefined, u: string, h2: string | undefined) => {
    total += (Number(n) + (h1 || h2 ? 0.5 : 0)) * UNIT_MONTHS[u];
    found = true;
    return " ";
  });
  // Calendar year: "in 2020".
  const yr = /\b(19[5-9]\d|20\d\d)\b/.exec(t);
  if (yr) {
    const now = new Date().getFullYear();
    const y = Number(yr[1]);
    if (y <= now) {
      total += (now - y) * 12;
      found = true;
      approximate = true;
      t = t.replace(yr[0], " ");
    }
  }
  if (!found) {
    // A bare number with no unit: assume months, but flag it approximate.
    const nums = t.match(/\b\d+(\.\d+)?\b/g);
    if (nums && nums.length === 1) {
      total = Number(nums[0]);
      found = true;
      approximate = true;
    }
  }
  if (never && found) return null; // "never… well, 3 years ago": conflicting
  if (never) return { value: Infinity, approximate: false };
  if (!found) return null;
  return { value: round(total, 2), approximate };
}

/** True when the turn mentions a quantity or a time unit (so a "no" in it is not "never"). */
function mentionsTime(plain: string, lang: Lang): boolean {
  const toks = digitize(plain.split(" ").filter(Boolean), lang);
  return toks.some((t) => /^\d/.test(t) || TIME_UNITS.has(t)) || /\b(never|nunca|jamas)\b.*\b(ago|hace)\b/.test(plain);
}

/** Parse "how long ago" in months. "never" → Infinity. */
export function parseMonthsAgo(text: string, lang: Lang): { value: number; approximate: boolean } | null {
  const n = normalize(text, lang);
  const r = parseMonthsDetailed(n.plain, lang);
  if (r) return r;
  // "no, never", "nope" — they never had it.
  if (!UNSURE_STRONG.test(n.plain) && !HEDGE.test(n.plain) && !mentionsTime(n.plain, lang)) {
    const yn = parseYesNo(n.plain);
    if (yn && yn.value === false && yn.confidence >= 0.9) return { value: Infinity, approximate: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

const ENUM_STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "el", "la", "los", "las", "de", "del", "y", "o", "en", "un", "una", "not"]);

function parseEnum(plain: string, options: string[]): Intent {
  const norm = options.map((o) => ({
    o,
    n: deaccent(o.toLowerCase().normalize("NFC")).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
  }));
  const naOpts = norm.filter((x) => /\b(apply|applies|applicable|n a|na|aplica)\b/.test(x.n));
  if (NA_RE.test(plain)) return naOpts.length === 1 ? answer(naOpts[0].o, 0.9) : UNCLEAR;

  const yesOpt = norm.find((x) => /^(yes|si|true)$/.test(x.n));
  const noOpt = norm.find((x) => /^(no|false)$/.test(x.n));
  const others = norm.filter((x) => x !== yesOpt && x !== noOpt && x.n.length > 0);

  const hits = others.filter((x) => new RegExp(`\\b${escapeRe(x.n)}\\b`).test(plain));
  if (hits.length > 0) {
    hits.sort((a, b) => b.n.length - a.n.length);
    const best = hits[0];
    const unrelated = hits.slice(1).some((h) => !best.n.includes(h.n));
    return unrelated ? UNCLEAR : answer(best.o, 0.9);
  }
  if (yesOpt || noOpt) {
    const yn = parseYesNo(plain);
    if (yn) {
      const target = yn.value ? yesOpt : noOpt;
      return target ? answer(target.o, yn.confidence) : UNCLEAR;
    }
  }
  // Partial word overlap ("type two" vs "type 2 diabetes").
  const words = new Set(digitize(plain.split(" "), "en"));
  let bestScore = 0;
  let best: { o: string }[] = [];
  for (const x of others) {
    const content = x.n.split(" ").filter((w) => (w.length > 1 || /\d/.test(w)) && !ENUM_STOP.has(w));
    if (!content.length) continue;
    const score = content.filter((w) => words.has(w)).length / content.length;
    if (score > bestScore) { bestScore = score; best = [x]; }
    else if (score === bestScore && score > 0) best.push(x);
  }
  if (bestScore >= 0.5 && best.length === 1) return answer(best[0].o, 0.75);
  return UNCLEAR;
}

// ---------------------------------------------------------------------------
// Who for / relationship / time of day / name
// ---------------------------------------------------------------------------

function parseWhoFor(plain: string, question?: string): Intent {
  const proxyRe = new RegExp(
    `\\b(someone else|somebody else|another person|other person|a family member|family member|a relative|a child|my (${FAM_EN})|for (him|her|them)|on behalf of|im (the|a|his|her|their) (parent|guardian|caregiver|mom|mother|dad|father)|caregiver|otra persona|alguien mas|un familiar|mis? (${FAM_ES})|(por|para) ella|soy (el|la|su) (padre|madre|mama|papa|tutor|tutora|cuidador|cuidadora))\\b|\\b(por|para) el$`,
    "g",
  );
  const selfRe =
    /\b(myself|for me|self|my own|its me|it is me|im the patient|i am the patient|just me|me myself|yo mismo|yo misma|para mi|por mi|mi mismo|mi misma|soy yo|el paciente soy yo|la paciente soy yo)\b|^(me|yo|i am|im|its for me|me personally)$/;
  const hasProxy = proxyRe.test(plain);
  const rest = plain.replace(proxyRe, " ").replace(/\s+/g, " ").trim();
  const hasSelf = selfRe.test(rest);
  if (hasProxy && hasSelf) return UNCLEAR;
  if (hasProxy) return answer("proxy", 0.9);
  if (hasSelf) return answer("self", 0.9);
  // Pediatric variant: "Are you a parent or guardian calling for a child?"
  if (question && /parent or guardian|padre, la madre o el tutor|padre o tutor|madre o el tutor/i.test(deaccent(question.toLowerCase()))) {
    const yn = parseYesNo(plain);
    if (yn) return answer(yn.value ? "proxy" : "self", Math.min(yn.confidence, 0.9));
  }
  return UNCLEAR;
}

// Role words, keyed by who they describe. "my X" → X is the patient; otherwise
// ("I'm her X", "X", "su X", "soy X") → X is the caller.
const ROLE: Record<string, { patient: Relationship; caller: Relationship }> = {};
const addRole = (words: string, patient: Relationship, caller: Relationship) => {
  for (const w of words.split(" ")) ROLE[w] = { patient, caller };
};
addRole("son sons daughter daughters child children kid kids boy girl baby stepson stepdaughter hijo hija hijos hijas nino nina ninos ninas bebe hijastro hijastra", "parent_guardian", "adult_child");
addRole("mom mother mum mommy mama dad father daddy papa parent parents stepmother stepfather stepmom stepdad madre padre padres madrastra padrastro guardian tutor tutora", "adult_child", "parent_guardian");
addRole("husband wife partner spouse boyfriend girlfriend fiance fiancee esposo esposa marido mujer pareja novio novia conyuge", "spouse_partner", "spouse_partner");
addRole("brother brothers sister sisters sibling siblings grandmother grandfather grandma grandpa granny grandson granddaughter grandchild grandkid aunt auntie uncle niece nephew cousin relative hermano hermana abuelo abuela nieto nieta tio tia sobrino sobrina primo prima familiar pariente cunado cunada suegro suegra yerno nuera", "other_family", "other_family");
addRole("friend neighbor neighbour roommate amigo amiga vecino vecina", "friend_caregiver", "friend_caregiver");
const CAREGIVER_WORDS = new Set(["caregiver", "carer", "caretaker", "aide", "nurse", "cuidador", "cuidadora", "enfermera", "enfermero"]);

function parseRelationship(plain: string): Intent {
  if (/\b(prefer not to (say|answer)|rather not (say|answer)|id rather not|none of your business|prefiero no (decir|decirlo|contestar|responder))\b/.test(plain)) {
    return answer("other", 0.9);
  }
  if (/\b(power of attorney|poa|legal representative|legally authorized|conservator|court appointed|representante legal|poder notarial|apoderad[oa]|tutor legal de un adulto)\b/.test(plain) ||
      /\b(legal )?guardian (of|for) (an|a|my)? ?adult\b|\badult\b.*\blegal guardian\b|\blegal guardian\b.*\badult\b/.test(plain)) {
    return answer("legal_representative", 0.9);
  }
  const cats = new Set<Relationship>();
  let t = plain;
  if (/\b(mother|father|son|daughter|brother|sister)s? in law\b/.test(t)) {
    cats.add("other_family");
    t = t.replace(/\b(mother|father|son|daughter|brother|sister)s? in law\b/g, " ");
  }
  const toks = t.split(" ");
  let caregiver = false;
  toks.forEach((tok, i) => {
    const prev = toks[i - 1];
    const r = ROLE[tok];
    if (r) cats.add(prev === "my" || prev === "our" || prev === "mi" || prev === "mis" || prev === "nuestro" || prev === "nuestra" ? r.patient : r.caller);
    if (CAREGIVER_WORDS.has(tok)) caregiver = true;
  });
  if (/\b(i take care of|i look after|i care for|la cuido|lo cuido|los cuido|las cuido|yo (la|lo) cuido)\b/.test(t)) caregiver = true;
  if (cats.size === 0 && caregiver) cats.add("friend_caregiver");
  if (cats.size === 1) return answer([...cats][0], 0.9);
  return UNCLEAR;
}

function parseTimeOfDay(plain: string): Intent {
  if (/\b(except|but not|not in the|excepto|menos|no en la|no por la)\b/.test(plain)) return UNCLEAR;
  const found = new Set<TimeOfDay>();
  let t = plain;
  // Spanish "mañana" next to "tarde/noche" means "tomorrow" ("mañana por la tarde").
  const esTomorrow = /\bmanana\b/.test(t) && /\b(tarde|noche)\b/.test(t) && !/\b(por|en|de) la manana\b/.test(t);
  if (esTomorrow) t = t.replace(/\bmanana\b/g, " ");
  const hourRe = /\b(\d{1,2})(?: \d\d)? ?(am|a m|pm|p m)\b/g;
  t = t.replace(hourRe, (_m, h: string, ap: string) => {
    const hour = Number(h);
    if (ap.startsWith("a")) found.add("morning");
    else if (hour === 12 || hour < 5) found.add("afternoon");
    else found.add("evening");
    return " ";
  });
  if (/\b(morning|mornings|the a ?m|before noon|early in the day|breakfast|manana|mananas|temprano)\b/.test(t)) found.add("morning");
  if (/\b(afternoon|afternoons|after lunch|midday|noon|lunchtime|lunch time|tarde|tardes|mediodia|medio dia)\b/.test(t)) found.add("afternoon");
  if (/\b(evening|evenings|night|nights|tonight|after work|after dinner|after (5|6|7|five|six|seven)|noche|noches)\b/.test(t)) found.add("evening");
  const any = /\b(any ?time|whenever|doesnt matter|does not matter|either|any|all day|no preference|dont care|flexible|cualquier (hora|momento|rato)|cuando sea|me da igual|da igual|no importa|todo el dia|cuando quiera|la hora que sea)\b/.test(t);
  if (found.size === 1) return answer([...found][0], 0.9);
  if (found.size === 0 && any) return answer("any", 0.9);
  return UNCLEAR;
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w ? w[0].toLocaleUpperCase() + w.slice(1) : w))
    .join(" ");
}

function parseName(n: Norm): Intent {
  let acc = n.acc;
  const leadRe =
    /^((hi|hello|hey|hola|yes|si|ok|okay|sure|well|bueno|claro|oh) )*(my (first )?name is|my names|the name is|name is|its|it is|this is|im|i am|you can call me|call me|me llamo|mi nombre es|me dicen|puede llamarme|llamame|soy)( )/;
  for (let k = 0; k < 2; k++) {
    const m = leadRe.exec(deaccent(acc));
    if (m) acc = acc.slice(m[0].length);
  }
  const cut = / (and|but|y|pero|thanks|thank you|gracias|please|por favor)\b.*$/.exec(deaccent(acc));
  if (cut) acc = acc.slice(0, cut.index);
  acc = acc.split(" ").filter(Boolean).slice(0, 3).join(" ").trim();
  if (!acc) return UNCLEAR;
  if (acc.split(" ").every((w) => /^(yes|no|si|ok|okay|sure|yeah|its|im|my|name|is|me|llamo)$/.test(deaccent(w)))) return UNCLEAR;
  return answer(titleCase(acc), 0.9);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Interpret one caller turn against what the agent expects. Meta intents win over
 * answers; manipulation is never obeyed; conflicting signals → "unclear".
 * `context.question` (optional) is used only for the pediatric who-for variant.
 */
export function parseUtterance(text: string, expect: Expectation, lang: Lang, context?: { question?: string }): Intent {
  const n = normalize(text, lang);
  const p = n.plain;
  if (!p) return UNCLEAR;

  const meta = detectMeta(n, expect);
  if (meta) return meta;

  if (expect.kind === "phone") {
    if (UNSURE_STRONG.test(p)) return { type: "unsure" };
    return answer((text ?? "").trim(), 1);
  }

  if (anyMatch(MANIPULATION_RES, p)) return UNCLEAR;

  if (UNSURE_STRONG.test(p)) return { type: "unsure" };
  const hedged = HEDGE.test(p);
  if (hedged && expect.kind !== "number" && expect.kind !== "months_ago") return { type: "unsure" };

  switch (expect.kind) {
    case "yes_no": {
      const yn = parseYesNo(p);
      return yn ? answer(yn.value, yn.confidence) : UNCLEAR;
    }
    case "number": {
      const r = parseNumberDetailed(p, lang);
      if (!r) return hedged ? { type: "unsure" } : UNCLEAR;
      let value = r.value;
      let approximate = r.approximate || hedged;
      const want = normUnit(expect.unit);
      if (r.unit && want && r.unit !== want) {
        const f = r.unit === "kg" ? 2.20462 : 1 / 2.20462;
        const conv = (x: number) => round(x * f, 1);
        value = typeof value === "number" ? conv(value) : { min: conv(value.min), max: conv(value.max) };
        approximate = true;
      }
      const conf = approximate ? 0.7 : typeof value === "number" ? 0.95 : 0.9;
      return answer(value, conf);
    }
    case "months_ago": {
      const r = parseMonthsDetailed(p, lang);
      if (r) {
        const approximate = r.approximate || hedged;
        return answer(r.value, approximate ? 0.7 : 0.95);
      }
      if (hedged) return { type: "unsure" };
      const yn = parseYesNo(p);
      if (yn && yn.value === false && !mentionsTime(p, lang)) return answer(Infinity, yn.confidence);
      return UNCLEAR; // includes a bare "yes" with no time
    }
    case "enum":
      return parseEnum(p, expect.options);
    case "who_for":
      return parseWhoFor(p, context?.question);
    case "relationship":
      return parseRelationship(p);
    case "time_of_day":
      return parseTimeOfDay(p);
    case "free_text":
      return parseName(n);
    default:
      return UNCLEAR;
  }
}

export const keywordInterpreter: Interpreter = {
  name: "keyword",
  async interpret(utterance, expect, lang, context) {
    return parseUtterance(utterance, expect, lang, context);
  },
  async redFlagTiming() {
    return "unclear";
  },
};
