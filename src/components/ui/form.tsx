import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

const FIELD = "w-full rounded-[12px] border border-line-strong bg-surface px-3 text-[13.5px] text-ink shadow-[0_1px_2px_rgb(10_11_12/0.04)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-4 hover:border-ink-4 focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:opacity-60";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input {...p} className={cn(FIELD, "h-9.5", className)} />;
}

export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea {...p} className={cn(FIELD, "py-2 leading-relaxed", className)} />;
}

export function Select({ className, children, ...p }: ComponentProps<"select">) {
  return (
    <select {...p} className={cn(FIELD, "h-9.5 cursor-pointer pr-8", className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className, htmlFor, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string; required?: boolean }) {
  const descriptionId = htmlFor && (error || hint) ? `${htmlFor}-description` : undefined;
  const describe = (nodes: ReactNode): ReactNode => Children.map(nodes, (node) => {
    if (!isValidElement(node)) return node;
    const element = node as ReactElement<{ id?: string; children?: ReactNode; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" }>;
    if (htmlFor && element.props.id === htmlFor) return cloneElement(element, {
      "aria-describedby": [element.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined,
      "aria-invalid": error ? true : element.props["aria-invalid"],
    });
    return element.props.children ? cloneElement(element, { children: describe(element.props.children) }) : element;
  });
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-critical">*</span>}
      </label>
      {describe(children)}
      {error ? <p id={descriptionId} role="alert" className="text-[11.5px] text-critical">{error}</p> : hint ? <p id={descriptionId} className="text-[11.5px] leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink", className)}>
      <input type="checkbox" {...p} className="size-4 cursor-pointer rounded-[5px] accent-[var(--color-accent)]" />
      {label}
    </label>
  );
}
