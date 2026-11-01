"use client";
import { useParams } from "next/navigation";
import { CallScreen } from "@/components/call/CallScreen";

export default function CallPage() {
  const { trialSlug } = useParams<{ trialSlug: string }>();
  return <CallScreen nctId={decodeURIComponent(trialSlug).toUpperCase()} />;
}
