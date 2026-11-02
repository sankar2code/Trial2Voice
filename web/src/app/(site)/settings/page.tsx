"use client";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { KeysExplainer } from "@/components/KeysExplainer";
import { saveSettings, useSettings } from "@/lib/settings";
import { DEFAULT_BUILD_MODEL } from "@/lib/script/builder";
import { DEFAULT_CALL_MODEL } from "@/lib/call/llmInterpreter";
import { getSiteVoices, type SiteVoices } from "@/lib/voice/elevenlabs";
import { TABLES, backupCounts, exportAll, importAll, validateBackup, type Backup } from "@/lib/store/backup";

export default function SettingsPage() {
  const s = useSettings();
  const [key, setKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <KeysExplainer />

      <Card className="p-5 space-y-4">
        <Field label="Your name" hint="Recorded in the audit log for every change you make.">
          <Input value={s.actor} onChange={(e) => saveSettings({ actor: e.target.value })} />
        </Field>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-medium">Anthropic API key (optional)</h2>
          <p className="text-sm text-muted mt-1">
            Needed only to build scripts for new trials. The demo trials work without it. The key is saved in this
            browser only and sent only to the Anthropic API.
          </p>
        </div>
        <Field label="API key">
          <Input
            type="password"
            autoComplete="off"
            placeholder={s.apiKey ? "•••••••• (saved)" : "sk-ant-…"}
            value={key ?? ""}
            onChange={(e) => {
              setKey(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={!key}
            onClick={() => {
              saveSettings({ apiKey: key!.trim() });
              setKey(null);
              setSaved(true);
            }}
          >
            Save key
          </Button>
          {s.apiKey && (
            <Button variant="danger" onClick={() => saveSettings({ apiKey: "" })}>
              Remove key
            </Button>
          )}
          {saved && <span className="text-sm text-green-700 self-center">Saved.</span>}
        </div>
        <Field label="Script-builder model" hint={`Default: ${DEFAULT_BUILD_MODEL}`}>
          <Input value={s.buildModel} onChange={(e) => saveSettings({ buildModel: e.target.value })} />
        </Field>
        <label className="flex gap-2 items-start text-sm">
          <input type="checkbox" className="mt-1" checked={s.useLlmInCalls} onChange={(e) => saveSettings({ useLlmInCalls: e.target.checked })} />
          <span><span className="font-medium">Use Claude to understand caller answers.</span> <span className="text-muted">Needs a key. Without it, calls use the built-in keyword parser. Claude never decides the outcome.</span></span>
        </label>
        <Field label="In-call model" hint={`Default: ${DEFAULT_CALL_MODEL}`}>
          <Input value={s.callModel} onChange={(e) => saveSettings({ callModel: e.target.value })} />
        </Field>
      </Card>

      <ElevenLabsSettings />

      <DataSettings />
    </div>
  );
}

function ElevenLabsSettings() {
  const s = useSettings();
  const [site, setSite] = useState<SiteVoices | null>(null);
  useEffect(() => {
    let live = true;
    void getSiteVoices().then((v) => live && setSite(v));
    return () => {
      live = false;
    };
  }, []);
  const available = Boolean(site?.configured && site.voices.length);

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-medium">Agent voice</h2>
        <p className="text-sm text-muted mt-1">
          No key needed. This site can provide natural ElevenLabs voices; otherwise your browser&apos;s built-in voices
          are used. Only the agent&apos;s voice changes — listening and the call logic stay in your browser. If the
          site&apos;s voice service fails during a call, the browser voice takes over.
        </p>
      </div>
      <div className="text-sm">
        {site === null ? (
          <span className="text-muted">Checking this site&apos;s voices…</span>
        ) : available ? (
          <>
            <span className="text-green-700">ElevenLabs voices are provided by this site ({site.voices.length} available{site.model ? `, ${site.model}` : ""}).</span>
            {site.warning && <span className="block text-xs text-muted mt-1">Using the configured default voices; the full voice list couldn&apos;t be loaded ({site.warning}).</span>}
          </>
        ) : site.configured ? (
          <span className="text-amber-800">This site&apos;s ElevenLabs voices aren&apos;t available right now{site.error ? ` (${site.error})` : ""}. Browser voices are used.</span>
        ) : (
          <span className="text-muted">This site doesn&apos;t provide ElevenLabs voices, so browser voices are used.</span>
        )}
      </div>
      {available && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Voice source">
          {(["elevenlabs", "browser"] as const).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={s.ttsProvider === p}
              onClick={() => saveSettings({ ttsProvider: p })}
              className={`rounded-md border px-3 py-1.5 text-sm ${s.ttsProvider === p ? "border-accent bg-accent-soft" : "border-border"}`}
            >
              {p === "elevenlabs" ? "Site voices (ElevenLabs)" : "Browser voices"}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Pick the exact voice, and preview it, on the call screen.</p>
    </Card>
  );
}

function DataSettings() {
  const s = useSettings();
  const [pending, setPending] = useState<{ name: string; backup: Backup } | null>(null);
  const [mode, setMode] = useState<"replace" | "merge">("merge");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const doExport = async () => {
    setResult(null);
    const backup = await exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial2voice-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pick = async (file: File | undefined) => {
    setResult(null);
    setPending(null);
    if (!file) return;
    try {
      setPending({ name: file.name, backup: validateBackup(JSON.parse(await file.text())) });
    } catch (e) {
      setResult({ ok: false, message: e instanceof SyntaxError ? "That file isn't valid JSON." : e instanceof Error ? e.message : "Couldn't read that file." });
    }
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await importAll(pending.backup, mode, s.actor || "unknown");
      const written = TABLES.map((t) => `${t} ${r.counts[t] ?? 0}`).join(", ");
      setResult({ ok: r.auditChainOk, message: `Imported (${mode}): ${written}. Audit chain ${r.auditChainOk ? "verified" : "FAILED verification — the log may have been edited"}.` });
      setPending(null);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Import failed." });
    } finally {
      setBusy(false);
    }
  };

  const counts = pending && backupCounts(pending.backup);

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-medium">Data</h2>
        <p className="text-sm text-muted mt-1">
          Move everything in this browser — trials, scripts, calls, referrals, eval runs and the audit log — to another
          machine. The file contains call transcripts (demo data only) and no API keys or settings.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={doExport}>Export all data</Button>
        <label className="inline-flex items-center justify-center rounded-md text-sm px-3 py-1.5 font-medium border border-border bg-surface hover:bg-stone-50 cursor-pointer">
          Import…
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {pending && counts && (
        <div className="rounded-md border border-border p-3 space-y-3">
          <p className="text-sm">
            <span className="font-medium">{pending.name}</span> <span className="text-muted">exported {new Date(pending.backup.exportedAt).toLocaleString()}</span>
          </p>
          <ul className="text-sm grid grid-cols-2 gap-x-4">
            {TABLES.map((t) => (
              <li key={t} className="flex justify-between"><span className="text-muted">{t}</span><span>{counts[t]}</span></li>
            ))}
          </ul>
          <div className="space-y-1 text-sm" role="radiogroup" aria-label="Import mode">
            <label className="flex gap-2 items-start">
              <input type="radio" className="mt-1" checked={mode === "merge"} onChange={() => setMode("merge")} />
              <span><span className="font-medium">Merge</span> <span className="text-muted">— add and update rows by id. Refused if the audit logs are different histories.</span></span>
            </label>
            <label className="flex gap-2 items-start">
              <input type="radio" className="mt-1" checked={mode === "replace"} onChange={() => setMode("replace")} />
              <span><span className="font-medium">Replace</span> <span className="text-muted">— delete all data in this browser first, then restore the file as-is.</span></span>
            </label>
          </div>
          <div className="flex gap-2">
            <Button variant={mode === "replace" ? "danger" : "primary"} disabled={busy} onClick={apply}>
              {busy ? "Importing…" : mode === "replace" ? "Replace all data" : "Merge data"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {result && <p role="status" className={`text-sm ${result.ok ? "text-green-700" : "text-red-700"}`}>{result.message}</p>}
    </Card>
  );
}
