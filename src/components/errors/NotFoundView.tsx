// The 404 page (#109): pages.html w-errors, "404 · not found". A Forest card with the bolt, a big "404" in the
// signature colour, "Wrong address." (Matt: short, tradie, no explaining), Go home and Help centre. Also what someone sees for a job they can't see: it never
// says the job exists (WEBAPP_SPEC G01). Used by src/app/not-found.tsx and the route groups' not-found files.
import { Button } from "@/components/Button";
import { BoltMark } from "@/components/BoltMark";

import styles from "./errors.module.css";

export const NOT_FOUND_TITLE = "Wrong address.";

export function NotFoundView() {
  return (
    <div className={styles.wrap}>
      <section className={styles.notFound} aria-labelledby="not-found-title">
        <BoltMark variant="hero" className={styles.bolt} />
        <div className={styles.notFoundInner}>
          <p className={styles.code} aria-hidden="true">
            404
          </p>
          <h1 id="not-found-title" className={styles.title}>
            {NOT_FOUND_TITLE}
          </h1>
          <div className={styles.actions}>
            <Button href="/" size="sm" width="auto" className={styles.goHome}>
              Go home
            </Button>
            <Button href="/help" size="sm" width="auto" className={styles.onDark}>
              Help centre
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
