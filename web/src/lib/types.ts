// Shared data model. Spec: docs/prd-addendum-v1.1.md (G1, G4, G7, G10) and docs/build-plan.md §4.
import { z } from "zod";

export const Bilingual = z.object({ en: z.string(), es: z.string() });
export type Bilingual = z.infer<typeof Bilingual>;

export const BilingualList = z.object({ en: z.array(z.string()), es: z.array(z.string()) });

// --- Trial (from ClinicalTrials.gov API v2) ---------------------------------

export const Location = z.object({
  facility: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string().optional(),
  country: z.string(),
  status: z.string(),
  phone: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});
export type Location = z.infer<typeof Location>;

export const Trial = z.object({
  nctId: z.string(),
  briefTitle: z.string(),
  shortName: z.string(),
  overallStatus: z.string(),
  lastUpdatePostDate: z.string(),
  minAgeYears: z.number().optional(),
  maxAgeYears: z.number().optional(),
  sex: z.enum(["ALL", "FEMALE", "MALE"]),
  genderBased: z.boolean(),
  genderDescription: z.string().optional(),
  healthyVolunteers: z.boolean(),
  eligibilityText: z.string(),
  locations: z.array(Location),
  fetchedAt: z.string(),
  // Set by the protocol-change check.
  stale: z.boolean(),
  latestRegistryUpdate: z.string().optional(),
  latestEligibilityText: z.string().optional(),
  callsPaused: z.boolean(),
});
export type Trial = z.infer<typeof Trial>;

// --- Eligibility bullets (deterministic pre-pass) ---------------------------

export const Bullet = z.object({
  id: z.string(), // "I1", "E3"
  kind: z.enum(["inclusion", "exclusion"]),
  section: z.string(), // heading it appeared under
  text: z.string(), // normalized text, nested items included
});
export type Bullet = z.infer<typeof Bullet>;

// --- Criterion schema (Addendum G1) -----------------------------------------

export const Rule = z.discriminatedUnion("op", [
  z.object({ op: z.literal("eq"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ op: z.literal("neq"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ op: z.literal("lt"), value: z.number() }),
  z.object({ op: z.literal("lte"), value: z.number() }),
  z.object({ op: z.literal("gt"), value: z.number() }),
  z.object({ op: z.literal("gte"), value: z.number() }),
  z.object({ op: z.literal("between"), min: z.number(), max: z.number() }),
  z.object({ op: z.literal("in"), values: z.array(z.string()) }),
  z.object({ op: z.literal("not_in"), values: z.array(z.string()) }),
]);
export type Rule = z.infer<typeof Rule>;

export const AnswerType = z.enum(["yes_no", "number", "enum", "months_ago"]);
export type AnswerType = z.infer<typeof AnswerType>;

export const Unit = z.enum(["years", "months", "kg", "lb", "cm"]);

export const Criterion = z.object({
  id: z.string(),
  kind: z.enum(["inclusion", "exclusion"]),
  bulletIds: z.array(z.string()), // which registry bullets this covers (coverage check)
  sourceText: z.string(), // exact registry text it came from
  mode: z.enum(["ask", "confirm_at_site"]),
  // Fields below are required when mode = "ask"; empty strings / null otherwise.
  question: Bilingual,
  questionProxy: Bilingual,
  altPhrasings: BilingualList, // max 2 per language (G7)
  answerType: AnswerType.nullable(),
  unit: Unit.nullable(),
  enumOptions: z.array(z.string()),
  rule: Rule.nullable(), // the PASS condition
  readBackText: Bilingual, // spoken when the answer would FAIL (G2)
  readBackTextProxy: Bilingual,
  groupId: z.string().nullable(), // OR-clauses
  registryDerived: z.boolean(), // age / sex rows built by code (G4)
  siteCheckNote: z.string(), // for confirm_at_site: what the site must verify
});
export type Criterion = z.infer<typeof Criterion>;

export const CriterionGroup = z.object({
  id: z.string(),
  logic: z.literal("any"),
  criterionIds: z.array(z.string()),
  label: z.string(),
});
export type CriterionGroup = z.infer<typeof CriterionGroup>;

export const GlossaryEntry = z.object({
  term: z.string(),
  plainDefinition: Bilingual,
});
export type GlossaryEntry = z.infer<typeof GlossaryEntry>;

// --- Script versions ---------------------------------------------------------

export const Approval = z.object({
  approver: z.string(),
  irbRef: z.string(),
  date: z.string(), // ISO date the IRB approved
  lockedAt: z.string(),
  sha256: z.string(),
});
export type Approval = z.infer<typeof Approval>;

export const ScriptStatus = z.enum(["draft", "locked", "stale", "superseded"]);

export const ScriptVersion = z.object({
  id: z.string(), // `${nctId}-v${version}`
  nctId: z.string(),
  version: z.number(),
  createdAt: z.string(),
  createdBy: z.string(), // "builder:claude-sonnet-5-5", "pre-built", "editor"
  basedOn: z.string().nullable(), // previous version id
  sourceLastUpdate: z.string(),
  sourceEligibilityText: z.string(),
  bullets: z.array(Bullet),
  criteria: z.array(Criterion),
  groups: z.array(CriterionGroup),
  glossary: z.array(GlossaryEntry),
  confidenceThreshold: z.number(), // default 0.80 (G2)
  stopOnConfirmedFail: z.boolean(),
  verbatimOnly: z.boolean(), // G7
  status: ScriptStatus,
  approval: Approval.nullable(),
});
export type ScriptVersion = z.infer<typeof ScriptVersion>;

// --- Audit log ---------------------------------------------------------------

export type AuditEvent = {
  seq?: number;
  at: string;
  actor: string;
  type: string;
  nctId?: string;
  payload: unknown;
  prevHash: string;
  hash: string;
};
