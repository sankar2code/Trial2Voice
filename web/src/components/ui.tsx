"use client";
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "text-xs px-2 py-1" : "text-sm px-3 py-1.5",
        variant === "primary" && "bg-accent text-white hover:bg-accent-strong",
        variant === "secondary" && "border border-border bg-surface hover:bg-stone-50",
        variant === "ghost" && "text-muted hover:text-foreground hover:bg-stone-100",
        variant === "danger" && "border border-red-200 text-red-700 bg-surface hover:bg-red-50",
        className,
      )}
    />
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "teal";
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-stone-100 text-stone-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    blue: "bg-sky-100 text-sky-800",
    teal: "bg-accent-soft text-accent-ink",
  };
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border border-border bg-surface", className)}>{children}</div>;
}

const inputCls = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm disabled:bg-stone-50 disabled:text-stone-600";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  );
}

export function Input({ ref, ...p }: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...p} className={cx(inputCls, p.className)} />;
}

export function TextArea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} {...p} className={cx(inputCls, "resize-y", p.className)} />;
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(inputCls, p.className)} />;
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="rounded-lg border border-border bg-surface text-foreground p-0 backdrop:bg-black/50 w-[min(32rem,calc(100vw-2rem))] m-auto">
      <div className="p-5">
        <h2 className="text-lg font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-border overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap",
            value === t.id ? "border-accent text-foreground font-medium" : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-sm text-red-700">{children}</p>;
}

export { cx };
