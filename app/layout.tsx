import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { SiteNav } from "@/components/SiteNav";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: { siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION, type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:gap-6 sm:py-3">
            <Link href="/rankings" className="flex items-center gap-2 py-1 font-display text-xl font-semibold tracking-tight">
              <LogoMark size={24} />
              {SITE_NAME}
            </Link>
            <div className="sm:ml-auto">
              <SiteNav />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted sm:flex-row sm:justify-between">
            <p>
              Data from{" "}
              <a href="https://collegefootballdata.com" className="underline underline-offset-2 hover:text-ink">
                CollegeFootballData.com
              </a>
              . Team names and logos are trademarks of their schools.
            </p>
            <p>
              <Link href="/methodology" className="underline underline-offset-2 hover:text-ink">How the rankings work</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
