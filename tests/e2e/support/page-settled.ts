import { expect, type Page } from "@playwright/test";

/** Audit a declared page only after its metadata commit, fonts and entrance effects have settled. */
export async function waitForPageSettled(page: Page, expectedTitle: string, action?: () => Promise<void>): Promise<void> {
  if (!expectedTitle.trim()) throw new Error("An accessibility audit needs the page's expected nonempty title.");
  // Save can leave the old (even identical) title in place before React commits new metadata.
  // Observe before the action, so a quick commit is retained and a late commit cannot be missed.
  const metadata = action ? await page.evaluateHandle(() => {
    const state = { changed: false, observer: null as MutationObserver | null };
    const titleNode = (node: Node) => node instanceof Element && (node.tagName === "TITLE" || Boolean(node.querySelector("title")));
    state.observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof Element && Boolean(record.target.closest("title")) ||
        record.target.parentElement?.tagName === "TITLE" || [...record.addedNodes, ...record.removedNodes].some(titleNode))) state.changed = true;
    });
    state.observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return state;
  }) : null;
  try {
    if (action) {
      await action();
      await expect.poll(() => metadata!.evaluate(state => state.changed), { message: "The action must commit its page metadata before accessibility is audited" }).toBe(true);
    }
    await expect(page).toHaveTitle(expectedTitle);
    await page.evaluate(async title => {
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      let stableFrames = 0;
      let previousTitle = "";
      while (stableFrames < 2) {
        await document.fonts.ready;
        await frame();
        const pending = document.getAnimations().filter(animation =>
          animation.playState !== "finished" && animation.playState !== "idle" &&
          // This lifecycle clock dismisses its toast; waiting for it would remove the state from the audit.
          !(animation instanceof CSSAnimation && animation.animationName === "tm-time-left") &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity));
        if (pending.length) {
          // Cancellation can replace an entrance animation; inspect the document again afterward.
          await Promise.allSettled(pending.map(animation => animation.finished));
          stableFrames = 0;
        } else {
          const currentTitle = document.title;
          const matches = currentTitle.trim().length > 0 && (!title || currentTitle === title) && document.fonts.status === "loaded";
          stableFrames = matches ? currentTitle === previousTitle ? stableFrames + 1 : 1 : 0;
          previousTitle = currentTitle;
        }
      }
    }, expectedTitle);
    await expect(page).toHaveTitle(expectedTitle);
  } finally {
    if (metadata) {
      await metadata.evaluate(state => state.observer?.disconnect());
      await metadata.dispose();
    }
  }
}
