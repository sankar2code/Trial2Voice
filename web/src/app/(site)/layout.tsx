import Link from "next/link";

const NAV = [
  ["/admin/trials", "Trials"],
  ["/coordinator", "Coordinator"],
  ["/settings", "Settings"],
] as const;

export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="border-b border-border bg-surface print:hidden">
        <nav className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight text-accent">
            Trial2Voice
          </Link>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="text-sm text-muted hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
