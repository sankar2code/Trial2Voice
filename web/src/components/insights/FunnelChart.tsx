import type { FunnelStep } from "@/lib/insights";
import { pct } from "./format";

/**
 * Horizontal bars, one series (teal), length relative to the first step.
 * Every count and step conversion is printed as text; the bar is a visual aid.
 */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div>
      <ol className="space-y-2.5" aria-label="Caller funnel">
        {steps.map((s, i) => {
          const w = (s.count / max) * 100;
          const conv = i === 0 ? null : s.fromPrev === null ? "—" : `${pct(s.fromPrev)} of previous`;
          return (
            <li key={s.id} title={`${s.label}: ${s.count}${conv ? ` (${conv})` : ""}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="text-muted tabular-nums mr-1.5">{i + 1}.</span>
                  {s.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold">{s.count}</span>
                  {conv && <span className="text-xs text-muted ml-2">{conv}</span>}
                </span>
              </div>
              <div className="mt-1 h-3 rounded-r bg-stone-100" aria-hidden>
                {s.count > 0 && <div className="h-3 rounded-r bg-accent" style={{ width: `max(${w}%, 4px)` }} />}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted">
        Enrollment is reported by the site and isn&apos;t tracked here. Steps 1–2 come from page events; steps 3–8 from saved calls
        (calls still in progress are left out). &ldquo;Referral sent&rdquo; = completed call marked Likely eligible or Needs site review;
        &ldquo;Site accepted&rdquo; and &ldquo;visit scheduled&rdquo; count only those referrals.
      </p>
    </div>
  );
}
