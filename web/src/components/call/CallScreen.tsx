"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, Input, cx } from "@/components/ui";
import { db } from "@/lib/store/db";
import { activeLocked, saveCall } from "@/lib/store/repo";
import { completeCall, runLlmJudge } from "@/lib/store/referrals";
import { nearestSiteForZip } from "@/lib/sites";
import type { ScriptVersion } from "@/lib/types";
import { CallSession, type AgentLine, type Turn } from "@/lib/call/session";
import { keywordInterpreter } from "@/lib/call/parse";
import { LlmInterpreter } from "@/lib/call/llmInterpreter";
import { getSettings, saveSettings, useSettings } from "@/lib/settings";
import { listVoices, listenOnce, loadVoices, speechInputSupported, speechOutputSupported } from "@/lib/voice/webspeech";
import { speakLine, stopAllSpeech } from "@/lib/voice/tts";
import { listElevenVoices, type ElevenVoice } from "@/lib/voice/elevenlabs";
import type { CallRecord, Lang } from "@/lib/call/types";

type Caption = { role: "agent" | "caller"; text: string; key: number };
type Status = "idle" | "speaking" | "listening" | "thinking" | "waiting" | "ended";

const UI = {
  en: { start: "Start call", repeat: "Repeat", notSure: "Not sure", back: "Go back", end: "End call", type: "Type your answer", send: "Send", question: "Question", of: "of", phone: "Type your phone number, e.g. (555) 555-0100" },
  es: { start: "Empezar llamada", repeat: "Repetir", notSure: "No estoy seguro", back: "Regresar", end: "Terminar", type: "Escriba su respuesta", send: "Enviar", question: "Pregunta", of: "de", phone: "Escriba su número, por ejemplo (555) 555-0100" },
};
const CANNED = {
  en: { repeat: "Can you repeat that?", notSure: "I'm not sure", back: "Go back" },
  es: { repeat: "¿Puede repetir?", notSure: "No estoy seguro", back: "Regresar" },
};
const FILLER = { en: "One moment.", es: "Un momento." };
const SAMPLE = {
  en: "Hi, I'm an AI assistant for this study. I'll ask a few short questions.",
  es: "Hola, soy un asistente de inteligencia artificial de este estudio. Le haré unas preguntas cortas.",
};

export function CallScreen({ nctId, embedded = false }: { nctId: string; embedded?: boolean }) {
  const trial = useLiveQuery(async () => (await db().trials.get(nctId)) ?? null, [nctId]);
  const versions = useLiveQuery(() => db().scripts.where("nctId").equals(nctId).toArray(), [nctId]);

  const [lang, setLang] = useState<Lang>("en");
  const [voice, setVoice] = useState(true);
  const [rate, setRate] = useState(1);
  const [supported, setSupported] = useState({ input: false, output: false });
  const [status, setStatus] = useState<Status>("idle");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [phoneHint, setPhoneHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CallRecord | null>(null);
  const [voices, setVoices] = useState<{ name: string; label: string }[]>([]);
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[] | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const settings = useSettings();

  const session = useRef<CallSession | null>(null);
  const scriptRef = useRef<ScriptVersion | null>(null);
  const stopListening = useRef<() => void>(() => {});
  const busy = useRef(false);
  const keyCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef(voice);
  const rateRef = useRef(rate);
  voiceRef.current = voice;
  rateRef.current = rate;

  // Voices load asynchronously and differ per browser and OS.
  useEffect(() => {
    if (!speechOutputSupported()) return;
    let live = true;
    const refresh = () => live && setVoices(listVoices(lang));
    void loadVoices().then(refresh);
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      live = false;
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
    };
  }, [lang]);

  const useEleven = settings.ttsProvider === "elevenlabs" && Boolean(settings.elevenApiKey);
  useEffect(() => {
    if (!useEleven) return setElevenVoices(null);
    const ctrl = new AbortController();
    listElevenVoices(getSettings().elevenApiKey, ctrl.signal)
      .then(setElevenVoices)
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setElevenVoices([]);
        setVoiceNotice(`${e instanceof Error ? e.message : "Couldn't load ElevenLabs voices."} Using browser voices.`);
      });
    return () => ctrl.abort();
  }, [useEleven, settings.elevenApiKey]);

  useEffect(() => {
    const s = { input: speechInputSupported(), output: speechOutputSupported() };
    setSupported(s);
    if (!s.input || !s.output) setVoice(false);
  }, []);

  const addCaption = (role: Caption["role"], text: string) => setCaptions((c) => [...c, { role, text, key: keyCounter.current++ }]);

  const finish = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    stopListening.current();
    stopAllSpeech();
    setStatus("ended");
    setResult(structuredClone(s.record));
    try {
      const referral = scriptRef.current ? await completeCall(s.record, scriptRef.current) : (await saveCall(s.record), null);
      const key = getSettings().apiKey;
      // Optional Claude review of the call (PRD §7 post-call judge); runs in the background.
      if (referral && key) void runLlmJudge(referral.id, key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the call record.");
    }
  }, []);

  // Forward declaration so speakTurn and listen can call each other.
  const handleUtterance = useRef<(text: string) => Promise<void>>(async () => {});

  const listen = useCallback(() => {
    const s = session.current;
    if (!s || s.ended) return;
    if (!voiceRef.current) return setStatus("waiting");
    setStatus("listening");
    stopListening.current = listenOnce(s.lang, {
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim("");
        void handleUtterance.current(t);
      },
      onSilence: () => {
        setInterim("");
        const turn = s.silence();
        void speakTurn(turn);
      },
      onError: (m) => {
        setError(`${m} You can type your answers instead.`);
        setVoice(false);
        setStatus("waiting");
      },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const speakTurn = useCallback(
    async (turn: Turn) => {
      setProgress(turn.progress);
      setPhoneHint(turn.inputHint === "phone");
      for (const l of turn.lines as AgentLine[]) {
        addCaption("agent", l.text);
        if (voiceRef.current) {
          setStatus("speaking");
          const r = await speakLine(l.text, l.lang, l.slow ? Math.max(0.6, rateRef.current - 0.25) : rateRef.current);
          if (r.fallbackReason) setVoiceNotice(`${r.fallbackReason} Using the browser voice.`);
        }
      }
      if (turn.ended) return finish();
      listen();
    },
    [finish, listen],
  );

  handleUtterance.current = async (text: string) => {
    const s = session.current;
    if (!s || s.ended || busy.current || !text.trim()) return;
    busy.current = true;
    stopListening.current();
    addCaption("caller", text.trim());
    setStatus("thinking");
    // Spoken filler only when understanding takes longer than 700 ms (PRD §13).
    let fillerSaid = false;
    const filler = setTimeout(() => {
      if (voiceRef.current) {
        fillerSaid = true;
        void speakLine(FILLER[s.lang], s.lang, rateRef.current);
      }
    }, 700);
    try {
      const turn = await s.hear(text);
      clearTimeout(filler);
      if (fillerSaid) stopAllSpeech();
      await speakTurn(turn);
    } catch (e) {
      clearTimeout(filler);
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("waiting");
    } finally {
      busy.current = false;
    }
  };

  // Typed mode: keep the cursor in the answer box between turns.
  useEffect(() => {
    if (status === "waiting" && !voice) inputRef.current?.focus();
  }, [status, voice]);

  // 12-minute cap (G5).
  useEffect(() => {
    if (status === "idle" || status === "ended") return;
    const id = setInterval(() => {
      const t = session.current?.tick();
      if (t) {
        stopListening.current();
        void speakTurn(t);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [status, speakTurn]);

  // Leaving the page ends the call.
  useEffect(() => () => {
    const s = session.current;
    if (s && !s.ended) {
      s.hangUp();
      void saveCall(s.record);
    }
    stopListening.current();
    stopAllSpeech();
  }, []);

  if (trial === undefined || versions === undefined) return <p className="text-sm text-muted">Loading…</p>;
  const script = versions ? activeLocked(versions.sort((a, b) => b.version - a.version)) : null;
  const notReady =
    !trial ? "This study isn't set up in this browser." :
    !script ? "This study's screening script hasn't been approved yet, so calls can't run." :
    trial.callsPaused || trial.stale || script.status !== "locked" ? "Calls for this study are paused while the study team reviews an update." : null;

  if (notReady || !trial || !script) {
    return (
      <Card className="p-6 max-w-xl space-y-2">
        <h1 className="text-lg font-semibold">{trial?.shortName ?? nctId}</h1>
        <p className="text-sm">{notReady}</p>
        {!embedded && <Link className="text-sm text-accent underline" href={trial ? `/admin/trials/${nctId}/script` : "/admin/trials"}>Open the script (admin)</Link>}
      </Card>
    );
  }

  const start = async () => {
    setError(null);
    setCaptions([]);
    setResult(null);
    const settings = getSettings();
    const interpreter = settings.apiKey && settings.useLlmInCalls ? new LlmInterpreter(settings.apiKey, settings.callModel) : keywordInterpreter;
    try {
      scriptRef.current = script;
      session.current = new CallSession({
        trial, script, interpreter, fallback: keywordInterpreter, lang, mode: voice ? "voice" : "text",
        findSite: (zip) => nearestSiteForZip(trial, zip),
      });
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Couldn't start the call.");
    }
    if (voice) await loadVoices();
    await speakTurn(session.current.start());
  };

  const send = (text: string) => {
    setTyped("");
    void handleUtterance.current(text);
  };

  const ui = UI[lang];
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const inCall = status !== "idle" && status !== "ended";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <div className="text-xs text-muted">{trial.nctId}</div>
        <h1 className="text-xl font-semibold">{trial.shortName}</h1>
        <p className="text-sm text-muted">{lang === "es" ? "Llamada de preselección con un asistente de IA. El equipo del estudio toma la decisión final." : "Pre-screening call with an AI assistant. The study team makes the final decision."}</p>
      </div>

      {status === "idle" && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Language">
            {(["en", "es"] as Lang[]).map((l) => (
              <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cx("rounded-md border px-3 py-1.5 text-sm", lang === l ? "border-accent bg-accent-soft" : "border-border")}>
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How to answer">
            <button role="radio" aria-checked={voice} disabled={!supported.input || !supported.output} onClick={() => setVoice(true)} className={cx("rounded-md border px-3 py-1.5 text-sm disabled:opacity-50", voice ? "border-accent bg-accent-soft" : "border-border")}>
              {lang === "es" ? "Hablar" : "Talk"}
            </button>
            <button role="radio" aria-checked={!voice} onClick={() => setVoice(false)} className={cx("rounded-md border px-3 py-1.5 text-sm", !voice ? "border-accent bg-accent-soft" : "border-border")}>
              {lang === "es" ? "Escribir" : "Type"}
            </button>
          </div>
          {!supported.input && <p className="text-xs text-muted">This browser can&apos;t listen to speech, so answers are typed. Chrome or Safari support talking.</p>}
          <label className="block text-sm">
            <span className="text-muted">{lang === "es" ? "Velocidad de la voz" : "Speech speed"}: {rate.toFixed(1)}×</span>
            <input type="range" min={0.6} max={1.4} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-full accent-teal-700" />
          </label>
          {supported.output && (
            <div className="space-y-1">
              <label className="block text-sm">
                <span className="text-muted">{lang === "es" ? "Voz" : "Voice"}</span>
                <div className="flex gap-2 mt-1">
                  {useEleven ? (
                    <select
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                      value={settings.elevenVoice[lang]}
                      onChange={(e) => saveSettings({ elevenVoice: { ...settings.elevenVoice, [lang]: e.target.value } })}
                      disabled={elevenVoices === null}
                    >
                      <option value="">{elevenVoices === null ? "Loading ElevenLabs voices…" : lang === "es" ? "Elija una voz de ElevenLabs" : "Choose an ElevenLabs voice"}</option>
                      {(elevenVoices ?? []).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  ) : (
                    <select
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                      value={settings.voice[lang]}
                      onChange={(e) => saveSettings({ voice: { ...settings.voice, [lang]: e.target.value } })}
                    >
                      <option value="">{lang === "es" ? "Automática (la mejor disponible)" : "Automatic (best available)"}</option>
                      {voices.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
                    </select>
                  )}
                  <Button
                    type="button"
                    onClick={async () => {
                      stopAllSpeech();
                      setVoiceNotice(null);
                      const r = await speakLine(SAMPLE[lang], lang, rate);
                      if (r.fallbackReason) setVoiceNotice(`${r.fallbackReason} Using the browser voice.`);
                    }}
                  >
                    {lang === "es" ? "Escuchar" : "Preview"}
                  </Button>
                </div>
              </label>
              {useEleven && <p className="text-xs text-muted">ElevenLabs voice ({settings.elevenModel}). Change provider in <Link href="/settings" className="underline">Settings</Link>.</p>}
              {!useEleven && voices.length === 0 && <p className="text-xs text-muted">{lang === "es" ? "Este navegador no tiene voces en español." : "No voices found for this language in this browser."}</p>}
              {!useEleven && <p className="text-xs text-muted">{lang === "es" ? "Las voces vienen de su navegador y sistema." : "Voices come from your browser and operating system. Ones marked Premium or Enhanced usually sound best."}</p>}
            </div>
          )}
          <Button variant="primary" onClick={start}>{ui.start}</Button>
          <p className="text-xs text-muted">Demo: don&apos;t give real health information. {voice && "Your browser may send audio to its speech service."}</p>
        </Card>
      )}

      {status !== "idle" && (
        <>
          <div>
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>{progress.current > 0 ? `${ui.question} ${progress.current} ${ui.of} ${progress.total}` : " "}</span>
              <span>{status === "speaking" ? "🔊" : status === "listening" ? (lang === "es" ? "🎙 Escuchando…" : "🎙 Listening…") : status === "thinking" ? "…" : ""}</span>
            </div>
            <div className="h-1.5 rounded bg-stone-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <Card className="p-4 h-[22rem] overflow-y-auto flex flex-col-reverse" aria-live="polite">
            <div className="space-y-2">
              {captions.map((c) => (
                <div key={c.key} className={cx("max-w-[85%] rounded-lg px-3 py-2 text-sm", c.role === "agent" ? "bg-stone-100" : "ml-auto bg-accent text-white")}>{c.text}</div>
              ))}
              {interim && <div className="ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm bg-teal-100 text-teal-900 italic">{interim}</div>}
            </div>
          </Card>

          {inCall && (
            <div className="space-y-2">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(typed);
                }}
              >
                <Input
                  aria-label={ui.type}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={phoneHint ? ui.phone : ui.type}
                  inputMode={phoneHint ? "tel" : "text"}
                  className={cx(phoneHint && "ring-2 ring-accent")}
                  ref={inputRef}
                  autoFocus={!voice}
                />
                <Button variant="primary" disabled={!typed.trim() || status === "thinking"}>{ui.send}</Button>
              </form>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => send(CANNED[lang].repeat)} disabled={status === "thinking"}>{ui.repeat}</Button>
                <Button size="sm" onClick={() => send(CANNED[lang].notSure)} disabled={status === "thinking"}>{ui.notSure}</Button>
                <Button size="sm" onClick={() => send(CANNED[lang].back)} disabled={status === "thinking"}>{ui.back}</Button>
                <Button size="sm" variant="danger" onClick={() => { session.current?.hangUp(); void finish(); }}>{ui.end}</Button>
              </div>
            </div>
          )}
        </>
      )}

      {voiceNotice && <p className="text-sm text-amber-800">{voiceNotice}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {result && <DemoResult call={result} script={script} onRestart={() => { setStatus("idle"); setProgress({ current: 0, total: 0 }); }} embedded={embedded} />}
    </div>
  );
}

const STATUS_LABEL: Record<CallRecord["status"], string> = {
  in_progress: "In progress", consent_declined: "Consent declined", incomplete: "Incomplete", capped: "Hit the 12-minute cap",
  red_flag: "Stopped: red flag", minor_self: "Stopped: caller under 18", completed: "Completed",
};
const DECISION_TONE = { LIKELY_ELIGIBLE: "green", NEEDS_SITE_REVIEW: "amber", NOT_ELIGIBLE: "red" } as const;

function DemoResult({ call, script, onRestart, embedded }: { call: CallRecord; script: import("@/lib/types").ScriptVersion; onRestart: () => void; embedded: boolean }) {
  const current = new Map(call.answers.filter((a) => !a.supersededBy).map((a) => [a.criterionId, a]));
  return (
    <Card className="p-4 space-y-3 border-dashed">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Demo details · not shown to callers</span>
        <Badge>{STATUS_LABEL[call.status]}</Badge>
        {call.decision && <Badge tone={DECISION_TONE[call.decision]}>{call.decision.replace(/_/g, " ").toLowerCase()}</Badge>}
        {call.respondent && <Badge tone="blue">{call.respondent === "proxy" ? `caregiver (${call.relationship ?? "?"})` : call.respondent}</Badge>}
        <Badge>{call.interpreter}</Badge>
      </div>
      {call.redFlag && <p className="text-sm text-red-700">Red flag: {call.redFlag.category.replace(/_/g, " ")}</p>}
      {call.transcript.length === 0 && <p className="text-sm text-muted">No consent was given, so only the fact that the call happened was stored.</p>}
      {call.rows && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted"><tr><th className="py-1 pr-2">Criterion</th><th className="pr-2">Caller said</th><th className="pr-2">Recorded</th><th>Result</th></tr></thead>
            <tbody>
              {call.rows.map((r) => {
                const a = current.get(r.criterionId);
                const c = script.criteria.find((x) => x.id === r.criterionId);
                return (
                  <tr key={r.criterionId} className="border-t border-border align-top">
                    <td className="py-1 pr-2 font-mono">{r.criterionId}</td>
                    <td className="pr-2">{a?.callerWords ?? (c?.mode === "confirm_at_site" ? <span className="text-muted">site check</span> : "—")}</td>
                    <td className="pr-2 font-mono">{a ? (a.value === Infinity ? "never" : JSON.stringify(a.value)) + (a.readBackConfirmed ? " ✓" : "") : ""}</td>
                    <td><Badge tone={r.result === "PASS" ? "green" : r.result === "FAIL" ? "red" : r.result === "UNSURE" ? "amber" : "neutral"}>{r.result}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={onRestart}>New call</Button>
        {!embedded && (call.status === "completed" || call.status === "red_flag") && <Link href={`/coordinator/referrals/${call.id}`} className="text-sm text-accent underline self-center">Open in the coordinator queue</Link>}
        {!embedded && <Link href={`/coordinator/calls/${call.id}`} className="text-sm text-accent underline self-center">Call console</Link>}
      </div>
    </Card>
  );
}
