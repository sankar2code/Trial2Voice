import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapStudy, parseAgeYears, NCT_ID } from "./ctgov";
import { splitEligibility } from "./bullets";
import { unescapeRegistry, normalizeForMatch } from "./text";
import { ageCriterion, sexCriterion, withDerivedRows, AGE_ID } from "./script/derived";
import { validateScript } from "./script/validate";
import { assembleDraft } from "./script/assemble";
import { stableStringify, sha256Hex } from "./hash";
import type { Criterion, Trial } from "./types";
import type { BuilderOutput } from "./script/builder";

const fixture = (id: string) =>
  mapStudy(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "__fixtures__", `${id}.json`), "utf8")));

describe("ctgov", () => {
  test("parses ages", () => {
    expect(parseAgeYears("18 Years")).toBe(18);
    expect(parseAgeYears("6 Months")).toBe(0.5);
    expect(parseAgeYears("N/A")).toBeUndefined();
    expect(parseAgeYears(undefined)).toBeUndefined();
  });
  test("validates NCT IDs", () => {
    expect(NCT_ID.test("NCT07599982")).toBe(true);
    expect(NCT_ID.test("NCT123")).toBe(false);
  });
  test("maps a study", () => {
    const t = fixture("NCT07599982");
    expect(t.shortName).toBe("MODIUS");
    expect([t.minAgeYears, t.maxAgeYears, t.sex]).toEqual([18, 80, "ALL"]);
    expect(t.lastUpdatePostDate).toBe("2026-08-28");
    expect(t.locations.length).toBeGreaterThan(0);
    expect(t.locations[0].lat).toBeTypeOf("number");
    expect(t.eligibilityText).toContain("HbA1c >7.5%"); // unescaped
  });
  test("maps sex and gender-based flags", () => {
    const t = fixture("NCT07229261");
    expect(t.sex).toBe("FEMALE");
    expect(t.genderBased).toBe(true);
  });
});

describe("text", () => {
  test("unescapes registry markdown", () => {
    expect(unescapeRegistry("HbA1c \\>7.5% and \\<12%")).toBe("HbA1c >7.5% and <12%");
  });
  test("normalizes for matching", () => {
    expect(normalizeForMatch("Patient’s  knee\n— pain")).toBe("patient's knee - pain");
  });
});

describe("bullets", () => {
  test("splits numbered inclusion / exclusion lists", () => {
    const b = splitEligibility(fixture("NCT07599982").eligibilityText);
    expect(b.filter((x) => x.kind === "inclusion")).toHaveLength(15);
    expect(b.filter((x) => x.kind === "exclusion")).toHaveLength(16);
    expect(b[0].id).toBe("I1");
    expect(b.find((x) => x.id === "E1")!.text).toMatch(/^Use of an insulin pump/);
  });
  test("keeps nested items inside the parent bullet", () => {
    const b = splitEligibility(fixture("NCT05332067").eligibilityText);
    const i9 = b.find((x) => x.id === "I9")!;
    expect(i9.text).toContain("At least one of the following");
    expect(i9.text).toContain("perennial aeroallergens");
  });
  test("recognises extra inclusion headings", () => {
    const b = splitEligibility(fixture("NCT05332067").eligibilityText);
    expect(b.find((x) => x.id === "I12")!.section).toMatch(/^Additional Inclusion Criteria/);
  });
  test("handles star bullets and paragraph criteria", () => {
    const b = splitEligibility("Inclusion Criteria:\n\n* Adults\n* Smokers\n  * at least 10 a day\n\nExclusion Criteria:\n\nPregnant women.\nPrior surgery.");
    expect(b.map((x) => x.id)).toEqual(["I1", "I2", "E1", "E2"]);
    expect(b[1].text).toContain("at least 10 a day");
  });
  test("defaults to inclusion when there is no heading", () => {
    const b = splitEligibility("1. Adults\n2. Diagnosed with asthma");
    expect(b.every((x) => x.kind === "inclusion")).toBe(true);
  });
});

describe("derived rows", () => {
  const t = fixture("NCT07599982");
  test("age row from structured fields", () => {
    const a = ageCriterion(t)!;
    expect(a.rule).toEqual({ op: "between", min: 18, max: 80 });
    expect(a.registryDerived).toBe(true);
  });
  test("one-sided age limit", () => {
    expect(ageCriterion({ ...t, maxAgeYears: undefined })!.rule).toEqual({ op: "gte", value: 18 });
    expect(ageCriterion({ ...t, minAgeYears: undefined, maxAgeYears: undefined })).toBeNull();
  });
  test("sex row only when restricted", () => {
    expect(sexCriterion(t)).toBeNull();
    expect(sexCriterion({ ...t, sex: "FEMALE" })!.mode).toBe("ask");
    expect(sexCriterion({ ...t, sex: "FEMALE", genderBased: true })!.mode).toBe("confirm_at_site");
  });
  test("withDerivedRows replaces old rows and keeps bullet links", () => {
    const first = withDerivedRows(t, [], { age: ["I3"] });
    const again = withDerivedRows({ ...t, maxAgeYears: 75 }, first);
    expect(again[0].id).toBe(AGE_ID);
    expect(again[0].bulletIds).toEqual(["I3"]);
    expect(again[0].rule).toEqual({ op: "between", min: 18, max: 75 });
    expect(again.filter((c) => c.id === AGE_ID)).toHaveLength(1);
  });
});

// --- validation --------------------------------------------------------------

const TEXT = "Inclusion Criteria:\n\n1. Age 18-65\n2. Diagnosed with type 2 diabetes\n3. HbA1c >7%\n\nExclusion Criteria:\n\n1. Heart surgery in the last 6 months";
const trial: Trial = {
  nctId: "NCT00000001", briefTitle: "Test", shortName: "TEST", overallStatus: "RECRUITING",
  lastUpdatePostDate: "2026-10-01", minAgeYears: 18, maxAgeYears: 65, sex: "ALL", genderBased: false,
  healthyVolunteers: false, eligibilityText: TEXT, locations: [], fetchedAt: "", stale: false, callsPaused: false,
};
const bi = (en: string) => ({ en, es: `${en} (es)` });
const ask = (over: Partial<Criterion>): Criterion => ({
  id: "IN-01", kind: "inclusion", bulletIds: ["I2"], sourceText: "Diagnosed with type 2 diabetes", mode: "ask",
  question: bi("Has a doctor told you that you have type 2 diabetes?"),
  questionProxy: bi("Has a doctor told the person you're calling for that they have type 2 diabetes?"),
  altPhrasings: { en: [], es: [] }, answerType: "yes_no", unit: null, enumOptions: [],
  rule: { op: "eq", value: true },
  readBackText: bi("So you don't have type 2 diabetes — is that right?"),
  readBackTextProxy: bi("So they don't have type 2 diabetes — is that right?"),
  groupId: null, registryDerived: false, siteCheckNote: "", ...over,
});
const site = (over: Partial<Criterion>): Criterion => ({
  ...ask({}), id: "IN-02", bulletIds: ["I3"], sourceText: "HbA1c >7%", mode: "confirm_at_site",
  question: bi(""), questionProxy: bi(""), readBackText: bi(""), readBackTextProxy: bi(""),
  answerType: null, rule: null, siteCheckNote: "Check HbA1c lab value.", ...over,
});
const exclusion = ask({
  id: "EX-01", kind: "exclusion", bulletIds: ["E1"], sourceText: "Heart surgery in the last 6 months",
  question: bi("In the last 6 months, have you had heart surgery?"),
  questionProxy: bi("In the last 6 months, has the person you're calling for had heart surgery?"),
  rule: { op: "eq", value: false },
});
const goodOutput: BuilderOutput = { criteria: [ask({}), site({}), exclusion], groups: [], glossary: [], derivedBulletIds: { age: ["I1"], sex: [] } };
const draft = (output = goodOutput) =>
  assembleDraft({ trial, bullets: splitEligibility(TEXT), output, version: 1, createdBy: "test", now: "2026-11-01" });

describe("validateScript", () => {
  test("a complete script passes", () => {
    const r = validateScript(draft());
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.canApprove).toBe(true);
    expect(r.coverage).toEqual({ covered: 4, total: 4, unmapped: [] });
  });
  test("flags unmapped bullets", () => {
    const r = validateScript(draft({ ...goodOutput, criteria: [ask({}), exclusion] }));
    expect(r.coverage.unmapped).toEqual(["I3"]);
    expect(r.canApprove).toBe(false);
  });
  test("source text must quote the registry", () => {
    const r = validateScript(draft({ ...goodOutput, criteria: [ask({ sourceText: "Has diabetes" }), site({}), exclusion] }));
    expect(r.issues.some((i) => i.message.includes("exact quote"))).toBe(true);
  });
  test("caller-facing text must not say eligible", () => {
    const bad = ask({ question: bi("Are you eligible because you have diabetes?") });
    const r = validateScript(draft({ ...goodOutput, criteria: [bad, site({}), exclusion] }));
    expect(r.issues.some((i) => i.message.includes("eligible"))).toBe(true);
  });
  test("rule must fit the answer type", () => {
    const bad = ask({ rule: { op: "gte", value: 3 } });
    expect(validateScript(draft({ ...goodOutput, criteria: [bad, site({}), exclusion] })).canApprove).toBe(false);
  });
  test("asked items need Spanish and caregiver wording", () => {
    const bad = ask({ questionProxy: { en: "", es: "" } });
    const r = validateScript(draft({ ...goodOutput, criteria: [bad, site({}), exclusion] }));
    expect(r.issues.some((i) => i.message.includes("caregiver question"))).toBe(true);
  });
  test("OR-groups need consistent members", () => {
    const a = site({ id: "IN-02a", groupId: "G1" });
    const b = site({ id: "IN-02b", groupId: "G1" });
    const ok = { ...goodOutput, criteria: [ask({}), a, b, exclusion], groups: [{ id: "G1", logic: "any" as const, criterionIds: ["IN-02a", "IN-02b"], label: "Either" }] };
    expect(validateScript(draft(ok)).canApprove).toBe(true);
    const broken = { ...ok, groups: [{ ...ok.groups[0], criterionIds: ["IN-02a"] }] };
    expect(validateScript(draft(broken)).canApprove).toBe(false);
  });
  test("warns when most criteria need a site check", () => {
    const r = validateScript(draft({ ...goodOutput, criteria: [site({ id: "A", bulletIds: ["I2"], sourceText: "Diagnosed with type 2 diabetes" }), site({}), site({ id: "EX-01", kind: "exclusion", bulletIds: ["E1"], sourceText: "Heart surgery in the last 6 months" })] }));
    expect(r.issues.some((i) => i.level === "warning" && i.message.includes("site check"))).toBe(true);
  });
});

describe("hash", () => {
  test("stable stringify ignores key order", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
  test("sha256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
