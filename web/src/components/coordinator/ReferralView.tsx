"use client";
import Link from "next/link";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, ErrorText, Select, cx } from "@/components/ui";
import { DECISION_LABEL, DecisionBadge, FOLLOW_LABEL, ROW_LABEL, ROW_TONE, ReasonDialog, fmtTime } from "./shared";
import { db } from "@/lib/store/db";
import {
  effectiveDecision, effectiveRows, logAttempt, overrideDecision, overrideRow, releaseHold, reopenReferral, reviewReferral, setFollowUp,
  type AttemptOutcome, type Referral,
} from "@/lib/store/referrals";
import { useSettings } from "@/lib/settings";
import { formatPhone } from "@/lib/call/phone";
import type { Answer, Decision, RowResult } from "@/lib/call/types";

const DEMO_PHONE = formatPhone("5555550100");
const RESULTS: RowResult[] = ["PASS", "FAIL", "UNSURE", "SITE_CHECK"];
const DECISIONS: Decision[] = ["LIKELY_ELIGIBLE", "NEEDS_SITE_REVIEW", "NOT_ELIGIBLE"];
const RELATIONSHIP_LABEL: Record<string, string> = {
  parent_guardian: "parent or guardian", spouse_partner: "spouse or partner", adult_child: "adult child", other_family: "other family",
  friend_caregiver: "friend or caregiver", legal_representative: "legal representative", other: "other",
};

function valueText(a?: Answer): string {
  if (!a) return "";
  if (a.value === "UNSURE") return "Unsure";
  if (a.value === Infinity) return "never";
  if (typeof a.value === "object") return `${a.value.min}–${a.value.max}`;
  if (typeof a.value === "boolean") return a.value ? "yes" : "no";
  return String(a.value);
}

type DialogState =
  | { kind: "reject" } | { kind: "accept" } | { kind: "reopen" } | { kind: "release" } | { kind: "decision" }
  | { kind: "row"; criterionId: string; from: RowResult }
  | null;

export function ReferralView({ id }: { id: string }) {
  const { actor } = useSettings();
  const data = useLiveQuery(async () => {
    const r = await db().referrals.get(id);
    if (!r) return { r: null };
    const [call, script, trial, audit] = await Promise.all([
      db().calls.get(r.callId),
      db().scripts.get(r.scriptVersionId),
      db().trials.get(r.nctId),
      db().audit.where("nctId").equals(r.nctId).toArray(),
    ]);
    return { r, call, script, trial, audit: audit.filter((e) => (e.payload as { id?: string; callId?: string } | null)?.id === id || (e.payload as { callId?: string } | null)?.callId === id) };
  }, [id]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ outcome: AttemptOutcome; voicemail: boolean }>({ outcome: "no_answer", voicemail: false });

  if (data === undefined) return <p className="text-sm text-muted">Loading…</p>;
  if (!data.r) return <p className="text-sm">Referral not found in this browser. <Link href="/coordinator" className="underline text-accent">Back to the queue</Link></p>;
  const { r, call, script, trial } = data;
  if (!call || !script) return <p className="text-sm">The call record or script version for this referral is missing.</p>;

  const decision = effectiveDecision(call, r, script);
  const rows = effectiveRows(call, r);
  const current = new Map(call.answers.filter((a) => !a.supersededBy).map((a) => [a.criterionId, a]));
  const asked = rows.filter((x) => script.criteria.find((c) => c.id === x.criterionId)?.mode === "ask");
  const passed = asked.filter((x) => x.result === "PASS").length;
  const siteChecks = rows.filter((x) => x.result === "SITE_CHECK").length;
  const flags = [...r.judge.rules, ...r.judge.llm];
  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link href="/coordinator" className="text-xs text-muted hover:text-foreground">← Queue</Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted font-mono">{r.nctId} · referral {r.id.slice(0, 8)}</div>
          <h1 className="text-2xl font-semibold">{trial?.shortName ?? r.nctId} pre-screen referral</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <DecisionBadge decision={decision} overridden={Boolean(r.decisionOverride || r.rowOverrides.length)} />
            {r.kind === "screen" && <span className="text-muted">{passed} of {asked.length} asked criteria passed · {siteChecks} to confirm at site</span>}
          </div>
          <div className="mt-1 text-xs text-muted flex flex-wrap gap-x-4">
            <span>{fmtTime(r.createdAt)}</span>
            <span>Language: {r.language === "es" ? "Spanish" : r.language === "mixed" ? "English and Spanish" : "English"}</span>
            <span>Script v{script.version}</span>
            <span>Answers read by: {call.interpreter}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button onClick={() => window.print()}>Print</Button>
          <Link href={`/coordinator/calls/${call.id}`}><Button>Call console</Button></Link>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {/* Banners */}
      {r.kind === "red_flag" && call.redFlag && (
        <Card className="p-4 border-red-200 bg-red-50 text-sm text-red-900">
          <div className="font-medium">Screen stopped for safety: {call.redFlag.category.replace(/_/g, " ")}</div>
          <p className="mt-1">The caller heard the fixed emergency message. Review the transcript and follow your site&apos;s safety procedure.</p>
        </Card>
      )}
      {flags.length > 0 && (
        <Card className={cx("p-4 text-sm", r.held ? "border-amber-300 bg-amber-50" : "")}>
          <div className="font-medium">{r.held ? "Held for quality review" : "Quality flags (reviewed)"}</div>
          <ul className="mt-1 space-y-1">
            {flags.map((f, i) => (
              <li key={i}>
                <Badge tone="amber">{f.kind.replace(/_/g, " ")}</Badge> <span className="text-xs text-muted">{f.source}</span> {f.detail}
                {f.turn !== undefined && <Link className="ml-1 text-xs underline" href={`/coordinator/calls/${call.id}#turn-${f.turn}`}>turn {f.turn}</Link>}
              </li>
            ))}
          </ul>
          {r.held && <Button className="mt-2 print:hidden" size="sm" onClick={() => setDialog({ kind: "release" })}>I reviewed these — release</Button>}
          {r.holdReleased && <p className="mt-1 text-xs text-muted">Released by {r.holdReleased.by}, {fmtTime(r.holdReleased.at)}: {r.holdReleased.note}</p>}
        </Card>
      )}
      {r.judge.llmStatus === "running" && <p className="text-xs text-muted">AI quality review running…</p>}
      {r.judge.llmStatus === "error" && <p className="text-xs text-amber-800">AI quality review failed: {r.judge.llmError}. The rule checks still ran.</p>}
      {r.needsPatientPermission && (
        <Card className="p-3 text-sm border-sky-200 bg-sky-50 text-sky-900">
          <strong>Caregiver call</strong> ({RELATIONSHIP_LABEL[r.relationship ?? "other"]}). Confirm the patient&apos;s (or legal representative&apos;s) permission before scheduling.
        </Card>
      )}
      {r.respondent === "unclear" && <Card className="p-3 text-sm">It wasn&apos;t clear whether the caller answered for themselves or someone else.</Card>}

      {/* Contact + site */}
      {r.kind === "screen" && (
        <Card className="p-4 grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Contact</div>
            {r.contact === "demo_discarded" ? (
              <>
                <div className="mt-1">Demo caller · {DEMO_PHONE}</div>
                <div className="text-xs text-muted">Demo: real names and numbers are never stored (Addendum G11).</div>
                <div className="mt-1 text-xs">
                  Voicemail mentioning the study: {r.contactPrefs?.voicemailOk === false ? <strong>not OK</strong> : r.contactPrefs?.voicemailOk ? "OK" : "not asked"} · Best time: {r.contactPrefs?.bestTime ?? "any"} · Language: {r.contactPrefs?.language === "es" ? "Spanish" : "English"}
                </div>
              </>
            ) : r.contact === "no_contact" ? (
              <div className="mt-1">The caller didn&apos;t leave contact details. They were given the site phone number.</div>
            ) : (
              <div className="mt-1 text-muted">Not a referral outcome — no contact was asked.</div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Nearest recruiting site</div>
            {r.nearestSite ? (
              <div className="mt-1">
                {r.nearestSite.facility}, {r.nearestSite.city}, {r.nearestSite.state}
                {r.nearestSite.miles !== undefined && <span className="text-muted"> · about {r.nearestSite.miles} mi</span>}
                {r.nearestSite.phone && <div className="text-xs text-muted">{r.nearestSite.phone}</div>}
              </div>
            ) : (
              <div className="mt-1 text-muted">No ZIP code given.</div>
            )}
          </div>
        </Card>
      )}

      {/* Review actions */}
      {r.kind === "screen" && (
        <Card className="p-4 flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-sm mr-2">
            Review: <strong>{r.review.state}</strong>
            {r.review.by && <span className="text-muted"> by {r.review.by}, {fmtTime(r.review.at!)}{r.review.reason ? ` — ${r.review.reason}` : ""}</span>}
          </span>
          {r.review.state === "pending" ? (
            <>
              <Button variant="primary" disabled={r.held} onClick={() => setDialog({ kind: "accept" })}>Accept for screening visit</Button>
              <Button variant="danger" disabled={r.held} onClick={() => setDialog({ kind: "reject" })}>Reject</Button>
            </>
          ) : (
            <Button onClick={() => setDialog({ kind: "reopen" })}>Reopen</Button>
          )}
          <Button variant="ghost" onClick={() => setDialog({ kind: "decision" })}>Override status</Button>
          {r.held && <span className="text-xs text-amber-800">Release the quality hold first.</span>}
        </Card>
      )}

      {/* Criterion table */}
      {r.kind === "screen" && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted border-b border-border">
              <tr>
                <th className="p-2">Criterion</th>
                <th className="p-2">Question asked / site check</th>
                <th className="p-2">Caller&apos;s words</th>
                <th className="p-2">Interpreted</th>
                <th className="p-2">Result</th>
                <th className="p-2 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const c = script.criteria.find((x) => x.id === row.criterionId);
                const a = current.get(row.criterionId);
                return (
                  <tr key={row.criterionId} className="border-b border-border align-top last:border-0">
                    <td className="p-2 font-mono text-xs whitespace-nowrap">
                      {row.criterionId}
                      <div className="font-sans text-muted">{c?.kind}</div>
                    </td>
                    <td className="p-2 max-w-sm">{c?.mode === "confirm_at_site" ? <span className="text-muted">{c.siteCheckNote}</span> : a?.questionSpoken ?? c?.question.en}</td>
                    <td className="p-2 max-w-xs">{a?.callerWords ?? (c?.mode === "ask" ? <span className="text-muted">not answered</span> : "")}</td>
                    <td className="p-2 whitespace-nowrap">
                      {valueText(a)}
                      {a?.readBackConfirmed && <span title="Caller confirmed the read-back"> ✓</span>}
                      {a && a.value !== "UNSURE" && <div className="text-xs text-muted">confidence {a.confidence.toFixed(2)}</div>}
                    </td>
                    <td className="p-2">
                      <Badge tone={ROW_TONE[row.result]}>{ROW_LABEL[row.result]}</Badge>
                      {row.overridden && <div className="text-xs text-muted">overridden</div>}
                    </td>
                    <td className="p-2 print:hidden">
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "row", criterionId: row.criterionId, from: row.result })}>Override</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Follow-up (G11 §7) */}
      {r.kind === "screen" && r.review.state === "accepted" && (
        <Card className="p-4 space-y-3 print:hidden">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">Follow-up</h2>
            <Badge tone="teal">{FOLLOW_LABEL[r.followUp.state]}</Badge>
          </div>
          {r.contact !== "demo_discarded" ? (
            <p className="text-sm text-muted">No contact details — follow up only if the caller gets in touch.</p>
          ) : (
            <>
              {r.followUp.attempts.length > 0 && (
                <ul className="text-sm space-y-1">
                  {r.followUp.attempts.map((a, i) => (
                    <li key={i}>
                      {fmtTime(a.at)} · {a.outcome.replace(/_/g, " ")}{a.voicemailLeft ? " · voicemail left" : ""} · {a.by}
                      {a.note ? ` — ${a.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {!["visit_scheduled", "declined", "not_a_fit", "unreachable"].includes(r.followUp.state) && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={attempt.outcome} onChange={(e) => setAttempt({ ...attempt, outcome: e.target.value as AttemptOutcome })} className="w-auto">
                    <option value="no_answer">No answer</option>
                    <option value="left_voicemail">Left voicemail</option>
                    <option value="reached">Reached</option>
                    <option value="wrong_number">Wrong number</option>
                  </Select>
                  <label className={cx("text-sm flex items-center gap-1", r.contactPrefs?.voicemailOk === false && "opacity-50")}>
                    <input
                      type="checkbox"
                      disabled={r.contactPrefs?.voicemailOk === false}
                      checked={attempt.voicemail || attempt.outcome === "left_voicemail"}
                      onChange={(e) => setAttempt({ ...attempt, voicemail: e.target.checked })}
                    />
                    Voicemail left
                  </label>
                  <Button
                    size="sm"
                    onClick={() =>
                      act(async () => {
                        await logAttempt(r.id, attempt.outcome, attempt.voicemail || attempt.outcome === "left_voicemail", actor);
                        setAttempt({ outcome: "no_answer", voicemail: false });
                      })
                    }
                  >
                    Log attempt
                  </Button>
                  {r.contactPrefs?.voicemailOk === false && <span className="text-xs text-amber-800">Caller said no voicemails about the study.</span>}
                </div>
              )}
              {(r.followUp.state === "reached" || r.followUp.state === "visit_scheduled") && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => act(() => setFollowUp(r.id, "visit_scheduled", actor))}>Screening visit scheduled</Button>
                  <Button size="sm" onClick={() => act(() => setFollowUp(r.id, "declined", actor))}>Caller declined</Button>
                  <Button size="sm" onClick={() => act(() => setFollowUp(r.id, "not_a_fit", actor))}>Not a fit after site check</Button>
                </div>
              )}
              <p className="text-xs text-muted">Three missed attempts mark the referral unreachable.</p>
            </>
          )}
        </Card>
      )}

      {/* History */}
      {(r.rowOverrides.length > 0 || r.decisionOverride || data.audit!.length > 0) && (
        <details className="rounded-lg border border-border bg-surface p-3 text-sm">
          <summary className="cursor-pointer">History ({data.audit!.length} audit events)</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {r.decisionOverride && (
              <li>
                Status overridden {DECISION_LABEL[r.decisionOverride.from]} → {DECISION_LABEL[r.decisionOverride.to]} by {r.decisionOverride.by}: {r.decisionOverride.reason}
              </li>
            )}
            {r.rowOverrides.map((o, i) => (
              <li key={i}>
                {o.criterionId}: {ROW_LABEL[o.from]} → {ROW_LABEL[o.to]} by {o.by}, {fmtTime(o.at)}: {o.reason}
              </li>
            ))}
            {data.audit!.map((e) => (
              <li key={e.seq} className="text-muted">
                {fmtTime(e.at)} · {e.type} · {e.actor} · <span className="font-mono">{e.hash.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Dialogs */}
      <ReasonDialog
        open={dialog?.kind === "accept"}
        title="Accept for a screening visit"
        intro="The site will contact the caller to confirm eligibility in person."
        reasonRequired={false}
        confirmLabel="Accept"
        onClose={() => setDialog(null)}
        onConfirm={(reason) => reviewReferral(r.id, "accepted", reason, actor)}
      />
      <ReasonDialog
        open={dialog?.kind === "reject"}
        title="Reject referral"
        intro="Reject reasons feed back into script improvements (PRD §12)."
        confirmLabel="Reject"
        onClose={() => setDialog(null)}
        onConfirm={(reason) => reviewReferral(r.id, "rejected", reason, actor)}
      />
      <ReasonDialog open={dialog?.kind === "reopen"} title="Reopen referral" confirmLabel="Reopen" onClose={() => setDialog(null)} onConfirm={(reason) => reopenReferral(r.id, reason, actor)} />
      <ReasonDialog
        open={dialog?.kind === "release"}
        title="Release the quality hold"
        intro="Confirm you read the flagged turns in the call console and the call is safe to act on."
        confirmLabel="Release"
        onClose={() => setDialog(null)}
        onConfirm={(note) => releaseHold(r.id, note, actor)}
      />
      <ReasonDialog<Decision>
        open={dialog?.kind === "decision"}
        title="Override status"
        intro={`Currently: ${decision ? DECISION_LABEL[decision] : "red flag"}.`}
        choices={{ label: "New status", options: DECISIONS.filter((d) => d !== decision).map((d) => ({ value: d, label: DECISION_LABEL[d] })) }}
        confirmLabel="Override"
        onClose={() => setDialog(null)}
        onConfirm={(reason, to) => overrideDecision(r.id, decision ?? "NEEDS_SITE_REVIEW", to!, reason, actor)}
      />
      <ReasonDialog<RowResult>
        open={dialog?.kind === "row"}
        title={dialog?.kind === "row" ? `Override ${dialog.criterionId}` : "Override"}
        intro={dialog?.kind === "row" ? `Currently: ${ROW_LABEL[dialog.from]}. The status is recalculated with the same rules.` : undefined}
        choices={dialog?.kind === "row" ? { label: "New result", options: RESULTS.filter((x) => x !== dialog.from).map((x) => ({ value: x, label: ROW_LABEL[x] })) } : undefined}
        confirmLabel="Override"
        onClose={() => setDialog(null)}
        onConfirm={(reason, to) => (dialog?.kind === "row" ? overrideRow(r.id, dialog.criterionId, dialog.from, to!, reason, actor) : Promise.resolve())}
      />
    </div>
  );
}

export type { Referral };
