"use client";
import { useState } from "react";
import { Badge, Button, Dialog, ErrorText, Field, Select, TextArea } from "@/components/ui";
import type { Decision, RowResult } from "@/lib/call/types";
import type { FollowUpState } from "@/lib/store/referrals";

export const DECISION_LABEL: Record<Decision, string> = {
  LIKELY_ELIGIBLE: "Likely eligible",
  NEEDS_SITE_REVIEW: "Needs site review",
  NOT_ELIGIBLE: "Not eligible",
};
export const DECISION_TONE = { LIKELY_ELIGIBLE: "green", NEEDS_SITE_REVIEW: "amber", NOT_ELIGIBLE: "red" } as const;
export const ROW_TONE: Record<RowResult, "green" | "red" | "amber" | "neutral"> = { PASS: "green", FAIL: "red", UNSURE: "amber", SITE_CHECK: "neutral" };
export const ROW_LABEL: Record<RowResult, string> = { PASS: "Pass", FAIL: "Fail", UNSURE: "Unsure", SITE_CHECK: "Site check" };
export const FOLLOW_LABEL: Record<FollowUpState, string> = {
  new: "Not contacted yet", attempted: "Contact attempted", reached: "Reached", visit_scheduled: "Screening visit scheduled",
  declined: "Declined", not_a_fit: "Not a fit at site", unreachable: "Unreachable",
};

export function DecisionBadge({ decision, overridden }: { decision: Decision | null; overridden?: boolean }) {
  if (!decision) return <Badge tone="red">Red flag — screen stopped</Badge>;
  return <Badge tone={DECISION_TONE[decision]}>{DECISION_LABEL[decision]}{overridden ? " (overridden)" : ""}</Badge>;
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtMs = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A dialog that asks for a required (or optional) reason, plus an optional choice. */
export function ReasonDialog<T extends string>({
  open, title, intro, reasonRequired = true, choices, confirmLabel, onClose, onConfirm,
}: {
  open: boolean;
  title: string;
  intro?: string;
  reasonRequired?: boolean;
  choices?: { label: string; options: { value: T; label: string }[] };
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string, choice?: T) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState<T | undefined>(choices?.options[0]?.value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onConfirm(reason, choice);
            setReason("");
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {intro && <p className="text-sm text-muted">{intro}</p>}
        {choices && (
          <Field label={choices.label}>
            <Select value={choice} onChange={(e) => setChoice(e.target.value as T)}>
              {choices.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label={reasonRequired ? "Reason (required, recorded in the audit log)" : "Note (optional)"}>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required={reasonRequired} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (reasonRequired && !reason.trim())}>{confirmLabel}</Button>
        </div>
      </form>
    </Dialog>
  );
}
