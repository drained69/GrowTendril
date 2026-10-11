import { Skeleton } from "@/components/ui/misc";
import { GrowthLoader } from "@/components/layout/logo";

export default function Loading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-label="Loading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="hidden h-8 w-28 sm:block" />
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-[10px]" />
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-72 rounded-[10px]" />
        <Skeleton className="h-72 rounded-[10px]" />
      </div>
      <GrowthLoader label="Gathering the latest" className="py-10" />
    </div>
  );
}
