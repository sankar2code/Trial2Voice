# Trial2Voice — 5-minute walkthrough (recording script)

For a screen recording. Use a fresh browser profile (or Settings → Data → Replace with an empty file), Chrome or Safari, sound on. Times are targets.

## 0:00 — The problem (20 s)
**Show:** the home page.
**Say:** "Only about half of surgical trials hit their enrollment target. Patients face dense criteria and a phone line open in business hours. Trial2Voice turns a trial's registry entry into a voice pre-screener in many languages, but nothing reaches a caller until a person approves it."

## 0:20 — Ingest and draft (60 s)
**Do:**
1. Trials → **Load demo trials**, then open **MODIUS**.
2. Click a registry bullet on the left, and point at the questions it highlights.
3. Expand one question to show the English, Spanish and caregiver wording and its decision rule.

**Say:** "Claude split each criterion into single facts and wrote one spoken question per fact. Lab values and anything needing the investigator's judgment go to a site check instead of the call. Age and sex come straight from the registry fields, never from the model. Every question quotes its source sentence, and the coverage bar has to reach 100% before approval."
**Optional:** with an API key, add a new NCT ID and click **Build with Claude**.

## 1:20 — Approve and lock (30 s)
**Do:** **Approve & lock** → IRB reference → confirm. Then open the **Approval** tab.
**Say:** "Approval records who approved it and the IRB reference, and freezes this version with a fingerprint. Any edit after this needs a new version. **Simulate registry change** shows that when the registry record changes, calls pause until a new version is approved."

## 1:50 — A call (90 s)
**Do:**
1. **Start a test call** → English → Talk.
2. Answer a few questions naturally, then ask "is it safe?" and hear the fixed reply.
3. Say "yes" to the insulin pump, then correct it at the read-back.
4. Say a Spanish sentence and hear the call switch to Spanish.
5. Finish: give a name, the demo phone number (555) 555-0100, and ZIP 48201.

**Say:** "The agent only ever reads approved lines. The AI's job ends at turning what you said into a structured answer; a rules engine decides. Anything that would screen you out is read back first. The ending never says 'eligible'. It says you may be a fit, and names the nearest site."

## 3:20 — The coordinator (60 s)
**Do:**
1. Coordinator → open the referral and scroll the trace table.
2. Override one row, with a reason.
3. Accept the referral, then log a contact attempt.
4. Open the **Call console**.

**Say:** "Every answer is traced: the question asked, the caller's exact words, what was understood, and the result. Overrides need a reason and go into a hash-chained audit log. The call console shows every step the agent took, with timings."

## 4:20 — Quality and evals (40 s)
**Do:** **Evals** → Run → show the gate table. Then **Insights** → select MODIUS → show criterion drop-off.
**Say:** "Before any release, 60 simulated callers run through the real agent. They're eligible, ineligible, vague, noisy, switching language, asking for medical advice, reporting chest pain. A release ships only if decision accuracy is at least 90% and missed eligible callers stay under 5%. Drop-off by criterion tells the sponsor which criteria turn away the most interested callers."

## 5:00 — Close (10 s)
**Say:** "This prototype runs entirely in the browser. The production path moves the keys, the voice and the data behind a server with HIPAA agreements in place. The pages and the rules stay the same."
