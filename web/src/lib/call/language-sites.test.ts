import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { detectLanguage, isOnlyLanguageRequest, languageRequest } from "./language";
import { milesBetween, nearestTo } from "../sites";
import { mapStudy } from "../ctgov";
import { splitEligibility } from "../bullets";
import { BuilderOutput } from "../script/builder";
import { assembleDraft } from "../script/assemble";
import { CallSession } from "./session";
import { keywordInterpreter } from "./parse";
import type { ScriptVersion, Trial } from "../types";

describe("detectLanguage", () => {
  test.each([
    ["Sí, tengo diabetes hace dos años", "es"],
    ["No, nunca he tenido eso", "es"],
    ["¿Puede repetir la pregunta?", "es"],
    ["Yes, I have had diabetes for two years", "en"],
    ["No, I don't think so", "en"],
    ["Can you repeat that?", "en"],
    ["en español por favor", "es"],
    ["English please", "en"],
  ])("%s → %s", (text, lang) => expect(detectLanguage(text)).toBe(lang));

  test.each(["no", "sí", "ok", "45", "Sam", "Diabetes", "Maria Lopez"])("too short or ambiguous: %s → null", (text) => {
    expect(detectLanguage(text)).toBeNull();
  });

  test("explicit requests", () => {
    expect(languageRequest("¿habla español?")).toBe("es");
    expect(isOnlyLanguageRequest("Spanish please")).toBe(true);
    expect(isOnlyLanguageRequest("sí, en español, tengo 45 años")).toBe(false);
  });
});

describe("sites", () => {
  test("distance is roughly right (NYC → Boston ≈ 190 mi)", () => {
    expect(milesBetween({ lat: 40.7128, lon: -74.006 }, { lat: 42.3601, lon: -71.0589 })).toBeGreaterThan(180);
    expect(milesBetween({ lat: 40.7128, lon: -74.006 }, { lat: 42.3601, lon: -71.0589 })).toBeLessThan(200);
  });
  test("nearest recruiting site wins; non-recruiting ignored", () => {
    const trial = { locations: [
      { facility: "Far", city: "LA", state: "California", country: "US", status: "RECRUITING", lat: 34.05, lon: -118.24 },
      { facility: "Closed", city: "Newark", state: "New Jersey", country: "US", status: "COMPLETED", lat: 40.73, lon: -74.17 },
      { facility: "Near", city: "Albany", state: "New York", country: "US", status: "RECRUITING", lat: 42.65, lon: -73.75 },
    ] } as unknown as Trial;
    expect(nearestTo(trial, { lat: 40.71, lon: -74.0 })?.facility).toBe("Near");
  });
  test("falls back to same state when sites have no coordinates", () => {
    const trial = { locations: [
      { facility: "A", city: "x", state: "Texas", country: "US", status: "RECRUITING" },
      { facility: "B", city: "y", state: "Ohio", country: "US", status: "RECRUITING" },
    ] } as unknown as Trial;
    expect(nearestTo(trial, { lat: 0, lon: 0, state: "Ohio" })?.facility).toBe("B");
  });
});

// --- In-call behavior ----------------------------------------------------------

const DEMO = path.join(import.meta.dirname, "..", "..", "data", "demo");
function modius(): { trial: Trial; script: ScriptVersion } {
  const trial = mapStudy(JSON.parse(fs.readFileSync(path.join(DEMO, "NCT07599982.registry.json"), "utf8")));
  const output = BuilderOutput.parse(JSON.parse(fs.readFileSync(path.join(DEMO, "NCT07599982.script.json"), "utf8")));
  const draft = assembleDraft({ trial, bullets: splitEligibility(trial.eligibilityText), output, version: 1, createdBy: "t" });
  return { trial, script: { ...draft, status: "locked", approval: { approver: "t", irbRef: "t", date: "x", lockedAt: "x", sha256: "f".repeat(64) } } };
}
const { trial, script } = modius();
const asked = script.criteria.filter((c) => c.mode === "ask");
const pass = (i: number) => {
  const c = asked[i];
  if (c.answerType === "number") return "49";
  const r = c.rule as { op: string; value: boolean };
  return (r.op === "eq" ? r.value : !r.value) ? "yes" : "no";
};

describe("language switching in a call", () => {
  test("a Spanish sentence mid-call switches the rest of the call, keeping the question", async () => {
    const s = new CallSession({ trial, script, interpreter: keywordInterpreter, lang: "en", mode: "text" });
    s.start();
    await s.hear("yes");
    await s.hear("myself");
    await s.hear(pass(0));
    const t = await s.hear("Sí, me dijeron que tengo diabetes hace muchos años");
    expect(s.lang).toBe("es");
    expect(s.record.language).toBe("mixed");
    expect(t.lines.at(-1)?.text).toBe(asked[2].question.es);
    expect(t.lines.at(-1)?.lang).toBe("es");
  });
  test("'Spanish please' repeats the current question in Spanish", async () => {
    const s = new CallSession({ trial, script, interpreter: keywordInterpreter, lang: "en", mode: "text" });
    s.start();
    await s.hear("yes");
    await s.hear("myself");
    const t = await s.hear("Spanish please");
    expect(t.lines.map((l) => l.text)).toEqual([asked[0].question.es]);
    expect(s.record.answers).toHaveLength(0);
  });
  test("short answers never switch", async () => {
    const s = new CallSession({ trial, script, interpreter: keywordInterpreter, lang: "en", mode: "text" });
    s.start();
    await s.hear("sí");
    expect(s.lang).toBe("en");
  });
});

describe("ZIP code and nearest site", () => {
  async function toZip(findSite: (zip: string) => Promise<unknown>) {
    const s = new CallSession({ trial, script, interpreter: keywordInterpreter, lang: "en", mode: "text", findSite: findSite as never });
    s.start();
    await s.hear("yes");
    await s.hear("myself");
    for (let i = 0; i < asked.length; i++) await s.hear(pass(i));
    for (const u of ["no", "yes", "Sam", "yes", "555 555 0100", "yes", "no", "evening"]) await s.hear(u);
    return s;
  }
  test("ZIP → nearest site named in the closing; ZIP and digits not stored", async () => {
    let asked: string | null = null;
    const s = await toZip(async (zip) => { asked = zip; return { facility: "Henry Ford Health System", city: "Detroit", state: "Michigan", miles: 3 }; });
    const t = await s.hear("four eight two zero one");
    expect(asked).toBe("48201");
    expect(t.lines.map((l) => l.text).join(" ")).toMatch(/study team at Henry Ford Health System will contact you/);
    expect(s.record.nearestSite?.facility).toBe("Henry Ford Health System");
    expect(s.record.contactPrefs).toEqual({ voicemailOk: false, bestTime: "evening", language: "en" });
    expect(JSON.stringify(s.record)).not.toMatch(/48201|four eight two/);
  });
  test("skip → generic closing", async () => {
    const s = await toZip(async () => null);
    const t = await s.hear("skip");
    expect(t.ended).toBe(true);
    expect(t.lines.map((l) => l.text).join(" ")).toMatch(/The study team will contact you/);
  });
});
