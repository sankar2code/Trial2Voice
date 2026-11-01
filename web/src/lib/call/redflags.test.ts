import { describe, expect, test } from "vitest";
import { detectRedFlag } from "./redflags";
import type { RedFlagCategory } from "./types";

const flags: [string, RedFlagCategory][] = [
  // chest_pain — EN
  ["I have chest pain right now", "chest_pain"],
  ["theres a lot of pressure in my chest", "chest_pain"],
  ["my chest feels tight", "chest_pain"],
  ["I think I'm having a heart attack", "chest_pain"],
  ["I had a heart attack in 2019", "chest_pain"], // historical: acceptable, timing step decides
  ["CHEST PAIN!!!", "chest_pain"],
  ["no I'm having chest pain", "chest_pain"], // "no" answers the question, not a negation
  // chest_pain — ES
  ["tengo dolor de pecho", "chest_pain"],
  ["siento presión en el pecho", "chest_pain"],
  ["me duele el pecho mucho", "chest_pain"],
  ["creo que es un infarto", "chest_pain"],
  ["ataque al corazón", "chest_pain"],
  // breathing — EN
  ["I can't breathe", "breathing"],
  ["i cant breath", "breathing"],
  ["she's struggling to breathe", "breathing"],
  ["no I can't breathe", "breathing"],
  ["I'm having trouble breathing", "breathing"],
  ["I'm short of breath", "breathing"],
  // breathing — ES
  ["no puedo respirar", "breathing"],
  ["me falta el aire", "breathing"],
  ["mi mamá no puede respirar", "breathing"],
  ["tiene dificultad para respirar", "breathing"],
  // stroke — EN
  ["his face is drooping", "stroke"],
  ["my arm is numb on one side", "stroke"],
  ["I can't move my arm", "stroke"],
  ["her speech is slurred", "stroke"],
  ["slurred speech since this morning", "stroke"],
  ["I think he's having a stroke", "stroke"],
  ["weakness on the left side", "stroke"],
  // stroke — ES
  ["creo que es un derrame", "stroke"],
  ["se me cayó la cara", "stroke"],
  ["no puedo mover el brazo", "stroke"],
  ["tiene la boca torcida", "stroke"],
  // bleeding_overdose — EN
  ["I'm bleeding a lot", "bleeding_overdose"],
  ["the bleeding won't stop", "bleeding_overdose"],
  ["I took too many pills", "bleeding_overdose"],
  ["he took a handful of sleeping pills", "bleeding_overdose"],
  ["I think it's an overdose", "bleeding_overdose"],
  ["she was poisoned", "bleeding_overdose"],
  // bleeding_overdose — ES
  ["estoy sangrando mucho", "bleeding_overdose"],
  ["tomé demasiadas pastillas", "bleeding_overdose"],
  ["es una sobredosis", "bleeding_overdose"],
  ["no para de sangrar", "bleeding_overdose"],
  // self_harm — EN
  ["I want to kill myself", "self_harm"],
  ["sometimes I want to end my life", "self_harm"],
  ["i just want to die", "self_harm"],
  ["I've been thinking about hurting myself", "self_harm"],
  ["I feel suicidal", "self_harm"],
  ["suicide", "self_harm"],
  // self_harm — ES
  ["ya no quiero vivir", "self_harm"],
  ["pienso en quitarme la vida", "self_harm"],
  ["quiero hacerme daño", "self_harm"],
  ["he pensado en el suicidio", "self_harm"],
  // acute_distress — EN
  ["I'm passing out", "acute_distress"],
  ["I feel like I'm about to faint", "acute_distress"],
  ["I'm having a severe allergic reaction", "acute_distress"],
  ["my throat is closing", "acute_distress"],
  // acute_distress — ES
  ["me estoy desmayando", "acute_distress"],
  ["tengo una reacción alérgica fuerte", "acute_distress"],
  ["se me está cerrando la garganta", "acute_distress"],
  // code-switching: Spanish list checked on an English call and vice versa
  ["yes and also me falta el aire", "breathing"],
  ["sí, I can't breathe", "breathing"],
];

describe("detectRedFlag: positives", () => {
  test.each(flags)("%s → %s", (text, cat) => {
    expect(detectRedFlag(text)?.category).toBe(cat);
  });
});

const clean: string[] = [
  // negations
  "no chest pain",
  "I don't have chest pain",
  "I never had a heart attack",
  "I haven't had a stroke",
  "no tengo dolor de pecho",
  "nunca he tenido un derrame",
  "no trouble breathing",
  "I'm not bleeding",
  "never overdosed",
  "no, I've never passed out", // "passed out" not a pattern; also negated
  "I'm not having chest pressure",
  "sin dolor de pecho",
  "no history of stroke",
  // false-positive traps from ordinary trial answers
  "I had a breathing tube after surgery",
  "yes I was on a breathing tube",
  "I had a blood test last week",
  "I did a blood donation in March",
  "my blood sugar is around 140",
  "my blood pressure is fine",
  "I ate too much at dinner",
  "it took too much time",
  "he had a heat stroke years ago",
  "I'm fifty two years old",
  "yes",
  "",
  "   ",
  "tengo diabetes tipo dos",
];

describe("detectRedFlag: no flag", () => {
  test.each(clean)("%j → null", (text) => {
    expect(detectRedFlag(text)).toBeNull();
  });
});

describe("detectRedFlag: self-harm is never negated", () => {
  test.each([
    "I'm not suicidal",
    "I don't want to kill myself",
    "I would never hurt myself",
    "no quiero hacerme daño",
    "no I don't want to die",
  ])("%s → self_harm", (text) => {
    expect(detectRedFlag(text)?.category).toBe("self_harm");
  });
});

describe("detectRedFlag: priority and matching", () => {
  test("self-harm wins over an earlier chest-pain mention", () => {
    expect(detectRedFlag("I have chest pain and I want to die")).toEqual({ category: "self_harm", matched: "want to die" });
  });
  test("self-harm wins over overdose", () => {
    expect(detectRedFlag("I took too many pills because I want to end my life")?.category).toBe("self_harm");
  });
  test("earliest non-self-harm match wins", () => {
    expect(detectRedFlag("I can't breathe and my chest hurts")?.category).toBe("breathing");
  });
  test("negated mention skipped, later real mention flags", () => {
    expect(detectRedFlag("no chest pain but I can't breathe")?.category).toBe("breathing");
  });
  test("negation is local: second unnegated mention flags", () => {
    expect(detectRedFlag("no chest pain earlier but now chest pain")?.category).toBe("chest_pain");
  });
  test("matched is the normalized phrase", () => {
    expect(detectRedFlag("Siento PRESIÓN en el pecho")).toEqual({ category: "chest_pain", matched: "presion en el pecho" });
  });
  test("apostrophes and punctuation are normalized", () => {
    expect(detectRedFlag("I...can’t... breathe!!")).toEqual({ category: "breathing", matched: "cant breathe" });
  });
});
