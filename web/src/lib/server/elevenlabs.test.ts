import { beforeEach, describe, expect, test, vi } from "vitest";
import { handleTts, handleVoices, MAX_TEXT, RATE_LIMIT, resetRateLimit, sameSite } from "./elevenlabs";

const env = { ELEVENLABS_API_KEY: "server-key-123", ELEVENLABS_VOICE_IDS: "voiceAAAAAAAAAA,voiceBBBBBBBBBB" };
const VOICE = "voiceAAAAAAAAAA";

function req(path: string, init: { method?: string; body?: unknown; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { host: "trial2voice.example", "x-forwarded-for": init.ip ?? "1.2.3.4" };
  if (init.origin !== null) headers.origin = init.origin ?? "https://trial2voice.example";
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://trial2voice.example${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

const audio = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });

beforeEach(() => resetRateLimit());

describe("same-site guard", () => {
  test("matches host; rejects other sites and missing origin", () => {
    expect(sameSite(req("/api/tts"))).toBe(true);
    expect(sameSite(req("/api/tts", { origin: "https://evil.example" }))).toBe(false);
    expect(sameSite(req("/api/tts", { origin: null }))).toBe(false);
  });
});

describe("POST /api/tts", () => {
  test("not configured → 503, and ElevenLabs is never called", async () => {
    const f = vi.fn();
    const r = await handleTts(req("/api/tts", { method: "POST", body: { text: "hi", voiceId: VOICE } }), {}, f as never);
    expect(r.status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });

  test("streams audio using the server key, never echoing it", async () => {
    const f = vi.fn().mockResolvedValue(audio());
    const r = await handleTts(req("/api/tts", { method: "POST", body: { text: "How old are you?", voiceId: VOICE, speed: 1.1 } }), env, f as never);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain(`/v1/text-to-speech/${VOICE}/stream`);
    expect(init.headers["xi-api-key"]).toBe("server-key-123");
    expect(JSON.parse(init.body)).toMatchObject({ text: "How old are you?", model_id: "eleven_v4_turbo", voice_settings: { speed: 1.1 } });
    expect(JSON.stringify([...r.headers])).not.toContain("server-key-123");
  });

  test("other sites are refused", async () => {
    const f = vi.fn();
    const r = await handleTts(req("/api/tts", { method: "POST", origin: "https://evil.example", body: { text: "hi", voiceId: VOICE } }), env, f as never);
    expect(r.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  test("text too long, bad voice id, or voice outside the allowlist are refused", async () => {
    const f = vi.fn().mockResolvedValue(audio());
    const long = await handleTts(req("/api/tts", { method: "POST", body: { text: "x".repeat(MAX_TEXT + 1), voiceId: VOICE } }), env, f as never);
    expect(long.status).toBe(400);
    const bad = await handleTts(req("/api/tts", { method: "POST", body: { text: "hi", voiceId: "../../v1/user" } }), env, f as never);
    expect(bad.status).toBe(400);
    const notAllowed = await handleTts(req("/api/tts", { method: "POST", body: { text: "hi", voiceId: "voiceZZZZZZZZZZ" } }), env, f as never);
    expect(notAllowed.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  test("rate limit per IP", async () => {
    const f = vi.fn().mockImplementation(async () => audio());
    for (let i = 0; i < RATE_LIMIT.requests; i++) {
      const ok = await handleTts(req("/api/tts", { method: "POST", body: { text: "hi", voiceId: VOICE } }), env, f as never);
      expect(ok.status).toBe(200);
    }
    const limited = await handleTts(req("/api/tts", { method: "POST", body: { text: "hi", voiceId: VOICE } }), env, f as never);
    expect(limited.status).toBe(429);
    const otherIp = await handleTts(req("/api/tts", { method: "POST", ip: "5.6.7.8", body: { text: "hi", voiceId: VOICE } }), env, f as never);
    expect(otherIp.status).toBe(200);
  });

  test("upstream errors become a short status the browser can fall back on", async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"detail":"quota_exceeded secret-stuff"}', { status: 402 }));
    const r = await handleTts(req("/api/tts", { method: "POST", body: { text: "hi", voiceId: VOICE } }), env, f as never);
    expect(r.status).toBe(429);
    expect(await r.text()).not.toContain("secret-stuff");
  });
});

describe("GET /api/voices", () => {
  test("not configured", async () => {
    const r = await handleVoices(req("/api/voices"), {});
    expect(await r.json()).toEqual({ configured: false, voices: [] });
  });

  test("lists only allowlisted voices, with defaults", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      voices: [
        { voice_id: "voiceAAAAAAAAAA", name: "Aria", labels: { accent: "american", gender: "female" } },
        { voice_id: "voiceBBBBBBBBBB", name: "Mateo" },
        { voice_id: "voiceCCCCCCCCCC", name: "Hidden" },
      ],
    })));
    const r = await handleVoices(req("/api/voices"), { ...env, ELEVENLABS_API_KEY: "key-for-list-test", ELEVENLABS_DEFAULT_VOICE_ID_ES: "voiceBBBBBBBBBB" }, f as never);
    const body = await r.json();
    expect(body.configured).toBe(true);
    expect(body.voices.map((v: { id: string }) => v.id)).toEqual(["voiceAAAAAAAAAA", "voiceBBBBBBBBBB"]);
    expect(body.voices[0].label).toBe("Aria (american, female)");
    expect(body.defaults).toEqual({ en: "voiceAAAAAAAAAA", es: "voiceBBBBBBBBBB" });
    expect(JSON.stringify(body)).not.toContain("key-for-list-test");
  });
});
