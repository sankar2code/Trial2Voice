"use client";
import { useParams } from "next/navigation";
import { CallConsole } from "@/components/coordinator/CallConsole";

export default function CallConsolePage() {
  const { callId } = useParams<{ callId: string }>();
  return <CallConsole callId={decodeURIComponent(callId)} />;
}
