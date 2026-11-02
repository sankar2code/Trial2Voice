// Deterministic decision engine (PRD §4, Addendum G2/G3/G4).
// The ONLY component that sets eligibility status. It never sees free text and
// must not import any LLM code (enforced by an ESLint rule).
import type { Criterion, CriterionGroup, Rule } from "./types";
import type { Answer, AnswerValue, Decision, NumericValue, RowResult } from "./call/types";

export type RuleOutcome = "pass" | "fail" | "mixed";

function numericBounds(v: NumericValue): [number, number] {
  return typeof v === "number" ? [v, v] : [v.min, v.max];
}

function numericPasses(rule: Rule, n: number): boolean | null {
  switch (rule.op) {
    case "lt": return n < rule.value;
    case "lte": return n <= rule.value;
    case "gt": return n > rule.value;
    case "gte": return n >= rule.value;
    case "between": return n >= rule.min && n <= rule.max;
    case "eq": return typeof rule.value === "number" ? n === rule.value : null;
    case "neq": return typeof rule.value === "number" ? n !== rule.value : null;
    default: return null;
  }
}

/**
 * Does a structured value satisfy the PASS condition?
 * A numeric range that is partly inside the limits is "mixed" (G4): the call
 * re-asks once for an exact value, then records Unsure.
 */
export function evaluateRule(rule: Rule, value: AnswerValue): RuleOutcome {
  if (typeof value === "boolean") {
    if ((rule.op === "eq" || rule.op === "neq") && typeof rule.value === "boolean") {
      return (rule.op === "eq" ? value === rule.value : value !== rule.value) ? "pass" : "fail";
    }
    return "mixed";
  }
  if (typeof value === "string") {
    if (rule.op === "in") return rule.values.includes(value) ? "pass" : "fail";
    if (rule.op === "not_in") return rule.values.includes(value) ? "fail" : "pass";
    if ((rule.op === "eq" || rule.op === "neq") && typeof rule.value === "string")
      return (rule.op === "eq" ? value === rule.value : value !== rule.value) ? "pass" : "fail";
    return "mixed";
  }
  const [lo, hi] = numericBounds(value);
  const a = numericPasses(rule, lo);
  const b = numericPasses(rule, hi);
  if (a === null || b === null) return "mixed";
  if (a && b) return "pass";
  if (!a && !b) return "fail";
  return "mixed";
}

/** Latest answer per criterion that hasn't been superseded (G6). */
export function currentAnswers(answers: Answer[]): Map<string, Answer> {
  const map = new Map<string, Answer>();
  for (const a of answers) if (!a.supersededBy) map.set(a.criterionId, a);
  return map;
}

/** Per-criterion result (Addendum G2). */
export function criterionResult(c: Criterion, answer: Answer | undefined, threshold: number): RowResult {
  if (c.mode === "confirm_at_site") return "SITE_CHECK";
  if (!answer || answer.value === "UNSURE" || !c.rule) return "UNSURE";
  if (answer.confidence < threshold) return "UNSURE";
  const outcome = evaluateRule(c.rule, answer.value);
  if (outcome === "pass") return "PASS";
  if (outcome === "fail") return answer.readBackConfirmed ? "FAIL" : "UNSURE";
  return "UNSURE";
}

function groupResult(members: RowResult[]): RowResult {
  if (members.some((r) => r === "PASS")) return "PASS";
  if (members.length > 0 && members.every((r) => r === "FAIL")) return "FAIL";
  if (members.every((r) => r === "SITE_CHECK" || r === "FAIL")) return "SITE_CHECK";
  return "UNSURE";
}

export type DecisionResult = {
  decision: Decision;
  rows: { criterionId: string; result: RowResult }[];
  groups: { groupId: string; result: RowResult }[];
  pendingSiteChecks: string[];
};

export function decide(script: { criteria: Criterion[]; groups: CriterionGroup[]; confidenceThreshold: number }, answers: Answer[]): DecisionResult {
  const current = currentAnswers(answers);
  const rows = script.criteria.map((c) => ({ criterionId: c.id, result: criterionResult(c, current.get(c.id), script.confidenceThreshold) }));
  return decideFromRows(rows, script.groups);
}

/**
 * Same decision rules applied to per-criterion results directly. Used when a
 * coordinator overrides a row: the outcome is recomputed, never hand-set.
 */
export function decideFromRows(rows: { criterionId: string; result: RowResult }[], groupsDef: CriterionGroup[]): DecisionResult {
  const byId = new Map(rows.map((r) => [r.criterionId, r.result]));
  const script = { groups: groupsDef };

  const grouped = new Set(script.groups.flatMap((g) => g.criterionIds));
  const groups = script.groups.map((g) => ({ groupId: g.id, result: groupResult(g.criterionIds.map((id) => byId.get(id) ?? "UNSURE")) }));
  // Units the decision is made on: ungrouped criteria + whole groups.
  const units = [...rows.filter((r) => !grouped.has(r.criterionId)).map((r) => r.result), ...groups.map((g) => g.result)];

  const decision: Decision = units.includes("FAIL") ? "NOT_ELIGIBLE" : units.includes("UNSURE") ? "NEEDS_SITE_REVIEW" : "LIKELY_ELIGIBLE";
  return { decision, rows, groups, pendingSiteChecks: rows.filter((r) => r.result === "SITE_CHECK").map((r) => r.criterionId) };
}
