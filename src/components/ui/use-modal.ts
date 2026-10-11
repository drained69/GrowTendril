"use client";
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const activeModals: symbol[] = [];
let previousOverflow = "";

/** Keep keyboard focus and scrolling inside the topmost open modal. */
export function useModal(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const container = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open || !container.current) return;
    const token = Symbol("modal");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!activeModals.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeModals.push(token);
    const isTop = () => activeModals.at(-1) === token;
    const focusable = () => Array.from(container.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.getClientRects().length > 0 && !el.matches(":disabled") && !el.closest('[hidden], [inert], [aria-hidden="true"]'));
    const candidates = focusable();
    const initial = candidates.find((el) => el.matches('[autofocus], input, textarea, select')) ?? candidates[0] ?? container.current;
    initial.focus();

    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) {
          event.preventDefault();
          container.current?.focus();
        } else if (event.shiftKey && (document.activeElement === first || !container.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !container.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTop() && !container.current?.contains(event.target as Node)) (focusable()[0] ?? container.current)?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      const wasTop = isTop();
      activeModals.splice(activeModals.indexOf(token), 1);
      if (!activeModals.length) document.body.style.overflow = previousOverflow;
      if (wasTop && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  return container;
}
