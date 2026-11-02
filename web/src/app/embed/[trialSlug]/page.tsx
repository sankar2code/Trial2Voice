"use client";
// The call UI without site chrome, for the embeddable widget (PRD §4 P1).
// Loaded in an iframe by /embed.js. Track B adds a domain allowlist and
// signed, short-lived call tokens.
import { useParams } from "next/navigation";
import { CallScreen } from "@/components/call/CallScreen";

export default function EmbedPage() {
  const { trialSlug } = useParams<{ trialSlug: string }>();
  return (
    <main className="p-3">
      <CallScreen nctId={decodeURIComponent(trialSlug).toUpperCase()} embedded />
    </main>
  );
}
