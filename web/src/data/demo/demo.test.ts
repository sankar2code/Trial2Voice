// Every pre-built demo script must pass the same validation as a live build.
// Run one trial: DEMO=NCT07599982 npx vitest run src/data/demo
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapStudy } from "@/lib/ctgov";
import { splitEligibility } from "@/lib/bullets";
import { BuilderOutput } from "@/lib/script/builder";
import { assembleDraft } from "@/lib/script/assemble";
import { validateScript } from "@/lib/script/validate";

const DIR = path.resolve(import.meta.dirname);
export const DEMO_IDS = ["NCT07599982", "NCT05332067", "NCT07219771"];
const ids = process.env.DEMO ? [process.env.DEMO] : DEMO_IDS;

describe.each(ids)("demo script %s", (id) => {
  const scriptPath = path.join(DIR, `${id}.script.json`);

  test("exists, matches the schema and passes validation", () => {
    expect(fs.existsSync(scriptPath), `${id}.script.json is missing`).toBe(true);
    const trial = mapStudy(JSON.parse(fs.readFileSync(path.join(DIR, `${id}.registry.json`), "utf8")));
    const bullets = splitEligibility(trial.eligibilityText);
    const parsed = BuilderOutput.safeParse(JSON.parse(fs.readFileSync(scriptPath, "utf8")));
    if (!parsed.success) {
      throw new Error(parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
    }
    const draft = assembleDraft({ trial, bullets, output: parsed.data, version: 1, createdBy: "pre-built" });
    const result = validateScript(draft);
    const report = result.issues.map((i) => `${i.level.toUpperCase()} ${i.criterionId ?? ""} ${i.message}`).join("\n");
    if (result.warnings) console.warn(`${id} warnings:\n${report}`);
    expect(result.errors, report).toBe(0);
    expect(result.coverage.unmapped).toEqual([]);
  });
});
