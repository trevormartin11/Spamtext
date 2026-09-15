import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = { title: "Spamtext", description: "Spam text and robocall reporting pipeline" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Spamtext</Link>
          <nav>
            <Link href="/">Overview</Link>
            <Link href="/?tab=reports">Reports</Link>
            <Link href="/?tab=claims">Claims</Link>
            <Link href="/?tab=spend">Spend</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
