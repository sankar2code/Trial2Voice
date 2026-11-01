"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, TextArea, cx } from "@/components/ui";
import { diffScripts, diffText, type DiffPart } from "@/lib/script/diff";
import { verifyScriptIntegrity } from "@/lib/store/repo";
import type { ScriptVersion, Trial } from "@/lib/types";

// --- Groups and glossary -----------------------------------------------------

export function GroupsGlossaryTab({ script, readOnly, onChange }: { script: ScriptVersion; readOnly: boolean; onChange: (s: ScriptVersion) => void }) {
  const setGroups = (groups: ScriptVersion["groups"]) => onChange({ ...script, groups });
  const setGlossary = (glossary: ScriptVersion["glossary"]) => onChange({ ...script, glossary });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="font-medium">Any-of groups</h3>
        <p className="text-xs text-muted">For registry OR-clauses. A group passes if any member passes, and fails only if every member fails. Assign members from each criterion&apos;s &quot;Any-of group&quot; field.</p>
        {script.groups.map((g, i) => {
          const members = script.criteria.filter((c) => c.groupId === g.id).map((c) => c.id);
          return (
            <Card key={i} className="p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Field label="ID"><Input disabled={readOnly} value={g.id} className="font-mono" onChange={(e) => setGroups(script.groups.map((x, k) => (k === i ? { ...x, id: e.target.value } : x)))} /></Field>
                <Field label="Label" className="col-span-2"><Input disabled={readOnly} value={g.label} onChange={(e) => setGroups(script.groups.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /></Field>
              </div>
              <div className="text-xs text-muted">Members: {members.join(", ") || "none yet"}</div>
              {!readOnly && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setGroups(script.groups.map((x, k) => (k === i ? { ...x, criterionIds: members } : x)))}>Sync members</Button>
                  <Button size="sm" variant="danger" onClick={() => setGroups(script.groups.filter((_, k) => k !== i))}>Remove</Button>
                </div>
              )}
            </Card>
          );
        })}
        {!readOnly && <Button size="sm" onClick={() => setGroups([...script.groups, { id: `GR-${String(script.groups.length + 1).padStart(2, "0")}`, logic: "any", criterionIds: [], label: "" }])}>+ Add group</Button>}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Approved glossary</h3>
        <p className="text-xs text-muted">The only definitions the agent may give when a caller asks what a term means (Addendum G7). Disabled when the script is verbatim-only.</p>
        {script.glossary.map((g, i) => (
          <Card key={i} className="p-3 space-y-2">
            <Field label="Term"><Input disabled={readOnly} value={g.term} onChange={(e) => setGlossary(script.glossary.map((x, k) => (k === i ? { ...x, term: e.target.value } : x)))} /></Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Definition · English"><TextArea disabled={readOnly} value={g.plainDefinition.en} onChange={(e) => setGlossary(script.glossary.map((x, k) => (k === i ? { ...x, plainDefinition: { ...x.plainDefinition, en: e.target.value } } : x)))} /></Field>
              <Field label="Definition · Spanish"><TextArea disabled={readOnly} lang="es" value={g.plainDefinition.es} onChange={(e) => setGlossary(script.glossary.map((x, k) => (k === i ? { ...x, plainDefinition: { ...x.plainDefinition, es: e.target.value } } : x)))} /></Field>
            </div>
            {!readOnly && <Button size="sm" variant="danger" onClick={() => setGlossary(script.glossary.filter((_, k) => k !== i))}>Remove</Button>}
          </Card>
        ))}
        {!readOnly && <Button size="sm" onClick={() => setGlossary([...script.glossary, { term: "", plainDefinition: { en: "", es: "" } }])}>+ Add term</Button>}
      </section>
    </div>
  );
}

// --- Call settings -----------------------------------------------------------

export function SettingsTab({ script, readOnly, onChange }: { script: ScriptVersion; readOnly: boolean; onChange: (s: ScriptVersion) => void }) {
  return (
    <Card className="p-4 space-y-4 max-w-xl">
      <Field label={`Confidence threshold: ${script.confidenceThreshold.toFixed(2)}`} hint="Answers interpreted with lower confidence are recorded as Unsure, and the call ends as Needs site review (Addendum G2).">
        <input type="range" min={0.7} max={0.95} step={0.01} disabled={readOnly} value={script.confidenceThreshold} onChange={(e) => onChange({ ...script, confidenceThreshold: Number(e.target.value) })} className="w-full accent-teal-700" />
      </Field>
      <label className="flex gap-2 items-start text-sm">
        <input type="checkbox" className="mt-1" disabled={readOnly} checked={script.verbatimOnly} onChange={(e) => onChange({ ...script, verbatimOnly: e.target.checked })} />
        <span><span className="font-medium">Verbatim only.</span> <span className="text-muted">No alternate phrasings or glossary; a repeat request repeats the question more slowly. Use if the IRB requires it.</span></span>
      </label>
      <label className="flex gap-2 items-start text-sm">
        <input type="checkbox" className="mt-1" disabled={readOnly} checked={script.stopOnConfirmedFail} onChange={(e) => onChange({ ...script, stopOnConfirmedFail: e.target.checked })} />
        <span><span className="font-medium">End the call after a confirmed screen-out.</span> <span className="text-muted">Off by default, so the site sees every answer and the sponsor gets full drop-off data.</span></span>
      </label>
    </Card>
  );
}

// --- Diff --------------------------------------------------------------------

export function DiffBlock({ parts }: { parts: DiffPart[] }) {
  const changed = parts.some((p) => p.kind !== "same");
  if (!changed) return <p className="text-sm text-muted">No differences.</p>;
  return (
    <pre className="text-xs leading-5 overflow-x-auto rounded-md border border-border bg-surface p-3 max-h-[70vh]">
      {parts.map((p, i) => (
        <span key={i} className={cx("block whitespace-pre-wrap", p.kind === "added" && "bg-green-50 text-green-900", p.kind === "removed" && "bg-red-50 text-red-900 line-through decoration-red-300")}>
          {p.text.replace(/\n$/, "").split("\n").map((l) => `${p.kind === "added" ? "+ " : p.kind === "removed" ? "− " : "  "}${l}`).join("\n")}
        </span>
      ))}
    </pre>
  );
}

export function DiffTab({ script, versions }: { script: ScriptVersion; versions: ScriptVersion[] }) {
  const others = versions.filter((v) => v.id !== script.id);
  const [otherId, setOtherId] = useState(others.find((v) => v.version < script.version)?.id ?? others[0]?.id ?? "");
  const other = versions.find((v) => v.id === otherId);
  const parts = useMemo(() => (other ? (other.version < script.version ? diffScripts(other, script) : diffScripts(script, other)) : []), [other, script]);
  if (!others.length) return <p className="text-sm text-muted">Only one version exists. A diff appears once there&apos;s a second version.</p>;
  return (
    <div className="space-y-3">
      <Field label="Compare with" className="max-w-xs">
        <Select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
          {others.map((v) => <option key={v.id} value={v.id}>v{v.version} ({v.status})</option>)}
        </Select>
      </Field>
      {other && <p className="text-xs text-muted">Showing changes from v{Math.min(other.version, script.version)} to v{Math.max(other.version, script.version)}.</p>}
      <DiffBlock parts={parts} />
    </div>
  );
}

// --- Approval and integrity -------------------------------------------------

export function ApprovalTab({ script }: { script: ScriptVersion }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (script.approval) verifyScriptIntegrity(script).then((r) => live && setOk(r));
    return () => {
      live = false;
    };
  }, [script]);
  if (!script.approval) return <p className="text-sm text-muted">This version hasn&apos;t been approved. Use &quot;Approve &amp; lock&quot; once validation passes.</p>;
  const a = script.approval;
  return (
    <Card className="p-4 max-w-2xl space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">Approved and locked</span>
        {ok === null ? <Badge>Checking…</Badge> : ok ? <Badge tone="green">Fingerprint matches</Badge> : <Badge tone="red">Fingerprint mismatch — content changed after approval</Badge>}
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
        <dt className="text-muted">Approver</dt><dd>{a.approver}</dd>
        <dt className="text-muted">IRB reference</dt><dd>{a.irbRef}</dd>
        <dt className="text-muted">IRB approval date</dt><dd>{a.date}</dd>
        <dt className="text-muted">Locked at</dt><dd>{new Date(a.lockedAt).toLocaleString()}</dd>
        <dt className="text-muted">Registry record</dt><dd>{script.sourceLastUpdate}</dd>
        <dt className="text-muted">SHA-256</dt><dd className="font-mono text-xs break-all">{a.sha256}</dd>
      </dl>
    </Card>
  );
}

// --- Registry change banner --------------------------------------------------

export function RegistryChangeBanner({ trial, script, rebasedDraft, onRebase, busy }: { trial: Trial; script: ScriptVersion | null; rebasedDraft: ScriptVersion | null; onRebase: () => void; busy: boolean }) {
  const [show, setShow] = useState(false);
  if (!trial.stale || !trial.latestRegistryUpdate) return null;
  const changed = trial.latestEligibilityText !== undefined && trial.latestEligibilityText !== trial.eligibilityText;
  return (
    <Card className="p-4 border-red-200 bg-red-50 space-y-2">
      <div className="font-medium text-red-900">The registry record changed ({trial.latestRegistryUpdate}). Calls for this trial are paused.</div>
      <p className="text-sm text-red-900">
        {changed ? "The eligibility text changed." : "The eligibility text is the same; other fields changed."}{" "}
        {rebasedDraft
          ? `Draft v${rebasedDraft.version} is based on the latest record. Review it, cover any new registry bullets, and approve it to resume calls.`
          : "Start a new draft from the latest record, review it, and approve it to resume calls."}
      </p>
      <div className="flex flex-wrap gap-2">
        {script && !rebasedDraft && <Button variant="primary" onClick={onRebase} disabled={busy}>Start draft from latest registry</Button>}
        {changed && <Button onClick={() => setShow(!show)}>{show ? "Hide" : "Show"} eligibility changes</Button>}
      </div>
      {show && changed && <DiffBlock parts={diffText(trial.eligibilityText + "\n", trial.latestEligibilityText! + "\n")} />}
    </Card>
  );
}
