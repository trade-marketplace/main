// /dev/components/buttons: every button, icon button and link variant in every state, for checking against
// docs/design/components.css and the mockups. `?mode=trade` / `?mode=office` shows them in the other palettes.
// Development only: in a production build this page is a 404. Labels are examples.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Button, IconButton, type ButtonVariant } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { DEFAULT_MODE, isMode, MODES, type Mode } from "@/lib/mode";

import { LoadingDemo, UsageExample } from "./ButtonDemos";
import { USAGE_SOURCE } from "./usage-source";
import styles from "./buttons.module.css";

export const metadata: Metadata = {
  title: "Buttons and links (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };

const VARIANTS: { variant: ButtonVariant; name: string; label: string; what: string }[] = [
  { variant: "primary", name: "Primary", label: "Post a job", what: "Action fill, Forest label (white in office). One per view." },
  { variant: "secondary", name: "Secondary", label: "Save for later", what: "White, 2px action-colour outline." },
  { variant: "tertiary", name: "Tertiary", label: "Skip for now", what: "Text only, in the link colour. Its own width." },
  { variant: "hero", name: "Hero", label: "Get my price", what: "Signature fill, Display 24, 61px. The one big CTA on a screen." },
  { variant: "destructive", name: "Destructive", label: "Cancel job", what: "Red outline: cancel, delete, log out." },
];

const SECTIONS = [
  ["variants", "Variants"],
  ["sizes", "Sizes and icons"],
  ["states", "States"],
  ["icon-buttons", "Icon buttons"],
  ["links", "Links"],
  ["long-labels", "Long labels"],
  ["widths", "Widths"],
  ["usage", "Usage"],
] as const;

const LONG =
  "Book Wiremu Te Rangi-Hēnare from Ōtautahi Electrical Services for the switchboard upgrade in Papatoetoe";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={styles.section}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
      </h2>
      {intro && <p className={styles.intro}>{intro}</p>}
      {children}
    </section>
  );
}

function Row({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.rowName}>{name}</h3>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      <div className={styles.stage}>{children}</div>
    </div>
  );
}

export default async function ButtonsPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;

  return (
    <div className={styles.page} data-mode={mode}>
      <header className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Buttons and links</h1>
          <p className={styles.lede}>
            <code>&lt;Button&gt;</code>, <code>&lt;IconButton&gt;</code> and <code>&lt;TextLink&gt;</code> from{" "}
            <code>src/components</code>, in every variant and state. Pick a mode to see them in that palette.
          </p>
          <nav aria-label="Mode" className={styles.modeNav}>
            {MODES.map((m) => (
              <Link
                key={m}
                href={m === DEFAULT_MODE ? "/dev/components/buttons" : `/dev/components/buttons?mode=${m}`}
                aria-current={m === mode ? "page" : undefined}
                className={styles.modeLink}
              >
                {MODE_NAMES[m]}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className={styles.wrap}>
        <nav aria-label="Sections" className={styles.toc}>
          {SECTIONS.map(([id, title]) => (
            <a key={id} href={`#${id}`}>
              {title}
            </a>
          ))}
        </nav>

        <Section id="variants" title="Variants" intro="Default size, each at its own width (they fill the width on a phone).">
          {VARIANTS.map((v) => (
            <Row key={v.variant} name={v.name} note={v.what}>
              <Button variant={v.variant} width="auto">
                {v.label}
              </Button>
            </Row>
          ))}
        </Section>

        <Section id="sizes" title="Sizes and icons" intro="md is 55px tall, sm 40px. Hero is always 61px, tertiary 44px.">
          {(["primary", "secondary", "destructive"] as const).map((variant) => (
            <Row key={variant} name={`${variant[0].toUpperCase()}${variant.slice(1)} · md and sm`}>
              <Button variant={variant} width="auto">
                Message Jack
              </Button>
              <Button variant={variant} size="sm" width="auto">
                Message Jack
              </Button>
            </Row>
          ))}
          <Row name="With an icon" note="Icons are decorative here: the label says the same.">
            <Button width="auto" icon="add_a_photo">
              Add photos
            </Button>
            <Button variant="secondary" width="auto" iconEnd="arrow_forward">
              Next
            </Button>
            <Button variant="tertiary" icon="map">
              Show map
            </Button>
          </Row>
          <Row name="A link that looks like a button" note="href makes it an <a>: for going somewhere, not doing something.">
            <Button href="/dev/components/buttons#usage" width="auto" iconEnd="arrow_forward">
              See the usage example
            </Button>
          </Row>
        </Section>

        <Section
          id="states"
          title="States"
          intro="Hover and press are M04 (src/styles/motion.css), shown here held on. Tab to any button to see the focus ring."
        >
          {VARIANTS.map((v) => (
            <Row key={v.variant} name={v.name}>
              <span className={styles.state}>
                <Button variant={v.variant} width="auto">
                  {v.label}
                </Button>
                <span className={styles.stateName}>Default</span>
              </span>
              <span className={styles.state}>
                <Button variant={v.variant} width="auto" className="is-hover">
                  {v.label}
                </Button>
                <span className={styles.stateName}>Hover</span>
              </span>
              <span className={styles.state}>
                <Button variant={v.variant} width="auto" className="is-press">
                  {v.label}
                </Button>
                <span className={styles.stateName}>Pressed</span>
              </span>
              <span className={styles.state}>
                <Button variant={v.variant} width="auto" loading>
                  {v.label}
                </Button>
                <span className={styles.stateName}>Loading</span>
              </span>
              <span className={styles.state}>
                <Button variant={v.variant} width="auto" disabled="Add at least one photo first">
                  {v.label}
                </Button>
                <span className={styles.stateName}>Disabled</span>
              </span>
            </Row>
          ))}
          <Row
            name="Loading keeps the width"
            note="Press it: the spinner takes the label's place for 2 seconds, the button doesn't change size, and more presses do nothing."
          >
            <LoadingDemo />
          </Row>
          <Row
            name="Disabled with a reason"
            note="Hover (after 500ms), Tab to it or tap it to see why. Esc hides the tooltip. Screen readers hear the reason as the description."
          >
            <Button width="auto" disabled="Add at least one photo first">
              Next
            </Button>
            <Button variant="secondary" width="auto" disabled="You can resend in 0:42">
              Resend email
            </Button>
          </Row>
          <Row name="Disabled, reason already on screen" note="disabled={true}: only when the reason sits right next to it.">
            <p className={styles.inlineReason} id="save-reason">
              Nothing has changed yet.
            </p>
            <Button width="auto" disabled aria-describedby="save-reason">
              Save changes
            </Button>
          </Row>
        </Section>

        <Section id="icon-buttons" title="Icon buttons" intro="The label is the accessible name and the hover tooltip.">
          <Row name="Plain" note="44px circle in the text colour: header actions, close.">
            <IconButton icon="close" label="Close" />
            <IconButton icon="notifications" label="Notifications" />
            <IconButton icon="more_vert" label="More options" />
          </Row>
          <Row name="Signature" note="The Save button on a job. On/off: aria-pressed, filled icon when on.">
            <IconButton icon="favorite" label="Save job" variant="signature" />
            <IconButton icon="favorite" label="Save job" variant="signature" pressed />
          </Row>
          <Row name="Disabled with a reason">
            <IconButton icon="call" label="Call Jack" disabled="Jack hasn’t shared a phone number" />
            <IconButton icon="favorite" label="Save job" variant="signature" disabled="Log in to save jobs" />
          </Row>
        </Section>

        <Section id="links" title="Links" intro="For going somewhere. In the mode's link colour.">
          <Row name="On its own" note="Bold 14px, underline on hover, 44px tall to tap.">
            <TextLink href="/dev/components/buttons#links">Forgot password?</TextLink>
            <TextLink href="/dev/components/buttons#links">See all jobs</TextLink>
          </Row>
          <Row name="Inside text" note="Always underlined, so it isn't told apart by colour alone.">
            <p className={styles.para}>
              By posting you agree to our <TextLink href="/dev/components/buttons#links" inline>terms</TextLink> and{" "}
              <TextLink href="/dev/components/buttons#links" inline>privacy policy</TextLink>.
            </p>
          </Row>
          <Row name="To another site" note="Opens a new tab; screen readers hear “(opens in a new tab)”.">
            <TextLink href="https://www.consumerprotection.govt.nz" external>
              Consumer Protection
            </TextLink>
          </Row>
        </Section>

        <Section
          id="long-labels"
          title="Long labels"
          intro="Names, suburbs and job titles can be any length. A label never spills out: it wraps, or it truncates and shows the whole text in a tooltip."
        >
          <Row name="Wraps (default)">
            <Button width="full">{LONG}</Button>
            <Button variant="hero" width="full">
              {LONG}
            </Button>
          </Row>
          <Row name="Truncates with a tooltip" note="truncate: one line ending in “…”. Hover or Tab to it to read it all.">
            <Button width="full" truncate>
              {LONG}
            </Button>
            <Button variant="secondary" size="sm" width="full" truncate>
              {LONG}
            </Button>
          </Row>
          <Row name="A long unbroken word">
            <Button variant="secondary" width="full">
              Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu
            </Button>
          </Row>
          <Row name="A long link">
            <TextLink href="/dev/components/buttons#long-labels">{LONG}</TextLink>
          </Row>
        </Section>

        <Section id="widths" title="Widths" intro="Resize the window: “full on phone” fills the width below 600px.">
          <Row name="full-on-phone (default)">
            <Button>Post a job</Button>
          </Row>
          <Row name="full">
            <Button width="full">Post a job</Button>
          </Row>
          <Row name="auto">
            <Button width="auto">Post a job</Button>
          </Row>
        </Section>

        <Section id="usage" title="Usage" intro="A dialog footer built from the kit, and the code that makes it.">
          <UsageExample />
          <pre className={styles.code} tabIndex={0} aria-label="Usage example code">
            <code>{USAGE_SOURCE}</code>
          </pre>
        </Section>
      </main>
    </div>
  );
}
