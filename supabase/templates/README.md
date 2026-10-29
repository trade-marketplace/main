# Verification email

`verify-email.html` is the complete HTML body for both **Confirm sign up** and **Magic link or OTP** in the
Trade Marketplace Sydney project's Supabase Auth → Emails settings. Use the subject **Confirm your email for
Trade Marketplace** for both. These templates confirm ownership; they do not sign someone in without a password.

Paste the same file into both template editors and save each. Reload each editor to verify persistence, then
check Preview. This is a hosted-project dashboard setting: merging this file does not deploy an email template.
Do not change the SMTP credentials, redirects, Confirm Email setting, or other auth templates for this design.

The primary button and secondary text link must both retain:

```html
href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email"
```

The app supplies `/verify/confirm?next=…` as `RedirectTo`. Do not substitute `ConfirmationURL`, change `type`,
add a tracking redirect or link the button to the home page. The server handles the single-use token and
expired/reused links. See [EMAIL_VERIFICATION.md](../../docs/EMAIL_VERIFICATION.md).

## Design and compatibility

The layout uses the existing production PNG bolt icon, a live-text wordmark, one prominent lime action and
concise copy. Inspiration: the clear hierarchy and single-action layouts in [Typeform's verification email](https://reallygoodemails.com/emails/please-verify-your-email-for-typeform)
and [Discord's verification email](https://reallygoodemails.com/emails/verify-email); no third-party artwork or copy is reused.

Colours are literal copies of `src/styles/tokens.css` because email clients do not reliably support CSS custom
properties. Keep these values in sync when changing the brand tokens:

| Token | Used for |
|---|---|
| `forest` | Header, headings, button label and secondary link |
| `paper` | Background and header wordmark |
| `surface` | Content card |
| `lime` | Button and header accent |
| `text-2` | Supporting text and footer |
| `line` | Divider |
| `focus` | Keyboard focus |

Core styling is inline on presentation tables, with an Outlook conditional fixed-width wrapper. The mobile
media query only adjusts spacing and heading size; the fluid table still fits when styles in the head are
removed. Corner radii are decorative. The optional self-hosted Trade UI font falls back to Arial/Helvetica;
neither text nor the confirmation action depends on fonts, images, JavaScript, SVG or background images.
No recipient address, personalisation, tracking pixel, analytics or fixed expiry claim is included.

For a local preview replace `{{ .RedirectTo }}` with `https://trademarketplace.nz/verify/confirm?next=%2F` and
`{{ .TokenHash }}` with `preview-only` **in a temporary copy**, then open it in a browser. Never use an actual
token in screenshots or commits. Check 320, 390, 768, 1024 and 1440px, plus image-blocked and fallback-font views.
Browser previews do not replace testing the received email in Gmail, Apple Mail and Outlook.
