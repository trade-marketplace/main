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

The header uses Matt's supplied **Trade Marketplace.svg**, preserved byte for byte in
`assets/trade-marketplace.svg`. This is the source for the email logo, including its exact lettering and bolt.
It is exported to `assets/trade-marketplace.png` at 752×188px and displayed at 188×47px (4× resolution). It does not
recreate the wordmark with a font. The PNG has a fully transparent background to avoid a rectangular patch
when email clients change surrounding colours. The header uses a solid Forest gradient to preserve contrast
in Gmail mobile dark mode; the rest of the email can still follow Gmail's normal colour adaptation. The
gradient uses the `background` shorthand, rather than inline `background-image`, for current Gmail Android support.
The logo has `alt="Trade Marketplace"` for image-blocked views. The body uses one prominent lime action and
concise copy. Inspiration: the clear hierarchy and single-action layouts in [Typeform's verification email](https://reallygoodemails.com/emails/please-verify-your-email-for-typeform)
and [Discord's verification email](https://reallygoodemails.com/emails/verify-email); no third-party artwork or copy is reused.

The image is hosted at `https://assets.trademarketplace.nz/email/trade-marketplace-40e29c402400.png` on the
sender's own domain. A small Cloudflare Worker (`trade-marketplace-email-assets`) returns the embedded public
PNG bytes; it has no credentials, storage bindings, upstream requests or user-data handling. The filename
contains the PNG's SHA-256 prefix, with immutable caching, HEAD and conditional-GET support. Other paths return
404 and other methods return 405. Keep existing image URLs working when publishing future versions.

`asset-worker.mjs` exports the handler factory. Deploy that source with
`export default createEmailAssetWorker(base64Png, fullSha256)` appended, using the bytes in
`assets/trade-marketplace.png`. The deployed module uses compatibility date 2026-10-29, `nodejs_compat`, and
sampled Worker observability. The custom domain is attached to the existing trademarketplace.nz Cloudflare zone.
No application deployment or new email credentials are required.

Do not use Vercel preview URLs, expiring URLs, authenticated resources, tracking URLs or third-party image hosts.
For a future transparent export, run from the repository root (Sharp is installed with Next.js):

```sh
node --input-type=module <<'JS'
import sharp from 'sharp';
await sharp('supabase/templates/assets/trade-marketplace.svg', { density: 384 })
  .resize(752, 188).png()
  .toFile('supabase/templates/assets/trade-marketplace.png');
JS
```

Keep the SVG as the source of truth; PNG is the delivery format for email-client compatibility. Linked and
embedded SVG support differs between clients ([Can I email](https://www.caniemail.com/features/image-svg/)).

Gmail's automatic colour inversion is not equivalent to a browser dark-mode media query. The regression
was observed in Matt's Gmail iPhone screenshot: the header changed to mint while the opaque logo retained a
Forest rectangle. The fix removes that opaque matte and protects only the header colour. See
[Litmus's Gmail background guidance](https://www.litmus.com/blog/background-colors-html-email) and the
[Gmail Android gradient compatibility note](https://www.caniemail.com/news/2025-04-24-april-updates/).

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
