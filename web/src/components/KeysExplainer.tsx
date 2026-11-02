// "Bring your own key": how API keys work in this browser-only prototype.
import { Card } from "@/components/ui";

const COLUMNS = [
  {
    title: "Without any key",
    note: "Free — the whole demo works",
    items: [
      "Demo trials with pre-built scripts",
      "Full calls, with the built-in answer parser",
      "Browser voices",
      "Coordinator queue, insights, evals and export",
    ],
  },
  {
    title: "With an Anthropic key",
    note: "Your Anthropic account pays",
    items: [
      "Build scripts for any NCT ID (Claude Sonnet 5.5)",
      "Claude reads caller answers (Claude Haiku 5.5)",
      "Claude reviews each finished call",
      "Evals with Claude reading the answers",
    ],
  },
  {
    title: "ElevenLabs voices",
    note: "No key needed — provided by this site",
    items: ["Natural agent voices, when the site owner has set them up", "Otherwise your browser's built-in voices"],
  },
];

export function KeysExplainer() {
  return (
    <Card className="p-5 space-y-4">
      <div id="api-keys" className="scroll-mt-20">
        <h2 className="font-medium">How API keys work: bring your own Claude key</h2>
        <p className="text-sm text-muted mt-1">
          The only key you&apos;ll ever be asked for is an Anthropic (Claude) key, and only for the AI-powered extras.
          It stays in your browser and your Anthropic account pays for what you use. The natural ElevenLabs voices are
          provided by the site owner through this site&apos;s server, so their key never reaches your browser.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {COLUMNS.map((c) => (
          <div key={c.title} className="rounded-md border border-border p-3">
            <div className="text-sm font-medium">{c.title}</div>
            <div className="text-xs text-muted mb-2">{c.note}</div>
            <ul className="text-sm space-y-1 list-disc pl-4">
              {c.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div className="text-sm space-y-2">
        <p>
          <span className="font-medium">Keep your key safe.</span>{" "}
          <span className="text-muted">
            A key saved here is visible in this browser&apos;s developer tools. Use your own key with a low spending
            limit, only on a device you trust, and remove it when you&apos;re done.
          </span>
        </p>
        <p>
          <span className="font-medium">In a real deployment,</span>{" "}
          <span className="text-muted">
            keys would live on a server, owned by the sponsor or study site, and never be visible to callers or
            coordinators. Patients calling a trial line would never need a key. That server would also set usage limits
            and short-lived call tokens, and would need HIPAA agreements (BAAs) with the AI and voice providers. The
            pages stay the same; only where the AI calls are made from changes.
          </span>
        </p>
      </div>
    </Card>
  );
}
