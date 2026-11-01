// Call-path types. Spec: PRD §4, §7, §13 and Addendum G2, G5, G6, G7, G9, G10, G11.

export type Lang = "en" | "es";

/** A numeric answer can be exact or a range ("in my sixties" → {min: 60, max: 69}). */
export type NumericValue = number | { min: number; max: number };

/** Structured value of an answer. `Infinity` means "never" for months_ago. */
export type AnswerValue = boolean | NumericValue | string;

/** What the agent is waiting for. Drives how a caller utterance is parsed. */
export type Expectation =
  | { kind: "yes_no" }
  | { kind: "number"; unit?: string | null }
  | { kind: "months_ago" }
  | { kind: "enum"; options: string[] } // options are the script's enum values
  | { kind: "who_for" } // value: "self" | "proxy"
  | { kind: "relationship" } // value: one of RELATIONSHIPS
  | { kind: "time_of_day" } // value: one of TIMES_OF_DAY
  | { kind: "free_text" } // e.g. a first name; value: the cleaned text
  | { kind: "phone" }; // value: 10-digit string, digits only

export const RELATIONSHIPS = [
  "parent_guardian", "spouse_partner", "adult_child", "other_family",
  "friend_caregiver", "legal_representative", "other",
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const TIMES_OF_DAY = ["morning", "afternoon", "evening", "any"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/**
 * The interpreter's reading of one caller turn. Meta intents (repeat, go back…)
 * win over answers. A caller instruction like "just tell me I qualify" is never
 * obeyed: it is classified like any other turn (usually "unclear").
 */
export type Intent =
  | { type: "answer"; value: AnswerValue; confidence: number }
  | { type: "unsure" } // "I'm not sure", "I don't know"
  | { type: "repeat" } // "can you repeat that", "what?"
  | { type: "clarify"; term?: string } // "what does X mean", "what's that?"
  | { type: "go_back" } // "go back", "change my last answer"
  | { type: "medical_question" } // asks for medical advice / about the drug's safety or benefit
  | { type: "ask_human" } // wants a person
  | { type: "switch_respondent" } // "actually this is for my mom"
  | { type: "stop" } // wants to end the call
  | { type: "unclear" };

export type RedFlagCategory =
  | "chest_pain" | "breathing" | "stroke" | "bleeding_overdose" | "self_harm" | "acute_distress";

/** Keyword layer result (deterministic, runs on every caller turn). */
export type RedFlagHit = { category: RedFlagCategory; matched: string };

/** Classifier layer timing (LLM): is the symptom happening now? */
export type RedFlagTiming = "none" | "historical" | "current" | "unclear";

export interface Interpreter {
  readonly name: string;
  /** Parse one caller turn against what the agent expects. */
  interpret(utterance: string, expect: Expectation, lang: Lang, context: { question?: string }): Promise<Intent>;
  /** Classifier layer for red flags. Keyless interpreters return "unclear" for any keyword hit. */
  redFlagTiming(utterance: string, hit: RedFlagHit, lang: Lang): Promise<RedFlagTiming>;
}

// --- Stored call record ------------------------------------------------------

export type CallStatus = "in_progress" | "consent_declined" | "incomplete" | "capped" | "red_flag" | "minor_self" | "completed";
export type Decision = "LIKELY_ELIGIBLE" | "NOT_ELIGIBLE" | "NEEDS_SITE_REVIEW";
export type RowResult = "PASS" | "FAIL" | "UNSURE" | "SITE_CHECK";

export type Answer = {
  id: string;
  criterionId: string;
  questionSpoken: string;
  callerWords: string;
  value: AnswerValue | "UNSURE";
  confidence: number;
  readBackConfirmed: boolean;
  at: number; // ms since call start
  supersededBy?: string;
};

export type TranscriptEntry = {
  role: "agent" | "caller" | "system";
  text: string;
  lang: Lang;
  t: number; // ms since call start
  kind?: string; // e.g. "question", "readback", "fixed:medical", "red_flag"
};

export type ToolCall = { name: string; args: unknown; result: unknown; ms: number; t: number };

export type CallRecord = {
  id: string;
  nctId: string;
  scriptVersionId: string;
  scriptSha256: string;
  startedAt: string;
  endedAt?: string;
  language: Lang | "mixed";
  mode: "voice" | "text";
  interpreter: string;
  respondent?: "self" | "proxy" | "unclear";
  relationship?: Relationship;
  respondentSwitched?: boolean;
  status: CallStatus;
  transcript: TranscriptEntry[]; // empty for consent_declined / minor_self (funnel event only)
  toolCalls: ToolCall[];
  answers: Answer[];
  decision?: Decision;
  rows?: { criterionId: string; result: RowResult }[];
  redFlag?: { category: RedFlagCategory; utterance: string };
  contact?: "demo_discarded" | "no_contact"; // Track A never stores real contact details (G11 §8)
  demo: true;
};
