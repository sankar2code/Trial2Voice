import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  ["/admin/trials", "Trials"],
  ["/coordinator", "Coordinator"],
  ["/insights", "Insights"],
  ["/evals", "Evals"],
  ["/settings", "Settings"],
] as const;

export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="border-b border-border bg-surface print:hidden">
        <nav className="mx-auto max-w-7xl px-4 min-h-14 py-2 flex items-center gap-x-6 gap-y-2 flex-wrap">
          <Link href="/" className="font-semibold tracking-tight text-accent-ink">
            Trial2Voice
          </Link>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="text-sm text-muted hover:text-foreground">
              {label}
            </Link>
          ))}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
