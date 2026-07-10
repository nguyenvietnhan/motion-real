import { useEffect, type RefObject } from "react";

/**
 * Close a popover/menu when the user clicks outside `rootRef` or presses Escape.
 * Shared by gallery filter, create knobs, BGM picker, diagnostics, etc.
 */
export function useDismissable(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, rootRef]);
}
