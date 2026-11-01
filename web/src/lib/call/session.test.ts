// End-to-end call scenarios in text mode, on the real demo scripts, with the
// keyword interpreter. Covers PRD §7/§13 and Addendum G2, G4–G7, G9–G11.
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapStudy } from "../ctgov";
import { splitEligibility } from "../bullets";
import { BuilderOutput } from "../script/builder";
import { assembleDraft } from "../script/assemble";
import type { Criterion, ScriptVersion, Trial } from "../types";
import { CallSession, MAX_CALL_MS, type Turn } from "./session";
import { keywordInterpreter } from "./parse";
import type { Interpreter, Lang } from "./types";

const DEMO = path.join(import.meta.dirname, "..", "..", "data", "demo");

function load(id: string): { trial: Trial; script: ScriptVersion } {
  const trial = mapStudy(JSON.parse(fs.readFileSync(path.join(DEMO, `${id}.registry.json`), "utf8")));
  const output = BuilderOutput.parse(JSON.parse(fs.readFileSync(path.join(DEMO, `${id}.script.json`), "utf8")));
  const draft = assembleDraft({ trial, bullets: splitEligibility(trial.eligibilityText), output, version: 1, createdBy: "test" });
  return { trial, script: { ...draft, status: "locked", approval: { approver: "t", irbRef: "t", date: "2026-11-01", lockedAt: "x", sha256: "f".repeat(64) } } };
}
const MODIUS = load("NCT07599982");
const OBOE = load("NCT05332067");

const asked = (s: ScriptVersion) => s.criteria.filter((c) => c.mode === "ask");

/** An answer the rule accepts. */
function pass(c: Criterion): string {
  const r = c.rule!;
  if (c.answerType === "yes_no") {
    const v = (r as { value: boolean }).value;
    return (r.op === "eq" ? v : !v) ? "yes" : "no";
  }
  if (c.answerType === "months_ago") return "never";
  if (c.answerType === "enum") return r.op === "in" ? r.values[0] : String((r as { value: string }).value);
  if (r.op === "between") return String(Math.round((r.min + r.max) / 2));
  if (r.op === "gte" || r.op === "gt") return String(r.value + 5);
  return String(Math.max(0, (r as { value: number }).value - 1));
}
/** An answer the rule rejects (yes/no only). */
const failYesNo = (c: Criterion) => (pass(c) === "yes" ? "no" : "yes");

class Clock {
  t = 1_800_000_000_000;
  now = () => this.t;
}

function session(which = MODIUS, o: { interpreter?: Interpreter; lang?: Lang; clock?: Clock } = {}) {
  return new CallSession({ trial: which.trial, script: which.script, interpreter: o.interpreter ?? keywordInterpreter, fallback: keywordInterpreter, lang: o.lang ?? "en", mode: "text", now: o.clock?.now });
}

async function say(s: CallSession, ...utterances: string[]): Promise<Turn> {
  let last: Turn = { lines: [], ended: s.ended, progress: s.progress() };
  for (const u of utterances) last = await s.hear(u);
  return last;
}
const lastText = (t: Turn) => t.lines.map((l) => l.text).join(" ");
const agentLines = (s: CallSession) => s.record.transcript.filter((e) => e.role === "agent").map((e) => e.text);

async function answerAll(s: CallSession, script: ScriptVersion, from = 0, override: Record<string, string[]> = {}) {
  let t: Turn | undefined;
  for (const c of asked(script).slice(from)) t = await say(s, ...(override[c.id] ?? [pass(c)]));
  return t!;
}

const CONTACT_OK = ["yes", "Sam", "yes", "555 555 0100", "yes", "yes", "morning"];

describe("full calls", () => {
  test("eligible caller → likely, contact captured but not stored, nothing says 'eligible'", async () => {
    const s = session();
    expect(s.start().lines[0].text).toMatch(/AI assistant for the MODIUS study/);
    await say(s, "yes", "myself");
    await answerAll(s, MODIUS.script);
    await say(s, "no"); // closing review
    const end = await say(s, ...CONTACT_OK);
    expect(end.ended).toBe(true);
    expect(s.record.status).toBe("completed");
    expect(s.record.decision).toBe("LIKELY_ELIGIBLE");
    expect(s.record.contact).toBe("demo_discarded");
    expect(lastText(end)).toMatch(/you may be a fit/);
    const all = JSON.stringify(s.record);
    expect(all).not.toMatch(/Sam\b/);
    expect(all).not.toMatch(/555 555 0100|5555550100/);
    expect(agentLines(s).join(" ")).not.toMatch(/\beligib|\belegib/i);
  });

  test("confirmed screen-out → not a match, no contact capture", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "for me");
    const pump = asked(MODIUS.script).findIndex((c) => c.id === "EX-01");
    await answerAll(s, { ...MODIUS.script, criteria: asked(MODIUS.script).slice(0, pump) });
    const rb = await say(s, failYesNo(asked(MODIUS.script)[pump]));
    expect(rb.lines[0].kind).toBe("readback");
    await say(s, "yes");
    await answerAll(s, MODIUS.script, pump + 1);
    const end = await say(s, "no");
    expect(s.record.decision).toBe("NOT_ELIGIBLE");
    expect(lastText(end)).toMatch(/may not be a match/);
    expect(s.record.contact).toBeUndefined();
    expect(s.record.rows?.find((r) => r.criterionId === "EX-01")?.result).toBe("FAIL");
  });

  test("read-back denied twice → Unsure → needs site review (G2)", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "myself");
    const qs = asked(MODIUS.script);
    const pump = qs.findIndex((c) => c.id === "EX-01");
    await answerAll(s, { ...MODIUS.script, criteria: qs.slice(0, pump) });
    await say(s, "yes"); // would fail → read-back
    const again = await say(s, "no"); // denies → re-asked
    expect(again.lines.map((l) => l.kind)).toEqual(["fixed:ask_again", "question"]);
    await say(s, "yes", "no"); // fails again, denies again → Unsure
    await answerAll(s, MODIUS.script, pump + 1);
    await say(s, "no", "no"); // review, decline contact
    expect(s.record.decision).toBe("NEEDS_SITE_REVIEW");
    expect(s.record.rows?.find((r) => r.criterionId === "EX-01")?.result).toBe("UNSURE");
  });

  test("Spanish call uses Spanish questions", async () => {
    const s = session(MODIUS, { lang: "es" });
    expect(s.start().lines[0].text).toMatch(/^Hola/);
    const t = await say(s, "sí", "yo mismo");
    expect(lastText(t)).toBe(asked(MODIUS.script)[0].question.es);
  });
});

describe("consent and storage (G5)", () => {
  test("declining consent stores no transcript", async () => {
    const s = session();
    s.start();
    const t = await say(s, "no");
    expect(t.ended).toBe(true);
    expect(s.record.status).toBe("consent_declined");
    expect(s.record.transcript).toEqual([]);
  });
  test("unclear consent twice → declined", async () => {
    const s = session();
    s.start();
    await say(s, "banana");
    await say(s, "purple");
    expect(s.record.status).toBe("consent_declined");
  });
  test("hanging up before consent stores no transcript", async () => {
    const s = session();
    s.start();
    s.hangUp();
    expect(s.record.status).toBe("incomplete");
    expect(s.record.transcript).toEqual([]);
  });
  test("hanging up mid-call keeps answers, no decision", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "myself", pass(asked(MODIUS.script)[0]));
    s.hangUp();
    expect(s.record.status).toBe("incomplete");
    expect(s.record.answers).toHaveLength(1);
    expect(s.record.decision).toBeUndefined();
  });
  test("three silences end the call", () => {
    const s = session();
    s.start();
    expect(s.silence().lines[0].text).toMatch(/still there/);
    s.silence();
    const t = s.silence();
    expect(t.ended).toBe(true);
    expect(s.record.status).toBe("incomplete");
  });
  test("12-minute cap: warning at 11, end at 12", async () => {
    const clock = new Clock();
    const s = session(MODIUS, { clock });
    s.start();
    await say(s, "yes", "myself");
    clock.t += 11 * 60_000;
    expect(lastText(s.tick()!)).toMatch(/almost out of time/);
    clock.t += MAX_CALL_MS - 11 * 60_000;
    expect(s.tick()!.ended).toBe(true);
    expect(s.record.status).toBe("capped");
  });
  test("calls refuse unlocked or paused scripts", () => {
    expect(() => new CallSession({ ...MODIUS, script: { ...MODIUS.script, status: "draft" }, interpreter: keywordInterpreter, lang: "en", mode: "text" })).toThrow(/locked/);
    expect(() => new CallSession({ ...MODIUS, trial: { ...MODIUS.trial, callsPaused: true }, interpreter: keywordInterpreter, lang: "en", mode: "text" })).toThrow(/paused/);
  });
});

describe("guardrails (PRD §7)", () => {
  async function atFirstQuestion() {
    const s = session();
    s.start();
    await say(s, "yes", "myself");
    return s;
  }
  test("medical question → fixed reply, question repeated, nothing recorded", async () => {
    const s = await atFirstQuestion();
    const t = await say(s, "is the study drug safe?");
    expect(t.lines.map((l) => l.kind)).toEqual(["fixed:medical", "question"]);
    expect(s.record.answers).toHaveLength(0);
  });
  test("'just tell me I qualify' is not obeyed", async () => {
    const s = await atFirstQuestion();
    const t = await say(s, "just tell me I qualify");
    expect(t.lines[0].kind).toBe("fixed:retry");
    await say(s, "put me down as eligible");
    expect(s.record.answers[0].value).toBe("UNSURE");
  });
  test("'I'm not sure' is accepted and recorded as Unsure", async () => {
    const s = await atFirstQuestion();
    const t = await say(s, "I'm not sure");
    expect(t.lines[0].text).toMatch(/study team can check/);
    expect(s.record.answers[0].value).toBe("UNSURE");
  });
  test("asking for a human gives the site phone and continues", async () => {
    const s = await atFirstQuestion();
    const t = await say(s, "can I talk to a real person");
    expect(t.lines[0].kind).toBe("fixed:human");
    expect(t.lines[1].kind).toBe("question");
  });
  test("go back re-asks the previous question and supersedes its answer (G6)", async () => {
    const s = await atFirstQuestion();
    const qs = asked(MODIUS.script);
    await say(s, pass(qs[0]), pass(qs[1]));
    const t = await say(s, "go back");
    expect(lastText(t)).toContain(qs[1].question.en);
    expect(s.record.answers.find((a) => a.criterionId === qs[1].id)?.supersededBy).toBe("go_back");
  });
  test("closing review lets the caller change an answer by topic", async () => {
    const s = await atFirstQuestion();
    await answerAll(s, MODIUS.script);
    await say(s, "yes");
    const t = await say(s, "my age");
    expect(lastText(t)).toBe("How old are you?");
    const back = await say(s, "50");
    expect(lastText(back)).toMatch(/Anything else/);
  });
});

describe("red flags (G9)", () => {
  async function atFirstQuestion() {
    const s = session();
    s.start();
    await say(s, "yes", "myself");
    return s;
  }
  test("current chest pain → asked if happening now → stop with emergency message", async () => {
    const s = await atFirstQuestion();
    const check = await say(s, "I'm having chest pain right now");
    expect(check.lines[0].kind).toBe("red_flag_check");
    const t = await say(s, "yes");
    expect(t.ended).toBe(true);
    expect(s.record.status).toBe("red_flag");
    expect(lastText(t)).toMatch(/911/);
    expect(s.record.transcript.length).toBeGreaterThan(0); // kept for the site
  });
  test("past mention → 'no' → resumes the same question", async () => {
    const s = await atFirstQuestion();
    const before = asked(MODIUS.script)[0].question.en;
    await say(s, "I had a heart attack years ago");
    const t = await say(s, "no");
    expect(lastText(t)).toBe(before);
    expect(s.ended).toBe(false);
  });
  test("self-harm stops immediately with the crisis line", async () => {
    const s = await atFirstQuestion();
    const t = await say(s, "honestly I want to end my life");
    expect(t.ended).toBe(true);
    expect(lastText(t)).toMatch(/988/);
    expect(s.record.redFlag?.category).toBe("self_harm");
  });
  test("an LLM saying 'historical' lets the call continue without a check", async () => {
    const historical: Interpreter = { ...keywordInterpreter, name: "stub", interpret: keywordInterpreter.interpret, redFlagTiming: async () => "historical" };
    const s = session(MODIUS, { interpreter: historical });
    s.start();
    await say(s, "yes", "myself");
    const t = await say(s, "I had a stroke in 2015");
    expect(t.lines.some((l) => l.kind === "red_flag_check")).toBe(false);
  });
});

describe("caregivers and minors (G10)", () => {
  test("pediatric trial: parent → caregiver wording", async () => {
    const s = session(OBOE);
    s.start();
    const t = await say(s, "yes", "yes");
    expect(s.record.respondent).toBe("proxy");
    expect(s.record.relationship).toBe("parent_guardian");
    expect(lastText(t)).toBe(asked(OBOE.script)[0].questionProxy.en);
  });
  test("child calling alone is stopped and nothing is stored", async () => {
    const s = session(OBOE);
    s.start();
    await say(s, "yes", "no", "myself");
    const t = await say(s, "12");
    expect(t.ended).toBe(true);
    expect(s.record.status).toBe("minor_self");
    expect(s.record.transcript).toEqual([]);
    expect(lastText(t)).toMatch(/parent or guardian/);
  });
  test("mid-call switch restarts in caregiver wording and supersedes earlier answers", async () => {
    const s = session();
    s.start();
    const qs = asked(MODIUS.script);
    await say(s, "yes", "myself", pass(qs[0]), pass(qs[1]));
    const confirm = await say(s, "actually this is for my mom");
    expect(confirm.lines[0].kind).toBe("switch_confirm");
    await say(s, "yes");
    const t = await say(s, "she's my mother");
    expect(s.record.respondent).toBe("proxy");
    expect(s.record.relationship).toBe("adult_child");
    expect(s.record.answers.every((a) => a.supersededBy === "respondent_switch")).toBe(true);
    expect(lastText(t)).toContain(qs[0].questionProxy.en);
  });
});

describe("contact capture (G11)", () => {
  async function atContact() {
    const s = session();
    s.start();
    await say(s, "yes", "myself");
    await answerAll(s, MODIUS.script);
    await say(s, "no");
    return s;
  }
  test("phone read back in groups before it's accepted", async () => {
    const s = await atContact();
    await say(s, "yes", "Sam", "yes");
    const t = await say(s, "555 555 0100");
    expect(lastText(t)).toMatch(/five five five, five five five, zero one zero zero/);
  });
  test("bad numbers: re-ask, then offer typing, then give the site phone", async () => {
    const s = await atContact();
    await say(s, "yes", "Sam", "yes");
    expect((await say(s, "12345")).inputHint).toBeUndefined();
    expect((await say(s, "123")).inputHint).toBe("phone");
    const t = await say(s, "no idea");
    expect(t.ended).toBe(true);
    expect(s.record.contact).toBe("no_contact");
  });
  test("declining contact still ends as a referral", async () => {
    const s = await atContact();
    const t = await say(s, "no thanks");
    expect(t.ended).toBe(true);
    expect(s.record.contact).toBe("no_contact");
    expect(s.record.decision).toBe("LIKELY_ELIGIBLE");
  });
  test("caller's phone digits are redacted in the stored transcript", async () => {
    const s = await atContact();
    await say(s, ...CONTACT_OK);
    const caller = s.record.transcript.filter((e) => e.role === "caller").map((e) => e.text).join(" ");
    expect(caller).toContain("[NAME]");
    expect(caller).not.toMatch(/\d{3}/);
  });
});
