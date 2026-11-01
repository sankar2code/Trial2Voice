// The call agent: a deterministic state machine (Addendum G5). It owns the
// order of the call; the interpreter only reads caller turns; the decision
// engine alone decides. Questions come verbatim from the locked script.
import { decide, evaluateRule } from "../engine";
import type { Criterion, ScriptVersion, Trial } from "../types";
import { line, type LineCtx, type LineKey } from "./lines";
import { detectRedFlag } from "./redflags";
import { parsePhone, phoneReadBack } from "./phone";
import type {
  Answer, AnswerValue, CallRecord, Expectation, Intent, Interpreter, Lang, NumericValue, RedFlagHit, Relationship, TranscriptEntry,
} from "./types";

export const MAX_CALL_MS = 12 * 60_000;
export const WARN_CALL_MS = 11 * 60_000;
export const FOLLOW_UP_DAYS = 3;
const MAX_SILENCES = 2;

export type AgentLine = {
  text: string;
  lang: Lang;
  kind: string;
  slow?: boolean; // repeat requests are spoken more slowly
};

export type Turn = {
  lines: AgentLine[];
  ended: boolean;
  inputHint?: "phone"; // the UI highlights the typed-input box
  progress: { current: number; total: number };
};

type Phase =
  | { p: "consent"; tries: number }
  | { p: "who_for_pediatric"; tries: number }
  | { p: "who_for"; tries: number }
  | { p: "relationship"; tries: number; restart: boolean }
  | { p: "question"; idx: number; tries: number; alt: number; glossaryUsed: boolean; returnToReview: boolean; denials: number }
  | { p: "readback"; idx: number; value: AnswerValue; confidence: number; words: string; asked: string; denials: number; tries: number; returnToReview: boolean }
  | { p: "switch_confirm"; resume: Phase; prompt: AgentLine[] }
  | { p: "red_flag_check"; resume: Phase; prompt: AgentLine[]; hit: RedFlagHit }
  | { p: "review"; tries: number; asked: boolean }
  | { p: "review_pick" }
  | { p: "contact_optin"; tries: number }
  | { p: "contact_name"; tries: number }
  | { p: "contact_name_confirm"; name: string; tries: number }
  | { p: "contact_phone"; tries: number }
  | { p: "contact_phone_confirm"; digits: string; tries: number }
  | { p: "contact_voicemail"; tries: number }
  | { p: "contact_time" }
  | { p: "ended" };

export type SessionOptions = {
  trial: Trial;
  script: ScriptVersion; // must be locked
  interpreter: Interpreter;
  fallback?: Interpreter; // used if the main interpreter throws
  lang: Lang;
  mode: "voice" | "text";
  now?: () => number;
  id?: string;
};

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`);

function sitePhoneOf(trial: Trial): string {
  return trial.locations.find((l) => l.status === "RECRUITING" && l.phone)?.phone ?? trial.locations.find((l) => l.phone)?.phone ?? "the number on the study listing";
}

function formatValue(v: AnswerValue, lang: Lang): string {
  if (typeof v === "number") return v === Infinity ? (lang === "es" ? "nunca" : "never") : String(v);
  if (typeof v === "object") return lang === "es" ? `entre ${v.min} y ${v.max}` : `between ${v.min} and ${v.max}`;
  if (typeof v === "boolean") return v ? (lang === "es" ? "sí" : "yes") : "no";
  return v;
}

function expectationFor(c: Criterion): Expectation {
  switch (c.answerType) {
    case "number": return { kind: "number", unit: c.unit };
    case "months_ago": return { kind: "months_ago" };
    case "enum": return { kind: "enum", options: c.enumOptions };
    default: return { kind: "yes_no" };
  }
}

function upperBound(v: NumericValue): number {
  return typeof v === "number" ? v : v.max;
}

const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{4,}/g) ?? []);

export class CallSession {
  readonly record: CallRecord;
  private phase: Phase = { p: "consent", tries: 0 };
  private readonly asked: Criterion[];
  private readonly ctx: LineCtx;
  private readonly now: () => number;
  private readonly t0: number;
  private silences = 0;
  private warned = false;
  private consentGiven = false;
  private lastPrompt: AgentLine[] = [];
  private contactDraft: { name?: string; digits?: string } = {}; // memory only (G11 §8)

  constructor(private readonly o: SessionOptions) {
    if (o.script.status !== "locked") throw new Error("Calls run only on a locked, approved script version.");
    if (o.trial.callsPaused || o.trial.stale) throw new Error("Calls for this trial are paused.");
    this.now = o.now ?? (() => Date.now());
    this.t0 = this.now();
    this.asked = o.script.criteria.filter((c) => c.mode === "ask");
    const n = this.asked.length;
    this.ctx = { shortName: o.trial.shortName, questions: n, minutes: Math.max(3, Math.round(n * 0.4)), sitePhone: sitePhoneOf(o.trial), days: FOLLOW_UP_DAYS };
    this.record = {
      id: o.id ?? uid(),
      nctId: o.trial.nctId,
      scriptVersionId: o.script.id,
      scriptSha256: o.script.approval?.sha256 ?? "",
      startedAt: new Date(this.t0).toISOString(),
      language: o.lang,
      mode: o.mode,
      interpreter: o.interpreter.name,
      status: "in_progress",
      transcript: [],
      toolCalls: [],
      answers: [],
      demo: true,
    };
  }

  // --- public API ------------------------------------------------------------

  get ended() { return this.phase.p === "ended"; }
  get lang() { return this.o.lang; }

  progress() {
    const idx = this.phase.p === "question" || this.phase.p === "readback" ? this.phase.idx + 1 : this.answeredCount();
    return { current: Math.min(idx, this.asked.length), total: this.asked.length };
  }

  start(): Turn {
    this.tool("next_question", { step: "disclosure" }, null, 0);
    return this.turn([this.say("disclosure", "disclosure")]);
  }

  async hear(raw: string): Promise<Turn> {
    const text = raw.trim();
    if (this.ended) return this.turn([]);
    if (!text) return this.turn([]);
    this.silences = 0;
    this.log({ role: "caller", text: this.redactCaller(text), lang: this.o.lang, t: this.elapsed() });

    const cap = this.checkCap();
    if (cap) return cap;

    // Red flags run on every caller turn, before anything else (G9).
    if (this.phase.p !== "red_flag_check") {
      const hit = detectRedFlag(text);
      if (hit) return this.onRedFlag(text, hit);
    }
    return this.dispatch(text);
  }

  /** Voice mode: no speech for 8 seconds (G5). */
  silence(): Turn {
    if (this.ended) return this.turn([]);
    this.silences += 1;
    if (this.silences > MAX_SILENCES) return this.end("incomplete", [this.say("silenceEnd", "fixed:silence_end")]);
    return this.turn([this.say("stillThere", "fixed:still_there")]);
  }

  /** The caller closed the call. */
  hangUp(): Turn {
    if (!this.ended) this.end("incomplete", []);
    return this.turn([]);
  }

  /** Call every second or so; enforces the 12-minute cap. */
  tick(): Turn | null {
    if (this.ended) return null;
    return this.checkCap();
  }

  // --- dispatch ----------------------------------------------------------------

  private async dispatch(text: string): Promise<Turn> {
    const ph = this.phase;
    switch (ph.p) {
      case "consent": return this.onConsent(text, ph);
      case "who_for_pediatric": return this.onWhoForPediatric(text, ph);
      case "who_for": return this.onWhoFor(text, ph);
      case "relationship": return this.onRelationship(text, ph);
      case "question": return this.onQuestion(text, ph);
      case "readback": return this.onReadBack(text, ph);
      case "switch_confirm": return this.onSwitchConfirm(text, ph);
      case "red_flag_check": return this.onRedFlagCheck(text, ph);
      case "review": return this.onReview(text, ph);
      case "review_pick": return this.onReviewPick(text);
      case "contact_optin": return this.onContactOptin(text, ph);
      case "contact_name": return this.onContactName(text, ph);
      case "contact_name_confirm": return this.onContactNameConfirm(text, ph);
      case "contact_phone": return this.onContactPhone(text, ph);
      case "contact_phone_confirm": return this.onContactPhoneConfirm(text, ph);
      case "contact_voicemail": return this.onVoicemail(text, ph);
      case "contact_time": return this.onBestTime(text);
      case "ended": return this.turn([]);
    }
  }

  private async interpret(text: string, expect: Expectation, question?: string): Promise<Intent> {
    const started = this.now();
    let intent: Intent;
    let used = this.o.interpreter.name;
    try {
      intent = await this.o.interpreter.interpret(text, expect, this.o.lang, { question });
    } catch (e) {
      if (!this.o.fallback) throw e;
      used = `${this.o.fallback.name} (fallback)`;
      intent = await this.o.fallback.interpret(text, expect, this.o.lang, { question });
    }
    // Contact details never go into the log (G11): keep only the intent type.
    const logged = expect.kind === "free_text" || expect.kind === "phone" ? { type: intent.type, redacted: true } : intent;
    this.tool("interpret", { expect: expect.kind, interpreter: used }, logged, this.now() - started);
    return intent;
  }

  private async yesNo(text: string): Promise<Intent> {
    return this.interpret(text, { kind: "yes_no" });
  }

  // --- consent and who-for -----------------------------------------------------

  private async onConsent(text: string, ph: Extract<Phase, { p: "consent" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === true) {
      this.consentGiven = true;
      this.tool("consent", {}, "given", 0);
      const pediatric = (this.o.trial.maxAgeYears ?? 99) < 18;
      this.phase = pediatric ? { p: "who_for_pediatric", tries: 0 } : { p: "who_for", tries: 0 };
      return this.turn([this.say(pediatric ? "whoForPediatric" : "whoFor", "who_for")]);
    }
    if ((i.type === "answer" && i.value === false) || i.type === "stop" || ph.tries >= 1)
      return this.end("consent_declined", [this.say("consentDeclined", "fixed:consent_declined")]);
    if (i.type === "medical_question") {
      this.phase = { p: "consent", tries: ph.tries };
      return this.turn([this.say("medical", "fixed:medical"), this.say("consentRetry", "consent")]);
    }
    this.phase = { p: "consent", tries: ph.tries + 1 };
    return this.turn([this.say("consentRetry", "consent")]);
  }

  private async onWhoForPediatric(text: string, ph: Extract<Phase, { p: "who_for_pediatric" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === true) {
      this.record.respondent = "proxy";
      this.record.relationship = "parent_guardian";
      return this.askQuestion(0);
    }
    if (i.type === "answer" && i.value === false) {
      // Not a parent: could be the child, or another caregiver.
      this.phase = { p: "who_for", tries: 0 };
      return this.turn([this.say("whoFor", "who_for")]);
    }
    if (i.type === "stop") return this.end("incomplete", [this.say("stopped", "fixed:stopped")]);
    if (ph.tries >= 1) {
      this.phase = { p: "who_for", tries: 0 };
      return this.turn([this.say("whoFor", "who_for")]);
    }
    this.phase = { p: "who_for_pediatric", tries: ph.tries + 1 };
    return this.turn([this.say("whoForPediatric", "who_for")]);
  }

  private async onWhoFor(text: string, ph: Extract<Phase, { p: "who_for" }>): Promise<Turn> {
    const i = await this.interpret(text, { kind: "who_for" });
    if (i.type === "answer" && (i.value === "self" || i.value === "proxy")) {
      this.record.respondent = i.value;
      if (i.value === "proxy") {
        this.phase = { p: "relationship", tries: 0, restart: false };
        return this.turn([this.say("relationship", "relationship")]);
      }
      return this.askQuestion(0);
    }
    if (i.type === "stop") return this.end("incomplete", [this.say("stopped", "fixed:stopped")]);
    if (ph.tries >= 1) {
      // G10: unclear twice → "you" wording, flagged on the referral.
      this.record.respondent = "unclear";
      return this.askQuestion(0);
    }
    this.phase = { p: "who_for", tries: ph.tries + 1 };
    return this.turn([this.say("whoForRetry", "who_for")]);
  }

  private async onRelationship(text: string, ph: Extract<Phase, { p: "relationship" }>): Promise<Turn> {
    const i = await this.interpret(text, { kind: "relationship" });
    if (i.type === "answer" && typeof i.value === "string") this.record.relationship = i.value as Relationship;
    else if (ph.tries < 1 && i.type !== "unsure") {
      this.phase = { ...ph, tries: ph.tries + 1 };
      return this.turn([this.say("relationship", "relationship")]);
    } else this.record.relationship = "other";
    if (ph.restart) return this.askQuestion(0, [this.say("switchRestart", "fixed:switch_restart")]);
    return this.askQuestion(0);
  }

  // --- questions -----------------------------------------------------------------

  private questionText(c: Criterion): string {
    const proxy = this.record.respondent === "proxy";
    return (proxy ? c.questionProxy : c.question)[this.o.lang];
  }

  private askQuestion(idx: number, before: AgentLine[] = [], opts: { returnToReview?: boolean; slow?: boolean } = {}): Turn {
    if (idx >= this.asked.length) return this.startReview(before);
    const c = this.asked[idx];
    this.phase = { p: "question", idx, tries: 0, alt: 0, glossaryUsed: false, returnToReview: opts.returnToReview ?? false, denials: 0 };
    this.tool("next_question", { criterionId: c.id, scriptVersion: this.o.script.id }, { text: this.questionText(c) }, 0);
    return this.turn([...before, this.speak(this.questionText(c), "question", opts.slow)]);
  }

  private nextAfter(idx: number, returnToReview: boolean, before: AgentLine[] = []): Turn {
    if (returnToReview) return this.reviewMore(before);
    return this.askQuestion(idx + 1, before);
  }

  private async onQuestion(text: string, ph: Extract<Phase, { p: "question" }>): Promise<Turn> {
    const c = this.asked[ph.idx];
    const q = this.questionText(c);
    const i = await this.interpret(text, expectationFor(c), q);

    switch (i.type) {
      case "repeat":
        return this.turn([this.speak(q, "question", true)]);
      case "clarify":
        return this.clarify(c, ph, i.term);
      case "go_back": {
        if (ph.idx === 0) return this.turn([this.say("firstQuestion", "fixed:first_question"), this.speak(q, "question")]);
        this.supersede(this.asked[ph.idx - 1].id, "go_back");
        return this.askQuestion(ph.idx - 1, [this.say("goingBack", "fixed:go_back")]);
      }
      case "medical_question":
        return this.turn([this.say("medical", "fixed:medical"), this.speak(q, "question")]);
      case "ask_human":
        return this.turn([this.say("human", "fixed:human"), this.speak(q, "question")]);
      case "switch_respondent":
        return this.requestSwitch(ph);
      case "stop":
        return this.end("incomplete", [this.say("stopped", "fixed:stopped")]);
      case "unsure":
        this.recordAnswer(c, q, text, "UNSURE", 1, false);
        return this.nextAfter(ph.idx, ph.returnToReview, [this.say("notSure", "fixed:not_sure")]);
      case "unclear":
        return this.retryOrMoveOn(c, ph, text);
      case "answer":
        return this.onAnswer(c, ph, text, i.value, i.confidence);
    }
  }

  private retryOrMoveOn(c: Criterion, ph: Extract<Phase, { p: "question" }>, text: string): Turn {
    if (ph.tries >= 1) {
      this.recordAnswer(c, this.questionText(c), text, "UNSURE", 0, false);
      return this.nextAfter(ph.idx, ph.returnToReview, [this.say("moveOn", "fixed:move_on")]);
    }
    this.phase = { ...ph, tries: ph.tries + 1 };
    const alts = this.altsFor(c);
    const reworded = !this.o.script.verbatimOnly && alts[ph.alt];
    if (reworded) this.phase = { ...this.phase, alt: ph.alt + 1 } as Phase;
    return this.turn([this.say("retry", "fixed:retry"), this.speak(reworded || this.questionText(c), reworded ? "alt_phrasing" : "question")]);
  }

  private altsFor(c: Criterion): string[] {
    // Alternate phrasings are written in "you" form; caregivers hear the proxy question instead.
    return this.record.respondent === "proxy" ? [] : c.altPhrasings[this.o.lang];
  }

  private clarify(c: Criterion, ph: Extract<Phase, { p: "question" }>, term?: string): Turn {
    const q = this.questionText(c);
    if (this.o.script.verbatimOnly) return this.turn([this.speak(q, "question", true)]);
    const alts = this.altsFor(c);
    if (ph.alt < alts.length) {
      this.phase = { ...ph, alt: ph.alt + 1 };
      return this.turn([this.speak(alts[ph.alt], "alt_phrasing")]);
    }
    if (!ph.glossaryUsed) {
      const qLower = q.toLowerCase();
      const entry =
        (term && this.o.script.glossary.find((g) => g.term.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(g.term.toLowerCase().split(" (")[0]))) ||
        this.o.script.glossary.find((g) => qLower.includes(g.term.toLowerCase().split(" (")[0]));
      if (entry) {
        this.phase = { ...ph, glossaryUsed: true };
        return this.turn([this.speak(entry.plainDefinition[this.o.lang], "glossary"), this.speak(q, "question")]);
      }
    }
    return this.turn([this.say("clarifyFallback", "fixed:clarify_fallback")]);
  }

  private onAnswer(c: Criterion, ph: Extract<Phase, { p: "question" }>, words: string, value: AnswerValue, confidence: number): Turn {
    const q = this.questionText(c);
    const expected = expectationFor(c).kind;
    const fits =
      expected === "yes_no" ? typeof value === "boolean" :
      expected === "enum" ? typeof value === "string" :
      typeof value === "number" || (typeof value === "object" && value !== null);
    if (!fits) return this.retryOrMoveOn(c, ph, words);
    // G10: a caller under 18 answering for themselves stops the screen.
    if (c.id === "IN-AGE" && this.record.respondent !== "proxy" && typeof value !== "boolean" && typeof value !== "string" && upperBound(value) < 18) {
      return this.end("minor_self", [this.say("minorStop", "fixed:minor_stop")]);
    }
    if (!c.rule) return this.nextAfter(ph.idx, ph.returnToReview);
    const outcome = evaluateRule(c.rule, value);
    if (outcome === "mixed") {
      if (ph.tries >= 1) {
        this.recordAnswer(c, q, words, "UNSURE", confidence, false);
        return this.nextAfter(ph.idx, ph.returnToReview, [this.say("moveOn", "fixed:move_on")]);
      }
      this.phase = { ...ph, tries: ph.tries + 1 };
      return this.turn([this.say("exactNumber", "fixed:exact_number")]);
    }
    if (outcome === "pass") {
      this.recordAnswer(c, q, words, value, confidence, false);
      return this.nextAfter(ph.idx, ph.returnToReview);
    }
    // Would screen the caller out: read it back first (G2).
    this.phase = { p: "readback", idx: ph.idx, value, confidence, words, asked: q, denials: ph.denials, tries: 0, returnToReview: ph.returnToReview };
    return this.turn([this.speak(this.readBackText(c, value), "readback")]);
  }

  private readBackText(c: Criterion, value: AnswerValue): string {
    const tpl = (this.record.respondent === "proxy" ? c.readBackTextProxy : c.readBackText)[this.o.lang];
    return tpl.replace(/\{answer\}/g, formatValue(value, this.o.lang));
  }

  private async onReadBack(text: string, ph: Extract<Phase, { p: "readback" }>): Promise<Turn> {
    const c = this.asked[ph.idx];
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === true) {
      this.recordAnswer(c, ph.asked, ph.words, ph.value, ph.confidence, true);
      if (this.o.script.stopOnConfirmedFail) return this.finish([]);
      return this.nextAfter(ph.idx, ph.returnToReview);
    }
    if (i.type === "repeat") return this.turn([this.speak(this.readBackText(c, ph.value), "readback", true)]);
    if (i.type === "unsure") {
      this.recordAnswer(c, ph.asked, ph.words, "UNSURE", 1, false);
      return this.nextAfter(ph.idx, ph.returnToReview, [this.say("notSure", "fixed:not_sure")]);
    }
    if (i.type === "stop") return this.end("incomplete", [this.say("stopped", "fixed:stopped")]);

    const denied = i.type === "answer" && i.value === false;
    if (!denied) {
      // Maybe the caller restated the answer ("no, I'm 45"): read it against the question.
      const again = await this.interpret(text, expectationFor(c), ph.asked);
      if (again.type === "answer") {
        const denials = ph.denials + 1;
        if (denials >= 2) return this.unsureAfterDenials(c, ph);
        return this.onAnswer(c, { p: "question", idx: ph.idx, tries: 0, alt: 0, glossaryUsed: false, returnToReview: ph.returnToReview, denials }, text, again.value, again.confidence);
      }
      if (ph.tries >= 1) return this.unsureAfterDenials(c, ph);
      this.phase = { ...ph, tries: ph.tries + 1 };
      return this.turn([this.say("retry", "fixed:retry"), this.speak(this.readBackText(c, ph.value), "readback")]);
    }
    // Caller corrected us: re-ask once; a second correction ends as Unsure (G2).
    if (ph.denials + 1 >= 2) return this.unsureAfterDenials(c, ph);
    this.phase = { p: "question", idx: ph.idx, tries: 0, alt: 0, glossaryUsed: false, returnToReview: ph.returnToReview, denials: ph.denials + 1 };
    return this.turn([this.say("askAgain", "fixed:ask_again"), this.speak(this.questionText(c), "question")]);
  }

  private unsureAfterDenials(c: Criterion, ph: Extract<Phase, { p: "readback" }>): Turn {
    this.recordAnswer(c, ph.asked, ph.words, "UNSURE", ph.confidence, false);
    return this.nextAfter(ph.idx, ph.returnToReview, [this.say("moveOn", "fixed:move_on")]);
  }

  // --- caregiver switch (G10) ---------------------------------------------------

  private requestSwitch(ph: Extract<Phase, { p: "question" }>): Turn {
    if (this.record.respondentSwitched) return this.end("incomplete", [this.say("switchTwice", "fixed:switch_twice")]);
    if (this.record.respondent === "proxy") return this.turn([this.say("retry", "fixed:retry"), this.speak(this.questionText(this.asked[ph.idx]), "question")]);
    this.phase = { p: "switch_confirm", resume: ph, prompt: this.lastPrompt };
    return this.turn([this.say("switchConfirm", "switch_confirm")]);
  }

  private async onSwitchConfirm(text: string, ph: Extract<Phase, { p: "switch_confirm" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === true) {
      for (const a of this.record.answers) if (!a.supersededBy) a.supersededBy = "respondent_switch";
      this.record.respondent = "proxy";
      this.record.respondentSwitched = true;
      this.tool("switch_respondent", {}, "restart", 0);
      this.phase = { p: "relationship", tries: 0, restart: true };
      return this.turn([this.say("relationship", "relationship")]);
    }
    this.phase = ph.resume;
    return this.turn(ph.prompt.map((l) => ({ ...l })));
  }

  // --- red flags (G9) -------------------------------------------------------------

  private async onRedFlag(text: string, hit: RedFlagHit): Promise<Turn> {
    if (hit.category === "self_harm") return this.stopForRedFlag(text, hit);
    const started = this.now();
    let timing: Awaited<ReturnType<Interpreter["redFlagTiming"]>> = "unclear";
    try {
      timing = await this.o.interpreter.redFlagTiming(text, hit, this.o.lang);
    } catch {
      timing = "unclear";
    }
    this.tool("red_flag_check", hit, timing, this.now() - started);
    if (timing === "current") return this.stopForRedFlag(text, hit);
    if (timing === "historical" || timing === "none") return this.dispatch(text);
    this.phase = { p: "red_flag_check", resume: this.phase, prompt: this.lastPrompt, hit };
    return this.turn([this.say(this.record.respondent === "proxy" ? "happeningNowProxy" : "happeningNow", "red_flag_check")]);
  }

  private async onRedFlagCheck(text: string, ph: Extract<Phase, { p: "red_flag_check" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === false) {
      this.phase = ph.resume;
      return this.turn(ph.prompt.map((l) => ({ ...l })));
    }
    // Yes, unsure or unclear: safety first.
    return this.stopForRedFlag(text, ph.hit);
  }

  private stopForRedFlag(text: string, hit: RedFlagHit): Turn {
    this.record.redFlag = { category: hit.category, utterance: text };
    this.tool("raise_red_flag", hit, "screen stopped", 0);
    const key: LineKey = hit.category === "self_harm" ? "crisis" : this.record.respondent === "proxy" ? "emergencyProxy" : "emergency";
    return this.end("red_flag", [this.say(key, "red_flag")]);
  }

  // --- closing review (G6) ------------------------------------------------------

  private startReview(before: AgentLine[]): Turn {
    if (this.answeredCount() === 0) return this.finish(before);
    this.phase = { p: "review", tries: 0, asked: true };
    return this.turn([...before, this.say("reviewAsk", "review")]);
  }

  private reviewMore(before: AgentLine[]): Turn {
    this.phase = { p: "review", tries: 0, asked: true };
    return this.turn([...before, this.say("reviewMore", "review")]);
  }

  private async onReview(text: string, ph: Extract<Phase, { p: "review" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === true) {
      this.phase = { p: "review_pick" };
      return this.turn([this.say("reviewWhich", "review_pick")]);
    }
    if (i.type === "go_back") return this.onReviewPick(text);
    if (i.type === "unclear" && ph.tries < 1) {
      // They may have named the item directly ("my age was wrong").
      const pick = this.matchCriterion(text);
      if (pick !== null) return this.onReviewPick(text);
      this.phase = { ...ph, tries: ph.tries + 1 };
      return this.turn([this.say("reviewAsk", "review")]);
    }
    return this.finish([]);
  }

  private matchCriterion(text: string): number | null {
    const said = words(text);
    if (/\b(age|old|edad|años)\b/i.test(text)) {
      const idx = this.asked.findIndex((c) => c.id === "IN-AGE");
      if (idx >= 0) return idx;
    }
    let best = -1;
    let bestScore = 0;
    this.asked.forEach((c, idx) => {
      const qw = words(`${c.question.en} ${c.question.es}`);
      const score = [...said].filter((w) => qw.has(w)).length;
      if (score > bestScore) [best, bestScore] = [idx, score];
    });
    return bestScore >= 1 ? best : null;
  }

  private async onReviewPick(text: string): Promise<Turn> {
    const idx = this.matchCriterion(text);
    if (idx === null) return this.finish([this.say("reviewNoMatch", "fixed:review_no_match")]);
    this.supersede(this.asked[idx].id, "closing_review");
    return this.askQuestion(idx, [], { returnToReview: true });
  }

  // --- decision and contact capture (G11) -----------------------------------------

  private finish(before: AgentLine[]): Turn {
    const result = decide(this.o.script, this.record.answers);
    this.record.decision = result.decision;
    this.record.rows = result.rows;
    this.tool("decide", { answers: this.record.answers.filter((a) => !a.supersededBy).length }, result.decision, 0);
    if (result.decision === "NOT_ELIGIBLE") return this.end("completed", [...before, this.say("closeNotMatch", "close")]);
    this.phase = { p: "contact_optin", tries: 0 };
    return this.turn([...before, this.say(this.record.respondent === "proxy" ? "contactAskProxy" : "contactAsk", "contact")]);
  }

  private closeWithDecision(before: AgentLine[]): Turn {
    const key: LineKey = this.record.decision === "LIKELY_ELIGIBLE" ? "closeLikely" : "closeReview";
    return this.end("completed", [...before, this.say(key, "close"), this.say("goodbye", "close")]);
  }

  private noContact(key: LineKey): Turn {
    this.record.contact = "no_contact";
    this.contactDraft = {};
    return this.closeWithDecision([this.say(key, "contact")]);
  }

  private async onContactOptin(text: string, ph: Extract<Phase, { p: "contact_optin" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === true) {
      this.tool("contact_consent", {}, "given", 0);
      this.phase = { p: "contact_name", tries: 0 };
      return this.turn([this.say("askName", "contact")]);
    }
    if (i.type === "answer" || i.type === "stop" || ph.tries >= 1) return this.noContact("contactDeclined");
    this.phase = { p: "contact_optin", tries: ph.tries + 1 };
    return this.turn([this.say("retry", "fixed:retry"), this.say(this.record.respondent === "proxy" ? "contactAskProxy" : "contactAsk", "contact")]);
  }

  private async onContactName(text: string, ph: Extract<Phase, { p: "contact_name" }>): Promise<Turn> {
    const i = await this.interpret(text, { kind: "free_text" });
    if (i.type === "answer" && typeof i.value === "string" && i.value.trim()) {
      this.phase = { p: "contact_name_confirm", name: i.value.trim(), tries: ph.tries };
      return this.turn([this.speak(this.o.lang === "es" ? `Anoté ${i.value.trim()}. ¿Es correcto?` : `I have ${i.value.trim()}. Is that right?`, "contact", false, "[NAME read-back]")]);
    }
    if (i.type === "stop") return this.noContact("contactDeclined");
    if (ph.tries >= 1) {
      this.phase = { p: "contact_phone", tries: 0 };
      return this.turn([this.say("askPhone", "contact")]);
    }
    this.phase = { p: "contact_name", tries: ph.tries + 1 };
    return this.turn([this.say("retry", "fixed:retry"), this.say("askName", "contact")]);
  }

  private async onContactNameConfirm(text: string, ph: Extract<Phase, { p: "contact_name_confirm" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if ((i.type === "answer" && i.value === true) || ph.tries >= 1) {
      this.contactDraft.name = ph.name;
      this.phase = { p: "contact_phone", tries: 0 };
      return this.turn([this.say("askPhone", "contact")]);
    }
    this.phase = { p: "contact_name", tries: ph.tries + 1 };
    return this.turn([this.say("askName", "contact")]);
  }

  private phoneRetry(tries: number): Turn {
    if (tries >= 2) return this.noContact("phoneGiveUp");
    this.phase = { p: "contact_phone", tries: tries + 1 };
    const lines = tries === 0 ? [this.say("phoneShort", "contact")] : [this.say("phoneShort", "contact"), this.say("phoneType", "contact")];
    return this.turn(lines, tries >= 1 ? "phone" : undefined);
  }

  private async onContactPhone(text: string, ph: Extract<Phase, { p: "contact_phone" }>): Promise<Turn> {
    const meta = await this.interpret(text, { kind: "phone" });
    if (meta.type === "stop" || meta.type === "unsure") return this.noContact("contactDeclined");
    const parsed = parsePhone(text);
    if (!parsed || !parsed.valid) return this.phoneRetry(ph.tries);
    this.phase = { p: "contact_phone_confirm", digits: parsed.digits, tries: ph.tries };
    const prefix = this.o.lang === "es" ? "Anoté" : "I have";
    return this.turn([this.speak(`${prefix} ${phoneReadBack(parsed.digits, this.o.lang)}. ${this.o.lang === "es" ? "¿Es correcto?" : "Is that right?"}`, "contact", false, "[PHONE read-back]")]);
  }

  private async onContactPhoneConfirm(text: string, ph: Extract<Phase, { p: "contact_phone_confirm" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type === "answer" && i.value === true) {
      this.contactDraft.digits = ph.digits; // never "got it" before this confirmation (G11 §4)
      this.phase = { p: "contact_voicemail", tries: 0 };
      return this.turn([this.say("voicemail", "contact")]);
    }
    // A corrected number said straight away.
    const parsed = parsePhone(text);
    if (parsed?.valid) return this.onContactPhone(text, { p: "contact_phone", tries: ph.tries + 1 });
    if (ph.tries >= 2) return this.noContact("phoneGiveUp");
    this.phase = { p: "contact_phone", tries: ph.tries + 1 };
    const lines = [this.say("askAgain", "fixed:ask_again"), this.say("askPhone", "contact")];
    if (ph.tries >= 1) lines.push(this.say("phoneType", "contact"));
    return this.turn(lines, ph.tries >= 1 ? "phone" : undefined);
  }

  private async onVoicemail(text: string, ph: Extract<Phase, { p: "contact_voicemail" }>): Promise<Turn> {
    const i = await this.yesNo(text);
    if (i.type !== "answer" && ph.tries < 1 && i.type !== "unsure") {
      this.phase = { p: "contact_voicemail", tries: ph.tries + 1 };
      return this.turn([this.say("voicemail", "contact")]);
    }
    this.phase = { p: "contact_time" };
    return this.turn([this.say("bestTime", "contact")]);
  }

  private async onBestTime(text: string): Promise<Turn> {
    await this.interpret(text, { kind: "time_of_day" });
    // Track A demo: contact details are discarded, never stored (G11 §8).
    this.record.contact = "demo_discarded";
    this.contactDraft = {};
    this.tool("contact_captured", { stored: false }, "demo: discarded", 0);
    return this.closeWithDecision([]);
  }

  // --- helpers -----------------------------------------------------------------

  private answeredCount() {
    return new Set(this.record.answers.filter((a) => !a.supersededBy).map((a) => a.criterionId)).size;
  }

  private recordAnswer(c: Criterion, q: string, callerWords: string, value: AnswerValue | "UNSURE", confidence: number, readBackConfirmed: boolean) {
    const a: Answer = { id: uid(), criterionId: c.id, questionSpoken: q, callerWords, value, confidence, readBackConfirmed, at: this.elapsed() };
    this.supersede(c.id, a.id);
    this.record.answers.push(a);
    this.tool("record_answer", { criterionId: c.id, value: value === Infinity ? "never" : value, confidence, readBackConfirmed }, "ok", 0);
  }

  private supersede(criterionId: string, by: string) {
    for (const a of this.record.answers) if (a.criterionId === criterionId && !a.supersededBy) a.supersededBy = by;
  }

  private checkCap(): Turn | null {
    const e = this.elapsed();
    if (e >= MAX_CALL_MS) return this.end("capped", [this.say("capEnd", "fixed:cap")]);
    if (e >= WARN_CALL_MS && !this.warned) {
      this.warned = true;
      return this.turn([this.say("almostOutOfTime", "fixed:cap_warning"), ...this.lastPrompt]);
    }
    return null;
  }

  private end(status: CallRecord["status"], lines: AgentLine[]): Turn {
    for (const l of lines) this.logAgent(l);
    this.record.status = status;
    this.record.endedAt = new Date(this.now()).toISOString();
    this.tool("end_call", { status }, this.record.decision ?? null, 0);
    // No consent (or a minor alone): keep only the funnel event, not what was said (G5, G10).
    if (status === "consent_declined" || status === "minor_self" || !this.consentGiven) {
      this.record.transcript = [];
      this.record.answers = [];
      delete this.record.respondent;
      delete this.record.relationship;
    }
    this.phase = { p: "ended" };
    return { lines, ended: true, progress: this.progress() };
  }

  private turn(lines: AgentLine[], inputHint?: "phone"): Turn {
    for (const l of lines) this.logAgent(l);
    const prompt = lines.filter((l) => !l.kind.startsWith("fixed:") && l.kind !== "red_flag_check" && l.kind !== "switch_confirm");
    if (prompt.length && !this.ended) this.lastPrompt = prompt;
    return { lines, ended: this.ended, inputHint, progress: this.progress() };
  }

  private say(key: LineKey, kind: string): AgentLine {
    return { text: line(key, this.o.lang, this.ctx), lang: this.o.lang, kind };
  }

  private speak(text: string, kind: string, slow = false, redacted?: string): AgentLine & { redacted?: string } {
    return { text, lang: this.o.lang, kind, slow, ...(redacted ? { redacted } : {}) };
  }

  private logAgent(l: AgentLine & { redacted?: string }) {
    this.log({ role: "agent", text: l.redacted ?? l.text, lang: l.lang, t: this.elapsed(), kind: l.kind });
  }

  private redactCaller(text: string): string {
    const p = this.phase.p;
    if (p === "contact_name" || p === "contact_name_confirm") return p === "contact_name" ? "[NAME]" : text;
    if (p === "contact_phone" || p === "contact_phone_confirm")
      return text.replace(/\d/g, "#").replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|oh|double|triple|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi, "#");
    return text;
  }

  private log(e: TranscriptEntry) {
    this.record.transcript.push(e);
  }

  private tool(name: string, args: unknown, result: unknown, ms: number) {
    this.record.toolCalls.push({ name, args, result, ms, t: this.elapsed() });
  }

  private elapsed() {
    return this.now() - this.t0;
  }
}
