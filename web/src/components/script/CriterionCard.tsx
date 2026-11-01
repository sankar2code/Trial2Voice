"use client";
import { useState } from "react";
import { Badge, Button, Field, Input, Select, TextArea, cx } from "@/components/ui";
import { ruleText } from "@/lib/script/diff";
import type { Issue } from "@/lib/script/validate";
import type { AnswerType, Bilingual, Bullet, Criterion, CriterionGroup, Rule } from "@/lib/types";

const ANSWER_TYPES: { v: AnswerType; label: string }[] = [
  { v: "yes_no", label: "Yes / no" },
  { v: "number", label: "Number" },
  { v: "months_ago", label: "Months ago" },
  { v: "enum", label: "Pick one option" },
];

function defaultRule(t: AnswerType, kind: Criterion["kind"]): Rule {
  if (t === "yes_no") return { op: "eq", value: kind === "inclusion" };
  if (t === "enum") return { op: "in", values: [] };
  if (t === "months_ago") return { op: "gt", value: 6 };
  return { op: "gte", value: 0 };
}

function opsFor(t: AnswerType | null): Rule["op"][] {
  if (t === "yes_no") return ["eq", "neq"];
  if (t === "enum") return ["in", "not_in", "eq", "neq"];
  return ["lt", "lte", "gt", "gte", "between", "eq", "neq"];
}

const OP_LABEL: Record<Rule["op"], string> = {
  eq: "equals", neq: "is not", lt: "less than", lte: "at most", gt: "more than", gte: "at least",
  between: "between (inclusive)", in: "is one of", not_in: "is none of",
};

function RuleEditor({ c, disabled, onChange }: { c: Criterion; disabled: boolean; onChange: (r: Rule) => void }) {
  const r = c.rule;
  if (!r || !c.answerType) return null;
  const setOp = (op: Rule["op"]) => {
    if (op === "between") onChange({ op, min: 0, max: 0 });
    else if (op === "in" || op === "not_in") onChange({ op, values: [] });
    else if (op === "eq" || op === "neq") onChange({ op, value: c.answerType === "yes_no" ? true : c.answerType === "enum" ? (c.enumOptions[0] ?? "") : 0 });
    else onChange({ op, value: 0 });
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Passes if the answer">
        <Select disabled={disabled} value={r.op} onChange={(e) => setOp(e.target.value as Rule["op"])}>
          {opsFor(c.answerType).map((op) => (
            <option key={op} value={op}>{OP_LABEL[op]}</option>
          ))}
        </Select>
      </Field>
      {(r.op === "eq" || r.op === "neq") && c.answerType === "yes_no" && (
        <Field label="Value">
          <Select disabled={disabled} value={String(r.value)} onChange={(e) => onChange({ op: r.op, value: e.target.value === "true" })}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </Field>
      )}
      {(r.op === "eq" || r.op === "neq") && c.answerType === "enum" && (
        <Field label="Value">
          <Select disabled={disabled} value={String(r.value)} onChange={(e) => onChange({ op: r.op, value: e.target.value })}>
            {c.enumOptions.map((o) => <option key={o}>{o}</option>)}
          </Select>
        </Field>
      )}
      {(r.op === "eq" || r.op === "neq") && (c.answerType === "number" || c.answerType === "months_ago") && (
        <Field label="Value">
          <Input type="number" disabled={disabled} value={Number(r.value)} onChange={(e) => onChange({ op: r.op, value: Number(e.target.value) })} className="w-28" />
        </Field>
      )}
      {(r.op === "lt" || r.op === "lte" || r.op === "gt" || r.op === "gte") && (
        <Field label={`Value${c.unit ? ` (${c.unit})` : ""}`}>
          <Input type="number" disabled={disabled} value={r.value} onChange={(e) => onChange({ op: r.op, value: Number(e.target.value) })} className="w-28" />
        </Field>
      )}
      {r.op === "between" && (
        <>
          <Field label="Min"><Input type="number" disabled={disabled} value={r.min} onChange={(e) => onChange({ ...r, min: Number(e.target.value) })} className="w-24" /></Field>
          <Field label="Max"><Input type="number" disabled={disabled} value={r.max} onChange={(e) => onChange({ ...r, max: Number(e.target.value) })} className="w-24" /></Field>
        </>
      )}
      {(r.op === "in" || r.op === "not_in") && (
        <fieldset className="flex flex-wrap gap-3 pb-1.5">
          {c.enumOptions.map((o) => (
            <label key={o} className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                disabled={disabled}
                checked={r.values.includes(o)}
                onChange={(e) => onChange({ op: r.op, values: e.target.checked ? [...r.values, o] : r.values.filter((v) => v !== o) })}
              />
              {o}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function BiField({ label, value, disabled, onChange, rows = 2 }: { label: string; value: Bilingual; disabled: boolean; onChange: (v: Bilingual) => void; rows?: number }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label={`${label} · English`}>
        <TextArea rows={rows} disabled={disabled} value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} />
      </Field>
      <Field label={`${label} · Spanish`}>
        <TextArea rows={rows} disabled={disabled} lang="es" value={value.es} onChange={(e) => onChange({ ...value, es: e.target.value })} />
      </Field>
    </div>
  );
}

export function CriterionCard({
  c, bullets, groups, issues, readOnly, highlighted, onChange, onDelete,
}: {
  c: Criterion;
  bullets: Bullet[];
  groups: CriterionGroup[];
  issues: Issue[];
  readOnly: boolean;
  highlighted: boolean;
  onChange: (next: Criterion) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const locked = readOnly || c.registryDerived;
  const set = (patch: Partial<Criterion>) => onChange({ ...c, ...patch });

  return (
    <div id={`crit-${c.id}`} className={cx("rounded-lg border bg-surface scroll-mt-24", highlighted ? "border-accent ring-2 ring-accent/20" : "border-border")}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left p-3 flex gap-3 items-start" aria-expanded={open}>
        <span className="font-mono text-xs mt-0.5 w-16 shrink-0">{c.id}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap gap-1.5 mb-1">
            <Badge tone={c.kind === "inclusion" ? "blue" : "amber"}>{c.kind}</Badge>
            <Badge tone={c.mode === "ask" ? "teal" : "neutral"}>{c.mode === "ask" ? "asked" : "confirm at site"}</Badge>
            {c.registryDerived && <Badge>from registry fields</Badge>}
            {c.groupId && <Badge>any-of {c.groupId}</Badge>}
            {errors > 0 && <Badge tone="red">{errors} error{errors > 1 ? "s" : ""}</Badge>}
            {warnings > 0 && <Badge tone="amber">{warnings} warning{warnings > 1 ? "s" : ""}</Badge>}
          </span>
          <span className="block text-sm">{c.mode === "ask" ? c.question.en || <em className="text-muted">No question yet</em> : c.siteCheckNote || <em className="text-muted">No site-check note</em>}</span>
          {c.mode === "ask" && <span className="block text-xs text-muted mt-0.5">Pass if {ruleText(c.rule)}{c.unit ? ` ${c.unit}` : ""}</span>}
        </span>
        <span className="text-muted text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-border p-3 space-y-3">
          {issues.length > 0 && (
            <ul className="text-xs space-y-0.5">
              {issues.map((i, k) => (
                <li key={k} className={i.level === "error" ? "text-red-700" : "text-amber-800"}>• {i.message}</li>
              ))}
            </ul>
          )}
          {c.registryDerived && <p className="text-xs text-muted">Generated from the registry&apos;s structured age/sex fields. Only the bullet links can be changed.</p>}

          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="ID"><Input disabled={locked} value={c.id} onChange={(e) => set({ id: e.target.value })} className="font-mono" /></Field>
            <Field label="Kind">
              <Select disabled={locked} value={c.kind} onChange={(e) => set({ kind: e.target.value as Criterion["kind"] })}>
                <option value="inclusion">Inclusion</option>
                <option value="exclusion">Exclusion</option>
              </Select>
            </Field>
            <Field label="How it's checked">
              <Select
                disabled={locked}
                value={c.mode}
                onChange={(e) => {
                  const mode = e.target.value as Criterion["mode"];
                  set(mode === "ask" ? { mode, answerType: "yes_no", rule: defaultRule("yes_no", c.kind) } : { mode, answerType: null, rule: null, unit: null });
                }}
              >
                <option value="ask">Asked on the call</option>
                <option value="confirm_at_site">Confirmed at site</option>
              </Select>
            </Field>
            <Field label="Any-of group">
              <Select disabled={locked} value={c.groupId ?? ""} onChange={(e) => set({ groupId: e.target.value || null })}>
                <option value="">None</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Registry bullets covered">
            <div className="flex flex-wrap gap-2">
              {bullets.map((b) => (
                <label key={b.id} className="text-xs flex items-center gap-1 font-mono">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={c.bulletIds.includes(b.id)}
                    onChange={(e) => set({ bulletIds: e.target.checked ? [...c.bulletIds, b.id] : c.bulletIds.filter((x) => x !== b.id) })}
                  />
                  {b.id}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Source text (exact quote from the registry)">
            <TextArea disabled={locked} value={c.sourceText} onChange={(e) => set({ sourceText: e.target.value })} />
          </Field>

          {c.mode === "confirm_at_site" ? (
            <Field label="What the site must check">
              <TextArea disabled={locked} value={c.siteCheckNote} onChange={(e) => set({ siteCheckNote: e.target.value })} />
            </Field>
          ) : (
            <>
              <BiField label="Question" value={c.question} disabled={locked} onChange={(question) => set({ question })} />
              <BiField label="Caregiver question" value={c.questionProxy} disabled={locked} onChange={(questionProxy) => set({ questionProxy })} />
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Answer type">
                  <Select
                    disabled={locked}
                    value={c.answerType ?? "yes_no"}
                    onChange={(e) => {
                      const t = e.target.value as AnswerType;
                      set({ answerType: t, rule: defaultRule(t, c.kind), unit: t === "months_ago" ? "months" : t === "number" ? c.unit : null });
                    }}
                  >
                    {ANSWER_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </Select>
                </Field>
                {(c.answerType === "number" || c.answerType === "months_ago") && (
                  <Field label="Unit">
                    <Select disabled={locked} value={c.unit ?? ""} onChange={(e) => set({ unit: (e.target.value || null) as Criterion["unit"] })}>
                      <option value="">—</option>
                      {["years", "months", "kg", "lb", "cm"].map((u) => <option key={u}>{u}</option>)}
                    </Select>
                  </Field>
                )}
                {c.answerType === "enum" && (
                  <Field label="Options (one per line)" className="sm:col-span-2">
                    <TextArea disabled={locked} value={c.enumOptions.join("\n")} onChange={(e) => set({ enumOptions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
                  </Field>
                )}
              </div>
              <RuleEditor c={c} disabled={locked} onChange={(rule) => set({ rule })} />
              <BiField label="Read-back if this would screen out" value={c.readBackText} disabled={locked} onChange={(readBackText) => set({ readBackText })} />
              <BiField label="Caregiver read-back" value={c.readBackTextProxy} disabled={locked} onChange={(readBackTextProxy) => set({ readBackTextProxy })} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Alternate phrasings · English (max 2, one per line)">
                  <TextArea disabled={locked} value={c.altPhrasings.en.join("\n")} onChange={(e) => set({ altPhrasings: { ...c.altPhrasings, en: e.target.value.split("\n").filter((s) => s.trim()) } })} />
                </Field>
                <Field label="Alternate phrasings · Spanish (max 2, one per line)">
                  <TextArea disabled={locked} lang="es" value={c.altPhrasings.es.join("\n")} onChange={(e) => set({ altPhrasings: { ...c.altPhrasings, es: e.target.value.split("\n").filter((s) => s.trim()) } })} />
                </Field>
              </div>
              <p className="text-xs text-muted">Use {"{answer}"} in a read-back to repeat a number answer.</p>
            </>
          )}

          {!locked && (
            <div className="flex justify-end">
              <Button variant="danger" size="sm" onClick={onDelete}>Delete criterion</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
