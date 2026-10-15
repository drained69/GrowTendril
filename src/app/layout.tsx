import type { Metadata, Viewport } from "next";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/shantell-sans/full.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  metadataBase: new URL("https://growtendril.xyz"),
  title: { default: "GrowTendril — find your next growth opportunity", template: "%s · GrowTendril" },
  description: "Find relevant customers and creators, plan small growth experiments, and review recorded outcomes alongside spending. Start with your website and keep control of your budget.",
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
