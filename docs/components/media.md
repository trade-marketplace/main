# Upload, photos, avatars and ratings

Issue #81. Code: `src/components/media` (import from `@/components/media`). The rules (what the picker takes, the
messages, star rounding) are in `src/lib/media.ts`. Every variant and state, live: `/dev/components/media` (dev
only, with pretend uploads).

| You need | Use | Spec |
|---|---|---|
| A place to drag photos or choose them (computer) | `<DropZone>` | M26; pages.html w-c-post2 |
| The photos picked so far, each uploading straight away | `<PhotoPicker>` | `.tm-upload`, M18; w-c-post2, cus-post-2 |
| The upload progress on its own | `<ProgressRing>` | M18 |
| Job photos that open full screen | `<PhotoGallery>` (thumbnails), or `<PhotoViewer>` with your own | WEBAPP_SPEC job page: "full-screen viewer, arrow keys" |
| A person's photo or initials | `<Avatar>` | `.tm-avatar` |
| A rating to show, or to give | `<StarRating>`, `<StarInput>` | `.tm-stars`; WEBAPP_SPEC C15 |

```tsx
const { accepted, problems } = checkPhotos(files, { existing: photos.length });   // what can be added, and why not
<DropZone onFiles={add} hint="JPG, PNG, HEIC up to 10 MB" />
<PhotoPicker photos={photos} onAdd={add} onRemove={remove} onRetry={retry} problems={problems} addTile={false} />
<PhotoGallery photos={[{ src, alt: "Old wiring behind the board" }]} label="Photos of Sub wiring" />
<Avatar name="Jack Wilson" src={avatarUrl} size="lg" />
<StarRating value={4.6} count={32} />
<StarInput name="stars" value={stars} onChange={setStars} label="How did Jack do?" />
```

## Rules

- **The picker holds no files.** The page owns the list and the uploading, through the upload service (#96), and
  passes each photo's `status` ("uploading", "done" or "failed") and `progress`.
  - **Remove:** after `onRemove`, show an Undo toast (WEBAPP_SPEC C03). The dev page shows how.
  - **Next:** a step's Next should wait while any photo is uploading ("Uploading 1…").
- **What it takes** (`checkPhotos`):
  - JPG, PNG, HEIC (also with no type, by its extension) and WebP, up to 10 MB each, and 6 photos in all.
  - Each problem is one plain sentence, read out as an alert: "“plan.pdf” isn't a photo we can use. Use JPG, PNG
    or HEIC."
- **Layouts:**
  - **Phone:** three thumbnails across with an "Add photo" tile (cus-post-2). The tile opens the camera or the
    photo library.
  - **Computer:** four across under the drop zone (w-c-post2).
  - The picker picks its layout from its own width, not the screen's.
- **Failed upload:** a red outline and "Failed · Retry", where Retry is a button named "Retry switch.jpg". × is a
  44px target around the mockup's 26px circle.
- **Viewer:** a native modal `<dialog>`, so focus stays inside and the page behind is inert. ← and → move, Esc or
  a click on the dark area closes it, and focus goes back to the thumbnail. It says "2 of 4".
- **Stars:**
  - `StarRating` is one image named "4.6 out of 5 stars, 32 reviews", rounded to half stars.
  - `StarInput` is five radios ("4 stars, Great"), moved with the arrows, with the words shown beside them.

## Tests

- `tests/unit/media-components.test.tsx` covers:
  - `checkPhotos` (types, size, the 6 limit, messages);
  - the formats;
  - each component's HTML, roles and names.
- `tests/e2e/dev-media.spec.ts` covers:
  - axe and sideways scroll at every width;
  - choosing real files (preview, progress, a refused PDF, the count);
  - Retry, and remove with Undo;
  - the drag-over state;
  - the viewer by keyboard (arrows wrap, Esc, focus back);
  - star input by keyboard;
  - 200% text.

  It runs against `npm run dev`:
  `E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-media.spec.ts`.

## Not in this issue

- **Reordering photos by dragging** (w-c-post2 note 3, "the first is the cover") isn't in #81's list. The post-a-job
  step can add it.
- **Storing files** is #96.
- **Example photos:** `public/images/examples/large/` holds copies of `docs/design/img` for the preview.
