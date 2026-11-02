import type { Metadata } from "next";
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
        {children}
      </body>
    </html>
  );
}
