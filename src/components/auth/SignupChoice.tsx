"use client";
// Sign up, step one (#103, sitemap B02): "I need a job done" or "I'm a tradie". pages.html w-signup, screens.html
// pub-signup-1. Two choice cards (radios: the whole card is the hit area), then Next to that side's details
// (/signup/customer, /signup/tradie: #104, #105). Choosing "I'm a tradie" turns the page to trade colours with a
// 200ms cross-fade (reduced motion: at once).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";

import { AuthLayout } from "./AuthLayout";
import styles from "./auth.module.css";

export type SignupRole = "customer" | "tradie";

export const ROLE_CHOICES: readonly { value: SignupRole; title: string; text: string; icon: string }[] = [
  // Short lines, as in w-signup. Never "we do the paperwork" (Matt, #341).
  { value: "customer", title: "I need a job done", text: "Post jobs, get a price.", icon: "home_repair_service" },
  { value: "tradie", title: "I’m a tradie", text: "Get local work.", icon: "construction" },
];

/** Where Next goes: that side's details, keeping where they were headed (?next=). */
export function detailsHref(role: SignupRole, next?: string): string {
  return `/signup/${role}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}

export function SignupChoice({ next, initialRole = "customer" }: { next?: string; initialRole?: SignupRole }) {
  const router = useRouter();
  const [role, setRole] = useState<SignupRole>(initialRole);
  const logIn = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(detailsHref(role, next));
  }

  return (
    <div data-mode={role === "tradie" ? "trade" : "customer"} className={styles.modeSwap}>
      <AuthLayout
        title="Create account"
        wideTitle
        art="mail"
        aside={
          <>
            Already have an account? <Link href={logIn}>Log in</Link>
          </>
        }
      >
        <form className={styles.form} onSubmit={onSubmit} action={detailsHref(role, next)}>
          <SignupRoleChoices role={role} onChange={setRole} />
          <Button type="submit" width="full" iconEnd="arrow_forward">
            Next
          </Button>
          <p className={styles.phoneOnly}>
            Already have an account? <Link href={logIn}>Log in</Link>
          </p>
        </form>
      </AuthLayout>
    </div>
  );
}

/** Shared desktop choice cards for the details steps. */
export function SignupRoleChoices({ role, onChange, name = "role" }: { role: SignupRole; onChange: (role: SignupRole) => void; name?: string }) {
  return (
    <fieldset className={styles.roles}>
      <legend className={styles.lede}>What brings you here?</legend>
      {ROLE_CHOICES.map((choice) => (
        <label key={choice.value} className={styles.roleCard} data-role={choice.value}>
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={role === choice.value}
            onChange={() => onChange(choice.value)}
            className={styles.roleInput}
          />
          <span className={styles.roleDot} aria-hidden="true" />
          <Icon name={choice.icon} decorative className={styles.roleIcon} />
          <span className={styles.roleText}>
            <span className={styles.roleTitle}>{choice.title}</span>
            <span className={styles.roleSub}>{choice.text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
