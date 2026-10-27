"use client";
// The preview around the app shell (#84): pretend people, pickers for each state, and buttons that change the
// unread counts so the badge pop (M20) can be seen. Dev only (see page.tsx).
import Link from "next/link";
import { useState } from "react";

import { AppShellView, type ShellViewer } from "@/components/app/AppShellView";
import { Button } from "@/components/Button";

import styles from "./app-shell.module.css";
import { COUNTS, type CountsKey, DEMO_VIEWERS, type DemoKey } from "./demo-data";

const BASE = "/dev/components/app-shell";

type Props = { viewerKey: DemoKey; countsKey: CountsKey; at: string; testMode: boolean; menuOpen: boolean };

function href(props: Props, change: Partial<Props>): string {
  const next = { ...props, ...change };
  const query = new URLSearchParams();
  if (next.viewerKey !== "customer") query.set("viewer", next.viewerKey);
  if (next.at !== DEMO_VIEWERS[next.viewerKey].home) query.set("at", next.at);
  if (next.countsKey !== "some") query.set("counts", next.countsKey);
  if (!next.testMode) query.set("test", "off");
  if (next.menuOpen) query.set("menu", "open");
  const q = query.toString();
  return q ? `${BASE}?${q}` : BASE;
}

function Picker<T>({ label, options, current, link }: { label: string; options: [T, string][]; current: T; link: (value: T) => string }) {
  return (
    <nav aria-label={label} className={styles.pickNav}>
      <span className={styles.pickLabel}>{label}</span>
      {options.map(([value, name]) => (
        <Link key={name} href={link(value)} aria-current={value === current ? "page" : undefined} className={styles.pick}>
          {name}
        </Link>
      ))}
    </nav>
  );
}

export function ShellDemo(props: Props) {
  const { viewerKey, countsKey, at, testMode, menuOpen } = props;
  const demo = DEMO_VIEWERS[viewerKey];
  // Counts the buttons below change; they start from the picked set and reset when it changes.
  const [counts, setCounts] = useState({ key: countsKey, messages: COUNTS[countsKey].messages, notifications: COUNTS[countsKey].notifications });
  const shown = counts.key === countsKey ? counts : { key: countsKey, messages: COUNTS[countsKey].messages, notifications: COUNTS[countsKey].notifications };
  const bump = (field: "messages" | "notifications") => setCounts({ ...shown, [field]: shown[field] + 1 });

  const viewer: ShellViewer = { ...demo.viewer, counts: { messages: shown.messages, notifications: shown.notifications } };
  const base = href({ ...props, menuOpen: false }, {});

  return (
    <AppShellView viewer={viewer} testMode={testMode} preview={{ at, base, menuOpen }}>
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>Dev only · not in production builds</p>
        <h1 className={styles.title}>App navigation</h1>
        <p className={styles.lede}>
          The signed-in shell for customers and tradies (#84): the top nav from 1024px wide, the bottom bar below that.
          These are pretend people; on a real page the server reads who is signed in. Nav links stay on this page and
          move the current page instead.
        </p>
        <p className={styles.current}>
          Current page: <code>{at}</code>
        </p>

        <Picker
          label="Person"
          options={(Object.keys(DEMO_VIEWERS) as DemoKey[]).map((k) => [k, DEMO_VIEWERS[k].name])}
          current={viewerKey}
          link={(k) => href(props, { viewerKey: k, at: DEMO_VIEWERS[k].home, menuOpen: false })}
        />
        <Picker
          label="Counts"
          options={(Object.keys(COUNTS) as CountsKey[]).map((k) => [k, COUNTS[k].name])}
          current={countsKey}
          link={(k) => href(props, { countsKey: k })}
        />
        <Picker
          label="Payments"
          options={[
            [true, "Test mode"],
            [false, "Live"],
          ]}
          current={testMode}
          link={(t) => href(props, { testMode: t })}
        />
        <Picker
          label="Page"
          options={[
            [at, "This page"],
            ["/notifications", "Notifications (no tab)"],
            ["/jobs/new", "Post a job (full screen)"],
          ]}
          current={at}
          link={(page) => href(props, { at: page })}
        />

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" width="auto" icon="notifications" onClick={() => bump("notifications")}>
            New notification
          </Button>
          <Button variant="secondary" size="sm" width="auto" icon="chat_bubble" onClick={() => bump("messages")}>
            New message
          </Button>
          <Button variant="tertiary" width="auto" onClick={() => setCounts({ key: countsKey, messages: 0, notifications: 0 })}>
            Read everything
          </Button>
        </div>

        <h2 className={styles.heading}>Things to try</h2>
        <ul className={styles.list}>
          <li>Click between the tabs: the bar under the current one slides to the new one (M16).</li>
          <li>Press “New message” or “New notification”: the badge pops (M20). Reading them makes it go, with no pop.</li>
          <li>Press Tab first thing on the page: “Skip to content” jumps past the nav.</li>
          <li>Narrow the window below 1024px: the bottom bar takes over, and the end of the page stays above it.</li>
          <li>Open the avatar menu: arrows move, Esc closes it and puts focus back on the avatar.</li>
        </ul>
        {Array.from({ length: 8 }, (_, i) => (
          <p key={i} className={styles.filler}>
            Example page content so there is something to scroll past. Post any job free, accept one fair fixed price,
            and someone local sorts it.
          </p>
        ))}
        <p className={styles.filler}>The end of the page: never hidden behind the bottom bar.</p>
      </div>
    </AppShellView>
  );
}
