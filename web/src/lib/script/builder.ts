// LLM script builder. Runs in the browser with the user's own Anthropic key
// (Track A). In Track B this moves behind POST /api/trials/[id]/build.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { Criterion, CriterionGroup, GlossaryEntry, type Bullet, type Trial } from "../types";
import { BUILDER_SYSTEM, builderUserMessage } from "./prompt";

export const BuilderOutput = z.object({
  criteria: z.array(Criterion),
  groups: z.array(CriterionGroup),
  glossary: z.array(GlossaryEntry),
  derivedBulletIds: z.object({ age: z.array(z.string()), sex: z.array(z.string()) }),
});
export type BuilderOutput = z.infer<typeof BuilderOutput>;

export const DEFAULT_BUILD_MODEL = "claude-sonnet-5-5";

export class BuildError extends Error {}

export type BuildProgress = { chars: number; criteria: number };

export async function buildScript(opts: {
  trial: Trial;
  bullets: Bullet[];
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  onProgress?: (p: BuildProgress) => void;
}): Promise<{ output: BuilderOutput; model: string; usage: { input: number; output: number } }> {
  const model = opts.model || DEFAULT_BUILD_MODEL;
  // The key belongs to the person using this browser; it never leaves it except to the Anthropic API.
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });

  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // re-run on a fallback model if a safety classifier declines
      output_config: { effort: "high", format: betaZodOutputFormat(BuilderOutput) },
      system: BUILDER_SYSTEM,
      messages: [{ role: "user", content: builderUserMessage(opts.trial, opts.bullets) }],
    },
    { signal: opts.signal },
  );

  let text = "";
  stream.on("text", (delta) => {
    text += delta;
    opts.onProgress?.({ chars: text.length, criteria: (text.match(/"sourceText"/g) ?? []).length });
  });

  let message;
  try {
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new BuildError("The API key was rejected. Check it in Settings.");
    if (e instanceof Anthropic.RateLimitError) throw new BuildError("Rate limited by the Anthropic API. Try again in a minute.");
    if (e instanceof Anthropic.APIUserAbortError) throw new BuildError("Build cancelled.");
    if (e instanceof Anthropic.APIError) throw new BuildError(`Anthropic API error ${e.status ?? ""}: ${e.message}`);
    throw e;
  }

  if (message.stop_reason === "refusal") throw new BuildError("The model declined to build this script.");
  if (message.stop_reason === "max_tokens") throw new BuildError("The script was too long and got cut off.");

  const body = message.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new BuildError("The builder returned text that isn't valid JSON.");
  }
  const parsed = BuilderOutput.safeParse(json);
  if (!parsed.success) throw new BuildError(`The builder output didn't match the schema: ${parsed.error.issues[0]?.message}`);

  return {
    output: parsed.data,
    model: message.model,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  };
}
