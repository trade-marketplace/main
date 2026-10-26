// The gold quote bounty pill (web.css `.tm-status--bounty`): "Quote bounty", "Bounty · 17h", "New bounty · 2.1 km".
// Gold is for quote bounties only. The time left and distance come from the server.
import { Pill } from "./Pill";

export type BountyPillProps = {
  /** Default "Quote bounty". */
  label?: string;
  /** Shown after a dot: the time left ("17h") or the distance ("2.1 km"). */
  detail?: string;
  /** M27: glints every 4s. For bounty cards and pings; leave off in dense lists. */
  glint?: boolean;
  truncate?: boolean;
  className?: string;
};

export function BountyPill({ label = "Quote bounty", detail, glint = false, truncate, className }: BountyPillProps) {
  const text = detail?.trim() ? `${label} · ${detail.trim()}` : label;
  return (
    <Pill kind="bounty" glint={glint} truncate={truncate} className={className}>
      {text}
    </Pill>
  );
}
