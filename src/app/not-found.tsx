import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { LogoMark } from "@/components/layout/logo";
import { Clouds } from "@/components/ui/sky";

export default function NotFound() {
  return (
    <div className="bg-surface p-3">
      <div className="sky relative grid min-h-[calc(100vh-24px)] place-items-center rounded-[40px] px-4">
        <Clouds set="hero" />
        <div className="relative text-center" style={{ animation: "rise-in 520ms cubic-bezier(0.2,0.75,0.2,1) both" }}>
          <LogoMark size={64} grow sway className="mx-auto text-accent" />
          <div className="mt-6 font-mono text-[12px] uppercase tracking-[0.2em] text-ink/45">Error 404</div>
          <h1 className="display display-bounce mt-3 text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.08]">
            This path hasn&apos;t <span className="scribble">grown</span> yet.
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-[16px] leading-relaxed text-ink/60">The page may have moved, or you may not have access to it.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/app" className="btn-sheen inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white transition-transform hover:-translate-y-0.5">
              <ArrowLeft className="size-4" /> Back to GrowTendril
            </Link>
            <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-full bg-white/75 px-5 text-[14px] font-medium backdrop-blur-sm transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-white">
              <Compass className="size-4" /> Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
