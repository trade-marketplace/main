// The Trade Marketplace bolt (docs/design/brand/logo.svg), drawn in the current mode's signature colour:
// Lime for customers, Amber for tradies, Mint in the office. Purely decorative, so hidden from screen readers.

type BoltMarkProps = {
  className?: string;
  /** "mark" is the logo bolt; "hero" is the large brand-device bolt that sits behind Forest bands at 20%. */
  variant?: "mark" | "hero";
};

export function BoltMark({ className, variant = "mark" }: BoltMarkProps) {
  if (variant === "hero") {
    return (
      <svg className={className} viewBox="0 0 419 694" aria-hidden="true" focusable="false">
        <path d="M400.847 301.429L328.103 301.429L297.051 379.348C281.237 418.739 243.571 444.328 201.018 444.328L126.262 444.328L93.197 527.135L36.554 668.597C29.079 686.998 52.368 702.237 66.169 687.861L223.157 526.848L413.785 331.619C424.999 320.118 416.948 300.854 400.847 300.854L400.847 301.429Z" />
        <path d="M105.560 392.574L18.153 392.574C2.052 392.574 -5.999 373.310 5.214 361.809L195.843 166.580L352.831 5.567C366.632 -8.522 389.921 6.430 382.445 24.831L325.803 166.293L248.459 359.796C240.696 379.348 221.720 392.286 200.443 392.286L105.273 392.286L105.560 392.574Z" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 26 43" aria-hidden="true" focusable="false">
      <path d="M24.6618 18.5452H20.1863L18.2758 23.3391C17.3029 25.7626 14.9856 27.337 12.3675 27.337H7.76817L5.73386 32.4316L2.24899 41.1349C1.78906 42.2671 3.22192 43.2046 4.07103 42.3201L13.7296 32.4139L25.4579 20.4026C26.1478 19.695 25.6524 18.5098 24.6618 18.5098V18.5452Z" />
      <path d="M6.49451 24.1528H1.11685C0.12623 24.1528 -0.369083 22.9676 0.320815 22.26L12.0491 10.2487L21.7076 0.342505C22.5567 -0.524289 23.9896 0.395575 23.5297 1.52771L20.0448 10.231L15.2863 22.1362C14.8087 23.3391 13.6411 24.1351 12.3321 24.1351H6.47682L6.49451 24.1528Z" />
    </svg>
  );
}
