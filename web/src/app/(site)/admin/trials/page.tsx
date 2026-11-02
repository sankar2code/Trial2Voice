"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, ErrorText, Input } from "@/components/ui";
import { db } from "@/lib/store/db";
import { activeLocked, checkForRegistryChange, ingestTrial, type ChangeCheck } from "@/lib/store/repo";
import { DEMO_TRIALS, loadDemoTrials } from "@/data/demo";
import { getSettings } from "@/lib/settings";
import type { ScriptVersion, Trial } from "@/lib/types";

function scriptSummary(versions: ScriptVersion[]) {
  const active = activeLocked(versions);
  const draft = versions.find((v) => v.status === "draft");
  return { active, draft, latest: versions[0] };
}

function CallsBadge({ trial, active }: { trial: Trial; active: ScriptVersion | null }) {
  if (!active) return <Badge>No approved script</Badge>;
  if (trial.callsPaused || active.status === "stale") return <Badge tone="red">Calls paused</Badge>;
  return <Badge tone="green">Calls can run</Badge>;
}

export default function TrialsPage() {
  const trials = useLiveQuery(() => db().trials.toArray(), []);
  const scripts = useLiveQuery(() => db().scripts.toArray(), []);
  const [nctId, setNctId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, ChangeCheck | "checking">>({});
  const checked = useRef(false);

  // Protocol-change watch: in Track A it runs when this page opens.
  useEffect(() => {
    if (!trials || checked.current) return;
    checked.current = true;
    (async () => {
      for (const t of trials) {
        setChecks((c) => ({ ...c, [t.nctId]: "checking" }));
        const r = await checkForRegistryChange(t.nctId, "protocol-change watch");
        setChecks((c) => ({ ...c, [t.nctId]: r }));
      }
    })();
  }, [trials]);

  async function ingest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("ingest");
    try {
      const t = await ingestTrial(nctId, getSettings().actor);
      setChecks((c) => ({ ...c, [t.nctId]: { state: "unchanged", lastUpdatePostDate: t.lastUpdatePostDate } }));
      setNctId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that trial.");
    } finally {
      setBusy(null);
    }
  }

  async function loadDemo() {
    setError(null);
    setBusy("demo");
    try {
      await loadDemoTrials(getSettings().actor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the demo trials.");
    } finally {
      setBusy(null);
    }
  }

  const byTrial = (id: string) => (scripts ?? []).filter((s) => s.nctId === id).sort((a, b) => b.version - a.version);
  const missingDemo = DEMO_TRIALS.filter((d) => !trials?.some((t) => t.nctId === d.nctId));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Trials</h1>
          <p className="text-sm text-muted">Add a study by NCT ID, then build and approve its pre-screening script.</p>
        </div>
        <form onSubmit={ingest} className="flex gap-2 w-full sm:w-auto">
          <Input
            aria-label="NCT ID"
            placeholder="NCT01234567"
            value={nctId}
            onChange={(e) => setNctId(e.target.value)}
            className="sm:w-48 font-mono"
          />
          <Button variant="primary" disabled={!nctId.trim() || busy !== null}>
            {busy === "ingest" ? "Loading…" : "Add trial"}
          </Button>
        </form>
      </div>
      <ErrorText>{error}</ErrorText>

      {missingDemo.length > 0 && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 bg-accent-soft border-teal-200">
          <div className="text-sm">
            <div className="font-medium">Try the demo trials</div>
            <div className="text-muted">{missingDemo.map((d) => d.label).join(" · ")}. They come with draft scripts, so no API key is needed.</div>
          </div>
          <Button variant="primary" onClick={loadDemo} disabled={busy !== null}>
            {busy === "demo" ? "Loading…" : "Load demo trials"}
          </Button>
        </Card>
      )}

      {trials && trials.length === 0 && !missingDemo.length && <p className="text-muted text-sm">No trials yet.</p>}

      <div className="grid gap-3">
        {(trials ?? []).map((t) => {
          const versions = byTrial(t.nctId);
          const { active, draft, latest } = scriptSummary(versions);
          const check = checks[t.nctId];
          return (
            <Card key={t.nctId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">{t.nctId}</span>
                    <Badge tone={t.overallStatus === "RECRUITING" ? "green" : "neutral"}>{t.overallStatus.toLowerCase().replace(/_/g, " ")}</Badge>
                    {t.stale && <Badge tone="red">Registry changed</Badge>}
                  </div>
                  <div className="font-medium mt-1">{t.shortName}</div>
                  <div className="text-sm text-muted truncate max-w-2xl">{t.briefTitle}</div>
                </div>
<div className="flex gap-2">
                  {active?.status === "locked" && !t.callsPaused && !t.stale && (
                    <Link href={`/call/${t.nctId}`}><Button>Test call</Button></Link>
                  )}
                  <Link href={`/admin/trials/${t.nctId}/script`}>
                  <Button variant={draft || !latest ? "primary" : "secondary"}>{latest ? "Open script" : "Build script"}</Button>
                </Link>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                <span>
                  Script:{" "}
                  {latest ? (
                    <>
                      {active && <>v{active.version} {active.status === "stale" ? "stale" : "approved"}</>}
                      {active && draft && " · "}
                      {draft && <>v{draft.version} draft</>}
                    </>
                  ) : (
                    "none"
                  )}
                </span>
                <span>
                  <CallsBadge trial={t} active={active} />
                </span>
                <span>Registry updated {t.lastUpdatePostDate}</span>
                <span>{t.locations.length} site{t.locations.length === 1 ? "" : "s"}</span>
                <span>
                  {t.stale && <span className="text-red-700">Registry changed {t.latestRegistryUpdate} — review the new draft</span>}
                  {!t.stale && check === "checking" && "Checking registry…"}
                  {!t.stale && check && check !== "checking" && check.state === "unchanged" && "Registry check: no change"}
                  {!t.stale && check && check !== "checking" && check.state === "changed" && <span className="text-red-700">Registry check: updated {check.lastUpdatePostDate}</span>}
                  {!t.stale && check && check !== "checking" && check.state === "error" && `Registry check failed: ${check.message}`}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
