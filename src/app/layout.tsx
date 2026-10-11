import type { Metadata, Viewport } from "next";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/shantell-sans/full.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "GrowTendril — your autonomous growth operator", template: "%s · GrowTendril" },
  description: "Give your growth operator a goal and a budget. For shops, apps, services, software and developer tools alike, GrowTendril finds evidence-backed customers, conversations and creators, spends USDC within hard limits on Arc, measures what works and moves the next dollar there.",
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f6f4" }, { media: "(prefers-color-scheme: dark)", color: "#0b0c0c" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
