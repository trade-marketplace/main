"use client";
// Dropdown menus (#78): web.css .w-menu (12px radius, 40px rows, dividers), M08 (fades in and scales from its
// top edge). The WAI-ARIA menu button: the trigger says it opens a menu and whether it's open; on open, focus
// goes to the first item (ArrowUp on the trigger: the last); arrows, Home/End and the first letter move; Enter
// or Space picks; Esc closes and returns to the trigger; Tab or a click outside just closes.
//
//   <Menu
//     trigger={(props) => <IconButton icon="more_vert" label="More options" {...props} />}
//     header={<><b>Sarah Thompson</b><span>sarah@email.co.nz</span></>}
//   >
//     <MenuItem icon="person" href="/account">Account</MenuItem>
//     <MenuSeparator />
//     <MenuItem icon="logout" tone="danger" onSelect={confirmLogOut}>Log out</MenuItem>
//   </Menu>
//
// The trigger is any kit button: spread the props it is given onto it. An item that opens a dialog can do so in
// onSelect: focus is already back on the trigger, so the dialog returns focus there when it closes.
import Link from "next/link";
import {
  createContext,
  useCallback,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "@/components/Icon";
import { menuKey, shiftIntoView, TYPEAHEAD_RESET_MS, typeaheadIndex } from "@/lib/overlays";

import styles from "./overlays.module.css";

/** Spread these on the trigger button. */
export type MenuTriggerProps = {
  id: string;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls"?: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

export type MenuProps = {
  /** Render the button that opens it, spreading the props given: (p) => <Button {...p}>Actions</Button>. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  children: ReactNode;
  /** Who or what the menu is about, above the items (e.g. the signed-in name and email). Read as its description. */
  header?: ReactNode;
  /** Line the menu up with the trigger's "end" (right, the default) or "start" (left) edge. */
  align?: "start" | "end";
  /** The menu's name for screen readers. Default: the trigger's name. */
  label?: string;
  /** Start open (previews and screenshots). It is still the menu's own state after that. */
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Designed menu variants, such as the notification panel. */
  panelClassName?: string;
  className?: string;
};

type MenuContextValue = { close: (returnFocus: boolean) => void };
const MenuContext = createContext<MenuContextValue | null>(null);

const ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';

export function Menu({ trigger, children, header, align = "end", label, defaultOpen = false, open: controlledOpen, onOpenChange, panelClassName, className }: MenuProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  const setOpen = useCallback((next: boolean) => { setOwnOpen(next); onOpenChange?.(next); }, [onOpenChange]);
  const [startAt, setStartAt] = useState<"first" | "last">("first");
  const triggerId = useId();
  const menuId = useId();
  const headerId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusedItem = useRef<HTMLElement | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
  const focusTrigger = () => document.getElementById(triggerId)?.focus();
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) focusTrigger();
  };

  // Focus the first (or last) item once it opens, and keep the panel on screen.
  useLayoutEffect(() => {
    if (!open) return;
    const list = items();
    (startAt === "last" ? list.at(-1) : list[0])?.focus();
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.removeProperty("--menu-shift");
    panel.removeAttribute("data-up");
    const box = panel.getBoundingClientRect();
    const shift = shiftIntoView(box.left, box.right, document.documentElement.clientWidth);
    if (shift) panel.style.setProperty("--menu-shift", `${Math.round(shift)}px`);
    // Not enough room below but more above (a trigger near the bottom of the screen): open upwards.
    const triggerBox = rootRef.current?.getBoundingClientRect();
    if (triggerBox && box.bottom > window.innerHeight && triggerBox.top > window.innerHeight - triggerBox.bottom) {
      panel.setAttribute("data-up", "true");
    }
  }, [open, startAt]);

  // Async results can remove the focused Retry/Mark all read item. Keep keyboard focus in the open menu.
  useLayoutEffect(() => {
    if (open && focusedItem.current && !focusedItem.current.isConnected && document.activeElement === document.body) items()[0]?.focus();
  });

  // A press anywhere outside closes it (without moving focus: the press already put focus where it should be).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  const openAt = (where: "first" | "last") => {
    setStartAt(where);
    setOpen(true);
  };

  const triggerProps: MenuTriggerProps = {
    id: triggerId,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: () => (open ? close(false) : openAt("first")),
    onKeyDown: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openAt(event.key === "ArrowUp" ? "last" : "first");
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    },
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = menuKey(event.key, index, list.length);
    if (move && "close" in move) {
      if (move.close === "escape") {
        event.preventDefault();
        event.stopPropagation(); // Esc closes the menu, not the dialog it is in
      }
      close(move.close === "escape");
      return;
    }
    if (move) {
      event.preventDefault();
      list[move.focus]?.focus();
      return;
    }
    // Type-ahead: a printable key moves to the next item starting with what's been typed.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      const now = event.timeStamp;
      typed.current = { text: (now - typed.current.at > TYPEAHEAD_RESET_MS ? "" : typed.current.text) + event.key, at: now };
      const next = typeaheadIndex(list.map((el) => el.textContent ?? ""), index, typed.current.text);
      if (next >= 0) list[next].focus();
    }
  };

  return (
    <MenuContext value={{ close }}>
      <span ref={rootRef} className={[styles.menuRoot, className].filter(Boolean).join(" ")}>
        {trigger(triggerProps)}
        {open && (
          <div ref={panelRef} className={[styles.menu, "tm-anim-suggest", panelClassName].filter(Boolean).join(" ")} data-align={align}>
            {header && (
              <div id={headerId} className={styles.menuHeader}>
                {header}
              </div>
            )}
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-labelledby={label ? undefined : triggerId}
              aria-label={label}
              aria-describedby={header ? headerId : undefined}
              onKeyDown={onMenuKeyDown}
              onFocusCapture={(event) => { focusedItem.current = event.target as HTMLElement; }}
              onBlur={(event) => {
                if (!rootRef.current?.contains(event.relatedTarget as Node | null) && event.relatedTarget) setOpen(false);
              }}
            >
              {children}
            </div>
          </div>
        )}
      </span>
    </MenuContext>
  );
}

type MenuItemCommon = {
  children: ReactNode;
  className?: string;
  closeOnSelect?: boolean;
  /** Navigation menus identify the current destination, without turning links into radio choices. */
  "aria-current"?: "page";
  /** A Material Symbols name before the label. Decorative. */
  icon?: string;
  /** "danger" for log out, delete: red text. */
  tone?: "default" | "danger";
  /**
   * For a menu that picks one option (a filter chip's dropdown): true on the current one, false on the others.
   * The items become menuitemradio and the current one shows a tick. Leave it out for plain actions.
   */
  checked?: boolean;
};

export type MenuItemProps = MenuItemCommon &
  (
    | { href: string; onSelect?: never; disabled?: never }
    | {
        href?: never;
        /** Runs after the menu has closed and focus is back on the trigger. */
        onSelect: () => void;
        /** Shown but can't be picked; arrows skip it. The reason belongs in its label (“Download receipt (after payment)”). */
        disabled?: boolean;
      }
  );

export function MenuItem({ children, icon, tone = "default", checked, className, closeOnSelect = true, "aria-current": current, ...action }: MenuItemProps) {
  const menu = useContext(MenuContext);
  const classes = [styles.menuItem, tone === "danger" && styles.menuDanger, className].filter(Boolean).join(" ");
  const choice = checked === undefined ? {} : { role: "menuitemradio" as const, "aria-checked": checked };
  const content = (
    <>
      {icon && <Icon name={icon} size="sm" decorative />}
      <span className={styles.menuLabel}>{children}</span>
      {checked && <Icon name="check" size="sm" decorative className={styles.menuCheck} />}
    </>
  );

  if (typeof action.href === "string") {
    return (
      <Link role="menuitem" {...choice} aria-current={current} tabIndex={-1} href={action.href} className={classes} onClick={() => menu?.close(false)}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      {...choice}
      tabIndex={-1}
      className={classes}
      aria-disabled={action.disabled || undefined}
      onClick={() => {
        if (action.disabled) return;
        if (closeOnSelect) menu?.close(true);
        action.onSelect?.();
      }}
    >
      {content}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className={styles.menuSeparator} />;
}
