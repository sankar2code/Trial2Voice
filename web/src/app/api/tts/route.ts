// POST /api/tts — speaks one approved line with the site's ElevenLabs voice.
// The key stays on the server (ELEVENLABS_API_KEY).
import { handleTts } from "@/lib/server/elevenlabs";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleTts(req, process.env);
}
