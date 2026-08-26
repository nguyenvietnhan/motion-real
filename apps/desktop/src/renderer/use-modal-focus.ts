import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function wrappedDialogFocusIndex(current: number, length: number, shift: boolean): number | null {
  if (length <= 0) return 0;
  if (shift && current <= 0) return length - 1;
  if (!shift && current === length - 1) return 0;
  return null;
}

/** Keep keyboard focus inside a modal, close on Escape, then restore its opener. */
export function useModalFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = (): HTMLElement[] =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);

    (initialFocusRef?.current ?? focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = wrappedDialogFocusIndex(current, items.length, event.shiftKey);
      if (next !== null) {
        event.preventDefault();
        items[next]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, dialogRef, initialFocusRef]);
}
