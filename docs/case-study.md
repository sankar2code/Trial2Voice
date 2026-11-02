# Case study: Trial2Voice

**Role:** product manager and engineer (solo) · **Status:** working prototype (Track A, browser-only) · **Stack:** Next.js, TypeScript, IndexedDB, Claude (Sonnet 5.5 for building scripts and reviewing calls, Haiku 5.5 for reading answers during calls), Web Speech and ElevenLabs.

## The problem

Enrollment is the step trials most often miss. In one study of 2,542 surgical RCTs, only 45.9% met their enrollment target (JAMA Network Open, 2023). Interested patients face dense free-text criteria and a site phone line staffed in business hours. Coordinators spend time on callers who are clearly ineligible.

The people involved need different things:

| Who | Job | What earns their trust |
|---|---|---|
| Caller (patient or caregiver) | Find out quickly, in my language, whether this trial could fit me | Clear AI disclosure, no pressure, a person makes the call |
| Site coordinator | Spend screening time on likely candidates | Every answer traced to a criterion; can override anything |
| IRB | Approve the script before any patient hears it | A locked, versioned script the agent can't stray from |

## The decision that shaped everything

**The LLM asks and interprets; a deterministic engine decides; the site confirms.**

The LLM is good at the parts rules can't do: turning free-text criteria into plain spoken questions, and understanding "my sugar's been high for years". It is a poor place to put the judgment. So the model's output is always a structured answer (yes/no, a number, an option), and a small, unit-tested engine turns structured answers into a status. A lint rule forbids the engine from importing any AI code.

Two consequences follow:

- **False negatives are the costliest error.** Screening out an eligible patient is worse than sending the site an extra referral. So an answer can only screen someone out after the caller confirms a read-back. Anything hedged, low-confidence or disputed becomes "Needs site review", never "Not eligible".
- **The agent never improvises.** Every line it speaks is either an approved script question, an approved alternate phrasing or glossary entry, or a fixed line awaiting IRB wording. A post-call judge checks this on every call and holds any call that strays.

## Closing the PRD's gaps

Reviewing my own PRD turned up eleven gaps that would have blocked the build ([addendum](prd-addendum-v1.1.md)). Three examples:

- **The PRD had no decision-rule format.** I defined a typed criterion schema, with any-of groups for "A or B" criteria and code-generated age and sex rows.
- **Read-backs covered exclusions only,** but a "no" to an inclusion question screens people out just as hard. Read-back now covers every answer that would screen someone out.
- **The site was promised a callback, but contact details were never collected.** I added opt-in contact capture with a digit-by-digit read-back, redaction in transcripts, and no storage in the demo.

## What I built

Four phases, each demoable:

1. **Script:** ingest by NCT ID, a bullet splitter, a Claude script builder with schema-validated output, a side-by-side editor, a validator, version diff, and an approval lock with a SHA-256 fingerprint. A registry-change check pauses calls when the protocol changes.
2. **Call:** a call state machine covering disclosure, consent, who's calling, questions, read-backs, closing review and contact. It handles red-flag stops (the self-harm stop is immediate), caregivers and children, medical questions, "just say I qualify", silence and the 12-minute cap. Speech runs through the browser, with optional ElevenLabs voices.
3. **Referral:** a coordinator queue and a traced referral with overrides (reason required, re-scored by the same engine), follow-up tracking, a call console, the post-call judge, English ↔ Spanish switching mid-call, the nearest site from a ZIP code, and an embeddable widget.
4. **Ship:** 60 simulated callers with release gates in CI, a funnel and drop-off insights page, and data export/import.

## How I know it works

- **About 600 automated tests,** including 60 end-to-end simulated calls across three real recruiting trials. The callers include eligible and ineligible patients, vague answers, background noise, an English → Spanish switch, medical-advice questions, "just say I qualify", current chest pain, self-harm, caregivers, children calling alone, and a misheard phone number.
- **Release gates from the PRD**, enforced in CI:
  - decision accuracy ≥ 90%
  - false-negative rate ≤ 5% and false-positive rate ≤ 15%
  - red flags stopped 100% of the time
  - zero off-script lines and zero "you" wording on caregiver calls
  - phone numbers exactly right ≥ 98%
- **Gates catch real bugs.** The first full run failed one gate: a stammered "no no" was scored as uncertain. It erred in the safe direction (site review, not a wrong rejection), but it showed up in the gate report before any person did.

## What I'd do next

- **Pilot (Track B):**
  - Move keys and data behind a server (Postgres, auth).
  - Use LiveKit for real-time voice with BAA-covered speech vendors, and get IRB approval of every fixed line.
  - Run a nightly registry check.
- **Measure the North Star:** the share of "likely eligible" referrals a coordinator accepts (target ≥ 70%), plus a weekly sample of "not eligible" calls to measure missed eligible callers in production.
- **Close the feedback loop:** feed reject reasons and drop-off by criterion back into reworded questions, then into a new script version that goes through re-approval. Nothing changes a live script without approval.
