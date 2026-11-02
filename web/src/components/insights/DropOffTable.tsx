import type { DropOffRow } from "@/lib/insights";
import { pct } from "./format";

// Status colours (fail = critical, unsure = warning). Never alone: every share is printed and the legend names both.
const FAIL = "#d03b3b";
const UNSURE = "#fab219";

function Swatch({ color }: { color: string }) {
  return <span className="inline-block size-2.5 rounded-sm align-middle" style={{ background: color }} aria-hidden />;
}

/** Per-question FAIL / UNSURE shares as a table with an inline stacked bar (0–100%). */
export function DropOffTable({ rows }: { rows: DropOffRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted">This script has no questions asked on the call.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted mb-2">
        <span><Swatch color={FAIL} /> Fail (answer ruled the caller out)</span>
        <span><Swatch color={UNSURE} /> Unsure (not sure, unclear, or not confirmed)</span>
      </div>
      <div className="overflow-x-auto -mx-3 px-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="py-1.5 pr-3 font-medium">Question</th>
              <th className="py-1.5 pr-3 font-medium text-right">Reached</th>
              <th className="py-1.5 pr-3 font-medium text-right">Fail</th>
              <th className="py-1.5 pr-3 font-medium text-right">Unsure</th>
              <th className="py-1.5 font-medium w-[30%] min-w-24 hidden sm:table-cell"><span className="sr-only">Chart</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const f = (r.failShare ?? 0) * 100;
              const u = (r.unsureShare ?? 0) * 100;
              return (
                <tr key={r.criterionId} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-3">
                    <span className="text-xs text-muted font-mono mr-1.5">{r.criterionId}</span>
                    {r.question}
                    {r.endedHere > 0 && <span className="block text-xs text-muted mt-0.5">{r.endedHere} call(s) ended at this question</span>}
                    {/* Phone: the bar sits under the question. */}
                    <Bar f={f} u={u} className="mt-1.5 sm:hidden" />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.reached}</td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{pct(r.failShare)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{pct(r.unsureShare)}</td>
                  <td className="py-2 hidden sm:table-cell">
                    <Bar f={f} u={u} className="mt-1" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Bar({ f, u, className }: { f: number; u: number; className?: string }) {
  return (
    <div
      className={`flex h-2.5 gap-[2px] overflow-hidden rounded-sm bg-stone-100 ${className ?? ""}`}
      aria-hidden
      title={`Fail ${f.toFixed(0)}% · Unsure ${u.toFixed(0)}%`}
    >
      {f > 0 && <div className="h-full rounded-l-sm" style={{ width: `${f}%`, background: FAIL }} />}
      {u > 0 && <div className="h-full" style={{ width: `${u}%`, background: UNSURE, borderRadius: f > 0 ? "0 2px 2px 0" : "2px" }} />}
    </div>
  );
}
