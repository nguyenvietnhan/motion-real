import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]';

export function menuIndexForKey(key: string, current: number, length: number): number | null {
  if (length <= 0) return null;
  if (key === "ArrowDown") return (current + 1) % length;
  if (key === "ArrowUp") return (current - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

/** Arrow-key navigation and focus restoration shared by menu/listbox popovers. */
export function useMenuNavigation(
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): { close: (restoreFocus?: boolean) => void; onKeyDown: (event: KeyboardEvent<HTMLElement>) => void } {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const items = useCallback(
    () => [...(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? [])].filter((item) => !item.hasAttribute("disabled")),
    [menuRef],
  );
  const close = useCallback((restoreFocus = true) => {
    const trigger = triggerRef.current;
    closeRef.current();
    if (restoreFocus) requestAnimationFrame(() => trigger?.focus());
  }, [triggerRef]);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
  }, [open, items]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>): void => {
    const options = items();
    if (options.length === 0) return;
    const current = Math.max(0, options.indexOf(document.activeElement as HTMLElement));
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const next = menuIndexForKey(event.key, current, options.length);
    if (next === null) return;
    event.preventDefault();
    options[next]?.focus();
  }, [close, items]);

  return { close, onKeyDown };
}
