"use client";
// Buttons (#74): docs/design/components.css (.tm-btn, .tm-iconbtn, .tm-save) and web.css (hover, .w-tip), written
// with the mode tokens only, so each one recolours itself in customer / trade / office mode. Press and hover are
// M04 from src/styles/motion.css (.tm-press), never re-made here. Every variant and state: /dev/components/buttons.
//
//   <Button>Post a job</Button>                                   primary: the one main action on a view
//   <Button variant="secondary" size="sm">Save for later</Button>
//   <Button loading>Post job</Button>                             spinner, same width, can't be pressed twice
//   <Button disabled="Add at least one photo first">Next</Button> greyed out; the reason shows on hover, focus or tap
//   <Button href="/jobs/new">Post a job</Button>                  a link that looks like a button
//   <IconButton icon="close" label="Close" />                     round icon button; its label is the tooltip
//
// Text links are <TextLink> (src/components/TextLink.tsx).
import Link from "next/link";
import {
  type ButtonHTMLAttributes,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "@/components/Icon";
import { useDebouncedValue } from "@/lib/motion/hooks";

import styles from "./Button.module.css";

/** WEBAPP_SPEC: tooltips appear after 500ms of hover. Keyboard focus and a tap show them straight away. */
export const TOOLTIP_DELAY_MS = 500;

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "hero" | "destructive";
export type ButtonSize = "md" | "sm";
/** "full-on-phone": the whole width below 600px, its own width from there up (the spec's "full width on mobile"). */
export type ButtonWidth = "full-on-phone" | "full" | "auto";

type Look = {
  /**
   * primary: action fill with a Forest label (white on Forest in office mode). One per view.
   * secondary: white with a 2px action-colour outline. tertiary: text only, in the link colour.
   * hero: signature fill, Display type, 61px tall: the one big call to action on a screen.
   * destructive: red outline, for cancel, delete, log out.
   */
  variant?: ButtonVariant;
  /** md is 55px tall, sm is 40px. Hero is always 61px and tertiary 44px, so they ignore it. */
  size?: ButtonSize;
  /** Default "full-on-phone". Tertiary is always "auto". */
  width?: ButtonWidth;
  /**
   * Long labels wrap onto more lines (the button grows). `truncate` keeps one line ending in "…" and shows the
   * whole label in a tooltip; screen readers always get the whole label.
   */
  truncate?: boolean;
};

type Common = Look & {
  children: ReactNode;
  /** A Material Symbols name before the label. Decorative: the label says the same. */
  icon?: string;
  /** A Material Symbols name after the label, e.g. "arrow_forward". */
  iconEnd?: string;
  className?: string;
};

/**
 * `disabled` takes the reason as a string ("Add at least one photo first"). The control stays focusable so
 * keyboard and screen reader users can find out why (it is the accessible description), and the reason shows as a
 * tooltip on hover, focus or tap. `true` disables with no reason: only when the reason is already on screen.
 */
type Disabled = string | boolean;

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "disabled"> & {
    href?: never;
    /** Shows a spinner in place of the label (the width stays) and ignores presses until it's done. */
    loading?: boolean;
    disabled?: Disabled;
  };

type AsLink = Common & {
  /** Navigation: a Next.js <Link> that looks like a button. A link can't be loading or disabled. */
  href: string;
  target?: string;
  rel?: string;
  "aria-current"?: "page" | "step" | "true";
  loading?: never;
  disabled?: never;
};

export type ButtonProps = AsButton | AsLink;

/** The class names for a look. Exported for tests and the rare element that can't be a <Button>. */
export function buttonClasses({ variant = "primary", size = "md", width = "full-on-phone", truncate = false }: Look): string {
  const press = variant === "hero" ? "tm-press--hero" : variant === "primary" ? "tm-press--primary" : "tm-press--secondary";
  const w = variant === "tertiary" ? "auto" : width;
  return [
    styles.btn,
    styles[variant],
    size === "sm" && variant !== "hero" && variant !== "tertiary" && styles.sm,
    w === "full" && styles.full,
    w === "full-on-phone" && styles.fullOnPhone,
    truncate && styles.truncate,
    "tm-press",
    press,
  ]
    .filter(Boolean)
    .join(" ");
}

function reasonOf(disabled: Disabled | undefined): string | null {
  return typeof disabled === "string" && disabled.trim() ? disabled.trim() : null;
}

/** The label as plain text, if it is plain text (for the truncation tooltip). */
function plainText(node: ReactNode): string | null {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    const parts = node.map(plainText);
    return parts.every((p) => p !== null) ? parts.join("") : null;
  }
  return null;
}

/**
 * Tooltip state, as the spec asks: after 500ms of hover, at once on keyboard focus or a tap, and gone on Esc.
 * The tooltip sits inside the hovered area, so the pointer can move onto it without it closing (WCAG 1.4.13).
 */
function useTooltip() {
  const [hover, setHover] = useState(false);
  const settled = useDebouncedValue(hover, TOOLTIP_DELAY_MS);
  const [keyboard, setKeyboard] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // A mouse click also focuses the button; only keyboard focus keeps the tooltip open once the pointer leaves.
  const open = !dismissed && ((hover && settled) || keyboard || tapped);

  return {
    open,
    tap: () => setTapped((t) => !t),
    hostProps: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => {
        setHover(false);
        setTapped(false);
        if (!keyboard) setDismissed(false);
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.target.matches(":focus-visible")) setKeyboard(true);
      },
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setKeyboard(false);
        setTapped(false);
        if (!hover) setDismissed(false);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation(); // Esc closes the tooltip, not the dialog the button is in.
        setDismissed(true);
      },
    },
  };
}

/** A press handler that does nothing while blocked (except show the reason on a tap). */
function guard(blocked: boolean, showReason: (() => void) | null, onClick?: (event: MouseEvent<HTMLButtonElement>) => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault(); // also stops a form submitting
      showReason?.();
      return;
    }
    onClick?.(event);
  };
}

/**
 * The .w-tip bubble. Always in the DOM so aria-describedby can read the reason; `hidden` keeps it out of the
 * layout (and the page width) until it opens. Text the accessible name already has is aria-hidden.
 */
function Tip({ open, name, reason, reasonId }: { open: boolean; name?: string | null; reason?: string | null; reasonId: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  // Centred over a small button near the edge of a phone screen, the tooltip would run off the side. When it opens,
  // measure it and slide it back inside the screen (keeping the arrow over the button).
  useLayoutEffect(() => {
    const tip = ref.current;
    if (!open || !tip) return;
    tip.style.removeProperty("--tip-shift");
    const gutter = 16; // --trade-inset-browse
    const { left, right } = tip.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const shift = left < gutter ? gutter - left : right > width - gutter ? width - gutter - right : 0;
    if (shift) tip.style.setProperty("--tip-shift", `${Math.round(shift)}px`);
  }, [open]);

  return (
    <span ref={ref} className={styles.tip} hidden={!open}>
      {name && <span aria-hidden="true">{name}</span>}
      {reason && (
        <span id={reasonId} className={name ? styles.tipReason : undefined}>
          {reason}
        </span>
      )}
    </span>
  );
}

function describedBy(own: string | undefined, reasonId: string | null): string | undefined {
  return [own, reasonId].filter(Boolean).join(" ") || undefined;
}

export function Button(props: ButtonProps) {
  const { children, variant = "primary", size, width = "full-on-phone", truncate, icon, iconEnd, className } = props;
  const reasonId = useId();
  const tooltip = useTooltip();

  const reason = reasonOf(props.disabled);
  const loading = Boolean(props.loading);
  const fullLabel = truncate ? plainText(children) : null;
  const classes = [buttonClasses({ variant, size, width, truncate }), loading && styles.loading, className]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className={styles.content}>
        {icon && <Icon name={icon} size="sm" decorative />}
        <span className={styles.label}>{children}</span>
        {iconEnd && <Icon name={iconEnd} size="sm" decorative />}
      </span>
      {loading && (
        <span className={styles.spinner}>
          <span className={styles.visuallyHidden}>, loading</span>
        </span>
      )}
    </>
  );

  let control: ReactNode;
  if (typeof props.href === "string") {
    control = (
      <Link href={props.href} target={props.target} rel={props.rel} aria-current={props["aria-current"]} className={classes}>
        {content}
      </Link>
    );
  } else {
    /* eslint-disable @typescript-eslint/no-unused-vars -- pulled out so only real <button> attributes are spread */
    const {
      children: _c, variant: _v, size: _s, width: _w, truncate: _t, icon: _i, iconEnd: _e, className: _cn,
      href: _h, loading: _l, disabled: _d, type = "button", onClick, "aria-describedby": ownDescribedBy, ...rest
    } = props;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    const blocked = Boolean(props.disabled) || loading;
    control = (
      // aria-disabled, not `disabled`: a disabled <button> can't take focus, so nobody could reach the reason.
      <button
        {...rest}
        type={type}
        className={classes}
        aria-disabled={blocked || undefined}
        aria-busy={loading || undefined}
        aria-describedby={describedBy(ownDescribedBy, reason ? reasonId : null)}
        data-disabled={props.disabled ? true : undefined}
        onClick={guard(blocked, reason ? tooltip.tap : null, onClick)}
      >
        {content}
      </button>
    );
  }

  if (!reason && !fullLabel) return control;

  const w = variant === "tertiary" ? "auto" : width;
  return (
    <span className={styles.host} data-width={w} {...tooltip.hostProps}>
      {control}
      <Tip open={tooltip.open} name={fullLabel} reason={reason} reasonId={reasonId} />
    </span>
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "disabled" | "aria-label"> & {
  /** A Material Symbols name, e.g. "close", "favorite". */
  icon: string;
  /** Decorative content such as an unread badge, inside the same tap target. */
  badge?: ReactNode;
  iconFill?: boolean;
  /** What it does, in words: "Close", "Save job". It is the accessible name and the hover tooltip. */
  label: string;
  /**
   * plain: a transparent 44px circle in the text colour (header actions, close).
   * signature: the 50px signature-colour square with a Forest icon (Save on a job).
   */
  variant?: "plain" | "signature";
  /** For on/off buttons like Save: true when on. Shows the filled icon and sets aria-pressed. */
  pressed?: boolean;
  disabled?: Disabled;
};

export function IconButton({
  icon,
  badge,
  iconFill,
  label,
  variant = "plain",
  pressed,
  disabled,
  className,
  type = "button",
  onClick,
  "aria-describedby": ownDescribedBy,
  ...rest
}: IconButtonProps) {
  const reasonId = useId();
  const tooltip = useTooltip();
  const reason = reasonOf(disabled);
  const press = variant === "signature" ? "tm-press--primary" : "tm-press--secondary";

  return (
    <span className={styles.host} data-width="auto" {...tooltip.hostProps}>
      <button
        {...rest}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={disabled ? true : undefined}
        aria-describedby={describedBy(ownDescribedBy, reason ? reasonId : null)}
        data-disabled={disabled ? true : undefined}
        className={[styles.iconBtn, styles[variant], "tm-press", press, className].filter(Boolean).join(" ")}
        onClick={guard(Boolean(disabled), reason ? tooltip.tap : null, onClick)}
      >
        <Icon name={icon} fill={iconFill ?? pressed} decorative />
        {badge}
      </button>
      <Tip open={tooltip.open} name={label} reason={reason} reasonId={reasonId} />
    </span>
  );
}
