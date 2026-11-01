# Trial2Voice — Build Plan

Source: *Trial2Voice — AI Product PRD* v1.0 (Nov 1, 2026).
This plan covers two tracks:

- **Track A — Frontend-only prototype.** Runs entirely in the browser, hosted as a static site. No servers, no voice infrastructure, no database. Proves the full loop: NCT ID → approved script → voice pre-screen → traced referral.
- **Track B — Production MVP.** The PRD's architecture (Next.js + LiveKit Python agent + Postgres). Track A is built so Track B swaps out adapters instead of rewriting.

Recommendation: build Track A first (~3–4 weeks), ship it as the portfolio demo, then add Track B pieces only where a pilot partner needs them.

---

## 1. PRD gaps — resolved

All gaps found in v1.0 are resolved in [PRD Addendum v1.1](prd-addendum-v1.1.md) (G1–G9, plus two new ones: G10 caregiver callers, G11 contact capture). The data model, engine rules and tasks below follow the addendum. Only external questions remain open (pilot partner, IRB, data controller, retention, final IRB wording for emergency / crisis / contact lines).

---

## 2. What is possible without a backend

Verified: `clinicaltrials.gov/api/v2` and `api.zippopotam.us` both return `Access-Control-Allow-Origin: *`, so the browser can call them directly.

| PRD feature | Pri | Frontend-only? | How (Track A) | What needs a backend (Track B) |
|---|---|---|---|---|
| NCT ID ingest | P0 | ✅ Fully | `fetch` the API v2 from the browser | Nothing |
| Script builder (LLM) | P0 | ✅ With caveat | (a) Pre-built scripts committed as JSON for demo trials, (b) live build with the user's own Anthropic key, called from the browser | Hiding the API key, SSE streaming from a server, cost limits |
| Script editor + version diff + approval lock | P0 | ✅ Simulated | IndexedDB; locked versions are frozen and SHA-256 hashed (WebCrypto) | Real auth, attributable approvers, Part 11 audit trail |
| Voice pre-screen call | P0 | ✅ Browser-grade | Web Speech API: `SpeechRecognition` (STT) + `speechSynthesis` (TTS). Text-input fallback (the PRD already requires it) | WebRTC rooms (LiveKit), pro STT/TTS, ≤1.2 s latency SLA, recording |
| Answer interpretation | P0 | ✅ Two modes | Keyless mode: rule-based parser (yes/no, numbers, "not sure"). Key mode: Claude Haiku-class with JSON-schema tool output | Server-side model calls with BAA |
| Deterministic decision engine | P0 | ✅ Fully | Pure TypeScript module, unit-tested. Identical code reused in Track B | Nothing (port to Python or call via API) |
| Red-flag stop + handoff | P0 | ✅ Fully | Keyword check on every turn + LLM classifier in key mode; fixed emergency message | Logging the event to the site |
| Referral summary | P0 | ✅ Fully | Per-criterion table, printable / PDF export | Delivery to a coordinator inbox |
| Call console + audit log | P0 | ✅ Simulated | Live transcript, per-step latency, tool-call trace; hash-chained log in IndexedDB | Immutable server-side storage |
| English ↔ Spanish | P1 | ✅ Fully | Per-turn language detection (keyword heuristic or LLM), switch `lang` on STT/TTS (`es-US`) | Better Spanish voices |
| Nearest recruiting site | P1 | ✅ Fully | ZIP → lat/long via zippopotam.us; distance to `geoPoint` in the study's locations | Nothing |
| Coordinator dashboard | P1 | ⚠️ Single browser | Queue, accept/reject + reason, overrides with required reason. Data lives in that browser; JSON export/import | Shared multi-user queue, email notifications |
| Protocol-change watch | P1 | ⚠️ On page load | Re-check `lastUpdatePostDate` when the admin page opens; mark stale and block calls | Nightly job (a GitHub Actions cron is a cheap middle ground) |
| Embeddable widget | P1 | ✅ Fully | `/embed/[trialSlug]` page + one `<script>` that injects an iframe | Domain allowlist, signed call tokens |
| Post-call judge | — | ✅ With key | Browser LLM call comparing agent turns to the locked script; flagged calls held from the queue | Async server job |
| Eval harness | — | ✅ Text-mode | Decision-engine unit tests (Vitest) + simulated callers in text through the same agent loop | Personas speaking through TTS into real rooms; WER tests |
| Funnel + criterion drop-off | — | ✅ Single browser | Events in IndexedDB, charts on a sponsor page | Cross-caller aggregation |
| Phone (SIP), CTMS/EHR | P2 | ❌ | — | Requires telephony and server infra |
| HIPAA, BAAs, encryption at rest, rate limits | — | ❌ | Not applicable: demo uses fake callers and a "demo — not affiliated" banner | Required before any real caller |

**Bottom line:** every P0 and almost every P1 feature can be shown working in a frontend-only build. What you lose is security (keys, auth, rate limits), shared data across users/devices, production voice quality and latency, and compliance. Those are exactly the things a real pilot needs, not a demo.

**Caveats on browser speech:**
- Chrome's `SpeechRecognition` sends audio to Google's servers. Fine for a demo, never for PHI.
- Firefox has no `SpeechRecognition`; show the text fallback there.
- Browser TTS voices vary by OS. Pick the best available voice per language at runtime.

---

## 3. Track A — Architecture

```
Browser (static site, no server code)
├── Admin (sponsor/CRO)
│   ├── Ingest ──────────── fetch → ClinicalTrials.gov API v2
│   ├── Script builder ──── pre-built JSON  |  Anthropic API (user key, direct browser access)
│   └── Editor / diff / approve → IndexedDB (frozen, hashed versions)
├── Call page (caller)
│   ├── Voice I/O ───────── Web Speech API (STT + TTS)  |  text fallback
│   ├── Agent loop ──────── state machine + tools: next_question, record_answer,
│   │                       nearest_site, raise_red_flag, end_call
│   ├── Interpreter ─────── rule parser (keyless)  |  Claude Haiku-class (key)
│   └── Decision engine ─── pure TS, no LLM
├── Coordinator ─────────── referral queue, overrides, audit view
└── Sponsor insights ───── funnel + criterion drop-off
```

Key idea: **the agent loop is a deterministic state machine, not a free-running LLM.** The machine owns the order (disclosure → consent → question N → read-back → … → close). The LLM is called only to (1) classify an answer into the schema, (2) detect red flags / language / intent ("repeat", "go back", medical question). This makes the keyless mode possible and matches the PRD's guardrails by construction.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, all client components, **no route handlers** in Track A | Same routes as PRD §14; Track B adds `/api/*` without moving pages |
| Language | TypeScript strict | Shared types for script, answers, decisions |
| UI | Tailwind + shadcn/ui | Fast admin tables, dialogs, diff view |
| Local data | Dexie (IndexedDB) | Structured tables, survives reloads |
| Validation | Zod | Same schemas validate LLM output and stored data |
| LLM | `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` | Build + judge on Sonnet-class, in-call on Haiku-class |
| Diff | `diff` (jsdiff) | Script version diff and protocol-change diff |
| Tests | Vitest (engine, parser), Playwright (call flow in text mode) | Eval gates in CI |
| Hosting | Vercel or GitHub Pages | Static, free |

### Routes

| Route | Purpose |
|---|---|
| `/` | Landing + demo banner + list of demo trials |
| `/admin/trials` | Ingest by NCT ID, list trials, stale badges |
| `/admin/trials/[nctId]/script` | Criterion ↔ question side-by-side editor, versions, diff, approve |
| `/call/[trialSlug]` | Public call page: disclosure, captions, progress bar, mic / text input |
| `/embed/[trialSlug]` | Same call UI, chrome-less, for the iframe widget |
| `/coordinator` | Referral queue, summary, accept/reject, overrides, audit log |
| `/coordinator/calls/[callId]` | Call console replay: transcript, latency, tool calls, judge flags |
| `/insights/[nctId]` | Funnel and criterion drop-off |
| `/evals` | Runs simulated callers against a locked script, shows gate results |
| `/settings` | Optional Anthropic key (stored in browser only), voice and speech-rate settings |

---

## 4. Data model (shared by both tracks)

```ts
type Trial = {
  nctId: string; briefTitle: string; shortName: string;
  status: string; lastUpdatePostDate: string;
  minAgeYears?: number; maxAgeYears?: number; sex: 'ALL' | 'FEMALE' | 'MALE';
  eligibilityText: string;
  locations: { facility: string; city: string; state: string; zip?: string;
               lat?: number; lon?: number; status: string }[];
  stale: boolean; callsPaused: boolean;          // kill switch
};

type Criterion = {                                // full spec: Addendum G1
  id: string;                                     // e.g. "EX-03", stable across versions
  kind: 'inclusion' | 'exclusion';
  sourceText: string;                             // must be a substring of the registry text
  mode: 'ask' | 'confirm_at_site';
  question:      { en: string; es: string };
  questionProxy: { en: string; es: string };      // caregiver wording (G10)
  altPhrasings:  { en: string[]; es: string[] };  // max 2 each (G7)
  answerType: 'yes_no' | 'number' | 'enum' | 'months_ago';
  enumOptions?: string[];
  unit?: 'years' | 'months' | 'kg' | 'lb' | 'cm';
  rule: { op: 'eq' | 'neq'; value: string | number | boolean }
      | { op: 'lt' | 'lte' | 'gt' | 'gte'; value: number }
      | { op: 'between'; min: number; max: number }
      | { op: 'in' | 'not_in'; values: string[] };  // the PASS condition
  readBackText:      { en: string; es: string };  // used whenever the answer would FAIL (G2)
  readBackTextProxy: { en: string; es: string };  // G10
  groupId?: string;                               // OR-clauses (G1)
  registryDerived?: boolean;                      // age / sex rows built by code (G4)
};

type CriterionGroup = { id: string; logic: 'any'; criterionIds: string[] };

type ScriptVersion = {
  id: string; nctId: string; version: number;
  sourceLastUpdate: string;                       // registry date it was built from
  criteria: Criterion[]; groups: CriterionGroup[];
  glossary: { term: string; plainDefinition: { en: string; es: string } }[];   // G7
  confidenceThreshold: number;                    // default 0.80, range 0.70–0.95 (G2)
  stopOnConfirmedFail: boolean;                   // default false (G2)
  status: 'draft' | 'locked' | 'stale';
  approval?: { approver: string; irbRef: string; date: string; sha256: string };
  verbatimOnly: boolean;
};

type Answer = {
  callId: string; criterionId: string; scriptVersionId: string;
  questionSpoken: string; callerWords: string;
  value: unknown | 'UNSURE'; confidence: number;
  readBackConfirmed?: boolean; supersededBy?: string;   // "go back"
};

type Decision = 'LIKELY_ELIGIBLE' | 'NOT_ELIGIBLE' | 'NEEDS_SITE_REVIEW';

type Call = {
  id: string; nctId: string; scriptVersionId: string;
  startedAt: string; endedAt?: string; language: 'en' | 'es' | 'mixed';
  respondent?: 'self' | 'proxy' | 'unclear';      // G10
  relationship?: 'parent_guardian' | 'spouse_partner' | 'adult_child' | 'other_family'
               | 'friend_caregiver' | 'legal_representative' | 'other';
  respondentSwitched?: boolean;                   // one switch allowed; earlier answers superseded
  status: 'consent_declined' | 'incomplete' | 'completed' | 'red_flag' | 'capped' | 'minor_self';  // G5, G10
  transcript: { role: 'agent' | 'caller'; text: string; t: number; lang: string }[];
  toolCalls: { name: string; args: unknown; result: unknown; ms: number }[];
  decision?: Decision; judgeFlags: string[]; heldForReview: boolean;
};

type Referral = {
  callId: string; decision: Decision; nearestSite?: string;
  respondent: 'self' | 'proxy' | 'unclear';
  needsPatientPermission: boolean;                // true for proxy calls (G10)
  contactId?: string;                             // G11; absent = no_contact
  followUp: { state: 'new' | 'attempted' | 'reached' | 'visit_scheduled' | 'declined'
                    | 'not_a_fit' | 'unreachable';
              attempts: { at: string; outcome: string; voicemailLeft: boolean }[] };
  rows: { criterionId: string; question: string; callerWords: string;
          interpreted: unknown; result: 'PASS' | 'FAIL' | 'UNSURE' | 'SITE_CHECK' }[];
  coordinator?: { action: 'accepted' | 'rejected'; reason: string; at: string };
  overrides: { field: string; from: unknown; to: unknown; reason: string; at: string }[];
};

type Contact = {                                  // G11 — separate table, never in transcript
  id: string; callId: string;
  consentAt: string; consentWordingVersion: string;
  firstName: string; phoneE164: string;
  voicemailOk: boolean; bestTime?: 'morning' | 'afternoon' | 'evening' | 'any';
  language: 'en' | 'es'; zip?: string;
  deleteAfter: string;                            // retention (default 90 days after close)
};                                                // Track A demo: never persisted

type AuditEvent = { id: string; at: string; actor: string; type: string;
                    payload: unknown; prevHash: string; hash: string };
```

### Decision engine rules (Addendum G2)

```
per criterion:
  confirm_at_site                            → SITE_CHECK
  no answer / UNSURE                         → UNSURE
  confidence < threshold                     → UNSURE
  rule passes                                → PASS
  rule fails and read-back confirmed         → FAIL
  rule fails and not confirmed               → UNSURE

per group (logic any): any PASS → PASS · all FAIL → FAIL · else UNSURE

call:
  any FAIL                                   → NOT_ELIGIBLE
  else any UNSURE                            → NEEDS_SITE_REVIEW
  else                                       → LIKELY_ELIGIBLE   (SITE_CHECK items listed as pending)
```

Read-back is triggered for **any** answer that would FAIL, inclusion or exclusion. Only the latest non-superseded answer per criterion counts (G6). Incomplete, declined and red-flag calls get no decision.

The engine never sees free text. It takes `Answer[]` + `Criterion[]` and returns `Decision` + per-row results. 100% unit-test coverage on every `op`.

---

## 5. Track A — Phased plan (≈ 4 weeks solo)

Each phase ends with something demoable.

### Phase 1 — Script (week 1)

| Task | Done when |
|---|---|
| Scaffold Next.js + Tailwind + shadcn + Dexie + Zod; demo banner on every page | App runs on Vercel with the banner |
| `lib/ctgov.ts`: fetch study by NCT ID, map to `Trial` | 5 real recruiting trials ingest correctly, including age/sex/locations |
| Split eligibility text into inclusion / exclusion bullets (deterministic pre-pass) | Bullets match the registry layout on the 5 trials |
| Script builder prompt (Sonnet-class) with JSON-schema tool output → `Criterion[]`, groups, proxy wording, alternates, glossary | Zod validation passes; `sourceText` substring check passes; coverage bar at 100% before approval |
| Age / sex rows generated by code from structured fields (G4) | Shown as locked "registry-derived" rows in the editor |
| Pre-build scripts for 3–5 demo trials and commit as JSON | Demo works with no API key |
| Editor: side-by-side source ↔ question, edit question / alt phrasings / rule | Edits save as a new draft version |
| Version diff + approval lock (approver, IRB ref, date, SHA-256) | Locked versions can't be edited; any change creates v+1 |
| Stale check on page load | Changed `lastUpdatePostDate` marks script stale and pauses calls |

### Phase 2 — Call (week 2)

| Task | Done when |
|---|---|
| `lib/engine.ts` decision engine + Vitest suite | All ops, OR-groups, age ranges and supersede logic covered; FAIL only with confirmed read-back |
| Agent state machine per Addendum G5: disclosure → consent → who-for (G10) → questions → read-backs → closing read-back → contact (G11) → close | Full text-mode call completes end to end; declined / silence / hang-up / cap paths each tested |
| Keyless interpreter: yes/no, numbers, durations, "not sure", "repeat", "go back" | Parser tests pass on ~100 sample utterances |
| LLM interpreter (Haiku-class) behind the same interface; "just tell me I qualify" classified as an answer | Toggling the key switches modes with no other change |
| Voice I/O: Web Speech STT/TTS, live captions, progress bar ("Question 4 of 11"), speech-rate slider | Chrome and Safari voice calls work; Firefox falls back to text |
| Fixed replies: medical-advice question, "I'm not sure", ask-for-a-human, repeat / clarify via alternates + glossary (G7), three closing lines (G2) | Each covered by a Playwright text-mode test; caller never hears "eligible" |
| Proxy flow (G10): who-for + relationship, proxy wording everywhere, minor stop, one mid-call switch with restart | Judge finds 0 self-wording lines after a proxy answer; minor persona stops before question 2 |
| Contact capture (G11): opt-in, name, phone parser (EN/ES digits, libphonenumber), grouped digit read-back, typed fallback, voicemail OK | Phone parser tests pass; no number stored without a confirmed read-back; demo mode persists nothing |
| Red-flag stop per Addendum G9: 6 categories, keyword + classifier, "happening right now?" check, emergency and crisis messages | Red-flag test phrases stop the call 100% of the time; historical mentions don't |

### Phase 3 — Referral, coordinator, quality (week 3)

| Task | Done when |
|---|---|
| Referral summary: per-criterion table, nearest site, "may be a fit — the study team will confirm" | Printable; never uses the word "eligible" toward the caller |
| Coordinator queue: tabs for Likely / Needs review / Not eligible (for FN sampling) / Red flag; accept / reject with reason, overrides with required reason | Every action writes a hash-chained audit event |
| Follow-up workflow (G11): contact attempts, voicemail flag, unreachable after 3; proxy patient-permission banner (G10); transcript redaction of name/phone | Time-to-first-contact and opt-in rate show on the insights page |
| Call console: transcript, per-step latency, tool-call trace | Replayable for any stored call |
| Post-call judge (key mode): off-script claims, missing disclosure, advice-giving | Flagged calls are held from the queue |
| English ↔ Spanish: per-turn detection, `es-US` voices, Spanish questions from the script | A mid-call switch keeps the same question position |
| Nearest site from ZIP | Shows closest recruiting location and distance |
| Embed widget: `/embed/[slug]` + `embed.js` that injects an iframe | Works on a plain HTML test page |

### Phase 4 — Evals, insights, ship (week 4)

| Task | Done when |
|---|---|
| Simulated callers (text mode): personas from PRD §9 with ground-truth eligibility | `/evals` runs 20 personas per demo trial |
| Gate report: decision accuracy ≥ 90%, FN ≤ 5%, FP ≤ 15%, red-flag 100%, off-script claims 0 | Gates shown pass/fail; Vitest + Playwright run in GitHub Actions |
| Funnel + criterion drop-off page | Charts populate from stored calls |
| Export / import all data as JSON | Coordinator view can be shown on another machine |
| README (architecture diagram from Addendum G8), walkthrough video, portfolio page | Ready to share |

### Repo layout

```
app/                    routes from §3
lib/ctgov.ts            registry client
lib/script/             builder prompt, schemas, pre-built scripts
lib/engine.ts           decision engine (no LLM imports allowed — enforced by ESLint rule)
lib/agent/              state machine, tools, interpreter (rule + LLM adapters)
lib/voice/              SpeechAdapter interface + WebSpeech implementation
lib/store/              Dexie tables, audit hash chain
lib/judge.ts
evals/personas/         simulated caller definitions
tests/                  Vitest + Playwright
```

**Adapter interfaces are the bridge to Track B:** `SpeechAdapter` (WebSpeech → LiveKit), `Interpreter` (rules / browser LLM → server LLM), `Store` (Dexie → Postgres API). Pages don't change.

---

## 6. Track B — Production MVP (what to add on top of Track A)

Follows PRD §11 and §14. Only build these once a pilot partner exists.

| Add | Replaces in Track A | Notes |
|---|---|---|
| Postgres (Supabase/Neon) + Drizzle | Dexie | Same schema as §4; shared multi-user data |
| Auth (Clerk / Supabase Auth) with roles: admin, approver, coordinator | Free-text approver name | Attributable approvals for Part 11-style controls |
| Route handlers: `POST /api/trials`, `/build` (SSE), `/scripts/[id]/approve`, `/call-token`, `/voice/webhook` | Browser LLM calls | Keys move server-side |
| LiveKit Cloud room + Python LiveKit Agents worker (Deepgram/AssemblyAI STT, Haiku-class LLM, Cartesia/ElevenLabs TTS) | Web Speech API | Meets ≤1.2 s p50 / ≤2 s p95; pre-rendered disclosure audio; recording |
| Decision engine ported to Python (or called via internal API) with the same test vectors | TS engine | Shared JSON test fixtures guarantee identical results |
| Upstash Redis rate limits, signed short-lived call tokens, embed domain allowlist | — | Abuse and cost control |
| Nightly protocol-change cron (Vercel Cron) | Check on page load | Pauses calls automatically |
| Email to coordinators (Resend / SES) | Local queue only | |
| Async judge job, monitoring + alerts from PRD §10 | Browser judge | |
| Encrypted recording storage, retention + deletion job, BAAs | — | Required before real callers |
| SIP inbound (P2) | — | LiveKit SIP |

Timeline: the PRD's 8-week plan (Nov 2 – Dec 24) is realistic for Track B only if Track A's Phases 1–2 are reused. Critical path is unchanged: the 30-trial golden set and the clinical reviewer, plus vendor BAAs and approved emergency wording.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Script builder misses or merges criteria | False negatives | Coverage check (every source bullet mapped), human approval required, golden set |
| Browser STT mishears numbers/negations | Wrong answers | Read-back on all exclusions; low confidence → Unsure |
| API key in the browser (Track A) | Key leak | Keyless default; user-supplied key only, stored locally, never committed |
| Demo mistaken for a real screener | Patient harm / reputational | Persistent "demo — not affiliated" banner; no referrals leave the browser |
| Registry text incomplete vs. full protocol | Wrong referrals | Labs/record criteria → confirm at site; summary always says the team will confirm |
