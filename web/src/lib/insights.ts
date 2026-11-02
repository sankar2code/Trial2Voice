// Sponsor insights (PRD §3 metrics, §12 product intelligence; Addendum G11).
// Pure functions over arrays so they can be tested without IndexedDB. Track A:
// everything here is computed from one browser's local store.
import { criterionResult, currentAnswers } from "./engine";
import type { AppEvent } from "./store/db";
import type { CallRecord } from "./call/types";
import type { Referral } from "./store/referrals";
import type { ScriptVersion } from "./types";

// --- Shared helpers ------------------------------------------------------------

export type RangeId = "7d" | "30d" | "all";
export const RANGE_DAYS: Record<RangeId, number | null> = { "7d": 7, "30d": 30, all: null };
const DAY_MS = 86_400_000;

/** Lower bound (inclusive) of a date range, or null for "all". */
export function rangeStart(range: RangeId, now = Date.now()): number | null {
  const d = RANGE_DAYS[range];
  return d === null ? null : now - d * DAY_MS;
}

/** Filter the three stores to one trial (or all) and a date range. */
export function scopeData(
  data: { events: AppEvent[]; calls: CallRecord[]; referrals: Referral[] },
  nctId: string | null,
  range: RangeId,
  now = Date.now(),
) {
  const from = rangeStart(range, now);
  const ok = (id: string, iso: string) => (nctId === null || id === nctId) && (from === null || Date.parse(iso) >= from);
  return {
    events: data.events.filter((e) => ok(e.nctId, e.at)),
    calls: data.calls.filter((c) => ok(c.nctId, c.startedAt)),
    referrals: data.referrals.filter((r) => ok(r.nctId, r.createdAt)),
  };
}

/** Calls still in progress are not counted anywhere. */
export const endedCalls = (calls: CallRecord[]) => calls.filter((c) => c.status !== "in_progress");

/** Caller said yes to the consent prompt. Red-flag stops count as consented (a screen was under way). */
export function consentGiven(c: CallRecord): boolean {
  return c.toolCalls.some((t) => t.name === "consent") || c.status === "red_flag" || c.status === "completed";
}

/**
 * Caller answered the consent prompt (yes or no). Declined calls keep no
 * transcript, so the status itself is the evidence.
 */
export function disclosurePassed(c: CallRecord): boolean {
  return c.status === "consent_declined" || consentGiven(c);
}

/** Questioning reached its end and the engine decided (incl. a scripted stop on a confirmed fail). */
export const allCriteriaAnswered = (c: CallRecord) => c.status === "completed" && c.decision !== undefined;

/** A completed call the site will see as a referral. */
export const referralSent = (c: CallRecord) =>
  allCriteriaAnswered(c) && (c.decision === "LIKELY_ELIGIBLE" || c.decision === "NEEDS_SITE_REVIEW");

export const durationMs = (c: CallRecord): number | null => {
  if (!c.endedAt) return null;
  const d = Date.parse(c.endedAt) - Date.parse(c.startedAt);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A share; null when the denominator is 0 (shown as "—"). */
export type Ratio = { num: number; den: number; value: number | null };
export const ratio = (num: number, den: number): Ratio => ({ num, den, value: den ? num / den : null });

// --- Funnel (PRD §12) ----------------------------------------------------------

export type FunnelStepId =
  | "opened" | "started" | "disclosure" | "consent" | "answered" | "referred" | "accepted" | "scheduled";

export type FunnelStep = {
  id: FunnelStepId;
  label: string;
  count: number;
  /** Conversion from the previous step; null for the first step or when the previous is 0. */
  fromPrev: number | null;
};

export const FUNNEL_LABELS: Record<FunnelStepId, string> = {
  opened: "Link opened",
  started: "Call started",
  disclosure: "Disclosure passed",
  consent: "Consent given",
  answered: "All criteria answered",
  referred: "Referral sent",
  accepted: "Site accepted",
  scheduled: "Screening visit scheduled",
};

/**
 * Link opened and call started come from funnel events (never fewer than the
 * saved calls); later steps from the stored calls (in-progress ignored) and
 * their referrals. Accepted and scheduled
 * are counted only for referral-sent calls, so each step nests in the one before.
 */
export function computeFunnel(events: AppEvent[], calls: CallRecord[], referrals: Referral[]): FunnelStep[] {
  const ended = endedCalls(calls);
  const sent = ended.filter(referralSent);
  const refBy = new Map(referrals.map((r) => [r.callId, r]));
  const accepted = sent.filter((c) => refBy.get(c.id)?.review.state === "accepted");
  // A saved call proves a start, and a start proves a page open (calls saved
  // before event logging existed, or whose event write failed, still count).
  const startedIds = new Set(ended.map((c) => c.id));
  let startEventsWithoutId = 0;
  for (const e of events) {
    if (e.type !== "call_started") continue;
    if (e.callId) startedIds.add(e.callId);
    else startEventsWithoutId++;
  }
  const started = startedIds.size + startEventsWithoutId;
  const opened = Math.max(events.filter((e) => e.type === "call_page_opened").length, started);
  const counts: [FunnelStepId, number][] = [
    ["opened", opened],
    ["started", started],
    ["disclosure", ended.filter(disclosurePassed).length],
    ["consent", ended.filter(consentGiven).length],
    ["answered", ended.filter(allCriteriaAnswered).length],
    ["referred", sent.length],
    ["accepted", accepted.length],
    ["scheduled", accepted.filter((c) => refBy.get(c.id)?.followUp.state === "visit_scheduled").length],
  ];
  return counts.map(([id, count], i) => {
    const prev = i ? counts[i - 1][1] : 0;
    return { id, label: FUNNEL_LABELS[id], count, fromPrev: i && prev ? count / prev : null };
  });
}

// --- Criterion drop-off (PRD §12) ------------------------------------------------

export type DropOffRow = {
  criterionId: string;
  question: string;
  /** Calls whose agent asked this question at least once. */
  reached: number;
  fail: number;
  unsure: number;
  /** Reached it, then the call ended (hang-up, cap, red flag…) with no answer to it. */
  endedHere: number;
  failShare: number | null;
  unsureShare: number | null;
};

const askedIds = (c: CallRecord) =>
  new Set(
    c.toolCalls
      .filter((t) => t.name === "next_question")
      .map((t) => (t.args as { criterionId?: unknown } | null)?.criterionId)
      .filter((x): x is string => typeof x === "string"),
  );

/**
 * For each asked criterion of this script version, among calls on that version
 * that reached it: the share whose result was FAIL and UNSURE. Completed calls
 * use the stored rows; unfinished calls are scored from their answers with the
 * same engine rule, and an unanswered question counts as "ended here".
 * Sorted by FAIL + UNSURE share, highest first.
 */
export function computeDropOff(script: ScriptVersion, calls: CallRecord[]): DropOffRow[] {
  const mine = endedCalls(calls).filter((c) => c.scriptVersionId === script.id);
  const asked = script.criteria.filter((c) => c.mode === "ask");
  const rows = asked.map((crit, order) => {
    let reached = 0, fail = 0, unsure = 0, endedHere = 0;
    for (const call of mine) {
      if (!askedIds(call).has(crit.id)) continue;
      reached++;
      let result = call.rows?.find((r) => r.criterionId === crit.id)?.result;
      if (!result) {
        const answer = currentAnswers(call.answers).get(crit.id);
        if (!answer) {
          endedHere++;
          continue;
        }
        result = criterionResult(crit, answer, script.confidenceThreshold);
      }
      if (result === "FAIL") fail++;
      else if (result === "UNSURE") unsure++;
    }
    return {
      order,
      row: {
        criterionId: crit.id,
        question: crit.question.en,
        reached, fail, unsure, endedHere,
        failShare: reached ? fail / reached : null,
        unsureShare: reached ? unsure / reached : null,
      } satisfies DropOffRow,
    };
  });
  const score = (r: DropOffRow) => (r.reached ? (r.fail + r.unsure) / r.reached : -1);
  return rows.sort((a, b) => score(b.row) - score(a.row) || a.order - b.order).map((x) => x.row);
}

// --- PRD §3 metrics + G11 leading metrics ---------------------------------------------

export const HANGUP_MS = 30_000;

/** Site business hours: Mon–Fri 9:00–17:00 in the viewer's local time zone. */
export function outsideBusinessHours(iso: string): boolean {
  const d = new Date(iso);
  const day = d.getDay();
  const mins = d.getHours() * 60 + d.getMinutes();
  return day === 0 || day === 6 || mins < 9 * 60 || mins >= 17 * 60;
}

/** Ended without consent being given, less than 30 s after the disclosure started. */
export function hungUpAfterDisclosure(c: CallRecord): boolean {
  if (c.status !== "incomplete" && c.status !== "consent_declined") return false;
  const d = durationMs(c);
  return d !== null && d < HANGUP_MS;
}

export type Metrics = {
  /** North Star: accepted / (accepted + rejected) screen referrals. Target ≥ 70%. */
  acceptedRate: Ratio;
  /** Consent given → all criteria answered. Target ≥ 60%. */
  completionRate: Ratio;
  /** Median length of completed calls, ms. Target ≤ 6 min. */
  medianCallMs: number | null;
  medianCallN: number;
  /** Calls started outside Mon–Fri 9–17 local. Hypothesis ≥ 30%. */
  outsideHours: Ratio;
  /** Calls in Spanish or mixed. Tracked. */
  nonEnglish: Ratio;
  /** Hang-ups within 30 s of the disclosure, over all ended calls. Target ≤ 15%. */
  earlyHangup: Ratio;
  /** G11: referrals that opted in to be contacted. Hypothesis ≥ 80%. */
  contactOptIn: Ratio;
  /** G11: referral created → first logged contact attempt, median ms. */
  firstContactMs: number | null;
  firstContactN: number;
  /** Opted-in, accepted referrals with no attempt yet, and how long the oldest has waited. */
  awaitingContact: number;
  oldestAwaitingMs: number | null;
};

export const TARGETS = {
  acceptedRate: 0.7,
  completionRate: 0.6,
  medianCallMs: 6 * 60_000,
  outsideHours: 0.3,
  earlyHangup: 0.15,
  contactOptIn: 0.8,
} as const;

export function computeMetrics(calls: CallRecord[], referrals: Referral[], now = Date.now()): Metrics {
  const ended = endedCalls(calls);
  const consented = ended.filter(consentGiven);
  const completedDurations = ended.filter(allCriteriaAnswered).map(durationMs).filter((d): d is number => d !== null);

  const screens = referrals.filter((r) => r.kind === "screen");
  const reviewed = screens.filter((r) => r.review.state !== "pending");
  // Contact is only asked when the call ends Likely eligible / Needs site review.
  const askedContact = screens.filter((r) => r.engineDecision === "LIKELY_ELIGIBLE" || r.engineDecision === "NEEDS_SITE_REVIEW");

  const firstContact = screens
    .filter((r) => r.followUp.attempts.length > 0)
    .map((r) => Math.min(...r.followUp.attempts.map((a) => Date.parse(a.at))) - Date.parse(r.createdAt))
    .filter((d) => Number.isFinite(d) && d >= 0);
  const awaiting = screens.filter((r) => r.review.state === "accepted" && r.contact === "demo_discarded" && r.followUp.attempts.length === 0);
  const waits = awaiting.map((r) => now - Date.parse(r.createdAt)).filter((d) => Number.isFinite(d));

  return {
    acceptedRate: ratio(reviewed.filter((r) => r.review.state === "accepted").length, reviewed.length),
    completionRate: ratio(consented.filter(allCriteriaAnswered).length, consented.length),
    medianCallMs: median(completedDurations),
    medianCallN: completedDurations.length,
    outsideHours: ratio(ended.filter((c) => outsideBusinessHours(c.startedAt)).length, ended.length),
    nonEnglish: ratio(ended.filter((c) => c.language !== "en").length, ended.length),
    earlyHangup: ratio(ended.filter(hungUpAfterDisclosure).length, ended.length),
    contactOptIn: ratio(askedContact.filter((r) => r.contact === "demo_discarded").length, askedContact.length),
    firstContactMs: median(firstContact),
    firstContactN: firstContact.length,
    awaitingContact: awaiting.length,
    oldestAwaitingMs: waits.length ? Math.max(...waits) : null,
  };
}
