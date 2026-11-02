"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, Dialog, ErrorText, Field, Input, Tabs, cx } from "@/components/ui";
import { CriteriaTab } from "./CriteriaTab";
import { ApprovalTab, DiffTab, GroupsGlossaryTab, RegistryChangeBanner, SettingsTab } from "./OtherTabs";
import { db } from "@/lib/store/db";
import {
  activeLocked, discardDraft, latestRegistryTrial, lockScript, newDraftFrom, saveNewDraft,
  simulateRegistryChange, updateDraft,
} from "@/lib/store/repo";
import { validateScript } from "@/lib/script/validate";
import { buildScript, BuildError, type BuildProgress } from "@/lib/script/builder";
import { assembleDraft } from "@/lib/script/assemble";
import { splitEligibility } from "@/lib/bullets";
import { getSettings, useSettings } from "@/lib/settings";
import type { ScriptVersion, Trial } from "@/lib/types";

type Tab = "criteria" | "groups" | "settings" | "diff" | "approval";

const STATUS_TONE = { draft: "amber", locked: "green", stale: "red", superseded: "neutral" } as const;

function useAutosave(script: ScriptVersion | null) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ScriptVersion | null>(null);

  const flush = async () => {
    const s = pending.current;
    if (!s) return;
    pending.current = null;
    setState("saving");
    try {
      await updateDraft(s.id, () => s, getSettings().actor);
      setState("saved");
      setError(null);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };
  const schedule = (s: ScriptVersion) => {
    pending.current = s;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  // Save pending edits when switching versions or leaving the page.
  useEffect(() => () => void flush(), [script?.id]);
  return { state, error, schedule, flush };
}

export function Workspace({ nctId }: { nctId: string }) {
  const settings = useSettings();
  const trial = useLiveQuery(async () => (await db().trials.get(nctId)) ?? null, [nctId]);
  const versions = useLiveQuery(async () => (await db().scripts.where("nctId").equals(nctId).toArray()).sort((a, b) => b.version - a.version), [nctId]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [working, setWorking] = useState<ScriptVersion | null>(null);
  const [tab, setTab] = useState<Tab>("criteria");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const autosave = useAutosave(working);

  const defaultId = useMemo(() => {
    if (!versions?.length) return null;
    return (versions.find((v) => v.status === "draft") ?? activeLocked(versions) ?? versions[0]).id;
  }, [versions]);
  const currentId = selectedId && versions?.some((v) => v.id === selectedId) ? selectedId : defaultId;
  const stored = versions?.find((v) => v.id === currentId) ?? null;

  // Load the stored version into the working copy, except while we have unsaved edits to it.
  useEffect(() => {
    if (!stored) return setWorking(null);
    setWorking((w) => (w && w.id === stored.id && stored.status === "draft" && autosave.state === "saving" ? w : stored));
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  const validation = useMemo(() => (working ? validateScript(working) : null), [working]);

  if (trial === undefined || versions === undefined) return <p className="text-sm text-muted">Loading…</p>;
  if (!trial) return <p className="text-sm">Trial {nctId} isn&apos;t in this browser yet. <Link className="text-accent-ink underline" href="/admin/trials">Add it from Trials</Link>.</p>;

  const readOnly = !working || working.status !== "draft";
  const actor = settings.actor;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(label);
    try {
      await autosave.flush();
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const edit = (next: ScriptVersion) => {
    setWorking(next);
    autosave.schedule(next);
  };

  const build = () =>
    run("build", async () => {
      abort.current = new AbortController();
      setProgress({ chars: 0, criteria: 0 });
      try {
        const source: Trial = trial.stale && trial.latestRegistryUpdate ? await latestRegistryTrial(nctId) : trial;
        const bullets = splitEligibility(source.eligibilityText);
        const { output, model } = await buildScript({ trial: source, bullets, apiKey: settings.apiKey, model: settings.buildModel, signal: abort.current.signal, onProgress: setProgress });
        const version = (versions[0]?.version ?? 0) + 1;
        const draft = assembleDraft({ trial: source, bullets, output, version, createdBy: `builder:${model}`, basedOn: versions[0]?.id ?? null });
        await saveNewDraft(draft, actor, `built with ${model}`);
        setSelectedId(draft.id);
      } catch (e) {
        throw e instanceof BuildError ? e : new Error(e instanceof Error ? e.message : "Build failed");
      } finally {
        setProgress(null);
        abort.current = null;
      }
    });

  const startBlank = () =>
    run("blank", async () => {
      const version = (versions[0]?.version ?? 0) + 1;
      const draft = assembleDraft({ trial, bullets: splitEligibility(trial.eligibilityText), output: { criteria: [], groups: [], glossary: [], derivedBulletIds: { age: [], sex: [] } }, version, createdBy: "editor (blank)" });
      await saveNewDraft(draft, actor, "blank draft");
      setSelectedId(draft.id);
    });

  const newVersion = () => run("new", async () => setSelectedId((await newDraftFrom(working!.id, actor)).id));

  const rebase = () =>
    run("rebase", async () => {
      const latest = await latestRegistryTrial(nctId);
      const base = working ?? versions[0];
      const d = await newDraftFrom(base.id, actor, { lastUpdatePostDate: latest.lastUpdatePostDate, eligibilityText: latest.eligibilityText, trial: latest });
      setSelectedId(d.id);
    });

  const hasDraft = versions.some((v) => v.status === "draft");
  const active = activeLocked(versions);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/admin/trials" className="text-xs text-muted hover:text-foreground">← Trials</Link>
          <h1 className="text-2xl font-semibold mt-1">{trial.shortName}</h1>
          <p className="text-sm text-muted">{trial.briefTitle}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
            <a className="font-mono hover:text-foreground underline-offset-2 hover:underline" href={`https://clinicaltrials.gov/study/${trial.nctId}`} target="_blank" rel="noreferrer">{trial.nctId} ↗</a>
            <span>Registry updated {trial.lastUpdatePostDate}</span>
            <span>Ages {trial.minAgeYears ?? "any"}–{trial.maxAgeYears ?? "any"} · sex {trial.sex.toLowerCase()}</span>
            <span>{active ? (trial.callsPaused || active.status === "stale" ? "Calls paused" : `Calls run on v${active.version}`) : "No approved version — calls can't run"}</span>
          </div>
        </div>
        {versions.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Versions">
            {versions.map((v) => (
              <button key={v.id} onClick={() => setSelectedId(v.id)} className={cx("rounded-md border px-2 py-1 text-xs flex items-center gap-1.5", v.id === currentId ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-stone-50")}>
                v{v.version} <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      <RegistryChangeBanner
        trial={trial}
        script={working ?? versions[0] ?? null}
        rebasedDraft={versions.find((v) => v.status === "draft" && v.sourceLastUpdate === trial.latestRegistryUpdate) ?? null}
        onRebase={rebase}
        busy={busy !== null}
      />
      <ErrorText>{error}</ErrorText>

      {/* No script yet */}
      {versions.length === 0 && (
        <Card className="p-5 space-y-3">
          <h2 className="font-medium">Build the screening script</h2>
          <p className="text-sm text-muted">
            Claude splits each criterion into single facts, writes one spoken question per fact in English and Spanish, and marks lab or record checks &quot;confirm at site&quot;. Nothing goes live until a person approves it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={build} disabled={!settings.apiKey || busy !== null}>{busy === "build" ? "Building…" : "Build with Claude"}</Button>
            <Button onClick={startBlank} disabled={busy !== null}>Start a blank draft</Button>
          </div>
          {!settings.apiKey && <p className="text-xs text-muted">Add an Anthropic API key in <Link href="/settings" className="underline">Settings</Link> to build automatically, or write the script by hand.</p>}
        </Card>
      )}

      {progress && (
        <Card className="p-4 text-sm flex items-center justify-between gap-3">
          <span>Building with {settings.buildModel}… {progress.criteria} criteria drafted ({Math.round(progress.chars / 1000)}k characters)</span>
          <Button size="sm" onClick={() => abort.current?.abort()}>Cancel</Button>
        </Card>
      )}

      {working && validation && (
        <>
          {/* Status + actions */}
          <Card className="p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5 min-w-60 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">v{working.version}</span>
                <Badge tone={STATUS_TONE[working.status]}>{working.status}</Badge>
                <span className="text-xs text-muted">by {working.createdBy}{working.basedOn ? ` · from ${working.basedOn.split("-").pop()}` : ""}</span>
                {working.status === "draft" && <span className="text-xs text-muted">{autosave.state === "saving" ? "Saving…" : autosave.state === "saved" ? "All changes saved" : autosave.state === "error" ? <span className="text-red-700">{autosave.error}</span> : ""}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-36 h-2 rounded bg-stone-200 overflow-hidden" aria-hidden>
                  <span className={cx("block h-full", validation.coverage.covered === validation.coverage.total ? "bg-green-600" : "bg-amber-500")} style={{ width: `${(validation.coverage.covered / Math.max(1, validation.coverage.total)) * 100}%` }} />
                </span>
                <span>{validation.coverage.covered}/{validation.coverage.total} registry bullets covered</span>
                <span className="text-muted">· {working.criteria.filter((c) => c.mode === "ask").length} asked · {working.criteria.filter((c) => c.mode !== "ask").length} site checks</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {working.status === "draft" && (
                <>
                  <Button variant="primary" disabled={!validation.canApprove || busy !== null || trial.stale && trial.latestRegistryUpdate !== working.sourceLastUpdate} onClick={() => setApproveOpen(true)}>Approve &amp; lock</Button>
                  <Button variant="danger" disabled={busy !== null} onClick={() => run("discard", () => discardDraft(working.id, actor))}>Discard draft</Button>
                </>
              )}
              {working.status === "locked" && !trial.callsPaused && !trial.stale && (
                <Link href={`/call/${trial.nctId}`}><Button variant="primary">Start a test call</Button></Link>
              )}
              {working.status !== "draft" && !hasDraft && !trial.stale && <Button onClick={newVersion} disabled={busy !== null}>New version from v{working.version}</Button>}
              {settings.apiKey && versions.length > 0 && <Button onClick={build} disabled={busy !== null}>{busy === "build" ? "Building…" : "Rebuild with Claude"}</Button>}
              {!trial.stale && active && <Button variant="ghost" size="sm" onClick={() => run("sim", () => simulateRegistryChange(nctId, actor))} title="Demo: pretend the registry record changed">Simulate registry change</Button>}
            </div>
          </Card>

          {/* Issues */}
          {validation.issues.length > 0 && (
            <details className="rounded-lg border border-border bg-surface" open={validation.errors > 0 && validation.errors <= 8}>
              <summary className="cursor-pointer px-4 py-2 text-sm">
                {validation.errors > 0 ? (
                  <span className="text-red-700 font-medium">{validation.errors} error{validation.errors > 1 ? "s" : ""}{working.status === "draft" ? " block approval" : ""}</span>
                ) : (
                  <span className="text-green-700 font-medium">{working.status === "draft" ? "Ready to approve" : "Passed all checks"}</span>
                )}
                {validation.warnings > 0 && <span className="text-amber-800"> · {validation.warnings} warning{validation.warnings > 1 ? "s" : ""}</span>}
              </summary>
              <ul className="px-4 pb-3 text-sm space-y-1 max-h-60 overflow-y-auto">
                {validation.issues.map((i, k) => (
                  <li key={k} className={i.level === "error" ? "text-red-700" : "text-amber-800"}>
                    {i.criterionId ? (
                      <button className="font-mono text-xs underline mr-1" onClick={() => { setTab("criteria"); document.getElementById(`crit-${i.criterionId}`)?.scrollIntoView({ behavior: "smooth" }); }}>{i.criterionId}</button>
                    ) : null}
                    {i.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "criteria", label: "Criteria" },
              { id: "groups", label: `Groups & glossary (${working.groups.length}/${working.glossary.length})` },
              { id: "settings", label: "Call settings" },
              { id: "diff", label: "Compare versions" },
              { id: "approval", label: "Approval" },
            ]}
          />
          {tab === "criteria" && <CriteriaTab script={working} issues={validation.issues} readOnly={readOnly} onChange={edit} />}
          {tab === "groups" && <GroupsGlossaryTab script={working} readOnly={readOnly} onChange={edit} />}
          {tab === "settings" && <SettingsTab script={working} readOnly={readOnly} onChange={edit} />}
          {tab === "diff" && <DiffTab script={working} versions={versions} />}
          {tab === "approval" && <ApprovalTab script={working} />}

          <ApproveDialog
            open={approveOpen}
            onClose={() => setApproveOpen(false)}
            onApprove={(a) => run("lock", async () => { await lockScript(working.id, a, actor); setApproveOpen(false); setTab("approval"); })}
            busy={busy === "lock"}
            warnings={validation.warnings}
            error={error}
          />
        </>
      )}
    </div>
  );
}

function ApproveDialog({ open, onClose, onApprove, busy, warnings, error }: { open: boolean; onClose: () => void; onApprove: (a: { approver: string; irbRef: string; date: string }) => void; busy: boolean; warnings: number; error: string | null }) {
  const settings = useSettings();
  const [approver, setApprover] = useState("");
  const [irbRef, setIrbRef] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Approve and lock this version">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onApprove({ approver: approver || settings.actor, irbRef, date });
        }}
      >
        <p className="text-sm text-muted">Locking freezes this version and records a SHA-256 fingerprint. Any later change needs a new version and a new approval.</p>
        <Field label="Approver" hint="Leave blank to use your name from Settings."><Input value={approver} placeholder={settings.actor} onChange={(e) => setApprover(e.target.value)} /></Field>
        <Field label="IRB reference" hint="Protocol or approval number. Demo: any value."><Input required value={irbRef} onChange={(e) => setIrbRef(e.target.value)} /></Field>
        <Field label="IRB approval date"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {warnings > 0 && <p className="text-sm text-amber-800">{warnings} warning{warnings > 1 ? "s" : ""} remain. Review them before approving.</p>}
        <label className="flex gap-2 items-start text-sm">
          <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>I reviewed every question against the registry text, and this version matches what the IRB approved.</span>
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!confirm || !irbRef.trim() || busy}>{busy ? "Locking…" : "Approve & lock"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
