// Human-readable version diff: each script is rendered as plain lines, then
// line-diffed. Reviewers see wording and rule changes, not JSON noise.
import { diffLines } from "diff";
import type { Criterion, Rule, ScriptVersion } from "../types";

export function ruleText(r: Rule | null): string {
  if (!r) return "—";
  switch (r.op) {
    case "between":
      return `between ${r.min} and ${r.max}`;
    case "in":
      return `one of ${r.values.join(", ")}`;
    case "not_in":
      return `none of ${r.values.join(", ")}`;
    default: {
      if (typeof r.value === "boolean") return r.op === "eq" ? (r.value ? "yes" : "no") : r.value ? "no" : "yes";
      const sym: Record<string, string> = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥" };
      return `${sym[r.op]} ${String(r.value)}`;
    }
  }
}

function criterionLines(c: Criterion): string[] {
  const head = `${c.id} · ${c.kind} · ${c.mode === "ask" ? "ask" : "confirm at site"}${c.groupId ? ` · group ${c.groupId}` : ""} · bullets ${c.bulletIds.join(", ") || "none"}`;
  const out = [head, `  source: ${c.sourceText}`];
  if (c.mode === "ask") {
    out.push(
      `  Q (en): ${c.question.en}`,
      `  Q (es): ${c.question.es}`,
      `  caregiver (en): ${c.questionProxy.en}`,
      `  caregiver (es): ${c.questionProxy.es}`,
      `  answer: ${c.answerType}${c.unit ? ` (${c.unit})` : ""}${c.enumOptions.length ? ` [${c.enumOptions.join(" | ")}]` : ""} · pass if ${ruleText(c.rule)}`,
      `  read-back (en): ${c.readBackText.en}`,
      `  read-back (es): ${c.readBackText.es}`,
    );
    c.altPhrasings.en.forEach((a) => out.push(`  alt (en): ${a}`));
    c.altPhrasings.es.forEach((a) => out.push(`  alt (es): ${a}`));
  } else {
    out.push(`  site check: ${c.siteCheckNote}`);
  }
  return out;
}

export function scriptToText(s: ScriptVersion): string {
  const lines = [
    `Registry record: ${s.sourceLastUpdate}`,
    `Settings: confidence ≥ ${s.confidenceThreshold} · verbatim only: ${s.verbatimOnly ? "yes" : "no"} · stop on confirmed fail: ${s.stopOnConfirmedFail ? "yes" : "no"}`,
    "",
    ...s.criteria.flatMap((c) => [...criterionLines(c), ""]),
    ...s.groups.map((g) => `Group ${g.id} (any of): ${g.criterionIds.join(", ")} — ${g.label}`),
    ...s.glossary.map((g) => `Glossary: ${g.term} — ${g.plainDefinition.en} / ${g.plainDefinition.es}`),
  ];
  return lines.join("\n") + "\n";
}

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

export function diffText(a: string, b: string): DiffPart[] {
  return diffLines(a, b).map((p) => ({ kind: p.added ? "added" : p.removed ? "removed" : "same", text: p.value }));
}

export function diffScripts(a: ScriptVersion, b: ScriptVersion): DiffPart[] {
  return diffText(scriptToText(a), scriptToText(b));
}
