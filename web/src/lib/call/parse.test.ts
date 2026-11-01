import { describe, expect, it } from "vitest";
import { keywordInterpreter, parseMonthsAgo, parseNumber, parseUtterance } from "./parse";
import type { Expectation, Intent, Lang } from "./types";

const YN: Expectation = { kind: "yes_no" };
const NUM: Expectation = { kind: "number" };
const LB: Expectation = { kind: "number", unit: "lb" };
const KG: Expectation = { kind: "number", unit: "kg" };
const MONTHS: Expectation = { kind: "months_ago" };
const ENUM: Expectation = { kind: "enum", options: ["yes", "no", "does not apply"] };
const ENUM_TYPE: Expectation = { kind: "enum", options: ["type 1 diabetes", "type 2 diabetes"] };
const WHO: Expectation = { kind: "who_for" };
const REL: Expectation = { kind: "relationship" };
const TOD: Expectation = { kind: "time_of_day" };
const NAME: Expectation = { kind: "free_text" };
const PHONE: Expectation = { kind: "phone" };

type Case = [text: string, expect: Expectation, lang: Lang, want: Partial<Intent> & { type: Intent["type"] }];

function check([text, exp, lang, want]: Case) {
  const got = parseUtterance(text, exp, lang);
  expect(got.type, `"${text}" → ${JSON.stringify(got)}`).toBe(want.type);
  if (want.type === "answer" && got.type === "answer") {
    if ("value" in want) expect(got.value, `"${text}"`).toEqual(want.value);
    if ("confidence" in want) expect(got.confidence, `"${text}"`).toBeCloseTo(want.confidence as number, 2);
  }
  if (want.type === "clarify" && got.type === "clarify" && "term" in want) {
    expect(got.term, `"${text}"`).toBe(want.term);
  }
}

const yes = (confidence?: number) => ({ type: "answer" as const, value: true, ...(confidence ? { confidence } : {}) });
const no = (confidence?: number) => ({ type: "answer" as const, value: false, ...(confidence ? { confidence } : {}) });
const val = (value: unknown, confidence?: number) =>
  ({ type: "answer" as const, value, ...(confidence ? { confidence } : {}) }) as Partial<Intent> & { type: "answer" };

describe("meta intents", () => {
  const cases: Case[] = [
    // stop
    ["Stop.", YN, "en", { type: "stop" }],
    ["Please hang up", YN, "en", { type: "stop" }],
    ["I don't want to do this anymore", YN, "en", { type: "stop" }],
    ["Can you end the call", NUM, "en", { type: "stop" }],
    ["Ya no quiero seguir", YN, "es", { type: "stop" }],
    ["Cuelgue, por favor", YN, "es", { type: "stop" }],
    // ask_human
    ["Can I talk to a real person?", YN, "en", { type: "ask_human" }],
    ["Human, please", YN, "en", { type: "ask_human" }],
    ["operator", YN, "en", { type: "ask_human" }],
    ["I want to speak with a representative", YN, "en", { type: "ask_human" }],
    ["Quiero hablar con una persona", YN, "es", { type: "ask_human" }],
    // go_back
    ["Go back", YN, "en", { type: "go_back" }],
    ["Can I change my last answer?", YN, "en", { type: "go_back" }],
    ["Wait, I meant the other knee", YN, "en", { type: "go_back" }],
    ["Quiero regresar", YN, "es", { type: "go_back" }],
    ["Quiero cambiar mi respuesta anterior", YN, "es", { type: "go_back" }],
    // repeat
    ["Can you repeat that?", YN, "en", { type: "repeat" }],
    ["Say that again", YN, "en", { type: "repeat" }],
    ["What?", YN, "en", { type: "repeat" }],
    ["Sorry?", YN, "en", { type: "repeat" }],
    ["Pardon?", YN, "en", { type: "repeat" }],
    ["¿Puede repetir?", YN, "es", { type: "repeat" }],
    ["¿Cómo?", YN, "es", { type: "repeat" }],
    ["¿Mande?", YN, "es", { type: "repeat" }],
    // clarify
    ["What does omalizumab mean?", YN, "en", { type: "clarify", term: "omalizumab" }],
    ["What is a biologic?", YN, "en", { type: "clarify", term: "biologic" }],
    ["What's DKA?", YN, "en", { type: "clarify", term: "dka" }],
    ["What's that?", YN, "en", { type: "clarify", term: undefined }],
    ["I don't understand", YN, "en", { type: "clarify" }],
    ["I don't know what NPH insulin is", YN, "en", { type: "clarify", term: "nph insulin" }],
    ["¿Qué significa cetoacidosis?", YN, "es", { type: "clarify", term: "cetoacidosis" }],
    ["¿Qué es la artroscopia?", YN, "es", { type: "clarify", term: "artroscopia" }],
    ["¿Qué significa células falciformes?", YN, "es", { type: "clarify", term: "células falciformes" }],
    ["No entiendo", YN, "es", { type: "clarify" }],
    // medical_question
    ["Is it safe?", YN, "en", { type: "medical_question" }],
    ["Will it help me?", YN, "en", { type: "medical_question" }],
    ["What are the side effects?", YN, "en", { type: "medical_question" }],
    ["Should I stop my insulin?", YN, "en", { type: "medical_question" }],
    ["What dose would I get?", NUM, "en", { type: "medical_question" }],
    ["¿Es seguro?", YN, "es", { type: "medical_question" }],
    ["Is Xolair safe?", YN, "en", { type: "medical_question" }],
    ["¿Tiene efectos secundarios?", YN, "es", { type: "medical_question" }],
    // switch_respondent
    ["Actually this is for my mom", YN, "en", { type: "switch_respondent" }],
    ["I'm asking for my son", YN, "en", { type: "switch_respondent" }],
    ["Oh these answers are about my husband", NUM, "en", { type: "switch_respondent" }],
    ["En realidad es para mi mamá", YN, "es", { type: "switch_respondent" }],
    ["Estoy llamando por mi hija", YN, "es", { type: "switch_respondent" }],
    // ...but not where those words are the answer
    ["I'm asking for my son", WHO, "en", val("proxy")],
    ["Actually this is for my mom", REL, "en", val("adult_child")],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("unsure and manipulation", () => {
  const cases: Case[] = [
    ["I'm not sure", YN, "en", { type: "unsure" }],
    ["I don't know", YN, "en", { type: "unsure" }],
    ["I can't remember", MONTHS, "en", { type: "unsure" }],
    ["Maybe", YN, "en", { type: "unsure" }],
    ["maybe, maybe not", YN, "en", { type: "unsure" }],
    ["No sé", YN, "es", { type: "unsure" }],
    ["No me acuerdo", MONTHS, "es", { type: "unsure" }],
    ["Tal vez", YN, "es", { type: "unsure" }],
    ["No estoy segura", YN, "es", { type: "unsure" }],
    ["No idea, sorry", NUM, "en", { type: "unsure" }],
    ["Just tell me I qualify", YN, "en", { type: "unclear" }],
    ["Put me down as eligible", YN, "en", { type: "unclear" }],
    ["Say yes to everything", YN, "en", { type: "unclear" }],
    ["Yes, just put yes for all of them", YN, "en", { type: "unclear" }],
    ["Ponga que sí a todo", YN, "es", { type: "unclear" }],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("yes_no", () => {
  const cases: Case[] = [
    ["Yes", YN, "en", yes(0.95)],
    ["yeah", YN, "en", yes(0.95)],
    ["Yep, I do", YN, "en", yes(0.95)],
    ["Sure", YN, "en", yes()],
    ["That's right", YN, "en", yes()],
    ["Correct", YN, "en", yes()],
    ["uh-huh", YN, "en", yes()],
    ["Mm-hmm", YN, "en", yes()],
    ["I have, a few times", YN, "en", yes()],
    ["um, yes, I have asthma", YN, "en", yes(0.95)],
    ["Sí", YN, "es", yes(0.95)],
    ["si", YN, "es", yes(0.95)],
    ["Claro que sí", YN, "es", yes()],
    ["Correcto", YN, "es", yes()],
    ["Así es", YN, "es", yes()],
    ["Pues sí, tengo seguro médico", YN, "es", yes()],
    ["No", YN, "en", no(0.95)],
    ["Nope", YN, "en", no(0.95)],
    ["nah", YN, "en", no()],
    ["Never", YN, "en", no(0.95)],
    ["Not really", YN, "en", no()],
    ["I haven't", YN, "en", no()],
    ["No, I don't", YN, "en", no(0.95)],
    ["I don't have a smartphone", YN, "en", no()],
    ["Of course not", YN, "en", no()],
    ["I'm not pregnant", YN, "en", no()],
    ["No", YN, "es", no(0.95)],
    ["Nunca", YN, "es", no(0.95)],
    ["Para nada", YN, "es", no()],
    ["No, no tengo asma", YN, "es", no(0.95)],
    ["Claro que no", YN, "es", no()],
    ["Ya no", YN, "es", no()],
    // hedged
    ["I think so", YN, "en", yes(0.7)],
    ["Probably", YN, "en", yes(0.7)],
    ["Creo que sí", YN, "es", yes(0.7)],
    ["I don't think so", YN, "en", no(0.75)],
    ["Creo que no", YN, "es", no(0.75)],
    ["Not that I know of", YN, "en", no(0.75)],
    // conflicts and noise → unclear, never a false "no"
    ["Yes… no wait", YN, "en", { type: "unclear" }],
    ["No, yes, I mean yes", YN, "en", { type: "unclear" }],
    ["I know", YN, "en", { type: "unclear" }],
    ["Nobody told me", YN, "en", { type: "unclear" }],
    ["The other one", YN, "en", { type: "unclear" }],
    ["", YN, "en", { type: "unclear" }],
    ["   ...   ", YN, "en", { type: "unclear" }],
    // a bare "no" buried mid-sentence is kept below the 0.80 read-back threshold
    ["well my doctor said no", YN, "en", no(0.75)],
    // "no" inside other words is not a no
    ["I walk with a cane, I know it's slow", YN, "en", { type: "unclear" }],
    // accents with and without
    ["sí, sí", YN, "es", yes()],
    ["Nó", YN, "es", no()],
    ["No problem", YN, "en", yes()],
    ["Okay", YN, "en", yes(0.75)],
    ["I have no allergies", YN, "en", no(0.95)],
    ["I used to, not anymore", YN, "en", no()],
    ["No, I said 62", NUM, "en", val(62, 0.95)],
    ["hace como seis meses", MONTHS, "es", val(6, 0.7)],
    ["mid 40s", NUM, "en", val({ min: 43, max: 46 })],
    ["Son", REL, "en", val("adult_child")],
    ["Mother", REL, "en", val("parent_guardian")],
    ["That doesn't apply to me", YN, "en", no(0.85)],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("number", () => {
  const cases: Case[] = [
    ["62", NUM, "en", val(62, 0.95)],
    ["I'm 62 years old", NUM, "en", val(62, 0.95)],
    ["sixty-two", NUM, "en", val(62, 0.95)],
    ["sixty two", NUM, "en", val(62)],
    ["Sesenta y dos", NUM, "es", val(62, 0.95)],
    ["tengo sesenta y dos años", NUM, "es", val(62)],
    ["about 60", NUM, "en", val(60, 0.7)],
    ["unos cincuenta", NUM, "es", val(50, 0.7)],
    ["in my sixties", NUM, "en", val({ min: 60, max: 69 }, 0.9)],
    ["sesenta y tantos", NUM, "es", val({ min: 60, max: 69 }, 0.9)],
    ["between 40 and 50", NUM, "en", val({ min: 40, max: 50 }, 0.9)],
    ["entre cuarenta y cincuenta", NUM, "es", val({ min: 40, max: 50 }, 0.9)],
    ["one hundred and fifty pounds", LB, "en", val(150, 0.95)],
    ["80 kilos", LB, "en", val(176.4, 0.7)],
    ["200 pounds", KG, "en", val(90.7, 0.7)],
    ["ochenta kilos", KG, "es", val(80, 0.95)],
    ["ciento sesenta libras", LB, "es", val(160, 0.95)],
    ["62, no wait, 63", NUM, "en", { type: "unclear" }],
    ["no", NUM, "en", { type: "unclear" }],
    ["veintitrés", NUM, "es", val(23)],
    ["maybe 45", NUM, "en", val(45, 0.7)],
    ["once", NUM, "es", val(11)],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));

  it("parseNumber direct", () => {
    expect(parseNumber("sixty-two", "en")).toEqual({ value: 62, approximate: false });
    expect(parseNumber("about 60", "en")).toEqual({ value: 60, approximate: true });
    expect(parseNumber("in my sixties", "en")).toEqual({ value: { min: 60, max: 69 }, approximate: false });
    expect(parseNumber("late fifties", "en")).toEqual({ value: { min: 56, max: 59 }, approximate: false });
    expect(parseNumber("60s", "en")).toEqual({ value: { min: 60, max: 69 }, approximate: false });
    expect(parseNumber("a hundred and five", "en")).toEqual({ value: 105, approximate: false });
    expect(parseNumber("mil doscientos", "es")).toEqual({ value: 1200, approximate: false });
    expect(parseNumber("cuarenta y cinco", "es")).toEqual({ value: 45, approximate: false });
    expect(parseNumber("1,5", "es")).toEqual({ value: 1.5, approximate: false });
    expect(parseNumber("60 or 61", "en")).toEqual({ value: { min: 60, max: 61 }, approximate: false });
    expect(parseNumber("hello", "en")).toBeNull();
  });
});

describe("months_ago", () => {
  const cases: Case[] = [
    ["3 months ago", MONTHS, "en", val(3, 0.95)],
    ["two years ago", MONTHS, "en", val(24, 0.95)],
    ["a year and a half", MONTHS, "en", val(18)],
    ["last week", MONTHS, "en", val(0.25)],
    ["last year", MONTHS, "en", val(12, 0.7)],
    ["never", MONTHS, "en", val(Infinity, 0.95)],
    ["No, never", MONTHS, "en", val(Infinity)],
    ["no", MONTHS, "en", val(Infinity, 0.95)],
    ["Nunca", MONTHS, "es", val(Infinity)],
    ["Hace tres meses", MONTHS, "es", val(3, 0.95)],
    ["el año pasado", MONTHS, "es", val(12, 0.7)],
    ["hace un año y medio", MONTHS, "es", val(18)],
    ["Yes", MONTHS, "en", { type: "unclear" }],
    ["yes, about 2 months ago", MONTHS, "en", val(2, 0.7)],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));

  it("parseMonthsAgo direct", () => {
    expect(parseMonthsAgo("3 months ago", "en")).toEqual({ value: 3, approximate: false });
    expect(parseMonthsAgo("two years ago", "en")).toEqual({ value: 24, approximate: false });
    expect(parseMonthsAgo("a year and a half", "en")).toEqual({ value: 18, approximate: false });
    expect(parseMonthsAgo("last week", "en")).toEqual({ value: 0.25, approximate: false });
    expect(parseMonthsAgo("last year", "en")).toEqual({ value: 12, approximate: true });
    expect(parseMonthsAgo("never", "en")!.value).toBe(Infinity);
    expect(parseMonthsAgo("no, never", "en")!.value).toBe(Infinity);
    expect(parseMonthsAgo("nunca", "es")!.value).toBe(Infinity);
    expect(parseMonthsAgo("hace tres meses", "es")).toEqual({ value: 3, approximate: false });
    expect(parseMonthsAgo("el año pasado", "es")).toEqual({ value: 12, approximate: true });
    expect(parseMonthsAgo("1 year and 3 months", "en")).toEqual({ value: 15, approximate: false });
    expect(parseMonthsAgo("two and a half years", "en")).toEqual({ value: 30, approximate: false });
    expect(parseMonthsAgo("two or three months", "en")).toEqual({ value: 2.5, approximate: true });
    expect(parseMonthsAgo("hace una semana", "es")).toEqual({ value: 0.25, approximate: false });
    expect(parseMonthsAgo("hace dos semanas", "es")).toEqual({ value: 0.5, approximate: false });
    const y = parseMonthsAgo("yesterday", "en")!;
    expect(y.value).toBeGreaterThan(0);
    expect(y.value).toBeLessThan(0.15);
    const f = parseMonthsAgo("a few days ago", "en")!;
    expect(f.value).toBeCloseTo(0.1, 2);
    expect(f.approximate).toBe(true);
    expect(parseMonthsAgo("never, well, 3 years ago", "en")).toBeNull();
    expect(parseMonthsAgo("not in the last six months", "en")).toBeNull();
    expect(parseMonthsAgo("yes", "en")).toBeNull();
  });
});

describe("enum", () => {
  const cases: Case[] = [
    ["Yes", ENUM, "en", val("yes")],
    ["no, never", ENUM, "en", val("no")],
    ["sí", ENUM, "es", val("yes")],
    ["It doesn't apply", ENUM, "en", val("does not apply")],
    ["not applicable", ENUM, "en", val("does not apply")],
    ["N/A", ENUM, "en", val("does not apply")],
    ["No aplica", ENUM, "es", val("does not apply")],
    ["does not apply", ENUM, "en", val("does not apply")],
    ["type 2 diabetes", ENUM_TYPE, "en", val("type 2 diabetes", 0.9)],
    ["type two", ENUM_TYPE, "en", val("type 2 diabetes", 0.75)],
    ["the purple one", ENUM_TYPE, "en", { type: "unclear" }],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("who_for", () => {
  const cases: Case[] = [
    ["For myself", WHO, "en", val("self", 0.9)],
    ["me", WHO, "en", val("self")],
    ["It's for me", WHO, "en", val("self")],
    ["Yo", WHO, "es", val("self")],
    ["Para mí", WHO, "es", val("self")],
    ["Someone else", WHO, "en", val("proxy", 0.9)],
    ["My mom", WHO, "en", val("proxy")],
    ["For my son", WHO, "en", val("proxy")],
    ["Otra persona", WHO, "es", val("proxy")],
    ["Mi hijo", WHO, "es", val("proxy")],
    ["Para mi mamá", WHO, "es", val("proxy")],
    ["For me and my mom", WHO, "en", { type: "unclear" }],
    ["Yes", WHO, "en", { type: "unclear" }],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));

  it("pediatric variant uses the question for yes/no", () => {
    const q = { question: "Are you a parent or guardian calling for a child?" };
    expect(parseUtterance("yes", WHO, "en", q)).toMatchObject({ type: "answer", value: "proxy" });
    expect(parseUtterance("no", WHO, "en", q)).toMatchObject({ type: "answer", value: "self" });
  });
});

describe("relationship", () => {
  const cases: Case[] = [
    ["My son", REL, "en", val("parent_guardian", 0.9)],
    ["She's my daughter", REL, "en", val("parent_guardian")],
    ["I'm the parent", REL, "en", val("parent_guardian")],
    ["I'm his mother", REL, "en", val("parent_guardian")],
    ["My husband", REL, "en", val("spouse_partner")],
    ["She's my wife", REL, "en", val("spouse_partner")],
    ["My mom", REL, "en", val("adult_child")],
    ["I'm her daughter", REL, "en", val("adult_child")],
    ["my father", REL, "en", val("adult_child")],
    ["My grandmother", REL, "en", val("other_family")],
    ["my sister", REL, "en", val("other_family")],
    ["mother-in-law", REL, "en", val("other_family")],
    ["A friend", REL, "en", val("friend_caregiver")],
    ["I'm their caregiver", REL, "en", val("friend_caregiver")],
    ["neighbor", REL, "en", val("friend_caregiver")],
    ["I'm her legal guardian, she's an adult", REL, "en", val("legal_representative")],
    ["I have power of attorney", REL, "en", val("legal_representative")],
    ["legal representative", REL, "en", val("legal_representative")],
    ["I'd prefer not to say", REL, "en", val("other")],
    ["Mi hijo", REL, "es", val("parent_guardian")],
    ["Soy su madre", REL, "es", val("parent_guardian")],
    ["Mi esposo", REL, "es", val("spouse_partner")],
    ["Es mi mamá", REL, "es", val("adult_child")],
    ["Soy su hija", REL, "es", val("adult_child")],
    ["Mi tía", REL, "es", val("other_family")],
    ["Soy su cuidadora", REL, "es", val("friend_caregiver")],
    ["Representante legal", REL, "es", val("legal_representative")],
    ["Prefiero no decir", REL, "es", val("other")],
    ["my mom, I'm her son", REL, "en", val("adult_child")],
    ["my son and my wife", REL, "en", { type: "unclear" }],
    ["the purple one", REL, "en", { type: "unclear" }],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("time_of_day", () => {
  const cases: Case[] = [
    ["Morning", TOD, "en", val("morning", 0.9)],
    ["In the afternoon", TOD, "en", val("afternoon")],
    ["evenings are best", TOD, "en", val("evening")],
    ["after 6 pm", TOD, "en", val("evening")],
    ["around 10 am", TOD, "en", val("morning")],
    ["Anytime", TOD, "en", val("any")],
    ["Whenever", TOD, "en", val("any")],
    ["Por la mañana", TOD, "es", val("morning")],
    ["En la tarde", TOD, "es", val("afternoon")],
    ["De noche", TOD, "es", val("evening")],
    ["A cualquier hora", TOD, "es", val("any")],
    ["Mañana por la tarde", TOD, "es", val("afternoon")],
    ["Morning or afternoon", TOD, "en", { type: "unclear" }],
    ["anytime except mornings", TOD, "en", { type: "unclear" }],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("free_text (first name)", () => {
  const cases: Case[] = [
    ["My name is maria", NAME, "en", val("Maria", 0.9)],
    ["It's John.", NAME, "en", val("John")],
    ["This is Sam", NAME, "en", val("Sam")],
    ["I'm Dana", NAME, "en", val("Dana")],
    ["um, Rosa", NAME, "en", val("Rosa")],
    ["Me llamo José", NAME, "es", val("José")],
    ["Soy Lucía", NAME, "es", val("Lucía")],
    ["Mi nombre es ana maría", NAME, "es", val("Ana María")],
    ["", NAME, "en", { type: "unclear" }],
    ["Can you repeat that?", NAME, "en", { type: "repeat" }],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("phone", () => {
  const cases: Case[] = [
    ["555 123 4567", PHONE, "en", val("555 123 4567", 1)],
    ["  (555) 123-4567  ", PHONE, "en", val("(555) 123-4567", 1)],
    ["cinco cinco cinco, uno dos tres", PHONE, "es", val("cinco cinco cinco, uno dos tres", 1)],
    ["I don't know my number", PHONE, "en", { type: "unsure" }],
    ["Say that again?", PHONE, "en", { type: "repeat" }],
    ["Stop", PHONE, "en", { type: "stop" }],
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("code-switching", () => {
  const cases: Case[] = [
    ["sí, I have it", YN, "en", yes()],
    ["yes, claro", YN, "es", yes()],
    ["no, nunca", YN, "en", no()],
    ["sixty y dos", NUM, "es", val(62)], // mixed-language number words still combine
  ];
  it.each(cases)("%s", (...c) => check(c as Case));
});

describe("keywordInterpreter", () => {
  it("wraps parseUtterance", async () => {
    expect(keywordInterpreter.name).toBe("keyword");
    await expect(keywordInterpreter.interpret("yes", YN, "en", {})).resolves.toEqual({ type: "answer", value: true, confidence: 0.95 });
    await expect(
      keywordInterpreter.interpret("yes", WHO, "en", { question: "Are you a parent or guardian calling for a child?" }),
    ).resolves.toMatchObject({ value: "proxy" });
  });
  it("redFlagTiming is always unclear", async () => {
    await expect(keywordInterpreter.redFlagTiming("I have chest pain right now", { category: "chest_pain", matched: "chest pain" }, "en")).resolves.toBe("unclear");
  });
});
