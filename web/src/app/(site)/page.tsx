import Link from "next/link";

const steps = [
  ["Ingest", "Pull a study from ClinicalTrials.gov by NCT ID."],
  ["Draft", "Turn each criterion into a plain spoken question, in English and Spanish, with a decision rule."],
  ["Review & lock", "Check every question against the registry text, then lock it with the approver and IRB reference."],
  ["Call", "A voice or typed pre-screen with AI disclosure, read-backs, red-flag stops and caregiver support."],
  ["Refer", "A rules engine scores the answers; the coordinator gets a traced referral and can override anything."],
  ["Check quality", "Every call is checked against the approved script; simulated callers gate each release."],
];

export default function Home() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">From NCT ID to an approved pre-screening script</h1>
      <p className="mt-3 text-muted">
        Trial2Voice drafts a phone pre-screening script from a trial&apos;s registry record. A person reviews it,
        and calls only run on a locked, approved version. The AI asks and interprets; a rules engine decides; the
        study site confirms.
      </p>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2">
        {steps.map(([t, d], i) => (
          <li key={t} className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-muted">Step {i + 1}</div>
            <div className="font-medium">{t}</div>
            <p className="text-sm text-muted mt-1">{d}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/admin/trials" className="rounded-md bg-accent text-white px-4 py-2 text-sm font-medium hover:bg-teal-800">
          Open trials
        </Link>
        <Link href="/coordinator" className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-50">
          Coordinator queue
        </Link>
      </div>
      <div className="mt-8 rounded-lg border border-border bg-surface p-4 text-sm">
        <div className="font-medium">Works without API keys</div>
        <p className="text-muted mt-1">
          The demo trials, calls, coordinator queue, insights and evals all run free in your browser, with natural
          voices provided by the site. For the AI-powered extras (building scripts for any trial, Claude reading
          answers and reviewing calls) you add your own Claude key, which stays in your browser and is billed to your own
          account.{" "}
          <Link href="/settings#api-keys" className="text-accent underline">How API keys work</Link>
        </p>
      </div>
    </div>
  );
}
