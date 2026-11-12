import "server-only";

import { z } from "zod";

import { SITE_URL } from "@/lib/metadata";
import { money } from "@/lib/office-job";
import { TRADE_LABELS } from "@/lib/office-jobs";
import { tokenColour } from "@/server/brand-colours";
import { CONTACT_SENDER, type ContactEmail } from "@/server/contact";

const job = { to: z.email(), jobId: z.uuid(), jobNumber: z.number().int().positive(), title: z.string().min(1).max(200) };
const inputs = {
  "job.priced": z.object({ ...job, priceCents: z.number().int().nonnegative() }).strict(),
  "job.submitted": z.object({ ...job, firstName: z.string().min(1).max(100), autoReleaseHours: z.number().int().positive() }).strict(),
  "licence.verified": z.object({ to: z.email(), trade: z.enum(["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION"]) }).strict(),
};
export type NotificationEmailEvent = keyof typeof inputs;
export type NotificationEmailFacts = { [E in NotificationEmailEvent]: z.infer<(typeof inputs)[E]> };
export type NotificationEmail = ContactEmail & { html: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const subjectLine = (value: string) => value.replace(/[\r\n]+/g, " ");

/** G05's three launch messages. Rendering reads immutable brand tokens and never calls a database or provider. */
export function notificationEmail<E extends NotificationEmailEvent>(event: E, facts: NotificationEmailFacts[E]): NotificationEmail {
  let to: string, subject: string, heading: string, body: string, button: string, path: string;
  let hero: string | null = null;
  if (event === "job.priced") {
    const value = inputs["job.priced"].parse(facts);
    to = value.to; heading = "Your price is ready"; hero = money(value.priceCents);
    subject = `${heading} · ${value.title} · ${hero}`;
    body = `Fixed price for ${value.title}, incl. GST. Saying no is free.`;
    button = "See your price"; path = `/jobs/${value.jobId}`;
  } else if (event === "job.submitted") {
    const value = inputs["job.submitted"].parse(facts);
    to = value.to; heading = `${value.firstName}’s finished.`;
    subject = `${heading} All good? · Please check within ${value.autoReleaseHours} hours`;
    body = `Have a look and let us know it’s all sorted. If we don’t hear back in ${value.autoReleaseHours} hours, we’ll mark it done.`;
    button = "Check & rate"; path = `/jobs/${value.jobId}`;
  } else {
    const value = inputs["licence.verified"].parse(facts), trade = TRADE_LABELS[value.trade];
    to = value.to; heading = "You’re good to go.";
    subject = `Your licence is checked · ${trade} · you can claim jobs now`;
    body = `We’ve checked your ${trade} licence. You can now claim ${trade.toLocaleLowerCase("en-NZ")} jobs.`;
    button = "Find work"; path = "/jobs";
  }
  const href = new URL(path, SITE_URL).href;
  const settings = new URL("/profile/notifications", SITE_URL).href;
  const font = new URL("/fonts/roboto-flex/RobotoFlex.woff2", SITE_URL).href;
  const logo = new URL("/icons/icon-192.png", SITE_URL).href;
  const forest = tokenColour("forest"), raised = tokenColour("forest-2"), paper = tokenColour("paper"), surface = tokenColour("surface"), muted = tokenColour("text-2");
  const action = tokenColour(event === "licence.verified" ? "amber" : "lime");
  const text = `${heading}\n\n${hero ? `${hero}\n\n` : ""}${body}\n\n${button}: ${href}\n\nTrade Marketplace Ltd · Invercargill · Notification settings: ${settings}\n`;
  // The existing post-confirmation renderer stays untouched; this uses the same one-card table layout.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(heading)}</title>
<style>@font-face{font-family:'Trade UI';src:url('${escapeHtml(font)}') format('woff2');font-weight:100 1000}@font-face{font-family:'Trade Display';src:url('${escapeHtml(font)}') format('woff2');font-weight:100 1000}@media(max-width:420px){h1{font-size:28px!important}}@media(prefers-color-scheme:dark){body,.email-page{background:${forest}!important}.email-card{background:${raised}!important}.email-copy{color:${surface}!important}.email-footer{color:${paper}!important}}</style></head>
<body style="margin:0;background:${paper};color:${forest};font-family:'Trade UI',Arial,sans-serif"><main><table class="email-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper}"><tr><td align="center" style="padding:24px 16px">
<table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${surface};border-radius:12px;overflow:hidden"><tr><td style="padding:24px;background:${forest};color:${surface}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px"><img src="${escapeHtml(logo)}" width="32" height="32" alt="" style="display:block;border:0"></td><td style="font-size:20px;font-weight:800">Trade Marketplace</td></tr></table></td></tr>
<tr><td class="email-copy" style="padding:32px 24px;color:${forest}"><h1 style="margin:0 0 16px;font-family:'Trade Display',Arial,sans-serif;font-size:36px;font-weight:900;line-height:1.1;overflow-wrap:anywhere">${escapeHtml(heading)}</h1>${hero ? `<p style="margin:0 0 16px;font-size:32px;font-weight:800">${escapeHtml(hero)}</p>` : ""}<p style="margin:0 0 24px;font-size:16px;line-height:1.5;overflow-wrap:anywhere">${escapeHtml(body)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="${action}" style="border-radius:11px;background:${action};text-align:center"><a href="${escapeHtml(href)}" style="display:block;padding:16px 24px;color:${forest};font-size:16px;font-weight:800;text-decoration:none">${escapeHtml(button)}</a></td></tr></table></td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${paper}"><p class="email-footer" style="margin:0;color:${muted};font-size:12px;line-height:1.5">Trade Marketplace Ltd · Invercargill · <a class="email-footer" href="${escapeHtml(settings)}" style="color:${muted};white-space:nowrap">Notification settings</a></p></td></tr></table></td></tr></table></main></body></html>`;
  return { from: CONTACT_SENDER, to, replyTo: "hello@trademarketplace.nz", subject: subjectLine(subject), text, html };
}
