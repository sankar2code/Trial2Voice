"use client";
import Link from "next/link";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Card, Tabs } from "@/components/ui";
import { DecisionBadge, FOLLOW_LABEL, fmtTime } from "@/components/coordinator/shared";
import { db } from "@/lib/store/db";
import { effectiveDecision, type Referral } from "@/lib/store/referrals";
import type { CallRecord, Decision } from "@/lib/call/types";
import type { ScriptVersion, Trial } from "@/lib/types";

type Tab = "review" | "held" | "not_match" | "red_flag" | "follow_up" | "closed";
type Row = { r: Referral; call?: CallRecord; trial?: Trial; decision: Decision | null };

const CLOSED_FOLLOW_UP = new Set(["visit_scheduled", "declined", "not_a_fit", "unreachable"]);

function tabOf(x: Row): Tab {
  const { r, decision } = x;
  if (r.kind === "red_flag") return "red_flag";
  if (r.held) return "held";
  if (r.review.state === "rejected") return "closed";
  if (r.review.state === "accepted") return CLOSED_FOLLOW_UP.has(r.followUp.state) ? "closed" : "follow_up";
  if (decision === "NOT_ELIGIBLE") return "not_match";
  return "review";
}

export default function CoordinatorQueue() {
  const [tab, setTab] = useState<Tab>("review");
  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const [refs, calls, scripts, trials] = await Promise.all([db().referrals.toArray(), db().calls.toArray(), db().scripts.toArray(), db().trials.toArray()]);
    const callBy = new Map(calls.map((c) => [c.id, c]));
    const scriptBy = new Map<string, ScriptVersion>(scripts.map((s) => [s.id, s]));
    const trialBy = new Map(trials.map((t) => [t.nctId, t]));
    return refs
      .map((r) => {
        const call = callBy.get(r.callId);
        const script = scriptBy.get(r.scriptVersionId);
        return { r, call, trial: trialBy.get(r.nctId), decision: call && script ? effectiveDecision(call, r, script) : r.engineDecision };
      })
      .sort((a, b) => b.r.createdAt.localeCompare(a.r.createdAt));
  }, []);

  const counts = (t: Tab) => (rows ?? []).filter((x) => tabOf(x) === t).length;
  const shown = (rows ?? []).filter((x) => tabOf(x) === tab);
  const label = (t: Tab, text: string) => (
    <span>
      {text} <span className="text-xs text-muted">{counts(t)}</span>
    </span>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Referral queue</h1>
        <p className="text-sm text-muted">
          Every completed pre-screen lands here. The AI never decides: each answer is traced to a criterion, and you can override anything with a reason.
        </p>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "review", label: label("review", "To review") },
          { id: "held", label: label("held", "Held for quality review") },
          { id: "not_match", label: label("not_match", "Not a match") },
          { id: "red_flag", label: label("red_flag", "Red flags") },
          { id: "follow_up", label: label("follow_up", "Follow-up") },
          { id: "closed", label: label("closed", "Closed") },
        ]}
      />
      {tab === "not_match" && (
        <p className="text-xs text-muted">Sample these weekly to measure missed eligible callers (the false-negative guardrail, Addendum G2).</p>
      )}
      {tab === "held" && <p className="text-xs text-muted">The post-call check found something off-script. Review each one before it can be accepted (PRD §7).</p>}
      {rows === undefined && <p className="text-sm text-muted">Loading…</p>}
      {rows && shown.length === 0 && <p className="text-sm text-muted">Nothing here.{rows.length === 0 && " Make a test call from an approved trial to create a referral."}</p>}
      <div className="grid gap-2">
        {shown.map(({ r, trial, decision, call }) => (
          <Link key={r.id} href={`/coordinator/referrals/${r.id}`}>
            <Card className="p-3 hover:border-accent transition-colors">
              <div className="flex flex-wrap items-center gap-2">
                <DecisionBadge decision={decision} overridden={Boolean(r.decisionOverride || r.rowOverrides.length)} />
                <span className="font-medium">{trial?.shortName ?? r.nctId}</span>
                <span className="text-xs text-muted">{fmtTime(r.createdAt)}</span>
                {r.needsPatientPermission && <Badge tone="blue">Caregiver call</Badge>}
                {r.language !== "en" && <Badge>{r.language === "es" ? "Spanish" : "English + Spanish"}</Badge>}
                {r.held && <Badge tone="red">{r.judge.rules.length + r.judge.llm.length} quality flag(s)</Badge>}
                {r.judge.llmStatus === "running" && <Badge>AI review running…</Badge>}
                {r.review.state !== "pending" && <Badge tone={r.review.state === "accepted" ? "green" : "neutral"}>{r.review.state}</Badge>}
                {r.review.state === "accepted" && <Badge tone="teal">{FOLLOW_LABEL[r.followUp.state]}</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted flex flex-wrap gap-x-4">
                <span>{r.contact === "demo_discarded" ? "Contact given (demo)" : r.contact === "no_contact" ? "No contact details" : r.kind === "red_flag" ? "Screen stopped for safety" : "—"}</span>
                {r.nearestSite && <span>Nearest site: {r.nearestSite.facility}{r.nearestSite.miles !== undefined ? ` (${r.nearestSite.miles} mi)` : ""}</span>}
                {call && <span>{call.answers.filter((a) => !a.supersededBy).length} answers</span>}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
