import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Blood Donation Matcher",
  description: "Match blood requests to compatible, available donors by urgency. DBMS Level 3 project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${geist.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
