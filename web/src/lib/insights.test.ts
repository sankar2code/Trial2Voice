import { describe, expect, test } from "vitest";
import {
  computeDropOff, computeFunnel, computeMetrics, consentGiven, disclosurePassed, hungUpAfterDisclosure,
  median, outsideBusinessHours, scopeData,
} from "./insights";
import type { AppEvent } from "./store/db";
import type { Answer, CallRecord, Decision, RowResult, ToolCall } from "./call/types";
import type { Referral } from "./store/referrals";
import type { Criterion, ScriptVersion } from "./types";

// --- fixtures ------------------------------------------------------------------

const T0 = Date.parse("2026-10-20T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
/** Local wall-clock time (the business-hours rule uses the viewer's zone). */
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

const tc = (name: string, args: unknown = {}): ToolCall => ({ name, args, result: null, ms: 0, t: 0 });
const asked = (...ids: string[]) => ids.map((id) => tc("next_question", { criterionId: id, scriptVersion: "NCT1-v1" }));

let n = 0;
function call(over: Partial<CallRecord> & { durS?: number } = {}): CallRecord {
  const { durS = 240, ...rest } = over;
  const startedAt = rest.startedAt ?? iso(T0);
  return {
    id: `c${++n}`,
    nctId: "NCT1",
    scriptVersionId: "NCT1-v1",
    scriptSha256: "",
    startedAt,
    endedAt: iso(Date.parse(startedAt) + durS * 1000),
    language: "en",
    mode: "text",
    interpreter: "rules",
    status: "completed",
    transcript: [{ role: "agent", text: "hi", lang: "en", t: 0 }],
    toolCalls: [tc("next_question", { step: "disclosure" }), tc("consent")],
    answers: [],
    demo: true,
    ...rest,
  };
}
const completed = (decision: Decision, over: Partial<CallRecord> & { durS?: number } = {}) => call({ status: "completed", decision, ...over });
const declined = (durS = 20) => call({ status: "consent_declined", transcript: [], toolCalls: [tc("next_question", { step: "disclosure" })], durS });

function ref(c: CallRecord, over: Partial<Referral> = {}): Referral {
  return {
    id: c.id, callId: c.id, nctId: c.nctId, scriptVersionId: c.scriptVersionId,
    createdAt: c.endedAt ?? c.startedAt,
    kind: c.status === "red_flag" ? "red_flag" : "screen",
    engineDecision: c.decision ?? null,
    respondent: "self", needsPatientPermission: false, language: c.language,
    contact: "demo_discarded",
    rowOverrides: [],
    review: { state: "pending" },
    followUp: { state: "new", attempts: [] },
    judge: { rules: [], llm: [], llmStatus: "not_run" },
    held: false,
    ...over,
  };
}
const ev = (type: AppEvent["type"], at = iso(T0), nctId = "NCT1"): AppEvent => ({ type, at, nctId });

const crit = (id: string, over: Partial<Criterion> = {}): Criterion => ({
  id, kind: "inclusion", bulletIds: [], sourceText: "", mode: "ask",
  question: { en: `Question ${id}?`, es: `¿Pregunta ${id}?` }, questionProxy: { en: "", es: "" }, altPhrasings: { en: [], es: [] },
  answerType: "yes_no", unit: null, enumOptions: [], rule: { op: "eq", value: true },
  readBackText: { en: "", es: "" }, readBackTextProxy: { en: "", es: "" },
  groupId: null, registryDerived: false, siteCheckNote: "", ...over,
});
const script: ScriptVersion = {
  id: "NCT1-v1", nctId: "NCT1", version: 1, createdAt: iso(T0), createdBy: "pre-built", basedOn: null,
  sourceLastUpdate: "", sourceEligibilityText: "", bullets: [],
  criteria: [crit("A"), crit("B"), crit("C"), crit("S", { mode: "confirm_at_site", rule: null })],
  groups: [], glossary: [], confidenceThreshold: 0.8, stopOnConfirmedFail: true, verbatimOnly: true,
  status: "locked", approval: null,
};
const rows = (r: Record<string, RowResult>) => Object.entries(r).map(([criterionId, result]) => ({ criterionId, result }));
const answer = (criterionId: string, value: Answer["value"], over: Partial<Answer> = {}): Answer => ({
  id: `a${++n}`, criterionId, questionSpoken: "", callerWords: "", value, confidence: 0.95, readBackConfirmed: true, at: 0, ...over,
});

// --- definitions -------------------------------------------------------------------

describe("call definitions", () => {
  test("consent_declined (empty transcript) passes disclosure but not consent", () => {
    const c = declined();
    expect(c.transcript).toEqual([]);
    expect(disclosurePassed(c)).toBe(true);
    expect(consentGiven(c)).toBe(false);
  });
  test("incomplete with no consent tool call passed neither", () => {
    const c = call({ status: "incomplete", toolCalls: [tc("next_question", { step: "disclosure" })], transcript: [] });
    expect(disclosurePassed(c)).toBe(false);
    expect(consentGiven(c)).toBe(false);
  });
  test("red_flag counts as consent given even without the tool call", () => {
    expect(consentGiven(call({ status: "red_flag", toolCalls: [] }))).toBe(true);
  });
  test("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  test("business hours: Mon–Fri 9:00–17:00 local", () => {
    expect(outsideBusinessHours(local(2026, 10, 19, 9, 0))).toBe(false); // Mon 9:00
    expect(outsideBusinessHours(local(2026, 10, 19, 16, 59))).toBe(false);
    expect(outsideBusinessHours(local(2026, 10, 19, 17, 0))).toBe(true); // 17:00 is closed
    expect(outsideBusinessHours(local(2026, 10, 19, 8, 59))).toBe(true);
    expect(outsideBusinessHours(local(2026, 10, 24, 11, 0))).toBe(true); // Saturday
    expect(outsideBusinessHours(local(2026, 10, 25, 11, 0))).toBe(true); // Sunday
  });
  test("hang-up within 30 s of disclosure", () => {
    expect(hungUpAfterDisclosure(declined(29))).toBe(true);
    expect(hungUpAfterDisclosure(declined(30))).toBe(false);
    expect(hungUpAfterDisclosure(call({ status: "incomplete", durS: 10 }))).toBe(true);
    expect(hungUpAfterDisclosure(call({ status: "capped", durS: 10 }))).toBe(false);
    expect(hungUpAfterDisclosure(completed("NOT_ELIGIBLE", { durS: 10 }))).toBe(false);
    expect(hungUpAfterDisclosure(call({ status: "incomplete", endedAt: undefined }))).toBe(false);
  });
});

// --- funnel ----------------------------------------------------------------------------

describe("computeFunnel", () => {
  test("saved calls without events still count as started and opened (no step above 100%)", () => {
    const calls = [completed("NOT_ELIGIBLE"), declined()];
    const f = computeFunnel([ev("call_page_opened"), { ...ev("call_started"), callId: calls[0].id }], calls, []);
    expect(f.slice(0, 3).map((s) => s.count)).toEqual([2, 2, 2]);
    expect(f.every((s) => s.fromPrev === null || s.fromPrev <= 1)).toBe(true);
  });

  test("empty data: zeros and no conversions", () => {
    const f = computeFunnel([], [], []);
    expect(f.map((s) => s.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(f.every((s) => s.fromPrev === null)).toBe(true);
  });

  test("counts every step and nests accepted/scheduled under referral sent", () => {
    const likely = completed("LIKELY_ELIGIBLE");
    const review = completed("NEEDS_SITE_REVIEW");
    const review2 = completed("NEEDS_SITE_REVIEW");
    const notElig = completed("NOT_ELIGIBLE");
    const red = call({ status: "red_flag", toolCalls: [tc("consent")] });
    const minor = call({ status: "minor_self", transcript: [] });
    const dec = declined();
    const noAnswer = call({ status: "incomplete", toolCalls: [tc("next_question", { step: "disclosure" })], transcript: [] });
    const live = call({ status: "in_progress" }); // ignored
    const calls = [likely, review, review2, notElig, red, minor, dec, noAnswer, live];
    const referrals = [
      ref(likely, { review: { state: "accepted" }, followUp: { state: "visit_scheduled", attempts: [] } }),
      ref(review, { review: { state: "accepted" }, followUp: { state: "attempted", attempts: [] } }),
      ref(review2, { review: { state: "rejected", reason: "x" } }),
      ref(notElig, { review: { state: "accepted" } }), // accepted not-eligible is not a sent referral
      ref(red),
    ];
    // 10 start events: 8 ended calls, the live one, and one call that never got saved.
    const startEvents = [...calls.map((c) => ({ ...ev("call_started"), callId: c.id })), { ...ev("call_started"), callId: "lost" }];
    const events = [...Array(12)].map(() => ev("call_page_opened")).concat(startEvents);
    const f = computeFunnel(events, calls, referrals);
    expect(f.map((s) => [s.id, s.count])).toEqual([
      ["opened", 12], ["started", 10], ["disclosure", 7], ["consent", 6], ["answered", 4], ["referred", 3], ["accepted", 2], ["scheduled", 1],
    ]);
    expect(f[0].fromPrev).toBeNull();
    expect(f[1].fromPrev).toBeCloseTo(10 / 12);
    expect(f[3].fromPrev).toBeCloseTo(6 / 7);
    expect(f[4].fromPrev).toBeCloseTo(4 / 6); // red_flag and minor_self consented but didn't finish
    expect(f[7].fromPrev).toBeCloseTo(1 / 2);
  });
});

// --- drop-off ---------------------------------------------------------------------------

describe("computeDropOff", () => {
  test("shares among calls that reached each question; sorted by FAIL + UNSURE", () => {
    const calls = [
      // Completed, all asked: A pass, B unsure, C pass.
      completed("NEEDS_SITE_REVIEW", { toolCalls: asked("A", "B", "C"), rows: rows({ A: "PASS", B: "UNSURE", C: "PASS", S: "SITE_CHECK" }) }),
      // Stopped on a confirmed fail at A: B and C rows are UNSURE but were never asked.
      completed("NOT_ELIGIBLE", { toolCalls: asked("A"), rows: rows({ A: "FAIL", B: "UNSURE", C: "UNSURE", S: "SITE_CHECK" }) }),
      // Hung up at B after answering A (no rows: scored from answers).
      call({ status: "incomplete", toolCalls: asked("A", "B"), answers: [answer("A", true)] }),
      // Capped after an unsure B.
      call({ status: "capped", toolCalls: asked("A", "B"), answers: [answer("A", true), answer("B", "UNSURE")] }),
      // Other script version and an in-progress call: ignored.
      completed("NOT_ELIGIBLE", { scriptVersionId: "NCT1-v2", toolCalls: asked("A"), rows: rows({ A: "FAIL" }) }),
      call({ status: "in_progress", toolCalls: asked("A"), answers: [answer("A", false)] }),
    ];
    const d = computeDropOff(script, calls);
    expect(d.map((r) => r.criterionId)).toEqual(["B", "A", "C"]); // site-check row S is not asked
    const [b, a, c] = d;
    expect(b).toMatchObject({ question: "Question B?", reached: 3, fail: 0, unsure: 2, endedHere: 1 });
    expect(b.unsureShare).toBeCloseTo(2 / 3);
    expect(a).toMatchObject({ reached: 4, fail: 1, unsure: 0, endedHere: 0, failShare: 0.25, unsureShare: 0 });
    expect(c).toMatchObject({ reached: 1, fail: 0, unsure: 0, failShare: 0, unsureShare: 0 });
  });

  test("unconfirmed or low-confidence fail on an unfinished call scores UNSURE (engine rule)", () => {
    const calls = [
      call({ status: "red_flag", toolCalls: asked("A", "B"), answers: [answer("A", false, { readBackConfirmed: false }), answer("B", false, { confidence: 0.5 })] }),
      call({ status: "incomplete", toolCalls: asked("A"), answers: [answer("A", false)] }),
    ];
    const d = computeDropOff(script, calls);
    const a = d.find((r) => r.criterionId === "A")!;
    expect(a).toMatchObject({ reached: 2, fail: 1, unsure: 1 });
    expect(d.find((r) => r.criterionId === "B")).toMatchObject({ reached: 1, unsure: 1 });
  });

  test("questions nobody reached show null shares and sort last in script order", () => {
    const d = computeDropOff(script, []);
    expect(d.map((r) => r.criterionId)).toEqual(["A", "B", "C"]);
    expect(d.every((r) => r.reached === 0 && r.failShare === null && r.unsureShare === null)).toBe(true);
  });
});

// --- metrics -----------------------------------------------------------------------------

describe("computeMetrics", () => {
  test("no data: every metric empty", () => {
    const m = computeMetrics([], []);
    expect(m.acceptedRate.value).toBeNull();
    expect(m.completionRate.value).toBeNull();
    expect(m.medianCallMs).toBeNull();
    expect(m.outsideHours.value).toBeNull();
    expect(m.nonEnglish.value).toBeNull();
    expect(m.earlyHangup.value).toBeNull();
    expect(m.contactOptIn.value).toBeNull();
    expect(m.firstContactMs).toBeNull();
    expect(m.oldestAwaitingMs).toBeNull();
  });

  test("all §3 and G11 metrics", () => {
    const now = T0 + 10 * 3_600_000;
    const weekday = local(2026, 10, 20, 10); // Tue 10:00
    const evening = local(2026, 10, 20, 19); // Tue 19:00
    const sat = local(2026, 10, 24, 10);
    const likely = completed("LIKELY_ELIGIBLE", { durS: 240, startedAt: weekday });
    const review = completed("NEEDS_SITE_REVIEW", { durS: 360, startedAt: evening, language: "es" });
    const review2 = completed("NEEDS_SITE_REVIEW", { durS: 480, startedAt: weekday, language: "mixed" });
    const notElig = completed("NOT_ELIGIBLE", { durS: 120, startedAt: sat });
    const red = call({ status: "red_flag", durS: 90, startedAt: weekday });
    const capped = call({ status: "capped", durS: 720, startedAt: weekday });
    const dec = declined(10);
    const decSlow = declined(45);
    const hangup = call({ status: "incomplete", toolCalls: [], transcript: [], durS: 15 });
    const live = call({ status: "in_progress", startedAt: sat, language: "es" });
    const calls = [likely, review, review2, notElig, red, capped, dec, decSlow, hangup, live];

    const at = (r: Referral, mins: number) => iso(Date.parse(r.createdAt) + mins * 60_000);
    const rLikely = ref(likely, { review: { state: "accepted" } });
    rLikely.followUp = { state: "reached", attempts: [{ at: at(rLikely, 90), outcome: "reached", voicemailLeft: false, by: "c" }] };
    const rReview = ref(review, { review: { state: "accepted" }, contact: "no_contact" });
    rReview.followUp = {
      state: "attempted",
      attempts: [
        { at: at(rReview, 60), outcome: "no_answer", voicemailLeft: false, by: "c" },
        { at: at(rReview, 30), outcome: "no_answer", voicemailLeft: false, by: "c" }, // earliest wins
      ],
    };
    const rReview2 = ref(review2, { review: { state: "accepted" } }); // opted in, no attempt yet
    const rNot = ref(notElig, { review: { state: "rejected", reason: "x" }, contact: undefined });
    const rRed = ref(red, { contact: undefined });
    const m = computeMetrics(calls, [rLikely, rReview, rReview2, rNot, rRed], now);

    // North Star: 3 accepted of 4 reviewed screens (red flag excluded).
    expect(m.acceptedRate).toEqual({ num: 3, den: 4, value: 0.75 });
    // Consented: 4 completed + red_flag + capped = 6; finished: 4.
    expect(m.completionRate).toMatchObject({ num: 4, den: 6 });
    // Completed durations 120, 240, 360, 480 s → median 300 s.
    expect(m.medianCallMs).toBe(300_000);
    expect(m.medianCallN).toBe(4);
    // Ended: 9. Outside hours: evening + Saturday, plus the 3 fixture calls at T0 if T0 is outside hours locally.
    const t0Outside = outsideBusinessHours(iso(T0)) ? 3 : 0;
    expect(m.outsideHours).toMatchObject({ num: 2 + t0Outside, den: 9 });
    expect(m.nonEnglish).toMatchObject({ num: 2, den: 9 });
    // Declined in 10 s + incomplete in 15 s; declined in 45 s doesn't count.
    expect(m.earlyHangup).toMatchObject({ num: 2, den: 9 });
    // Contact asked on 3 (likely + 2 review); opted in: 2.
    expect(m.contactOptIn).toMatchObject({ num: 2, den: 3 });
    // First attempts: 90 min and 30 min → median 60 min.
    expect(m.firstContactMs).toBe(60 * 60_000);
    expect(m.firstContactN).toBe(2);
    expect(m.awaitingContact).toBe(1);
    expect(m.oldestAwaitingMs).toBe(now - Date.parse(rReview2.createdAt));
  });
});

// --- scoping ------------------------------------------------------------------------------

describe("scopeData", () => {
  test("filters by trial and date range", () => {
    const now = T0;
    const old = iso(T0 - 10 * 86_400_000);
    const a = call({ startedAt: iso(T0 - 3600_000) });
    const b = call({ startedAt: old });
    const c = call({ nctId: "NCT2" });
    const data = { events: [ev("call_started"), ev("call_started", old), ev("call_started", iso(T0), "NCT2")], calls: [a, b, c], referrals: [ref(a), ref(b), ref(c)] };
    const week = scopeData(data, "NCT1", "7d", now);
    expect(week.calls.map((x) => x.id)).toEqual([a.id]);
    expect(week.events).toHaveLength(1);
    expect(week.referrals.map((r) => r.id)).toEqual([a.id]);
    expect(scopeData(data, "NCT1", "all", now).calls).toHaveLength(2);
    expect(scopeData(data, null, "30d", now).calls).toHaveLength(3);
  });
});
