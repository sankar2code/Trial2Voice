"use client";
import { useParams } from "next/navigation";
import { ReferralView } from "@/components/coordinator/ReferralView";

export default function ReferralPage() {
  const { id } = useParams<{ id: string }>();
  return <ReferralView id={decodeURIComponent(id)} />;
}
