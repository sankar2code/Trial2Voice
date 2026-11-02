"use client";
import { useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { CriterionCard } from "./CriterionCard";
import type { Issue } from "@/lib/script/validate";
import type { Criterion, ScriptVersion } from "@/lib/types";

function blankCriterion(s: ScriptVersion): Criterion {
  const n = s.criteria.filter((c) => c.id.startsWith("IN-") && !c.registryDerived).length + 1;
  return {
    id: `IN-${String(n).padStart(2, "0")}-new`,
    kind: "inclusion", bulletIds: [], sourceText: "", mode: "ask",
    question: { en: "", es: "" }, questionProxy: { en: "", es: "" }, altPhrasings: { en: [], es: [] },
    answerType: "yes_no", unit: null, enumOptions: [], rule: { op: "eq", value: true },
    readBackText: { en: "", es: "" }, readBackTextProxy: { en: "", es: "" },
    groupId: null, registryDerived: false, siteCheckNote: "",
  };
}

export function CriteriaTab({ script, issues, readOnly, onChange }: { script: ScriptVersion; issues: Issue[]; readOnly: boolean; onChange: (s: ScriptVersion) => void }) {
  const [focusBullet, setFocusBullet] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ask" | "site" | "issues">("all");
  const linked = (id: string) => script.criteria.filter((c) => c.bulletIds.includes(id));
  const issuesFor = (id: string) => issues.filter((i) => i.criterionId === id);

  const shown = script.criteria.filter((c) =>
    filter === "ask" ? c.mode === "ask" : filter === "site" ? c.mode === "confirm_at_site" : filter === "issues" ? issuesFor(c.id).length > 0 : true,
  );

  const setCriterion = (idx: number, next: Criterion) => {
    const criteria = [...script.criteria];
    criteria[idx] = next;
    onChange({ ...script, criteria });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {/* Registry side */}
      <section aria-label="Registry bullets" className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-2 pr-1">
        <h3 className="text-sm font-medium">Registry text</h3>
        <p className="text-xs text-muted">Click a bullet to highlight the criteria that cover it.</p>
        {script.bullets.map((b, i) => {
          const l = linked(b.id);
          const newSection = i === 0 || script.bullets[i - 1].section !== b.section;
          return (
            <div key={b.id}>
              {newSection && <div className="text-xs font-semibold uppercase tracking-wide text-muted mt-3 mb-1">{b.section}</div>}
              <button
                type="button"
                onClick={() => setFocusBullet(focusBullet === b.id ? null : b.id)}
                className={cx(
                  "w-full text-left rounded-md border p-2 text-sm",
                  focusBullet === b.id ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-stone-50",
                  l.length === 0 && "border-red-300 bg-red-50",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs">{b.id}</span>
                  {l.length === 0 ? <Badge tone="red">not covered</Badge> : l.map((c) => <Badge key={c.id} tone={c.mode === "ask" ? "teal" : "neutral"}>{c.id}</Badge>)}
                </div>
                <div className="whitespace-pre-wrap text-stone-700">{b.text}</div>
              </button>
            </div>
          );
        })}
      </section>

      {/* Script side */}
      <section aria-label="Criteria" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 text-xs">
            {(["all", "ask", "site", "issues"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx("rounded px-2 py-1", filter === f ? "bg-foreground text-background" : "bg-stone-100 hover:bg-stone-200")}>
                {f === "all" ? `All ${script.criteria.length}` : f === "ask" ? `Asked ${script.criteria.filter((c) => c.mode === "ask").length}` : f === "site" ? `Site check ${script.criteria.filter((c) => c.mode !== "ask").length}` : "With issues"}
              </button>
            ))}
          </div>
          {!readOnly && (
            <Button size="sm" onClick={() => onChange({ ...script, criteria: [...script.criteria, blankCriterion(script)] })}>
              + Add criterion
            </Button>
          )}
        </div>
        {shown.map((c) => {
          const idx = script.criteria.indexOf(c);
          return (
            <CriterionCard
              key={`${idx}-${c.registryDerived ? c.id : idx}`}
              c={c}
              bullets={script.bullets}
              groups={script.groups}
              issues={issuesFor(c.id)}
              readOnly={readOnly}
              highlighted={focusBullet !== null && c.bulletIds.includes(focusBullet)}
              onChange={(next) => setCriterion(idx, next)}
              onDelete={() => onChange({ ...script, criteria: script.criteria.filter((_, i) => i !== idx) })}
            />
          );
        })}
        {shown.length === 0 && <p className="text-sm text-muted">Nothing matches this filter.</p>}
      </section>
    </div>
  );
}
