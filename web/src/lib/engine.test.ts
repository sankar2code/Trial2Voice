import { describe, expect, test } from "vitest";
import { criterionResult, decide, evaluateRule } from "./engine";
import type { Criterion, Rule } from "./types";
import type { Answer } from "./call/types";

const crit = (id: string, rule: Rule | null, over: Partial<Criterion> = {}): Criterion => ({
  id, kind: "inclusion", bulletIds: [], sourceText: "", mode: rule ? "ask" : "confirm_at_site",
  question: { en: "q", es: "q" }, questionProxy: { en: "q", es: "q" }, altPhrasings: { en: [], es: [] },
  answerType: rule ? "yes_no" : null, unit: null, enumOptions: [], rule,
  readBackText: { en: "", es: "" }, readBackTextProxy: { en: "", es: "" },
  groupId: null, registryDerived: false, siteCheckNote: "", ...over,
});
let n = 0;
const ans = (criterionId: string, value: Answer["value"], over: Partial<Answer> = {}): Answer => ({
  id: `a${++n}`, criterionId, questionSpoken: "", callerWords: "", value, confidence: 0.95, readBackConfirmed: false, at: 0, ...over,
});

describe("evaluateRule", () => {
  test.each([
    [{ op: "eq", value: true }, true, "pass"],
    [{ op: "eq", value: true }, false, "fail"],
    [{ op: "eq", value: false }, false, "pass"],
    [{ op: "neq", value: true }, false, "pass"],
    [{ op: "between", min: 18, max: 80 }, 18, "pass"],
    [{ op: "between", min: 18, max: 80 }, 80, "pass"],
    [{ op: "between", min: 18, max: 80 }, 81, "fail"],
    [{ op: "between", min: 18, max: 80 }, { min: 60, max: 69 }, "pass"],
    [{ op: "between", min: 18, max: 65 }, { min: 60, max: 69 }, "mixed"],
    [{ op: "between", min: 18, max: 50 }, { min: 60, max: 69 }, "fail"],
    [{ op: "gt", value: 6 }, Infinity, "pass"],
    [{ op: "gt", value: 6 }, 3, "fail"],
    [{ op: "gte", value: 6 }, 6, "pass"],
    [{ op: "lt", value: 40 }, 40, "fail"],
    [{ op: "lte", value: 440 }, 440, "pass"],
    [{ op: "in", values: ["yes", "does not apply"] }, "does not apply", "pass"],
    [{ op: "in", values: ["yes", "does not apply"] }, "no", "fail"],
    [{ op: "not_in", values: ["no"] }, "no", "fail"],
    [{ op: "eq", value: "yes" }, "yes", "pass"],
    [{ op: "eq", value: true }, 5, "mixed"],
    [{ op: "gte", value: 3 }, true, "mixed"],
    [{ op: "in", values: ["a"] }, 3, "mixed"],
  ] as [Rule, Answer["value"], string][])("%j with %j → %s", (rule, value, out) => {
    expect(evaluateRule(rule, value as never)).toBe(out);
  });
});

describe("criterionResult (G2)", () => {
  const c = crit("EX-01", { op: "eq", value: false }, { kind: "exclusion" });
  test("site check items never need an answer", () => {
    expect(criterionResult(crit("S", null), undefined, 0.8)).toBe("SITE_CHECK");
  });
  test("missing or unsure → UNSURE", () => {
    expect(criterionResult(c, undefined, 0.8)).toBe("UNSURE");
    expect(criterionResult(c, ans("EX-01", "UNSURE"), 0.8)).toBe("UNSURE");
  });
  test("low confidence → UNSURE even when it would pass", () => {
    expect(criterionResult(c, ans("EX-01", false, { confidence: 0.79 }), 0.8)).toBe("UNSURE");
    expect(criterionResult(c, ans("EX-01", false, { confidence: 0.8 }), 0.8)).toBe("PASS");
  });
  test("FAIL only with a confirmed read-back", () => {
    expect(criterionResult(c, ans("EX-01", true), 0.8)).toBe("UNSURE");
    expect(criterionResult(c, ans("EX-01", true, { readBackConfirmed: true }), 0.8)).toBe("FAIL");
  });
  test("a straddling range is UNSURE", () => {
    const age = crit("IN-AGE", { op: "between", min: 18, max: 65 }, { answerType: "number" });
    expect(criterionResult(age, ans("IN-AGE", { min: 60, max: 69 }, { readBackConfirmed: true }), 0.8)).toBe("UNSURE");
  });
});

describe("decide", () => {
  const script = (criteria: Criterion[], groups = [] as { id: string; logic: "any"; criterionIds: string[]; label: string }[]) => ({ criteria, groups, confidenceThreshold: 0.8 });
  const a = crit("IN-01", { op: "eq", value: true });
  const b = crit("EX-01", { op: "eq", value: false }, { kind: "exclusion" });
  const site = crit("IN-02", null);

  test("all asked pass + site checks pending → LIKELY_ELIGIBLE (G3)", () => {
    const r = decide(script([a, b, site]), [ans("IN-01", true), ans("EX-01", false)]);
    expect(r.decision).toBe("LIKELY_ELIGIBLE");
    expect(r.pendingSiteChecks).toEqual(["IN-02"]);
  });
  test("any confirmed FAIL → NOT_ELIGIBLE, even with unsure items", () => {
    expect(decide(script([a, b]), [ans("IN-01", "UNSURE"), ans("EX-01", true, { readBackConfirmed: true })]).decision).toBe("NOT_ELIGIBLE");
  });
  test("unconfirmed screen-out → NEEDS_SITE_REVIEW, never NOT_ELIGIBLE", () => {
    expect(decide(script([a, b]), [ans("IN-01", true), ans("EX-01", true)]).decision).toBe("NEEDS_SITE_REVIEW");
  });
  test("unanswered question → NEEDS_SITE_REVIEW", () => {
    expect(decide(script([a, b]), [ans("IN-01", true)]).decision).toBe("NEEDS_SITE_REVIEW");
  });
  test("superseded answers are ignored (go back)", () => {
    const first = ans("EX-01", true, { readBackConfirmed: true, supersededBy: "x" });
    expect(decide(script([a, b]), [ans("IN-01", true), first, ans("EX-01", false)]).decision).toBe("LIKELY_ELIGIBLE");
  });
  describe("any-of groups", () => {
    const g1 = crit("G-a", { op: "eq", value: true }, { groupId: "G" });
    const g2 = crit("G-b", { op: "eq", value: true }, { groupId: "G" });
    const groups = [{ id: "G", logic: "any" as const, criterionIds: ["G-a", "G-b"], label: "" }];
    test("one member passing passes the group", () => {
      expect(decide(script([g1, g2], groups), [ans("G-a", false, { readBackConfirmed: true }), ans("G-b", true)]).decision).toBe("LIKELY_ELIGIBLE");
    });
    test("all members failing fails the group", () => {
      expect(decide(script([g1, g2], groups), [ans("G-a", false, { readBackConfirmed: true }), ans("G-b", false, { readBackConfirmed: true })]).decision).toBe("NOT_ELIGIBLE");
    });
    test("one fail + one unsure → unsure", () => {
      expect(decide(script([g1, g2], groups), [ans("G-a", false, { readBackConfirmed: true })]).decision).toBe("NEEDS_SITE_REVIEW");
    });
    test("group of site checks stays a site check", () => {
      const s1 = crit("S-a", null, { groupId: "S" });
      const s2 = crit("S-b", null, { groupId: "S" });
      const r = decide(script([a, s1, s2], [{ id: "S", logic: "any", criterionIds: ["S-a", "S-b"], label: "" }]), [ans("IN-01", true)]);
      expect(r.decision).toBe("LIKELY_ELIGIBLE");
      expect(r.groups[0].result).toBe("SITE_CHECK");
    });
  });
});
