import { Icon } from "@/components/Icon";
import type { ThreadMessage } from "@/lib/problem-threads";
import styles from "./messages.module.css";

/** One renderer for private office support and shared job conversations. */
export function MessageBubble({ message, latest }: { message: ThreadMessage; latest: boolean }) {
  return <article className={`${styles.message} tm-anim-bubble`} data-own={message.own} aria-label={`${message.author}, ${message.when}`}>
    <div className={styles.sender}>{message.office && <Icon name="bolt" size="sm" decorative />}<b>{message.own ? "You" : message.author}</b><time dateTime={message.at}>{message.when}</time></div>
    <p>{message.body}</p>
    {!!message.photos.length && <div className={styles.photos}>{message.photos.map((photo, i) => photo.url
      // Authorized signed URLs expire and are renewed when the thread refreshes.
      // eslint-disable-next-line @next/next/no-img-element
      ? <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Message photo ${i + 1}`} /></a>
      : <span key={photo.id}>Photo unavailable</span>)}</div>}
    {latest && message.own && <span className={styles.receipt}>{message.seen ? "Read" : "Sent"}</span>}
  </article>;
}
