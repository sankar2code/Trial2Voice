import { afterEach, describe, expect, test, vi } from "vitest";
import { listElevenVoices, ElevenLabsError } from "./elevenlabs";

afterEach(() => vi.unstubAllGlobals());

const page = (voices: object[], next: string | null) =>
  new Response(JSON.stringify({ voices, has_more: next !== null, next_page_token: next }), { status: 200 });

describe("listElevenVoices", () => {
  test("sends the key, follows pagination and builds labels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ voice_id: "a", name: "Aria", category: "premade", labels: { accent: "american", gender: "female" } }], "t1"))
      .mockResolvedValueOnce(page([{ voice_id: "b", name: "Mateo", category: "cloned" }], null));
    vi.stubGlobal("fetch", fetchMock);

    const voices = await listElevenVoices("k-123");
    expect(voices).toEqual([
      { id: "a", name: "Aria", label: "Aria (american, female, premade)" },
      { id: "b", name: "Mateo", label: "Mateo (cloned)" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(String(firstUrl)).toContain("/v2/voices?page_size=100");
    expect(firstInit.headers["xi-api-key"]).toBe("k-123");
    expect(String(fetchMock.mock.calls[1][0])).toContain("next_page_token=t1");
  });

  test.each([
    [401, /rejected the API key/],
    [429, /quota or rate limit/],
    [500, /error 500/],
  ])("HTTP %i gives a clear error", async (status, msg) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    const err = await listElevenVoices("bad").catch((e) => e);
    expect(err).toBeInstanceOf(ElevenLabsError);
    expect(err.message).toMatch(msg);
    expect(err.status).toBe(status);
  });
});
