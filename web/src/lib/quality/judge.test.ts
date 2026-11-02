// Post-call judge on real calls (demo scripts + CallSession + keyword interpreter).
import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapStudy } from "../ctgov";
import { splitEligibility } from "../bullets";
import { BuilderOutput } from "../script/builder";
import { assembleDraft } from "../script/assemble";
import type { Criterion, ScriptVersion, Trial } from "../types";
import { CallSession } from "../call/session";
import { keywordInterpreter } from "../call/parse";
import type { CallRecord, Lang, TranscriptEntry } from "../call/types";
import { llmJudge, ruleJudge, type JudgeFlagKind } from "./judge";

const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIUserAbortError = class extends APIError {};
    beta = { messages: { create } };
  }
  return { default: Anthropic };
});

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
const failYesNo = (c: Criterion, lang: Lang = "en") => {
  const yes = lang === "es" ? "sí" : "yes";
  return pass(c) === "yes" ? "no" : yes;
};
const passIn = (c: Criterion, lang: Lang) => (lang === "es" && pass(c) === "yes" ? "sí" : pass(c));

function session(which = MODIUS, lang: Lang = "en") {
  return new CallSession({ trial: which.trial, script: which.script, interpreter: keywordInterpreter, fallback: keywordInterpreter, lang, mode: "text" });
}
async function say(s: CallSession, ...utterances: string[]) {
  for (const u of utterances) await s.hear(u);
}
async function answerAll(s: CallSession, script: ScriptVersion, lang: Lang = "en", override: Record<string, string[]> = {}) {
  for (const c of asked(script)) await say(s, ...(override[c.id] ?? [passIn(c, lang)]));
}
const CONTACT_OK = ["yes", "Sam", "yes", "555 555 0100", "yes", "yes", "morning"];
const CONTACT_OK_ES = ["sí", "Ana", "sí", "555 555 0100", "sí", "sí", "en la mañana"];

const kinds = (r: CallRecord, script = MODIUS.script) => ruleJudge(r, script).map((f) => f.kind);
const clone = (r: CallRecord): CallRecord => structuredClone(r);
const agentEntry = (text: string, kind = "fixed:x"): TranscriptEntry => ({ role: "agent", text, lang: "en", t: 0, kind });

async function cleanCall(): Promise<CallRecord> {
  const s = session();
  s.start();
  await say(s, "yes", "myself");
  await answerAll(s, MODIUS.script);
  await say(s, "no", ...CONTACT_OK);
  expect(s.record.status).toBe("completed");
  return s.record;
}

async function failCall(lang: Lang = "en"): Promise<CallRecord> {
  const s = session(MODIUS, lang);
  s.start();
  const yes = lang === "es" ? "sí" : "yes";
  await say(s, yes, lang === "es" ? "yo mismo" : "myself");
  const ex01 = asked(MODIUS.script).find((c) => c.id === "EX-01")!;
  await answerAll(s, MODIUS.script, lang, { "EX-01": [failYesNo(ex01, lang), yes] });
  await say(s, "no");
  expect(s.record.decision).toBe("NOT_ELIGIBLE");
  return s.record;
}

describe("ruleJudge: clean real calls", () => {
  test("full likely-fit call with contact capture → no flags", async () => {
    expect(ruleJudge(await cleanCall(), MODIUS.script)).toEqual([]);
  });

  test("confirmed screen-out (read-back confirmed) → no flags", async () => {
    expect(ruleJudge(await failCall(), MODIUS.script)).toEqual([]);
  });

  test("Spanish full call → no flags", async () => {
    const s = session(MODIUS, "es");
    s.start();
    await say(s, "sí", "yo mismo");
    await answerAll(s, MODIUS.script, "es");
    await say(s, "no", ...CONTACT_OK_ES);
    expect(s.record.status).toBe("completed");
    expect(s.record.transcript.filter((e) => e.role === "agent").length).toBeGreaterThan(10);
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  for (const lang of ["en", "es"] as const) {
    test(`age read-back fills {answer} (${lang}) → no flags`, async () => {
      const s = session(MODIUS, lang);
      s.start();
      const yes = lang === "es" ? "sí" : "yes";
      await say(s, yes, lang === "es" ? "yo mismo" : "myself");
      await answerAll(s, MODIUS.script, lang, { "IN-AGE": ["85", yes] });
      await say(s, "no");
      expect(s.record.transcript.some((e) => e.kind === "readback" && e.text.includes("85"))).toBe(true);
      expect(s.record.decision).toBe("NOT_ELIGIBLE");
      expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
    });
  }

  test("Spanish confirmed screen-out → no flags", async () => {
    expect(ruleJudge(await failCall("es"), MODIUS.script)).toEqual([]);
  });

  test("detours (clarify, glossary, medical, human, not sure, unclear, go back, review) → no flags", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "myself");
    const qs = asked(MODIUS.script);
    await say(s, "what does that mean", "what does that mean", "what does that mean"); // alternates, glossary, fallback
    await say(s, "is the study drug safe?", "can I talk to a real person", "can you repeat that");
    await say(s, pass(qs[0]), "I'm not sure", "go back", "banana", "purple"); // q2: unsure, back, unclear twice
    for (const c of qs.slice(2)) {
      if (c.id === "EX-01") await say(s, "what's an insulin pump?"); // no alternate → glossary definition
      await say(s, pass(c));
    }
    await say(s, "yes", "my age", "50", "no", "no thanks");
    expect(s.ended).toBe(true);
    const spoken = s.record.transcript.filter((e) => e.role === "agent").map((e) => e.kind);
    expect(spoken).toEqual(expect.arrayContaining(["alt_phrasing", "glossary", "fixed:clarify_fallback", "fixed:medical", "fixed:human", "fixed:move_on", "review_pick"]));
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("current red flag stops the call → no flags", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "myself", "I'm having chest pain right now", "yes");
    expect(s.record.status).toBe("red_flag");
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("historical red flag → check, resume, finish → no flags", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "myself", "I had a heart attack years ago", "no");
    await answerAll(s, MODIUS.script);
    await say(s, "no", "no");
    expect(s.ended).toBe(true);
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("self-harm crisis stop → no flags", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "myself", "honestly I want to end my life");
    expect(s.record.status).toBe("red_flag");
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("caregiver call (proxy wording) → no flags", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "for my mother", "she's my mother");
    expect(s.record.respondent).toBe("proxy");
    await answerAll(s, MODIUS.script);
    await say(s, "no", ...CONTACT_OK);
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("mid-call switch to caregiver → no flags", async () => {
    const s = session();
    s.start();
    const qs = asked(MODIUS.script);
    await say(s, "yes", "myself", pass(qs[0]), pass(qs[1]), "actually this is for my mom", "yes", "she's my mother");
    await answerAll(s, MODIUS.script);
    await say(s, "no", "no");
    expect(s.record.respondentSwitched).toBe(true);
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("pediatric trial, parent calling → no flags", async () => {
    const s = session(OBOE);
    s.start();
    await say(s, "yes", "yes");
    await answerAll(s, OBOE.script);
    await say(s, "no", "no");
    expect(s.ended).toBe(true);
    expect(ruleJudge(s.record, OBOE.script)).toEqual([]);
  });

  test("ZIP → nearest site named in the closing line → no flags", async () => {
    const s = new CallSession({
      trial: MODIUS.trial, script: MODIUS.script, interpreter: keywordInterpreter, fallback: keywordInterpreter, lang: "en", mode: "text",
      findSite: async () => ({ facility: "Riverside Diabetes & Endocrine Research Center (Building 2)", city: "x", state: "y", miles: 4 }),
    });
    s.start();
    await say(s, "yes", "myself");
    await answerAll(s, MODIUS.script);
    await say(s, "no", ...CONTACT_OK, "10001");
    expect(s.record.transcript.some((e) => e.kind === "close" && e.text.includes("Riverside"))).toBe(true);
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("caller switches to Spanish mid-call → no flags", async () => {
    const s = session();
    s.start();
    await say(s, "yes", "myself", "en español por favor");
    await answerAll(s, MODIUS.script, "es");
    await say(s, "no", "no");
    expect(s.record.language).toBe("mixed");
    expect(s.record.transcript.some((e) => e.role === "agent" && e.lang === "es" && e.kind === "question")).toBe(true);
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });

  test("declined consent stores nothing → no flags", async () => {
    const s = session();
    s.start();
    await say(s, "no");
    expect(s.record.transcript).toEqual([]);
    expect(ruleJudge(s.record, MODIUS.script)).toEqual([]);
  });
});

describe("ruleJudge: tampered transcripts", () => {
  test("injected treatment claim → off_script with the text", async () => {
    const r = clone(await cleanCall());
    r.transcript.splice(6, 0, agentEntry("This treatment is very safe and you'll feel better."));
    const flags = ruleJudge(r, MODIUS.script);
    expect(flags).toEqual([{ kind: "off_script", turn: 6, detail: expect.stringContaining("very safe"), source: "rules" }]);
  });

  test("replaced disclosure → missing_disclosure", async () => {
    const r = clone(await cleanCall());
    r.transcript[0] = { ...r.transcript[0], text: "Hi, I'm Dr. Smith from the MODIUS study. Is it OK to start?" };
    expect(kinds(r)).toEqual(expect.arrayContaining(["missing_disclosure", "off_script"]));
    const r2 = clone(await cleanCall());
    r2.transcript.shift(); // disclosure gone entirely
    expect(kinds(r2)).toContain("missing_disclosure");
  });

  test("disclosure with a different study name still passes (wildcard slot)", async () => {
    const r = clone(await cleanCall());
    r.transcript[0] = { ...r.transcript[0], text: r.transcript[0].text.replace("MODIUS", "ACME-2") };
    expect(ruleJudge(r, MODIUS.script)).toEqual([]);
  });

  test("'You are eligible!' → said_eligible (and off_script)", async () => {
    const r = clone(await cleanCall());
    r.transcript.splice(r.transcript.length - 1, 0, agentEntry("You are eligible!", "close"));
    expect(new Set(kinds(r))).toEqual(new Set<JudgeFlagKind>(["said_eligible", "off_script"]));
  });

  test("question before consent → consent_order", async () => {
    const r = clone(await cleanCall());
    const qi = r.transcript.findIndex((e) => e.kind === "question");
    const [q] = r.transcript.splice(qi, 1);
    r.transcript.splice(1, 0, q);
    const flags = ruleJudge(r, MODIUS.script);
    expect(flags).toEqual([{ kind: "consent_order", turn: 1, detail: expect.any(String), source: "rules" }]);
  });

  test("confirmed read-back flipped to false on a FAIL answer → missing_readback", async () => {
    const r = clone(await failCall());
    const a = r.answers.find((x) => x.criterionId === "EX-01" && !x.supersededBy)!;
    expect(a.readBackConfirmed).toBe(true);
    a.readBackConfirmed = false;
    expect(ruleJudge(r, MODIUS.script)).toEqual([{ kind: "missing_readback", detail: expect.stringContaining("EX-01"), source: "rules" }]);
  });

  test("confirmed FAIL answer with the read-back line removed → missing_readback", async () => {
    const r = clone(await failCall());
    r.transcript = r.transcript.filter((e) => e.kind !== "readback");
    expect(kinds(r)).toEqual(["missing_readback"]);
  });

  test("whitespace differences don't matter", async () => {
    const r = clone(await cleanCall());
    r.transcript = r.transcript.map((e) => (e.role === "agent" ? { ...e, text: `  ${e.text.replace(/ /g, "  ")}\n` } : e));
    expect(ruleJudge(r, MODIUS.script)).toEqual([]);
  });
});

describe("llmJudge output mapping (SDK mocked)", () => {
  test("agent turn numbers map back to transcript indexes", async () => {
    const r = await cleanCall();
    const agentIdx = r.transcript.flatMap((e, i) => (e.role === "agent" ? [i] : []));
    create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ flags: [{ kind: "advice", turn: 3, detail: "d" }, { kind: "off_script", turn: null, detail: "e" }] }) }],
    });
    const flags = await llmJudge(r, MODIUS.script, "k");
    expect(flags).toEqual([
      { kind: "advice", turn: agentIdx[2], detail: "d", source: "llm" },
      { kind: "off_script", detail: "e", source: "llm" },
    ]);
    const req = create.mock.calls[0][0];
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.messages[0].content).toContain("[A3]");
  });

  test("refusal and bad schema throw clear errors", async () => {
    const r = await cleanCall();
    create.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    await expect(llmJudge(r, MODIUS.script, "k")).rejects.toThrow(/declined/);
    create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: '{"flags":[{"kind":"nope"}]}' }] });
    await expect(llmJudge(r, MODIUS.script, "k")).rejects.toThrow(/schema/);
  });
});


describe("caregiver wording (G10)", () => {
  test("a self-wording question on a proxy call is flagged", async () => {
    const { trial, script } = OBOE;
    const s = new CallSession({ trial, script, interpreter: keywordInterpreter, lang: "en", mode: "text" });
    s.start();
    await s.hear("yes");
    await s.hear("yes"); // parent → proxy
    expect(ruleJudge(s.record, script)).toEqual([]);
    const call = structuredClone(s.record);
    const q = script.criteria.find((c) => c.mode === "ask" && c.question.en !== c.questionProxy.en)!;
    call.transcript.push({ role: "agent", text: q.question.en, lang: "en", t: 99999, kind: "question" });
    expect(ruleJudge(call, script).map((f) => f.kind)).toContain("wrong_respondent_wording");
  });
});
