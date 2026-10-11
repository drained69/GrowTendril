import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <div className="num text-[13px] text-ink-4">404</div>
        <h1 className="mt-2 text-[20px] font-semibold">This page doesn’t exist</h1>
        <p className="mt-1 text-[13px] text-ink-3">It may have moved, or you may not have access to it.</p>
        <Link href="/app" className="mt-5 inline-block text-[13px] text-s1 hover:underline">
          Back to GrowTendril →
        </Link>
      </div>
    </div>
  );
}
