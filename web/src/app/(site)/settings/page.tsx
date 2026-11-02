"use client";
import { useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { saveSettings, useSettings } from "@/lib/settings";
import { DEFAULT_BUILD_MODEL } from "@/lib/script/builder";
import { DEFAULT_CALL_MODEL } from "@/lib/call/llmInterpreter";
import { DEFAULT_ELEVEN_MODEL, listElevenVoices } from "@/lib/voice/elevenlabs";
import { TABLES, backupCounts, exportAll, importAll, validateBackup, type Backup } from "@/lib/store/backup";

export default function SettingsPage() {
  const s = useSettings();
  const [key, setKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

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
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "ok" | "error"; message?: string }>({ state: "idle" });

  const test = async (apiKey: string) => {
    setCheck({ state: "checking" });
    try {
      const voices = await listElevenVoices(apiKey);
      setCheck({ state: "ok", message: `Connected — ${voices.length} voice${voices.length === 1 ? "" : "s"} available. Pick one on the call screen.` });
      return true;
    } catch (e) {
      setCheck({ state: "error", message: e instanceof Error ? e.message : "Couldn't reach ElevenLabs." });
      return false;
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-medium">Agent voice</h2>
        <p className="text-sm text-muted mt-1">
          Browser voices are free and built in. ElevenLabs voices sound more natural; they need your ElevenLabs key,
          which is saved in this browser only and sent only to ElevenLabs. Only the agent&apos;s voice uses ElevenLabs —
          listening and the call logic stay in the browser. If ElevenLabs fails during a call, the browser voice takes over.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Voice provider">
        {(["browser", "elevenlabs"] as const).map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={s.ttsProvider === p}
            onClick={() => saveSettings({ ttsProvider: p })}
            className={`rounded-md border px-3 py-1.5 text-sm ${s.ttsProvider === p ? "border-accent bg-accent-soft" : "border-border"}`}
          >
            {p === "browser" ? "Browser voices" : "ElevenLabs"}
          </button>
        ))}
      </div>

      {s.ttsProvider === "elevenlabs" && (
        <>
          <Field label="ElevenLabs API key">
            <Input
              type="password"
              autoComplete="off"
              placeholder={s.elevenApiKey ? "•••••••• (saved)" : "Paste your ElevenLabs key"}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setCheck({ state: "idle" });
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              variant="primary"
              disabled={!key.trim() || check.state === "checking"}
              onClick={async () => {
                const k = key.trim();
                if (await test(k)) {
                  saveSettings({ elevenApiKey: k });
                  setKey("");
                }
              }}
            >
              {check.state === "checking" ? "Checking…" : "Save key"}
            </Button>
            {s.elevenApiKey && !key && (
              <>
                <Button onClick={() => test(s.elevenApiKey)} disabled={check.state === "checking"}>Test saved key</Button>
                <Button variant="danger" onClick={() => { saveSettings({ elevenApiKey: "", elevenVoice: { en: "", es: "" } }); setCheck({ state: "idle" }); }}>Remove key</Button>
              </>
            )}
          </div>
          {check.message && <p className={`text-sm ${check.state === "ok" ? "text-green-700" : "text-red-700"}`}>{check.message}</p>}
          <Field label="ElevenLabs model" hint={`Default: ${DEFAULT_ELEVEN_MODEL} (low latency, many languages). eleven_flash_v2_5 is a cheaper fast option.`}>
            <Input value={s.elevenModel} onChange={(e) => saveSettings({ elevenModel: e.target.value.trim() || DEFAULT_ELEVEN_MODEL })} />
          </Field>
          <p className="text-xs text-muted">
            Demo only: the key is visible in this browser&apos;s developer tools. Set a low spending limit on it, and
            don&apos;t use it on a shared or public deployment. Real patient calls need a BAA with ElevenLabs.
          </p>
        </>
      )}
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
