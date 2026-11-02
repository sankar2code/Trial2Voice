// Release gate (PRD §9): 20 simulated callers per demo trial must meet every
// gate with the keyword interpreter. A failing gate fails CI.
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapStudy } from "../ctgov";
import { splitEligibility } from "../bullets";
import { BuilderOutput } from "../script/builder";
import { assembleDraft } from "../script/assemble";
import { nearestTo } from "../sites";
import type { ScriptVersion, Trial } from "../types";
import { personasFor } from "./personas";
import { runPersona, summarize, type PersonaResult } from "./runner";

const DEMO = path.join(import.meta.dirname, "..", "..", "data", "demo");
const IDS = ["NCT07599982", "NCT05332067", "NCT07219771"];

function load(id: string): { trial: Trial; script: ScriptVersion } {
  const trial = mapStudy(JSON.parse(fs.readFileSync(path.join(DEMO, `${id}.registry.json`), "utf8")));
  const output = BuilderOutput.parse(JSON.parse(fs.readFileSync(path.join(DEMO, `${id}.script.json`), "utf8")));
  const draft = assembleDraft({ trial, bullets: splitEligibility(trial.eligibilityText), output, version: 1, createdBy: "eval" });
  return { trial, script: { ...draft, status: "locked", approval: { approver: "eval", irbRef: "eval", date: "x", lockedAt: "x", sha256: "e".repeat(64) } } };
}

const all: PersonaResult[] = [];

describe.each(IDS)("simulated callers: %s", (id) => {
  const { trial, script } = load(id);
  const personas = personasFor(trial, script);

  test("there are 20 personas", () => expect(personas).toHaveLength(20));

  test.each(personas.map((p) => [p.label, p] as const))("%s", async (_label, p) => {
    const r = await runPersona(p, trial, script, { findSite: async () => nearestTo(trial, { lat: 42.33, lon: -83.05 }) });
    all.push(r);
    const transcript = r.record.transcript.map((e) => `${e.role === "agent" ? "A" : "C"}: ${e.text}`).join("\n");
    expect(r.error, transcript).toBeUndefined();
    expect({ status: r.status, decision: r.decision }, transcript).toEqual({ status: p.expected.status, decision: p.expected.decision });
    expect(r.flags, transcript).toEqual([]);
  });
});

describe("release gates", () => {
  test("all PRD §9 and Addendum gates pass", () => {
    expect(all.length).toBe(60);
    const s = summarize(all);
    const report = s.gates.map((g) => `${g.pass === false ? "FAIL" : g.pass === null ? "n/a " : "ok  "} ${g.label}: ${g.display} (target ${g.target})`).join("\n");
    expect(s.allPass, report).toBe(true);
  });
});
