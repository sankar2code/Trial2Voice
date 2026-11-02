// Referrals: what a coordinator acts on (PRD §4 referral summary + P1
// coordinator dashboard; Addendum G2, G10, G11). Every action is attributed
// and written to the hash-chained audit log; nothing is changed silently.
import { db } from "./db";
import { appendAudit, RepoError, saveCall } from "./repo";
import { decideFromRows } from "../engine";
import { ruleJudge, llmJudge, type JudgeFlag } from "../quality/judge";
import type { CallRecord, Decision, RowResult } from "../call/types";
import type { ScriptVersion } from "../types";

export type FollowUpState = "new" | "attempted" | "reached" | "visit_scheduled" | "declined" | "not_a_fit" | "unreachable";
export type AttemptOutcome = "no_answer" | "left_voicemail" | "reached" | "wrong_number";
export const MAX_ATTEMPTS = 3;

export type Referral = {
  id: string; // = callId
  callId: string;
  nctId: string;
  scriptVersionId: string;
  createdAt: string;
  kind: "screen" | "red_flag";
  engineDecision: Decision | null; // null for red-flag stops
  respondent: CallRecord["respondent"];
  relationship?: CallRecord["relationship"];
  needsPatientPermission: boolean; // G10: proxy calls
  language: CallRecord["language"];
  nearestSite?: CallRecord["nearestSite"];
  contact?: CallRecord["contact"];
  contactPrefs?: CallRecord["contactPrefs"];
  rowOverrides: { criterionId: string; from: RowResult; to: RowResult; reason: string; at: string; by: string }[];
  decisionOverride?: { from: Decision; to: Decision; reason: string; at: string; by: string };
  review: { state: "pending" | "accepted" | "rejected"; reason?: string; at?: string; by?: string };
  followUp: { state: FollowUpState; attempts: { at: string; outcome: AttemptOutcome; voicemailLeft: boolean; by: string; note?: string }[] };
  judge: { rules: JudgeFlag[]; llm: JudgeFlag[]; llmStatus: "not_run" | "running" | "done" | "error"; llmError?: string };
  held: boolean; // judge flags keep it out of the queue until a person reviews (PRD §7)
  holdReleased?: { at: string; by: string; note: string };
};

const now = () => new Date().toISOString();

/** Rows after coordinator overrides (latest override per criterion wins). */
export function effectiveRows(call: CallRecord, r: Referral): { criterionId: string; result: RowResult; overridden: boolean }[] {
  const last = new Map<string, RowResult>();
  for (const o of r.rowOverrides) last.set(o.criterionId, o.to);
  return (call.rows ?? []).map((row) => ({ criterionId: row.criterionId, result: last.get(row.criterionId) ?? row.result, overridden: last.has(row.criterionId) }));
}

/** Decision the coordinator sees: an explicit override, else the engine re-run on effective rows. */
export function effectiveDecision(call: CallRecord, r: Referral, script: ScriptVersion): Decision | null {
  if (r.decisionOverride) return r.decisionOverride.to;
  if (r.kind === "red_flag" || !call.rows) return r.engineDecision;
  if (!r.rowOverrides.length) return r.engineDecision;
  return decideFromRows(effectiveRows(call, r), script.groups).decision;
}

/** Save a finished call; completed and red-flag calls become referrals with a rules judge pass. */
export async function completeCall(call: CallRecord, script: ScriptVersion): Promise<Referral | null> {
  await saveCall(call);
  if (call.status !== "completed" && call.status !== "red_flag") return null;
  const rules = ruleJudge(call, script);
  const r: Referral = {
    id: call.id,
    callId: call.id,
    nctId: call.nctId,
    scriptVersionId: call.scriptVersionId,
    createdAt: call.endedAt ?? now(),
    kind: call.status === "red_flag" ? "red_flag" : "screen",
    engineDecision: call.decision ?? null,
    respondent: call.respondent,
    relationship: call.relationship,
    needsPatientPermission: call.respondent === "proxy",
    language: call.language,
    nearestSite: call.nearestSite,
    contact: call.contact,
    contactPrefs: call.contactPrefs,
    rowOverrides: [],
    review: { state: "pending" },
    followUp: { state: "new", attempts: [] },
    judge: { rules, llm: [], llmStatus: "not_run" },
    held: rules.length > 0,
  };
  await db().referrals.put(r);
  await appendAudit("call agent", "referral.created", { id: r.id, kind: r.kind, decision: r.engineDecision, judgeFlags: rules.length, held: r.held }, r.nctId);
  return r;
}

/** Optional second pass with Claude (key mode). New flags hold the referral. */
export async function runLlmJudge(id: string, apiKey: string, model?: string): Promise<void> {
  const r = await db().referrals.get(id);
  const call = await db().calls.get(id);
  const script = r && (await db().scripts.get(r.scriptVersionId));
  if (!r || !call || !script) return;
  await db().referrals.update(id, { judge: { ...r.judge, llmStatus: "running" } });
  try {
    const flags = await llmJudge(call, script, apiKey, model);
    const latest = (await db().referrals.get(id))!;
    const held = latest.held || (flags.length > 0 && !latest.holdReleased);
    await db().referrals.update(id, { judge: { ...latest.judge, llm: flags, llmStatus: "done", llmError: undefined }, held });
    await appendAudit("judge", "referral.llm_judged", { id, flags: flags.length, held }, r.nctId);
  } catch (e) {
    const latest = (await db().referrals.get(id))!;
    await db().referrals.update(id, { judge: { ...latest.judge, llmStatus: "error", llmError: e instanceof Error ? e.message : "Judge failed" } });
  }
}

async function load(id: string) {
  const r = await db().referrals.get(id);
  if (!r) throw new RepoError("Referral not found.");
  return r;
}

const needReason = (reason: string) => {
  if (!reason.trim()) throw new RepoError("A reason is required.");
  return reason.trim();
};

export async function releaseHold(id: string, note: string, actor: string) {
  const r = await load(id);
  const n = needReason(note);
  await db().referrals.update(id, { held: false, holdReleased: { at: now(), by: actor, note: n } });
  await appendAudit(actor, "referral.hold_released", { id, note: n, flags: r.judge.rules.length + r.judge.llm.length }, r.nctId);
}

export async function reviewReferral(id: string, action: "accepted" | "rejected", reason: string, actor: string) {
  const r = await load(id);
  if (r.held) throw new RepoError("Review the quality flags before accepting or rejecting.");
  if (r.kind === "red_flag") throw new RepoError("Red-flag calls aren't referrals; mark them handled instead.");
  const why = action === "rejected" ? needReason(reason) : reason.trim();
  await db().referrals.update(id, { review: { state: action, reason: why || undefined, at: now(), by: actor } });
  await appendAudit(actor, `referral.${action}`, { id, reason: why || null }, r.nctId);
}

export async function reopenReferral(id: string, reason: string, actor: string) {
  const r = await load(id);
  const why = needReason(reason);
  await db().referrals.update(id, { review: { state: "pending" } });
  await appendAudit(actor, "referral.reopened", { id, previous: r.review, reason: why }, r.nctId);
}

export async function overrideRow(id: string, criterionId: string, from: RowResult, to: RowResult, reason: string, actor: string) {
  const r = await load(id);
  if (from === to) throw new RepoError("Pick a different result.");
  const why = needReason(reason);
  const o = { criterionId, from, to, reason: why, at: now(), by: actor };
  await db().referrals.update(id, { rowOverrides: [...r.rowOverrides, o] });
  await appendAudit(actor, "referral.row_overridden", { id, ...o }, r.nctId);
}

export async function overrideDecision(id: string, from: Decision, to: Decision, reason: string, actor: string) {
  const r = await load(id);
  if (from === to) throw new RepoError("Pick a different status.");
  const why = needReason(reason);
  const o = { from, to, reason: why, at: now(), by: actor };
  await db().referrals.update(id, { decisionOverride: o });
  await appendAudit(actor, "referral.decision_overridden", { id, ...o }, r.nctId);
}

/** G11 §7: log a contact attempt; three misses → unreachable. */
export async function logAttempt(id: string, outcome: AttemptOutcome, voicemailLeft: boolean, actor: string, note?: string) {
  const r = await load(id);
  if (voicemailLeft && r.contactPrefs?.voicemailOk === false) throw new RepoError("The caller asked us not to leave a voicemail about the study.");
  const attempts = [...r.followUp.attempts, { at: now(), outcome, voicemailLeft, by: actor, note: note?.trim() || undefined }];
  const misses = attempts.filter((a) => a.outcome === "no_answer" || a.outcome === "left_voicemail").length;
  const state: FollowUpState =
    outcome === "reached" ? "reached" : outcome === "wrong_number" ? "unreachable" : misses >= MAX_ATTEMPTS ? "unreachable" : "attempted";
  await db().referrals.update(id, { followUp: { state, attempts } });
  await appendAudit(actor, "referral.contact_attempt", { id, outcome, voicemailLeft, state }, r.nctId);
}

export async function setFollowUp(id: string, state: Extract<FollowUpState, "visit_scheduled" | "declined" | "not_a_fit">, actor: string) {
  const r = await load(id);
  if (r.followUp.state !== "reached" && r.followUp.state !== "visit_scheduled") throw new RepoError("Log a reached contact attempt first.");
  await db().referrals.update(id, { followUp: { ...r.followUp, state } });
  await appendAudit(actor, "referral.follow_up", { id, state }, r.nctId);
}
