"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-5 py-12 text-center">
      <h1 className="display text-[28px] text-ink">This page couldn’t load</h1>
      <p role="alert" className="mt-3 text-[14px] leading-relaxed text-ink-3">Something went wrong while loading the page. Try again, or return home to continue.</p>
      <div className="mt-6 flex items-center gap-4">
        <Button variant="primary" size="md" onClick={reset}>Try again</Button>
        <Link href="/" className="text-[13px] text-ink-2 hover:underline">Return home</Link>
      </div>
    </div>
  );
}
