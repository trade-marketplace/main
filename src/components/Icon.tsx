import styles from "./Icon.module.css";

type Common = {
  /** Material Symbols ligature name, e.g. "search", "check_circle". */
  name: string;
  fill?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/**
 * Every icon must say how it keeps its meaning if the icon font fails to load (or for a screen reader):
 * - `label`: the icon stands alone (an icon-only button, a status). It gets role="img" and that aria-label.
 * - `decorative`: visible text right next to it already says the same thing, so it is hidden from screen readers.
 * TypeScript refuses an icon with neither (or both).
 */
export type IconProps = Common & ({ label: string; decorative?: never } | { decorative: true; label?: never });

export function Icon({ name, fill = false, size = "md", className, ...meaning }: IconProps) {
  const classes = [styles.icon, fill && styles.fill, size !== "md" && styles[size], className]
    .filter(Boolean)
    .join(" ");

  if ("label" in meaning && meaning.label) {
    return (
      <span className={classes} role="img" aria-label={meaning.label} translate="no">
        {name}
      </span>
    );
  }

  return (
    <span className={classes} aria-hidden="true" translate="no">
      {name}
    </span>
  );
}
