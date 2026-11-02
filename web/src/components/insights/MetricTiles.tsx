import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui";
import { TARGETS, type Metrics, type Ratio } from "@/lib/insights";
import { minSec, ratioText, span } from "./format";

type Goal = { kind: "target" | "hypothesis"; dir: "min" | "max"; value: number } | { kind: "tracked" };

function Status({ goal, value }: { goal: Goal; value: number | null }) {
  if (goal.kind === "tracked" || value === null) return <Badge>{goal.kind === "tracked" ? "Tracked" : "No data"}</Badge>;
  const met = goal.dir === "min" ? value >= goal.value : value <= goal.value;
  if (goal.kind === "target") return <Badge tone={met ? "green" : "amber"}>{met ? "✓ Meets target" : "! Below target"}</Badge>;
  return <Badge tone={met ? "teal" : "neutral"}>{met ? "✓ Supports hypothesis" : "Below hypothesis"}</Badge>;
}

function Tile({ label, value, sub, goal, raw, hero }: { label: string; value: string; sub: ReactNode; goal: Goal; raw: number | null; hero?: boolean }) {
  return (
    <Card className={`p-3 flex flex-col gap-1 ${hero ? "border-accent/50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <Status goal={goal} value={raw} />
      </div>
      <span className={`${hero ? "text-4xl" : "text-2xl"} font-semibold`}>{value}</span>
      <span className="text-xs text-muted">{sub}</span>
    </Card>
  );
}

const of = (r: Ratio, what: string) => (r.den ? `${r.num} of ${r.den} ${what}` : `No ${what} yet`);

export function MetricTiles({ m }: { m: Metrics }) {
  const minTarget = (v: number, kind: "target" | "hypothesis" = "target"): Goal => ({ kind, dir: "min", value: v });
  return (
    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        hero
        label="North Star · site-accepted referral rate"
        value={ratioText(m.acceptedRate)}
        raw={m.acceptedRate.value}
        goal={minTarget(TARGETS.acceptedRate)}
        sub={<>Target ≥ 70%. {of(m.acceptedRate, "reviewed referrals accepted")}.</>}
      />
      <Tile
        label="Call completion rate"
        value={ratioText(m.completionRate)}
        raw={m.completionRate.value}
        goal={minTarget(TARGETS.completionRate)}
        sub={<>Consent → last criterion. Target ≥ 60%. {of(m.completionRate, "consented calls")}.</>}
      />
      <Tile
        label="Median call length"
        value={minSec(m.medianCallMs)}
        raw={m.medianCallMs}
        goal={{ kind: "target", dir: "max", value: TARGETS.medianCallMs }}
        sub={<>Completed calls. Target ≤ 6:00. {m.medianCallN ? `n = ${m.medianCallN}` : "No completed calls yet"}.</>}
      />
      <Tile
        label="Hang-ups within 30 s of disclosure"
        value={ratioText(m.earlyHangup)}
        raw={m.earlyHangup.value}
        goal={{ kind: "target", dir: "max", value: TARGETS.earlyHangup }}
        sub={<>Declined or dropped in under 30 s. Target ≤ 15%. {of(m.earlyHangup, "calls")}.</>}
      />
      <Tile
        label="Calls outside site hours"
        value={ratioText(m.outsideHours)}
        raw={m.outsideHours.value}
        goal={minTarget(TARGETS.outsideHours, "hypothesis")}
        sub={<>Not Mon–Fri 9:00–17:00, this browser&apos;s time zone. Hypothesis ≥ 30%. {of(m.outsideHours, "calls")}.</>}
      />
      <Tile
        label="Calls not in English"
        value={ratioText(m.nonEnglish)}
        raw={m.nonEnglish.value}
        goal={{ kind: "tracked" }}
        sub={<>Spanish or mixed. {of(m.nonEnglish, "calls")}.</>}
      />
      <Tile
        label="Contact opt-in among referrals"
        value={ratioText(m.contactOptIn)}
        raw={m.contactOptIn.value}
        goal={minTarget(TARGETS.contactOptIn, "hypothesis")}
        sub={<>Leading metric (G11). Hypothesis ≥ 80%. {of(m.contactOptIn, "referrals asked")}.</>}
      />
      <Tile
        label="Referral → first contact attempt"
        value={span(m.firstContactMs)}
        raw={m.firstContactMs}
        goal={{ kind: "tracked" }}
        sub={
          <>
            Median, leading metric (G11). {m.firstContactN ? `n = ${m.firstContactN}` : "No attempts logged yet"}.
            {m.awaitingContact > 0 && ` ${m.awaitingContact} accepted referral(s) waiting; oldest ${span(m.oldestAwaitingMs)}.`}
          </>
        }
      />
    </div>
  );
}
