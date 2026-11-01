// Turn builder output (live or pre-built) into a draft ScriptVersion.
import type { Bullet, ScriptVersion, Trial } from "../types";
import type { BuilderOutput } from "./builder";
import { withDerivedRows } from "./derived";

export const DEFAULT_CONFIDENCE = 0.8;

export function assembleDraft(opts: {
  trial: Trial;
  bullets: Bullet[];
  output: BuilderOutput;
  version: number;
  createdBy: string;
  basedOn?: string | null;
  now?: string;
}): ScriptVersion {
  const { trial, bullets, output, version } = opts;
  return {
    id: `${trial.nctId}-v${version}`,
    nctId: trial.nctId,
    version,
    createdAt: opts.now ?? new Date().toISOString(),
    createdBy: opts.createdBy,
    basedOn: opts.basedOn ?? null,
    sourceLastUpdate: trial.lastUpdatePostDate,
    sourceEligibilityText: trial.eligibilityText,
    bullets,
    criteria: withDerivedRows(trial, output.criteria, output.derivedBulletIds),
    groups: output.groups,
    glossary: output.glossary,
    confidenceThreshold: DEFAULT_CONFIDENCE,
    stopOnConfirmedFail: false,
    verbatimOnly: false,
    status: "draft",
    approval: null,
  };
}
