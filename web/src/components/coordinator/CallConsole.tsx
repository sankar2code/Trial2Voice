"use client";
// Call console (PRD §4): transcript, latency per step and every tool call,
// from the stored call record. Read-only.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Card, Tabs, cx } from "@/components/ui";
import { fmtMs, fmtTime } from "./shared";
import { db } from "@/lib/store/db";
import type { CallRecord } from "@/lib/call/types";

function percentile(xs: number[], p: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 140 ? `${s.slice(0, 140)}…` : s;
};

export function CallConsole({ callId }: { callId: string }) {
  const data = useLiveQuery(async () => {
    const call = await db().calls.get(callId);
    const referral = await db().referrals.get(callId);
    const trial = call ? await db().trials.get(call.nctId) : undefined;
    return { call, referral, trial };
  }, [callId]);
  const [tab, setTab] = useState<"transcript" | "tools">("transcript");
  const [hash, setHash] = useState<string>("");
  useEffect(() => setHash(window.location.hash), []);

  if (data === undefined) return <p className="text-sm text-muted">Loading…</p>;
  const { call, referral, trial } = data;
  if (!call) return <p className="text-sm">Call not found in this browser.</p>;

  const interp = call.toolCalls.filter((t) => t.name === "interpret").map((t) => t.ms);
  const duration = call.endedAt ? new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime() : null;
  const flagged = new Map<number, string>();
  for (const f of [...(referral?.judge.rules ?? []), ...(referral?.judge.llm ?? [])]) if (f.turn !== undefined) flagged.set(f.turn, f.kind.replace(/_/g, " "));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <Link href="/coordinator" className="text-muted hover:text-foreground">← Queue</Link>
        {referral && <Link href={`/coordinator/referrals/${call.id}`} className="text-muted hover:text-foreground">Referral</Link>}
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Call console</h1>
        <div className="text-sm text-muted flex flex-wrap gap-x-4">
          <span>{trial?.shortName ?? call.nctId}</span>
          <span>{fmtTime(call.startedAt)}</span>
          <span>Status: {call.status.replace(/_/g, " ")}</span>
          <span>{call.mode === "voice" ? "Voice" : "Typed"} · {call.language === "mixed" ? "English + Spanish" : call.language === "es" ? "Spanish" : "English"}</span>
          <span>Script {call.scriptVersionId.split("-").pop()} · <span className="font-mono">{call.scriptSha256.slice(0, 10)}</span></span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Duration", duration !== null ? fmtMs(duration) : "—"],
          ["Caller turns", String(call.transcript.filter((e) => e.role === "caller").length)],
          ["Understanding p50 / p95", interp.length ? `${percentile(interp, 50)} / ${percentile(interp, 95)} ms` : "—"],
          ["Answers read by", call.interpreter],
        ].map(([k, v]) => (
          <Card key={k} className="p-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-medium text-sm mt-0.5 break-all">{v}</div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted">
        Timing covers understanding the caller only. Speaking time depends on the voice and isn&apos;t included. The PRD target is first audio within 1.2 s (p50) of the caller stopping.
      </p>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: "transcript", label: "Transcript" }, { id: "tools", label: `Steps (${call.toolCalls.length})` }]} />

      {tab === "transcript" && (
        <Card className="p-3">
          {call.transcript.length === 0 ? (
            <p className="text-sm text-muted">No transcript: the caller didn&apos;t consent, or a minor called alone. Only the fact that the call happened is stored.</p>
          ) : (
            <ol className="space-y-1">
              {call.transcript.map((e, i) => (
                <li
                  key={i}
                  id={`turn-${i}`}
                  className={cx("grid grid-cols-[3.5rem_4.5rem_1fr] gap-2 text-sm rounded px-1 py-0.5", (flagged.has(i) || hash === `#turn-${i}`) && "bg-amber-50 ring-1 ring-amber-300")}
                >
                  <span className="text-xs text-muted font-mono pt-0.5">{fmtMs(e.t)}</span>
                  <span className={cx("text-xs pt-0.5", e.role === "agent" ? "text-accent" : "text-foreground")}>{e.role === "agent" ? "Agent" : "Caller"}{e.lang === "es" ? " · es" : ""}</span>
                  <span>
                    {e.text}
                    {e.kind && e.role === "agent" && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">{e.kind.replace("fixed:", "")}</span>}
                    {flagged.has(i) && <Badge tone="amber" className="ml-2">{flagged.get(i)}</Badge>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === "tools" && (
        <Card className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted border-b border-border">
              <tr><th className="p-2">Time</th><th className="p-2">Step</th><th className="p-2">Input</th><th className="p-2">Result</th><th className="p-2 text-right">ms</th></tr>
            </thead>
            <tbody>
              {call.toolCalls.map((t, i) => (
                <tr key={i} className="border-b border-border last:border-0 align-top">
                  <td className="p-2 font-mono text-muted">{fmtMs(t.t)}</td>
                  <td className="p-2 font-mono">{t.name}</td>
                  <td className="p-2 font-mono break-all max-w-xs">{short(t.args)}</td>
                  <td className="p-2 font-mono break-all max-w-xs">{short(t.result)}</td>
                  <td className={cx("p-2 text-right font-mono", t.ms > 700 && "text-amber-700")}>{t.ms || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export type { CallRecord };
