// Demo trials: a registry snapshot plus a pre-built script (written with the
// same rules as the live builder), so the app works without an API key.
import { mapStudy } from "@/lib/ctgov";
import { splitEligibility } from "@/lib/bullets";
import { BuilderOutput } from "@/lib/script/builder";
import { assembleDraft } from "@/lib/script/assemble";
import { db } from "@/lib/store/db";
import { appendAudit, saveNewDraft, saveTrial } from "@/lib/store/repo";

export const DEMO_TRIALS = [
  { nctId: "NCT07599982", label: "MODIUS — insulin dosing app, adults with diabetes" },
  { nctId: "NCT05332067", label: "OBOE — asthma in children 6–17 (caregiver callers)" },
  { nctId: "NCT07219771", label: "MOTION-P — knee osteoarthritis injection, 18 sites" },
];

export const PREBUILT_BY = "pre-built (Claude, same rules as the live builder)";

export async function loadDemoTrials(actor: string): Promise<{ added: string[]; skipped: string[] }> {
  const added: string[] = [];
  const skipped: string[] = [];
  for (const { nctId } of DEMO_TRIALS) {
    if (await db().trials.get(nctId)) {
      skipped.push(nctId);
      continue;
    }
    const [registry, script] = await Promise.all([
      import(`./${nctId}.registry.json`).then((m) => m.default),
      import(`./${nctId}.script.json`).then((m) => m.default),
    ]);
    const trial = mapStudy(registry);
    const bullets = splitEligibility(trial.eligibilityText);
    const output = BuilderOutput.parse(script);
    await saveTrial(trial, actor, "demo snapshot");
    await saveNewDraft(assembleDraft({ trial, bullets, output, version: 1, createdBy: PREBUILT_BY }), actor, "pre-built demo script");
    added.push(nctId);
  }
  if (added.length) await appendAudit(actor, "demo.loaded", { added }, undefined);
  return { added, skipped };
}
