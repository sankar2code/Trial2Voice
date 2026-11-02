"use client";
// Offline evals in the browser (PRD §9): simulated callers with known ground
// truth run through the real call agent; results are scored against the
// release gates and compared with the previous run.
import { Fragment, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, ErrorText, cx } from "@/components/ui";
import { db, type EvalRunRecord } from "@/lib/store/db";
import { personasFor } from "@/lib/evals/personas";
import { runPersona, summarize, type EvalSummary, type PersonaResult } from "@/lib/evals/runner";
import { keywordInterpreter } from "@/lib/call/parse";
import { LlmInterpreter } from "@/lib/call/llmInterpreter";
import { nearestTo } from "@/lib/sites";
import { useSettings } from "@/lib/settings";
import type { ScriptVersion, Trial } from "@/lib/types";

type Candidate = { trial: Trial; script: ScriptVersion };
type StoredResult = Omit<PersonaResult, "record"> & { transcript: string[] };

const uid = () => globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`;

function GateTable({ s, previous }: { s: EvalSummary; previous?: EvalSummary }) {
  const prev = new Map(previous?.gates.map((g) => [g.key, g]));
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted">
        <tr><th className="py-1">Gate</th><th>Target</th><th>Result</th><th>Previous run</th><th /></tr>
      </thead>
      <tbody>
        {s.gates.map((g) => (
          <tr key={g.key} className="border-t border-border">
            <td className="py-1.5 pr-2">{g.label}</td>
            <td className="pr-2 text-muted">{g.target}</td>
            <td className="pr-2 font-medium">{g.display}</td>
            <td className="pr-2 text-muted">{prev.get(g.key)?.display ?? "—"}</td>
            <td>{g.pass === null ? <Badge>no cases</Badge> : g.pass ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function EvalsPage() {
  const settings = useSettings();
  const candidates = useLiveQuery(async (): Promise<Candidate[]> => {
    const [trials, scripts] = await Promise.all([db().trials.toArray(), db().scripts.toArray()]);
    return trials
      .map((trial) => {
        const versions = scripts.filter((s) => s.nctId === trial.nctId && s.status !== "superseded").sort((a, b) => b.version - a.version);
        const script = versions[0];
        return script ? { trial, script } : null;
      })
      .filter((x): x is Candidate => x !== null);
  }, []);
  const runs = useLiveQuery(() => db().evalRuns.orderBy("at").reverse().limit(10).toArray(), []);

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [useLlm, setUseLlm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<StoredResult[] | null>(null);
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef(false);

  const chosen = useMemo(() => {
    if (!candidates) return [];
    const ids = selected ?? new Set(candidates.map((c) => c.trial.nctId));
    return candidates.filter((c) => ids.has(c.trial.nctId));
  }, [candidates, selected]);

  // The run just finished is runs[0]; compare with the one before it.
  const previous = (summary ? runs?.[1] : runs?.[0]) as EvalRunRecord | undefined;

  const run = async () => {
    setError(null);
    setResults(null);
    setSummary(null);
    cancel.current = false;
    const interpreter = useLlm && settings.apiKey ? new LlmInterpreter(settings.apiKey, settings.callModel) : keywordInterpreter;
    const jobs = chosen.flatMap((c) => personasFor(c.trial, { ...c.script, status: "locked" }).map((p) => ({ p, c })));
    setProgress({ done: 0, total: jobs.length });
    const out: PersonaResult[] = [];
    try {
      for (const { p, c } of jobs) {
        if (cancel.current) break;
        const script = { ...c.script, status: "locked" as const }; // evaluate drafts as release candidates
        out.push(await runPersona(p, { ...c.trial, callsPaused: false, stale: false }, script, {
          interpreter,
          findSite: async () => nearestTo(c.trial, { lat: 42.33, lon: -83.05 }),
        }));
        setProgress({ done: out.length, total: jobs.length });
      }
      const s = summarize(out);
      const stored: StoredResult[] = out.map(({ record, ...rest }) => ({ ...rest, transcript: record.transcript.map((e) => `${e.role === "agent" ? "Agent" : "Caller"}: ${e.text}`) }));
      setResults(stored);
      setSummary(s);
      await db().evalRuns.put({ id: uid(), at: new Date().toISOString(), interpreter: interpreter.name, trials: chosen.map((c) => `${c.trial.nctId} v${c.script.version}`), summary: s, results: stored });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The eval run failed.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Evals</h1>
        <p className="text-sm text-muted max-w-3xl">
          Twenty simulated callers per trial, each with a known right answer, talk to the real call agent in text mode. A release
          ships only if every gate passes (PRD §9). Drafts can be checked before approval.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        {candidates === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm">No trials with a script yet. Load the demo trials from the Trials page.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {candidates.map((c) => {
              const on = !selected || selected.has(c.trial.nctId);
              return (
                <label key={c.trial.nctId} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const next = new Set(selected ?? candidates.map((x) => x.trial.nctId));
                      if (e.target.checked) next.add(c.trial.nctId);
                      else next.delete(c.trial.nctId);
                      setSelected(next);
                    }}
                  />
                  {c.trial.shortName} <span className="text-xs text-muted">v{c.script.version} {c.script.status}</span>
                </label>
              );
            })}
          </div>
        )}
        <label className={cx("flex items-start gap-2 text-sm", !settings.apiKey && "opacity-50")}>
          <input type="checkbox" className="mt-1" disabled={!settings.apiKey} checked={useLlm && Boolean(settings.apiKey)} onChange={(e) => setUseLlm(e.target.checked)} />
          <span>
            Read answers with Claude ({settings.callModel}) instead of the keyword parser.{" "}
            <span className="text-muted">{settings.apiKey ? "Uses your API key: roughly one call per caller turn." : "Needs an API key in Settings."}</span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          <Button variant="primary" disabled={!chosen.length || progress !== null} onClick={run}>
            {progress ? `Running ${progress.done}/${progress.total}…` : `Run ${chosen.length * 20} simulated calls`}
          </Button>
          {progress && <Button onClick={() => (cancel.current = true)}>Stop</Button>}
        </div>
        <ErrorText>{error}</ErrorText>
      </Card>

      {summary && results && (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">Release gates</h2>
              {summary.allPass ? <Badge tone="green">All gates pass</Badge> : <Badge tone="red">Gate failed — don&apos;t ship</Badge>}
              <span className="text-xs text-muted">
                {summary.passed}/{summary.total} callers got the expected outcome · understanding p50 {summary.latency.p50} ms, p95 {summary.latency.p95} ms
              </span>
            </div>
            <GateTable s={summary} previous={previous?.summary as EvalSummary | undefined} />
          </Card>

          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted border-b border-border">
                <tr><th className="p-2">Caller</th><th className="p-2">Expected</th><th className="p-2">Got</th><th className="p-2">Checks</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <Fragment key={r.personaId}>
                    <tr className={cx("border-b border-border align-top", !r.pass && "bg-red-50")}>
                      <td className="p-2">
                        <div className="font-medium">{r.label}</div>
                        <div className="text-xs text-muted">{r.nctId} · {r.scenario}</div>
                      </td>
                      <td className="p-2 text-xs">{r.expected.decision ?? r.expected.status}</td>
                      <td className="p-2 text-xs">{r.decision ?? r.status}{r.error ? ` — ${r.error}` : ""}</td>
                      <td className="p-2 space-x-1">
                        {r.pass ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}
                        {r.falseNegative && <Badge tone="red">false negative</Badge>}
                        {r.falsePositive && <Badge tone="amber">false positive</Badge>}
                        {r.flags.length > 0 && <Badge tone="amber">{r.flags.length} flag(s)</Badge>}
                        {r.phoneExact === false && <Badge tone="red">phone wrong</Badge>}
                      </td>
                      <td className="p-2">
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.personaId ? null : r.personaId)}>{open === r.personaId ? "Hide" : "Transcript"}</Button>
                      </td>
                    </tr>
                    {open === r.personaId && (
                      <tr className="border-b border-border">
                        <td colSpan={5} className="p-3 bg-stone-50">
                          <ol className="text-xs space-y-0.5 font-mono">{r.transcript.map((l, i) => <li key={i}>{l}</li>)}</ol>
                          {r.flags.map((f, i) => <p key={i} className="text-xs text-amber-800 mt-1">{f.kind}: {f.detail}</p>)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {runs && runs.length > 0 && (
        <Card className="p-4">
          <h2 className="font-medium mb-2">Recent runs</h2>
          <ul className="text-sm space-y-1">
            {runs.map((r) => {
              const s = r.summary as EvalSummary;
              return (
                <li key={r.id} className="flex flex-wrap gap-2 items-center">
                  <span className="text-muted text-xs">{new Date(r.at).toLocaleString()}</span>
                  {s.allPass ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}
                  <span>{s.passed}/{s.total}</span>
                  <span className="text-xs text-muted">{r.interpreter} · {r.trials.join(", ")}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
