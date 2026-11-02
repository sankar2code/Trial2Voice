"use client";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Card, Field, Select } from "@/components/ui";
import { FunnelChart } from "@/components/insights/FunnelChart";
import { DropOffTable } from "@/components/insights/DropOffTable";
import { MetricTiles } from "@/components/insights/MetricTiles";
import { db } from "@/lib/store/db";
import { activeLocked } from "@/lib/store/repo";
import { computeDropOff, computeFunnel, computeMetrics, endedCalls, scopeData, type RangeId } from "@/lib/insights";

const RANGES: { id: RangeId; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

export default function InsightsPage() {
  const [nctId, setNctId] = useState<string>("");
  const [range, setRange] = useState<RangeId>("30d");
  const [versionPick, setVersionPick] = useState<string>("");

  const data = useLiveQuery(async () => {
    const [events, calls, referrals, trials, scripts] = await Promise.all([
      db().events.toArray(), db().calls.toArray(), db().referrals.toArray(), db().trials.toArray(), db().scripts.toArray(),
    ]);
    return { events, calls, referrals, trials, scripts };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const scoped = scopeData(data, nctId || null, range, now);
    return {
      funnel: computeFunnel(scoped.events, scoped.calls, scoped.referrals),
      metrics: computeMetrics(scoped.calls, scoped.referrals, now),
      calls: scoped.calls,
    };
  }, [data, nctId, range]);

  // Drop-off is per script version (question wording and ids can change between versions).
  const versions = useMemo(() => {
    if (!data || !nctId) return [];
    const withCalls = new Set(endedCalls(data.calls).filter((c) => c.nctId === nctId).map((c) => c.scriptVersionId));
    const mine = data.scripts.filter((s) => s.nctId === nctId).sort((a, b) => b.version - a.version);
    const active = activeLocked(mine);
    return mine.filter((s) => withCalls.has(s.id) || s.id === active?.id);
  }, [data, nctId]);
  const script =
    versions.find((s) => s.id === versionPick) ??
    versions.find((s) => s.status === "locked" || s.status === "stale") ??
    versions[0] ??
    null;
  const dropOff = useMemo(() => (script && view ? computeDropOff(script, view.calls) : null), [script, view]);

  const trials = (data?.trials ?? []).slice().sort((a, b) => a.shortName.localeCompare(b.shortName));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Sponsor insights</h1>
        <p className="text-sm text-muted">
          Where callers drop off and which eligibility questions rule them out or leave them unsure (PRD §3, §12).
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Field label="Trial" className="w-full sm:w-72">
          <Select
            value={nctId}
            onChange={(e) => {
              setNctId(e.target.value);
              setVersionPick("");
            }}
          >
            <option value="">All trials</option>
            {trials.map((t) => (
              <option key={t.nctId} value={t.nctId}>
                {t.shortName} ({t.nctId})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date range" className="w-full sm:w-44">
          <Select value={range} onChange={(e) => setRange(e.target.value as RangeId)}>
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-xs text-muted rounded-md bg-stone-100 px-3 py-2">
        Numbers come from this browser only (Track A): calls, referrals and page events stored locally on this device. Small counts swing a lot; read
        them as a demo, not a trend.
      </p>

      {!view && <p className="text-sm text-muted">Loading…</p>}
      {view && (
        <>
          <section className="space-y-2" aria-labelledby="metrics-h">
            <h2 id="metrics-h" className="text-lg font-semibold">
              Success metrics
            </h2>
            <MetricTiles m={view.metrics} />
          </section>

          <section aria-labelledby="funnel-h">
            <Card className="p-4">
              <h2 id="funnel-h" className="text-lg font-semibold mb-3">
                Caller funnel
              </h2>
              <FunnelChart steps={view.funnel} />
            </Card>
          </section>

          <section aria-labelledby="dropoff-h">
            <Card className="p-4">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                  <h2 id="dropoff-h" className="text-lg font-semibold">
                    Criterion drop-off
                  </h2>
                  <p className="text-xs text-muted">
                    For each question, among calls that reached it: the share that ended Fail or Unsure. Highest first — candidates for protocol or
                    wording changes.
                  </p>
                </div>
                {versions.length > 1 && script && (
                  <Field label="Script version" className="w-40">
                    <Select value={script.id} onChange={(e) => setVersionPick(e.target.value)}>
                      {versions.map((s) => (
                        <option key={s.id} value={s.id}>
                          v{s.version} ({s.status})
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              {!nctId && <p className="text-sm text-muted">Pick one trial to see its questions.</p>}
              {nctId && !script && <p className="text-sm text-muted">This trial has no approved script yet.</p>}
              {nctId && script && dropOff && <DropOffTable rows={dropOff} />}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
