# Trial2Voice — 2-minute walkthrough script

Same format as the Pre-Auth demo: a voiceover over animated scenes built from the app's own UI. About 245 words, roughly 2:00–2:10 at a natural pace. Read the narration column; the right column is what appears on screen.

| # | Narration (read this) | On screen |
|---|---|---|
| 1 | Clinical trials struggle to enroll. Fewer than half of surgical trials hit their enrollment target. When a patient does find a trial, they face pages of dense criteria and a phone line that's open nine to five. And coordinators spend their time screening callers who were never a fit. | Eyebrow "WHY TRIALS STALL". Headline "Clinical trials **can't find patients.**" A registry page full of criteria stacks up. Stat card: "45.9% hit their enrollment target". A clock card: "9–5 phone line". |
| 2 | This prototype turns a trial's registry entry into a voice pre-screener. Two rules: the AI asks, but a rules engine decides. And nothing reaches a caller until the study team approves it. | Headline "One registry entry. **A voice pre-screener.**" Three cards slide in: AI (asks and understands) · Rules engine (decides) · Study team (approves and confirms). Then "RULE 1 · The AI never decides." and "RULE 2 · Nothing goes live unapproved." |
| 3 | Let me show you one case. Maria, fifty-two, has type 2 diabetes. It's nine at night, and she wants to know about a diabetes study. | Headline "Let me show you **one case.**" Caller card: "Maria, 52 · Type 2 diabetes · 9:04 PM". |
| 4 | First, the study team's side. Claude turned thirty-one registry criteria into fourteen plain questions, in English and Spanish. Lab checks are left for the site visit. A person reviewed the script and locked it. | Script editor: a registry bullet highlights its question (EN and ES). Coverage bar fills to "31 / 31 covered". Badges: "14 asked · 35 site checks". Lock stamp: "Approved · IRB-2026-0142 · fingerprint". |
| 5 | Now Maria's call. The agent says it's an AI and asks for her consent. She answers in her own words. When she says yes to using an insulin pump, which would rule her out, the agent reads it back first. She misheard. She says so, and the agent simply asks again. | Call screen with captions and "Question 7 of 14". Disclosure bubble. Her "yes" bubble, then the read-back highlighted: "So you have used an insulin pump in the last 3 months — is that right?" Her reply: "No, that's wrong." |
| 6 | Halfway through, she switches to Spanish, and so does the agent. | The next question appears in Spanish. A small "English → Español" tag. |
| 7 | At the end, she hears that she may be a fit, never that she's eligible, and which site will call her. | Closing line card: "You may be a fit. The study team at Henry Ford Health System will contact you within 3 business days." The word "eligible" struck out beside it. |
| 8 | The coordinator gets a traced referral: every question, Maria's exact words, and the result. One click to accept. | Referral page: trace table rows (question · caller's words · result), "14 of 14 asked passed · 35 to confirm at site", nearest site. Cursor clicks "Accept for screening visit". |
| 9 | Before any release, sixty simulated callers run through the real agent, and every safety gate has to pass. | Eval gate table, every row "pass": decision accuracy 100%, missed eligible callers 0%, red flags stopped 100%. |
| 10 | One case, end to end. A registry entry became an approved script. A patient got screened after hours, in her own language. And the site got a referral it can trust. | Eyebrow "ONE CASE · END TO END". Three numbers count up: "31 criteria → 14 questions", "9:04 PM, in Spanish", "1 traced referral". End card: logo, "Trial2Voice", "The AI asks. The rules decide. The study team confirms." and trial2voice.sankar.work. |

## Recording tips

- **One take is fine.** Pause for about a second between numbered scenes; I'll cut the scenes to your pauses.
- **Pronunciation:** "Trial2Voice" is *trial-to-voice*.
- **Format:** any audio file works (m4a, mp3 or wav). A quiet room matters more than the microphone.
