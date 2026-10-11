import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_POSTS } from "@/server/demo/seed";

/** Every seeded DEMO "source" resolves here — clearly fictional, never pretending to be a real post. */
export default async function DemoSource({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = DEMO_POSTS.find((x) => x.id === id);
  const enrichment = !p && /^(acme|northwind|kestrel)-/.test(id);
  if (!p && !enrichment) notFound();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <div className="mb-4 inline-flex rounded border border-s7/50 bg-s7/10 px-2 py-0.5 text-[11px] font-medium tracking-wider text-s7">DEMO DATA — FICTIONAL</div>
      {p ? (
        <div className="rounded-md border border-line bg-surface p-4">
          <div className="text-[11px] uppercase text-ink-3">
            {p.provider} · @{p.handle} {p.company ? `· ${p.company}` : ""} · {p.days}d ago (relative to seeding)
          </div>
          {p.title && <div className="mt-2 text-[15px] font-semibold">{p.title}</div>}
          <p className="mt-2 text-[14px] leading-relaxed">{p.text}</p>
          <div className="num mt-3 text-[11px] text-ink-3">{Object.entries(p.eng).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
        </div>
      ) : (
        <div className="rounded-md border border-line bg-surface p-4 text-[13px]">Fictional enrichment record returned by the bundled x402 seller for a demo company ({id}).</div>
      )}
      <p className="mt-4 text-[12px] text-ink-3">This post, its author and its numbers are invented for the GrowTendril demo. They are stored with dataMode = DEMO and are never presented as real. Live projects link to real sources on X, GitHub, Reddit, YouTube, Hacker News and news feeds.</p>
      <Link href="/app" className="mt-4 inline-block text-[12px] text-s1 hover:underline">← back to GrowTendril</Link>
    </div>
  );
}
