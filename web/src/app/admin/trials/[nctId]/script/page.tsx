"use client";
import { useParams } from "next/navigation";
import { Workspace } from "@/components/script/Workspace";

export default function ScriptPage() {
  const { nctId } = useParams<{ nctId: string }>();
  return <Workspace nctId={decodeURIComponent(nctId).toUpperCase()} />;
}
