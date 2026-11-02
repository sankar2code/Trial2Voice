"use client";
// Light / Dark / Auto. The choice is a per-browser convenience in
// localStorage; Auto follows the operating system and updates live.
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "t2v.theme";

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"system";var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function read(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "system", label: "Auto", icon: "◐" },
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => setChoice(read()), []);

  // In Auto mode, follow the OS when it switches (e.g. at sunset).
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const pick = (c: ThemeChoice) => {
    setChoice(c);
    try {
      window.localStorage.setItem(THEME_KEY, c);
    } catch {
      /* storage blocked: still apply for this page */
    }
    apply(c);
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="flex items-center rounded-md border border-border p-0.5 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          title={`${o.label} theme`}
          onClick={() => pick(o.value)}
          className={`rounded px-1.5 py-0.5 flex items-center gap-1 ${choice === o.value ? "bg-accent-soft text-accent-ink font-medium" : "text-muted hover:text-foreground"}`}
        >
          <span aria-hidden>{o.icon}</span>
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
