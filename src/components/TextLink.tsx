// Text links (#74): .tm-link and .w-link-u from docs/design/components.css / web.css, in the mode's link colour
// (--trade-link: green for customers, #9E4A00 for tradies, Forest in the office). <a> is for going somewhere;
// anything that does something on the page is a <Button variant="tertiary">.
//
//   <TextLink href="/recovery">Forgot password?</TextLink>       on its own: bold, underline on hover
//   <p>Read our <TextLink href="/legal/terms" inline>terms</TextLink>.</p>   inside a sentence: always underlined
import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import styles from "./Button.module.css";

export type TextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children"> & {
  href: string;
  children: ReactNode;
  /**
   * Inside running text, a link has to be more than a colour (WCAG 1.4.1), so `inline` keeps it underlined and
   * at the size of the text around it. Without it: the 14px bold standalone link.
   */
  inline?: boolean;
  /** Opens another site in a new tab, with rel="noopener" and "(opens in a new tab)" for screen readers. */
  external?: boolean;
};

export function TextLink({ href, children, inline = false, external = false, className, ...rest }: TextLinkProps) {
  const classes = [styles.link, inline && styles.linkInline, className].filter(Boolean).join(" ");
  if (external) {
    return (
      <a {...rest} href={href} className={classes} target="_blank" rel="noopener noreferrer">
        {children}
        <span className={styles.visuallyHidden}> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link {...rest} href={href} className={classes}>
      {children}
    </Link>
  );
}
