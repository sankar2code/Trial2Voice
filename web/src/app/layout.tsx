import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Trial2Voice",
  description: "Turn a ClinicalTrials.gov NCT ID into an approved, multilingual voice pre-screening script.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <div role="note" className="bg-amber-100 text-amber-950 text-xs sm:text-sm px-4 py-2 text-center border-b border-amber-200">
          <strong>Demo prototype.</strong> Not affiliated with any study shown. No referrals are sent. Don&apos;t enter real health information.
        </div>
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight text-accent">
              Trial2Voice
            </Link>
            <Link href="/admin/trials" className="text-sm text-muted hover:text-foreground">
              Trials
            </Link>
            <Link href="/settings" className="text-sm text-muted hover:text-foreground">
              Settings
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
