"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Globe } from "lucide-react";
import { websiteSetupPath } from "@/lib/website-start";
import { SERVICES } from "@/lib/services";

export function WebsiteStart({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = websiteSetupPath(website);
      router.push(signedIn ? next : `/signup?${new URLSearchParams({ next })}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check your website address.");
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-[650px] text-left">
      <form method="post" onSubmit={start} className="rounded-[24px] border border-ink/10 bg-white/85 p-2 shadow-[0_12px_40px_-20px_rgb(10_11_12/0.3)] backdrop-blur-sm">
        <label htmlFor="start-website" className="sr-only">Your business website</label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Globe className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink/40" />
            <input id="start-website" name="website" inputMode="url" autoComplete="url" required maxLength={300} placeholder="yourbusiness.com" value={website} onChange={(e) => { setWebsite(e.target.value); setError(null); }} aria-invalid={!!error} aria-describedby={error ? "start-website-error" : "start-website-hint"} className="h-12 w-full rounded-full bg-transparent pl-12 pr-4 text-[15px] text-ink outline-none placeholder:text-ink/40 focus-visible:ring-2 focus-visible:ring-accent" />
          </div>
          <button type="submit" className="btn-sheen inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Find my next move <ArrowRight className="size-4" />
          </button>
        </div>
        <p id="start-website-hint" className="px-4 pb-2 pt-3 text-[12px] leading-relaxed text-ink/60">Workspace setup is free. Market scans cost {SERVICES.scan.priceUsdc} USDC each. You review creator payments.</p>
        {error && <p id="start-website-error" role="alert" className="px-4 pb-2 text-[12px] text-critical">{error}</p>}
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-ink/65">
        <Link href={signedIn ? "/onboarding?new=1&manual=1" : `/signup?${new URLSearchParams({ next: "/onboarding?new=1&manual=1" })}`} className="underline decoration-ink/20 underline-offset-4 hover:text-ink">Describe your business instead</Link>
        <a href="#product" className="hover:text-ink">Explore the workflow <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  );
}
