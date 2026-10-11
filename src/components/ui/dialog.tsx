"use client";
import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useModal } from "@/components/ui/use-modal";

export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }) {
  const titleId = useId();
  const descriptionId = useId();
  const container = useModal(open, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 px-4 pb-10 pt-[12vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={container} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1} className={cn("w-full animate-pop-in rounded-[22px] border border-line bg-surface shadow-[var(--shadow-pop)]", size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg")}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[14.5px] font-semibold text-ink">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-ink-4 hover:text-ink [&_svg]:size-4">
            <X />
          </button>
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
