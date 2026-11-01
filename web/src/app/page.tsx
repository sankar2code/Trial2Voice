import Link from "next/link";

const steps = [
  ["Ingest", "Pull a study from ClinicalTrials.gov by NCT ID."],
  ["Draft", "Turn each criterion into a plain spoken question, in English and Spanish, with a decision rule."],
  ["Review", "Edit side by side with the registry text. Every registry bullet must be covered."],
  ["Approve & lock", "Record the approver and IRB reference. The version is frozen and fingerprinted."],
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
        <Link href="/settings" className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-50">
          Add an API key (optional)
        </Link>
      </div>
      <p className="mt-4 text-xs text-muted">
        Phase 1 of the prototype: script building and approval. Voice calls arrive in Phase 2.
      </p>
    </div>
  );
}
