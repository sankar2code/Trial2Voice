// Script checks run in the editor and before approval. Errors block approval;
// warnings are shown to the approver. Rules: Addendum G1, G2, G3, G7.
import { Criterion as CriterionSchema, type Criterion, type ScriptVersion } from "../types";
import { normalizeForMatch } from "../text";

export type Issue = { level: "error" | "warning"; criterionId?: string; message: string };

export type ValidationResult = {
  issues: Issue[];
  errors: number;
  warnings: number;
  coverage: { covered: number; total: number; unmapped: string[] };
  canApprove: boolean;
};

export const MAX_ASKED = 15;

const ELIGIBLE =/\beligib|\belegib|\bineligib|\binelegib/i;
const RECRUITMENT_RISK = /\bfree (treatment|medication|medicine|care)\b|\bcure[sd]?\b|\bguarantee|\bgratis\b|\bcura\b|\bgarantiza/i;

function callerFacingTexts(c: Criterion): string[] {
  return [
    c.question.en, c.question.es,
    c.questionProxy.en, c.questionProxy.es,
    ...c.altPhrasings.en, ...c.altPhrasings.es,
    c.readBackText.en, c.readBackText.es,
    c.readBackTextProxy.en, c.readBackTextProxy.es,
  ].filter(Boolean);
}

function checkRule(c: Criterion, push: (m: string) => void) {
  const { answerType: t, rule } = c;
  if (!t || !rule) return;
  const numericOps = ["lt", "lte", "gt", "gte", "between", "eq", "neq"];
  if (t === "yes_no") {
    if (!(rule.op === "eq" || rule.op === "neq") || typeof rule.value !== "boolean")
      push("A yes/no question needs an eq/neq rule with true or false.");
  } else if (t === "number" || t === "months_ago") {
    if (!numericOps.includes(rule.op)) push(`A ${t} answer needs a numeric rule (lt, lte, gt, gte, between).`);
    if ((rule.op === "eq" || rule.op === "neq") && typeof rule.value !== "number")
      push("Numeric eq/neq rules need a number.");
    if (rule.op === "between" && rule.min > rule.max) push("Rule 'between' has min greater than max.");
  } else if (t === "enum") {
    if (c.enumOptions.length < 2) push("An enum question needs at least 2 answer options.");
    const vals =
      rule.op === "in" || rule.op === "not_in"
        ? rule.values
        : rule.op === "eq" || rule.op === "neq"
          ? [rule.value]
          : null;
    if (!vals) push("An enum answer needs an in / not_in / eq / neq rule.");
    else {
      const bad = vals.filter((v) => !c.enumOptions.includes(String(v)));
      if (bad.length) push(`Rule uses values that aren't answer options: ${bad.join(", ")}.`);
    }
  }
}

export function validateScript(s: ScriptVersion): ValidationResult {
  const issues: Issue[] = [];
  const err = (message: string, criterionId?: string) => issues.push({ level: "error", message, criterionId });
  const warn = (message: string, criterionId?: string) => issues.push({ level: "warning", message, criterionId });

  const source = normalizeForMatch(s.sourceEligibilityText);
  const bulletIds = new Set(s.bullets.map((b) => b.id));
  const bulletKind = new Map(s.bullets.map((b) => [b.id, b.kind]));
  const seen = new Set<string>();
  const groupIds = new Set(s.groups.map((g) => g.id));

  if (s.criteria.length === 0) err("The script has no criteria.");

  for (const c of s.criteria) {
    const parsed = CriterionSchema.safeParse(c);
    if (!parsed.success) {
      err(`Malformed criterion: ${parsed.error.issues[0]?.message ?? "invalid"}`, c.id);
      continue;
    }
    if (!c.id.trim()) err("A criterion has an empty ID.");
    if (seen.has(c.id)) err(`Duplicate criterion ID ${c.id}.`, c.id);
    seen.add(c.id);

    // Traceability: every question quotes the registry text it came from.
    if (!c.registryDerived) {
      if (!c.sourceText.trim()) err("Source text is empty.", c.id);
      else if (!source.includes(normalizeForMatch(c.sourceText)))
        err("Source text isn't an exact quote from the registry criteria.", c.id);
      if (c.bulletIds.length === 0) err("Not linked to any registry bullet.", c.id);
    }
    for (const b of c.bulletIds) {
      if (!bulletIds.has(b)) err(`Links to unknown bullet ${b}.`, c.id);
      else if (!c.registryDerived && bulletKind.get(b) !== c.kind)
        warn(`Marked ${c.kind} but bullet ${b} is listed under ${bulletKind.get(b)}.`, c.id);
    }

    if (c.mode === "ask") {
      const need: [string, string][] = [
        ["question (EN)", c.question.en], ["question (ES)", c.question.es],
        ["caregiver question (EN)", c.questionProxy.en], ["caregiver question (ES)", c.questionProxy.es],
        ["read-back (EN)", c.readBackText.en], ["read-back (ES)", c.readBackText.es],
        ["caregiver read-back (EN)", c.readBackTextProxy.en], ["caregiver read-back (ES)", c.readBackTextProxy.es],
      ];
      for (const [label, v] of need) if (!v.trim()) err(`Missing ${label}.`, c.id);
      if (!c.answerType) err("Missing answer type.", c.id);
      if (!c.rule) err("Missing decision rule.", c.id);
      checkRule(c, (m) => err(m, c.id));
      if (c.answerType === "number" && !c.unit) warn("Number answer has no unit.", c.id);
      if (c.altPhrasings.en.length > 2 || c.altPhrasings.es.length > 2)
        err("At most 2 alternate phrasings per language.", c.id);
    } else {
      if (c.rule || c.answerType) warn("Confirm-at-site items shouldn't have a rule or answer type.", c.id);
      if (!c.siteCheckNote.trim()) warn("Add a note saying what the site must check.", c.id);
    }

    for (const t of callerFacingTexts(c)) {
      if (ELIGIBLE.test(t)) err(`Caller-facing text must not say "eligible": "${t}"`, c.id);
      if (RECRUITMENT_RISK.test(t)) warn(`Check recruitment-content rules (no "free", "cure", guarantees): "${t}"`, c.id);
    }

    if (c.groupId && !groupIds.has(c.groupId)) err(`Belongs to unknown group ${c.groupId}.`, c.id);
  }

  // OR-groups
  for (const g of s.groups) {
    const members = s.criteria.filter((c) => g.criterionIds.includes(c.id));
    if (members.length < 2) err(`Group ${g.id} needs at least 2 criteria.`);
    for (const id of g.criterionIds) {
      const c = s.criteria.find((x) => x.id === id);
      if (!c) err(`Group ${g.id} lists unknown criterion ${id}.`);
      else if (c.groupId !== g.id) err(`${id} is listed in group ${g.id} but its group field says ${c.groupId ?? "none"}.`, id);
    }
    if (new Set(members.map((m) => m.kind)).size > 1) err(`Group ${g.id} mixes inclusion and exclusion criteria.`);
  }

  // Coverage: every bullet maps to at least one criterion.
  const covered = new Set(s.criteria.flatMap((c) => c.bulletIds));
  const unmapped = s.bullets.filter((b) => !covered.has(b.id)).map((b) => b.id);
  for (const id of unmapped) err(`Registry bullet ${id} isn't covered by any criterion.`);

  // G3: warn when the pre-screen can only check a minority of criteria.
  const asked = s.criteria.filter((c) => c.mode === "ask").length;
  const site = s.criteria.length - asked;
  if (site > asked) warn(`Only ${asked} of ${s.criteria.length} criteria can be asked by phone; ${site} need a site check.`);
  // PRD §3/§13: about 11 questions, median call ≤ 6 minutes.
  if (asked > MAX_ASKED)
    warn(`${asked} questions will likely run past the 6-minute call target (aim for ${MAX_ASKED} or fewer). Consider moving lower-yield items to a site check.`);

  if (s.confidenceThreshold < 0.7 || s.confidenceThreshold > 0.95)
    err("Confidence threshold must be between 0.70 and 0.95.");

  for (const g of s.glossary) {
    if (!g.term.trim() || !g.plainDefinition.en.trim() || !g.plainDefinition.es.trim())
      err(`Glossary entry "${g.term || "(blank)"}" needs a term and both definitions.`);
    if (ELIGIBLE.test(g.plainDefinition.en) || ELIGIBLE.test(g.plainDefinition.es))
      err(`Glossary entry "${g.term}" must not say "eligible".`);
  }

  const errors = issues.filter((i) => i.level === "error").length;
  return {
    issues,
    errors,
    warnings: issues.length - errors,
    coverage: { covered: s.bullets.length - unmapped.length, total: s.bullets.length, unmapped },
    canApprove: errors === 0,
  };
}
