import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/components/ui/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "xs" | "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "btn-sheen bg-ink text-bg shadow-[0_1px_2px_rgb(10_11_12/0.18),0_6px_14px_-8px_rgb(10_11_12/0.45)] hover:-translate-y-px hover:bg-ink-2",
  secondary: "bg-surface text-ink shadow-[0_0_0_1px_rgb(10_11_12/0.1),0_1px_2px_rgb(10_11_12/0.05)] hover:-translate-y-px hover:bg-surface-2 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]",
  outline: "bg-transparent text-ink shadow-[0_0_0_1px_rgb(10_11_12/0.14)] hover:bg-surface-2 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.14)]",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-transparent text-critical shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-critical)_40%,transparent)] hover:bg-critical/10",
};
const SIZE: Record<Size, string> = {
  xs: "h-6 px-2.5 text-[11.5px] gap-1",
  sm: "h-7.5 px-3 text-[12px] gap-1.5",
  md: "h-8.5 px-3.5 text-[12.5px] gap-1.5",
  lg: "h-11 px-5 text-[14px] gap-2",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "sm", className?: string) {
  return cn("inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-medium transition-[color,background-color,transform,box-shadow] duration-200 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0", VARIANT[variant], SIZE[size], className);
}

export function Button({ variant, size, loading, icon, children, className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button {...rest} type={rest.type ?? "button"} aria-busy={loading || undefined} disabled={rest.disabled || loading} className={buttonClass(variant, size, className)}>
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant, size, icon, children, className, external }: { href: string; variant?: Variant; size?: Size; icon?: ReactNode; children?: ReactNode; className?: string; external?: boolean }) {
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={buttonClass(variant, size, className)}>
        {icon}
        {children}
      </a>
    );
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}
