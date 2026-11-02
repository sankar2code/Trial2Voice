// GET /api/voices — whether the site provides ElevenLabs voices, and which.
import { handleVoices } from "@/lib/server/elevenlabs";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleVoices(req, process.env);
}
