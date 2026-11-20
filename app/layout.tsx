import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Dyon",
  description: "Send the same coding task to Claude Code and Codex and compare how they did it.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Rendered per request, so each page gets its own CSP nonce (proxy.ts).
  await connection();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
