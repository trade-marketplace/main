import "server-only";

import { z } from "zod";
import { SITE_URL } from "@/lib/metadata";
import { tokenColour } from "@/server/brand-colours";
import { CONTACT_SENDER, type ContactEmail } from "@/server/contact";

export const postConfirmationInput = z.object({
  jobId: z.uuid(), customerId: z.uuid(), recipientEmail: z.string().max(254).pipe(z.email()),
  jobNumber: z.number().int().positive(), title: z.string().max(100),
}).strict();
export type PostConfirmationInput = z.infer<typeof postConfirmationInput>;

// Queued payloads are validated but never rendered again: a deployment must not change the body sent under
// an existing provider idempotency key. They contain one owning customer's confirmation, never a worker price.
export const frozenPostConfirmationMessage = z.object({
  from: z.literal(CONTACT_SENDER), to: z.string().max(254).pipe(z.email()), replyTo: z.literal("hello@trademarketplace.nz"),
  subject: z.string().min(1).max(200).regex(/^[^\r\n]*$/), text: z.string().max(10_000), html: z.string().max(50_000),
}).strict();

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** G05's one-card email, using C06's wording. No database, network or provider calls during rendering. */
export function postConfirmationEmail(input: PostConfirmationInput): ContactEmail & { html: string } {
  const value = postConfirmationInput.parse(input);
  const href = new URL(`/jobs/${value.jobId}`, SITE_URL).href;
  const settings = new URL("/profile/notifications", SITE_URL).href;
  const font = new URL("/fonts/roboto-flex/RobotoFlex.woff2", SITE_URL).href;
  const logo = new URL("/icons/icon-192.png", SITE_URL).href;
  const forest = tokenColour("forest"), raised = tokenColour("forest-2"), paper = tokenColour("paper");
  const surface = tokenColour("surface"), lime = tokenColour("lime"), muted = tokenColour("text-2");
  const number = `TM-${value.jobNumber}`;
  const body = "We’re on it. We’ll let you know when your price is ready.";
  const text = `Posted.\n\n${body}\n\n${number}\n${value.title}\n\nView my job: ${href}\n\nTrade Marketplace Ltd · Invercargill\nNotification settings: ${settings}\n`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>Posted.</title>
<style>@font-face{font-family:'Trade UI';src:url('${font}') format('woff2');font-weight:100 1000}@font-face{font-family:'Trade Display';src:url('${font}') format('woff2');font-weight:100 1000}@media(prefers-color-scheme:dark){body,.email-page{background:${forest}!important}.email-card{background:${raised}!important}.email-copy{color:${surface}!important}.email-footer{color:${paper}!important}}</style></head>
<body style="margin:0;background:${paper};color:${forest};font-family:'Trade UI',Arial,sans-serif"><table class="email-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper}"><tr><td align="center" style="padding:24px 16px">
<table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${surface};border-radius:12px;overflow:hidden"><tr><td style="padding:24px;background:${forest};color:${surface}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px"><img src="${logo}" width="32" height="32" alt="" style="display:block;border:0"></td><td style="font-size:20px;font-weight:800">Trade Marketplace</td></tr></table></td></tr>
<tr><td class="email-copy" style="padding:32px 24px;color:${forest}"><h1 style="margin:0 0 16px;font-family:'Trade Display',Arial,sans-serif;font-size:36px;font-weight:900;line-height:1.1">Posted.</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.5">${body}</p><p style="margin:0 0 8px;font-size:14px;font-weight:700">${number}</p><p style="margin:0 0 24px;font-size:16px;line-height:1.5;overflow-wrap:anywhere">${escapeHtml(value.title)}</p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${lime}" style="border-radius:11px;background:${lime}"><a href="${href}" style="display:inline-block;padding:16px 24px;color:${forest};font-size:16px;font-weight:800;text-decoration:none">View my job</a></td></tr></table></td></tr></table>
<p class="email-footer" style="max-width:560px;margin:24px 0 0;color:${muted};font-size:12px;line-height:1.5">Trade Marketplace Ltd · Invercargill<br><a class="email-footer" href="${settings}" style="color:${muted}">Notification settings</a></p></td></tr></table></body></html>`;
  return { from: CONTACT_SENDER, to: value.recipientEmail, replyTo: "hello@trademarketplace.nz", subject: `Posted. · ${number}`, text, html };
}
