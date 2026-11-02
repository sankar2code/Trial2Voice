import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Trial2VoiceDB, db, useDatabase } from "./db";
import { RepoError, saveNewDraft, saveTrial, verifyAuditChain } from "./repo";
import {
  completeCall, effectiveDecision, logAttempt, overrideDecision, overrideRow, releaseHold, reviewReferral, setFollowUp,
} from "./referrals";
import { mapStudy } from "../ctgov";
import { splitEligibility } from "../bullets";
import { BuilderOutput } from "../script/builder";
import { assembleDraft } from "../script/assemble";
import { CallSession } from "../call/session";
import { keywordInterpreter } from "../call/parse";
import type { ScriptVersion, Trial } from "../types";

const DEMO = path.join(import.meta.dirname, "..", "..", "data", "demo");
const trial: Trial = mapStudy(JSON.parse(fs.readFileSync(path.join(DEMO, "NCT07599982.registry.json"), "utf8")));
const output = BuilderOutput.parse(JSON.parse(fs.readFileSync(path.join(DEMO, "NCT07599982.script.json"), "utf8")));
const script: ScriptVersion = {
  ...assembleDraft({ trial, bullets: splitEligibility(trial.eligibilityText), output, version: 1, createdBy: "t" }),
  status: "locked",
  approval: { approver: "t", irbRef: "t", date: "x", lockedAt: "x", sha256: "f".repeat(64) },
};
const asked = script.criteria.filter((c) => c.mode === "ask");
const pass = (i: number) => {
  const c = asked[i];
  if (c.answerType === "number") return "49";
  const r = c.rule as { op: string; value: boolean };
  return (r.op === "eq" ? r.value : !r.value) ? "yes" : "no";
};

async function likelyCall(opts: { voicemail?: "yes" | "no" } = {}) {
  const s = new CallSession({ trial, script, interpreter: keywordInterpreter, lang: "en", mode: "text" });
  s.start();
  for (const u of ["yes", "myself"]) await s.hear(u);
  for (let i = 0; i < asked.length; i++) await s.hear(pass(i));
  for (const u of ["no", "yes", "Sam", "yes", "555 555 0100", "yes", opts.voicemail ?? "yes", "morning"]) await s.hear(u);
  return s.record;
}

let n = 0;
beforeEach(async () => {
  useDatabase(new Trial2VoiceDB(`ref-${++n}`));
  await saveTrial(trial, "t", "fixture");
  await saveNewDraft({ ...script, status: "draft", approval: null }, "t", "fixture");
  await db().scripts.put(script);
});

describe("referrals", () => {
  test("a completed call becomes a pending, unheld referral with prefs but no identity", async () => {
    const call = await likelyCall();
    const r = (await completeCall(call, script))!;
    expect(r.engineDecision).toBe("LIKELY_ELIGIBLE");
    expect(r.held).toBe(false);
    expect(r.judge.rules).toEqual([]);
    expect(r.contactPrefs).toEqual({ voicemailOk: true, bestTime: "morning", language: "en" });
    expect(JSON.stringify(await db().referrals.get(r.id))).not.toMatch(/Sam\b/);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  test("declined consent saves the call but makes no referral", async () => {
    const s = new CallSession({ trial, script, interpreter: keywordInterpreter, lang: "en", mode: "text" });
    s.start();
    await s.hear("no");
    expect(await completeCall(s.record, script)).toBeNull();
    expect(await db().calls.get(s.record.id)).toBeDefined();
  });

  test("judge flags hold the referral until a person releases it", async () => {
    const call = await likelyCall();
    call.transcript.push({ role: "agent", text: "This treatment is very safe.", lang: "en", t: 1, kind: "close" });
    const r = (await completeCall(call, script))!;
    expect(r.held).toBe(true);
    await expect(reviewReferral(r.id, "accepted", "", "coord")).rejects.toThrow(/quality flags/);
    await expect(releaseHold(r.id, " ", "coord")).rejects.toThrow(RepoError);
    await releaseHold(r.id, "Read the call; injected test line", "coord");
    await reviewReferral(r.id, "accepted", "", "coord");
    expect((await db().referrals.get(r.id))!.review.state).toBe("accepted");
  });

  test("rejecting needs a reason", async () => {
    const r = (await completeCall(await likelyCall(), script))!;
    await expect(reviewReferral(r.id, "rejected", "", "coord")).rejects.toThrow(/reason/);
    await reviewReferral(r.id, "rejected", "Duplicate of an earlier call", "coord");
    expect((await db().referrals.get(r.id))!.review).toMatchObject({ state: "rejected", reason: "Duplicate of an earlier call", by: "coord" });
  });

  test("a row override re-runs the engine; a status override wins outright", async () => {
    const call = await likelyCall();
    const r = (await completeCall(call, script))!;
    await overrideRow(r.id, asked[1].id, "PASS", "FAIL", "Site records show diagnosis under 6 months", "coord");
    let latest = (await db().referrals.get(r.id))!;
    expect(effectiveDecision(call, latest, script)).toBe("NOT_ELIGIBLE");
    await overrideRow(r.id, asked[1].id, "FAIL", "UNSURE", "Records unclear", "coord");
    latest = (await db().referrals.get(r.id))!;
    expect(effectiveDecision(call, latest, script)).toBe("NEEDS_SITE_REVIEW");
    await overrideDecision(r.id, "NEEDS_SITE_REVIEW", "LIKELY_ELIGIBLE", "PI reviewed by phone", "coord");
    latest = (await db().referrals.get(r.id))!;
    expect(effectiveDecision(call, latest, script)).toBe("LIKELY_ELIGIBLE");
    expect(latest.rowOverrides).toHaveLength(2);
  });

  test("three missed attempts → unreachable; reached → visit scheduled", async () => {
    const a = (await completeCall(await likelyCall(), script))!;
    await reviewReferral(a.id, "accepted", "", "coord");
    await logAttempt(a.id, "no_answer", false, "coord");
    await logAttempt(a.id, "left_voicemail", true, "coord");
    expect((await db().referrals.get(a.id))!.followUp.state).toBe("attempted");
    await logAttempt(a.id, "no_answer", false, "coord");
    expect((await db().referrals.get(a.id))!.followUp.state).toBe("unreachable");

    const b = (await completeCall(await likelyCall(), script))!;
    await expect(setFollowUp(b.id, "visit_scheduled", "coord")).rejects.toThrow(/reached/);
    await logAttempt(b.id, "reached", false, "coord");
    await setFollowUp(b.id, "visit_scheduled", "coord");
    expect((await db().referrals.get(b.id))!.followUp.state).toBe("visit_scheduled");
  });

  test("no voicemail when the caller said no", async () => {
    const r = (await completeCall(await likelyCall({ voicemail: "no" }), script))!;
    await expect(logAttempt(r.id, "left_voicemail", true, "coord")).rejects.toThrow(/voicemail/);
  });
});
