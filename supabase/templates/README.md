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

The header uses the exact bolt and outlined lettering from `docs/design/brand/wordmark.svg`, exported to
`docs/design/brand/wordmark-email.png` at 752×184px and displayed at 188×46px (4× resolution). It does not
recreate the wordmark with a font. The PNG is flattened on the Forest token for readability in dark-mode clients
and has `alt="Trade Marketplace"` for image-blocked views. The body uses one prominent lime action and
concise copy. Inspiration: the clear hierarchy and single-action layouts in [Typeform's verification email](https://reallygoodemails.com/emails/please-verify-your-email-for-typeform)
and [Discord's verification email](https://reallygoodemails.com/emails/verify-email); no third-party artwork or copy is reused.

The image URL is pinned to the public Git commit containing that PNG, so it is available before merge and
survives branch deletion. Do not replace it with a Vercel preview URL, expiring URL, authenticated resource or
tracking URL. For a future export, run from the repository root (Sharp is installed with Next.js):

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const forest = tokens.match(/--trade-forest:\s*(#[0-9a-f]{6})/i)[1];
await sharp('docs/design/brand/wordmark.svg', { density: 288 })
  .resize(752, 184).flatten({ background: forest }).png()
  .toFile('docs/design/brand/wordmark-email.png');
JS
```

Keep the SVG as the source of truth; PNG is the delivery format for email-client compatibility. Linked and
embedded SVG support differs between clients ([Can I email](https://www.caniemail.com/features/image-svg/)).

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
