import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";
import { Avatar } from "@/components/media/Avatar";
import { StarRating } from "@/components/media/Stars";
import { VerifiedBadge } from "@/components/status/VerifiedBadge";
import type { PublicProfileCard, PublicTradieProfile } from "@/server/workers/public-profile";
import styles from "./tradie-profile.module.css";

const trades = { ELECTRICAL: "Electrician", PLUMBING: "Plumber", GAS: "Gasfitter", CONSTRUCTION: "Builder", OTHER: "Other" };
const month = new Intl.DateTimeFormat("en-NZ", { month: "short", year: "numeric", timeZone: "UTC" });

export function TradieProfileCard({ profile, heading: Heading = "h1" }: {
  profile: PublicProfileCard; heading?: "h1" | "h2" | "h3";
}) {
  return <section className={styles.card} aria-labelledby="tradie-name">
    <Avatar name={profile.name} src={profile.avatarUrl} size="lg" className={styles.avatar} decorative />
    <Heading id="tradie-name" className={styles.name}>{profile.name}</Heading>
    <p>{[...profile.trades.map(trade => trades[trade]), profile.city].join(" · ")}</p>
    {profile.trades.filter(trade => trade !== "OTHER").map(trade =>
      <div className={styles.badge} key={trade}>
        {profile.trades.length > 1 && <span>{trades[trade]}</span>}
        <VerifiedBadge verified trade={trade} />
      </div>)}
    <div className={styles.stats}>
      {profile.rating !== null && <div><strong>{profile.rating.toFixed(1)}</strong> rating</div>}
      <div><strong>{profile.jobs}</strong> {profile.jobs === 1 ? "job" : "jobs"}</div>
      <div><strong>{profile.joined}</strong> joined</div>
    </div>
    {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
  </section>;
}

export function TradieProfile({ profile }: { profile: PublicTradieProfile }) {
  return <div className={`${styles.layout} tm-anim-rise`}>
    <TradieProfileCard profile={profile} />
    <section aria-labelledby="tradie-reviews" className={styles.reviews}>
      <h2 id="tradie-reviews">Reviews{profile.reviewCount > 0 && <small> ({profile.reviewCount})</small>}</h2>
      {profile.reviews.length === 0 ? <p>No reviews yet.</p> : <ul>
        {profile.reviews.map((review, index) => <li key={index}>
          <div className={styles.heading}>
            <StarRating value={review.rating} showValue={false} size="sm" />
            <time dateTime={review.month}>{month.format(new Date(`${review.month}-01T00:00:00Z`))}</time>
          </div>
          {review.comment && <p>{review.comment}</p>}
          <div className={styles.byline}>{review.customer} · {review.job}</div>
        </li>)}
      </ul>}
    </section>
  </div>;
}

export function ProfileSkeleton() {
  return <div className={styles.layout} role="status" aria-label="Loading profile">
    <h1 className={styles.hidden}>Public tradie profile</h1>
    <div className={styles.card}><Skeleton shape="circle" width={120} height={120} /><SkeletonText lines={3} /></div>
    <div><SkeletonText lines={5} /></div>
  </div>;
}
