"use client";
import { useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { saveSettings, useSettings } from "@/lib/settings";
import { DEFAULT_BUILD_MODEL } from "@/lib/script/builder";
import { DEFAULT_CALL_MODEL } from "@/lib/call/llmInterpreter";

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
    </div>
  );
}
