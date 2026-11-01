// Red-flag keyword layer (Addendum G9, layer 1).
//
// Deterministic, no network, runs on EVERY caller turn before anything else.
// English and Spanish lists are always both checked, whatever the call language
// (callers code-switch, and STT may transcribe either).
//
// High recall by design: this is a safety net. For every category except
// self_harm, a separate step asks "Is this happening right now?", so flagging a
// historical mention ("I had a heart attack in 2019") is acceptable.
//
// Matching runs on normalized text: lowercase, accents stripped, apostrophes
// removed ("can't" → "cant"), all other punctuation collapsed to single spaces.
// `matched` in the result is the matched phrase in that normalized form.

import type { RedFlagCategory, RedFlagHit } from "./types";

type Pattern = {
  re: RegExp;
  /**
   * Whether a negation right before the phrase ("no chest pain") cancels it.
   * Phrases that already express inability ("can't breathe", "no puedo
   * respirar", "me falta el aire") are not negatable: with no punctuation in STT
   * output, "no I can't breathe" (answering "no" then reporting the symptom) is
   * indistinguishable from a negation, and recall wins.
   */
  negatable: boolean;
};

const P = (src: string, negatable = true): Pattern => ({ re: new RegExp(`\\b(?:${src})\\b`, "g"), negatable });

// Pronoun / determiner groups reused in patterns.
const POSS = "(?:my|his|her|their|the)";
const CANT = "(?:cant|cannot|can not|couldnt|could not|unable to|not able to)";
const DRUG = "pills?|tablets?|medicines?|medications?|meds|insulin|tylenol|ibuprofen|aspirin|sleeping pills|opioids?|fentanyl";
const ES_CANT = "(?:no (?:puedo|puede|pueden|podia|podemos))";

const PATTERNS: Record<RedFlagCategory, Pattern[]> = {
  // Self-harm is NEVER negatable (see detectRedFlag). The flag is kept on every
  // pattern only for uniformity; it is ignored for this category.
  self_harm: [
    P("kill(?:ing)? (?:myself|himself|herself|themselves|themself)"),
    P("end(?:ing)? (?:my|his|her|their) (?:own )?life|end it all|take (?:my|his|her|their) (?:own )?life"),
    P("(?:want|wanted|wanting|wanna) (?:to )?die"),
    P("wish (?:i|he|she|they) (?:was|were) dead|better off dead"),
    P("(?:hurt|hurting|harm|harming|cut|cutting) (?:myself|himself|herself|themselves|themself)"),
    P("self (?:harm|harming|injury)"),
    P("suicid\\w*"),
    P("(?:dont|do not|doesnt|does not) want to (?:live|be alive) ?(?:anymore)?|no reason to live"),
    // ES
    P("no quiero (?:seguir )?vivir|no quiere (?:seguir )?vivir"),
    P("quitar(?:me|se|le) la vida|acabar con (?:mi|su) vida"),
    P("(?:hacerme|hacerse|me hago|me voy a hacer) dano|lastimarme|cortarme"),
    P("matarme|matarse|me quiero matar|se quiere matar"),
    P("(?:me )?quiero morir(?:me)?|se quiere morir"),
  ],

  chest_pain: [
    P("chest (?:pain|pains|pressure|tightness|discomfort|hurts|is hurting|is tight|feels tight|feels heavy)"),
    P(`(?:pain|pains|pressure|tightness|squeezing|crushing|heaviness) (?:in|on) ${POSS} chest`),
    P("tight chest|heart attack"),
    // ES
    P("dolor(?:es)?(?: fuerte)? (?:de|del|en el|en mi|en su) pecho"),
    P("(?:presion|opresion|apreton|peso) en (?:el|mi|su) pecho|pecho apretado"),
    P("(?:me|le) duele (?:el|mi|su) pecho"),
    P("ataque (?:al|de) corazon|ataque cardiaco|infarto"),
  ],

  breathing: [
    // Inability phrases: not negatable.
    P(`${CANT} (?:breathe|breath|catch (?:my|his|her|their) breath|get (?:any )?air)`, false),
    P("(?:struggling|fighting|gasping) (?:to breathe|for air|for breath)", false),
    P(`${ES_CANT} respirar`, false),
    P("(?:me|le) falta (?:el )?(?:aire|la respiracion)", false),
    P("(?:me|se) (?:estoy|esta) ahogando|me ahogo", false),
    // Negatable descriptions. Note: "breathing tube" deliberately matches nothing.
    P("(?:trouble|difficulty|problems?|a hard time) breathing|breathing (?:problems?|trouble|difficulty)"),
    P("short(?:ness)? of breath"),
    P("(?:dificultad|problemas?) (?:para|al) respirar"),
  ],

  stroke: [
    P("(?<!heat |sun )stroke"),
    P("face (?:is |feels |went |looks )?(?:drooping|droopy|numb|crooked|lopsided)|(?:drooping|droopy) face"),
    P("face (?:fell|dropped|is falling)"),
    P(`(?:arm|leg) (?:is |feels |went |got )?(?:weak|numb|limp|dead)`),
    P(`(?:numb|weak|numbness|weakness|paralyzed|paralysis) (?:on|in) (?:one|${POSS})(?: left| right)? side`),
    P(`${CANT} (?:move|lift|feel) ${POSS} (?:arm|leg|hand|face)`, false),
    P("slurred speech|slurring|(?:speech|words|talking) (?:is |are )?slurred"),
    // ES
    P("derrame(?: cerebral)?|embolia|ataque cerebral|accidente cerebrovascular"),
    P("se (?:me|le) (?:cayo|cae|esta cayendo) (?:la cara|la boca|un lado de la cara)", false),
    P("(?:cara|boca) (?:caida|torcida|adormecida|dormida)"),
    P(`${ES_CANT} mover (?:el|mi|su) (?:brazo|pierna|mano)`, false),
    P("(?:brazo|pierna) (?:dormido|dormida|adormecido|adormecida|debil|entumido|entumecido|entumecida)"),
    P("arrastrando las palabras|(?:hablo|habla) (?:raro|arrastrado|enredado)"),
    P(`${ES_CANT} hablar bien`, false),
  ],

  bleeding_overdose: [
    // Deliberately no bare "blood": "blood test", "blood donation", "blood sugar"
    // and "blood pressure" are ordinary screening topics.
    P("bleeding (?:a lot|heavily|badly|really bad|so much|everywhere|nonstop|(?:that )?(?:wont|will not|doesnt|does not) stop)"),
    P("(?:bleeding|blood) (?:wont|will not|doesnt|does not|isnt|cant) stop"),
    P("(?:heavy|severe|lots of|a lot of) bleeding|(?:cant|cannot) stop (?:the )?bleeding"),
    P("losing (?:a lot of |so much )?blood|blood everywhere|(?:coughing|throwing|vomiting|spitting) up blood"),
    // "took too many" alone flags; "too much" / "a handful of" need a drug noun
    // so "I ate too much" or "took too much time" don't.
    P("(?:took|taken|swallowed) too many"),
    P(`(?:took|taken|take|swallowed|ate) (?:too much|a bunch of|a handful of|all (?:of )?${POSS}) (?:of )?(?:${POSS} )?(?:${DRUG})`),
    P("overdos\\w*|poison(?:ed|ing)|drank (?:bleach|poison|antifreeze)"),
    // ES
    P("sangr(?:ando|a|o) (?:mucho|demasiado|sin parar)|sangrado (?:fuerte|abundante|que no para)"),
    P("no (?:para|deja) de sangrar|(?:la sangre|el sangrado) no (?:para|se detiene|se para)"),
    P("(?:vomitando|tosiendo|escupiendo) sangre"),
    P("(?:me |se )?(?:tome|tomo|tomaste|trague|trago) (?:demasiadas|muchas|todas las|un monton de) (?:pastillas|pildoras|medicinas|tabletas|medicamentos)"),
    P("sobredosis|envenenad[oa]|me envenene|(?:tome|tomo) veneno"),
  ],

  acute_distress: [
    P("pass(?:ing)? out|black(?:ing)? out"),
    P("(?:about|going|gonna) to faint|fainting|feel(?:s|ing)? (?:like )?(?:im |hes |shes )?(?:going to |gonna )?faint"),
    P("(?:severe|bad|serious|strong) (?:allergic )?reaction|anaphyla\\w*"),
    P("throat (?:is )?(?:closing|swelling|closing up)"),
    P(`${POSS} (?:tongue|lips|face) (?:is |are )?swelling`),
    P("having a seizure|seizing|convulsing"),
    // ES
    P("(?:me|se) (?:estoy|esta) desmayando|(?:me|se) va(?:y|s)? a desmayar|desmayarme"),
    P("reaccion alergica (?:fuerte|grave|severa)|(?:fuerte|grave|severa) reaccion alergica|anafilax\\w*"),
    P("se (?:me|le) (?:esta )?(?:cierra|cerrando) la garganta|garganta (?:cerrada|cerrandose|se (?:me |le )?cierra)"),
    P("(?:teniendo|tiene|tengo) (?:una )?convulsion|convulsionando"),
  ],
};

// Category check order after self-harm. Within these, the earliest match wins.
const ORDER: RedFlagCategory[] = ["chest_pain", "breathing", "stroke", "bleeding_overdose", "acute_distress"];

/**
 * Negation cues that must end immediately before the matched phrase. Kept
 * narrow on purpose (only short, unambiguous scopes) so "no, I'm having chest
 * pain" still flags while "no chest pain" / "I don't have chest pain" don't.
 */
const NEGATIONS: RegExp[] = [
  // "no chest pain", "not bleeding", "never had a heart attack" (via next rule), "without chest pain"
  /\b(?:no|not|never|without|denies|deny|zero|dont|doesnt|didnt|wont|havent|hasnt)(?: any| real| more| signs? of| history of)?$/,
  // "I don't have chest pain", "haven't had a stroke", "I'm not having chest pain"
  /\b(?:dont|doesnt|didnt|do not|does not|did not|havent|hasnt|hadnt|have not|has not|had not|never|not|wont|isnt|arent|wasnt)(?: ever)? (?:have|had|having|get|got|getting|feel|felt|feeling|experience|experienced|experiencing|been|suffer|suffered)(?: from)?(?: any| a| an| ever)?$/,
  // ES: "no tengo dolor de pecho", "nunca he tenido un derrame", "sin dolor"
  /\b(?:no|nunca|jamas|sin|tampoco|ningun|ninguna)(?: (?:he|ha|han|hemos|habia))?(?: (?:tenido|sentido|sufrido|padecido))?(?: (?:un|una|ningun|ninguna|nada de))?$/,
  /\b(?:no|nunca|jamas) (?:tengo|tiene|tenia|tuve|tuvo|siento|siente|sentia|sufro|sufre|estoy|esta|estaba)(?: (?:un|una|ningun|ninguna|nada de))?$/,
];

/** Lowercase, strip accents, drop apostrophes, collapse punctuation/whitespace. */
export function normalizeForRedFlags(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

function isNegated(norm: string, index: number): boolean {
  const before = norm.slice(0, index).trimEnd();
  if (!before) return false;
  // Only look at the last few words: negation must be close to the mention.
  const tail = before.split(" ").slice(-6).join(" ");
  return NEGATIONS.some((re) => re.test(tail));
}

/** All non-negated matches of a category, as [index, phrase]. */
function findFirst(norm: string, cat: RedFlagCategory, honorNegation: boolean): { index: number; matched: string } | null {
  let best: { index: number; matched: string } | null = null;
  for (const { re, negatable } of PATTERNS[cat]) {
    re.lastIndex = 0;
    for (const m of norm.matchAll(re)) {
      const index = m.index ?? 0;
      if (honorNegation && negatable && isNegated(norm, index)) continue;
      if (!best || index < best.index) best = { index, matched: m[0].trim() };
      break; // earliest non-negated hit for this pattern found
    }
  }
  return best;
}

/**
 * Deterministic keyword layer. Returns the first red-flag hit in the caller's
 * turn, or null. Self-harm takes priority over every other category.
 */
export function detectRedFlag(text: string): RedFlagHit | null {
  const norm = normalizeForRedFlags(text);
  if (!norm) return null;

  // SAFETY: self-harm is never skipped for negation. "I'm not suicidal" or
  // "no quiero hacerme daño" still flags: a missed crisis is far worse than an
  // unnecessary 988 message, and negation detection on messy STT is unreliable.
  const sh = findFirst(norm, "self_harm", false);
  if (sh) return { category: "self_harm", matched: sh.matched };

  let best: (RedFlagHit & { index: number }) | null = null;
  for (const cat of ORDER) {
    const hit = findFirst(norm, cat, true);
    if (hit && (!best || hit.index < best.index)) best = { category: cat, matched: hit.matched, index: hit.index };
  }
  return best ? { category: best.category, matched: best.matched } : null;
}
