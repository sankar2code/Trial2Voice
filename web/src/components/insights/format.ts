import type { Ratio } from "@/lib/insights";

export const DASH = "—";

export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? DASH : `${(v * 100).toFixed(digits)}%`);

export const ratioText = (r: Ratio) => (r.value === null ? DASH : pct(r.value));

/** 3:05 for call lengths. */
export const minSec = (ms: number | null) => {
  if (ms === null) return DASH;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** 45 min / 3.5 h / 2.1 days for waits. */
export const span = (ms: number | null) => {
  if (ms === null) return DASH;
  const m = ms / 60_000;
  if (m < 90) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 36) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
};
