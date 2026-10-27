# Mapbox job map (#139)

`MapListLayout` uses the existing map pins, cluster buttons, cards and legend. Pass `mapbox` to replace the kit's
illustrated surface with Mapbox GL JS. The provider projects each already-authorized `MapJob.point`; it never fetches
an exact address or makes the privacy decision. Continue using `jobPinFor()` on the server before passing jobs in.

```tsx
import { MapListLayout } from "@/components/map/MapListLayout";
import { loadMapboxConfig } from "@/server/geo/mapbox-config";

const config = await loadMapboxConfig(); // MAPBOX_ACCESS_TOKEN + coverage from office Settings
<MapListLayout jobs={jobs} serverNow={Date.now()} mapbox={config} />
```

With no public token, the component renders the complete list immediately and does not load the Mapbox SDK or
contact Mapbox. A failed SDK, CSS, WebGL, style or tile load switches to that same list. Rows still open their cards;
Escape closes the card and returns focus. Loading the SDK/assets is bounded to 15 seconds; loading the map is bounded
to 20 seconds. The existing `state` prop handles job-data loading, empty and error states separately.

Pins are projected again on every map move and resize. The kit's overlap-based clustering keeps labels apart at each
screen size, retains a gold indicator when a cluster includes a bounty, and keeps a selected job out of a cluster.
Cluster buttons fit their members; “Show all jobs” restores the full bounds. Initial bounds fit all supplied jobs,
or the configured work area when there are no jobs. Keyboard controls and the full list offer an alternative to
dragging the canvas. Mapbox attribution stays enabled. Rotation and pitch are disabled so pins and area rings stay
aligned with the flat map. The CDN assets are pinned to **3.33.0** and load only after a token is present.

Location is requested only after pressing “Use my location”; it is not saved or sent to our server. Success recentres
the map and shows the location dot. Denial, unsupported geolocation or timeout recentres the full office work area,
with a readable status message. The map/list and zoom controls remain usable.

## Install the token

The list is the working default whenever the environment has no public token. Configure a dedicated token for
each environment that needs live maps:

1. Create a dedicated **public** (`pk.`) Mapbox token with the minimum map/style/font read scopes in the Mapbox console.
2. Add **URL restrictions** for the actual deployed app origins, including `https://trademarketplace.nz/*`. Add the
   specific preview and local origins that need maps; do not use an unrestricted token for production. Restrictions
   are set and enforced by Mapbox, not by client JavaScript. Verify both an allowed app URL and a disallowed origin.
3. Save it in Vercel as `MAPBOX_ACCESS_TOKEN` and redeploy. No `NEXT_PUBLIC_` variable is needed: the server explicitly
   passes only a validated `pk.` token to the map. An `sk.` token is never exposed; the map falls back to the list.
4. Check the Live Mapbox preview or the consuming job board. A URL restriction mismatch/401/403 must show the list.

The existing server-side address search also reads `MAPBOX_ACCESS_TOKEN` (#97). Mapbox's URL-restricted browser tokens
can reject server-side address search, because it has no browser Referer. Before using a restricted token for both,
William should validate the geocoding use case and provision a separate server-only search token if needed. Never
remove the map's URL restrictions or expose a secret token to make geocoding work.
Follow-up: [#348](https://github.com/trade-marketplace/main/issues/348).

Official references: [GL JS install](https://docs.mapbox.com/mapbox-gl-js/guides/get-started/),
[Map API](https://docs.mapbox.com/mapbox-gl-js/api/map/),
[public tokens and URL restrictions](https://docs.mapbox.com/help/dive-deeper/access-tokens/).

## Preview and tests

`/dev/components/mapbox?state=ready|missing-token|loading|error|empty|location-denied|live` is guarded by
`guardDevPage()`. The first six states use an offline camera adapter and illustrated tiles; no external requests,
real permissions or customer data are needed. `live` uses the environment token and real CDN SDK, or the list when
it is absent. The fixture exercises the same provider setup, projection, clustering, fit bounds, controls, failure
and location handling as the real SDK. It does not claim to test Mapbox's tile service.

Unit tests cover configuration, secret-token rejection, coordinate order, work-area bounds, allowed/denied/timeout
location and token-free rendering. Browser tests cover all preview states at 320, 390, 768, 1024 and 1440 px with
axe, keyboard selection/closing, clustering, fit bounds, location success/denial and network-free fallback.

The offline fixture includes the SDK's `.mapboxgl-map` / canvas / attribution DOM and loads its positioning rules
after the app CSS. A regression checks full-height canvas geometry, visible pins and attribution at every width,
so a late vendor stylesheet cannot silently collapse the map while the SDK reports a successful load.

Live checks are opt-in: run the dev server with the authorized token in ignored `.env.local`, use a localhost
`E2E_DEV_BASE_URL`, and set `E2E_MAPBOX_LIVE=1` for the `live Mapbox renders` browser tests. They wait for SDK idle,
all tiles loaded and rendered features, then check real canvas dimensions, pins and attribution and save screenshots
at every required width. They do not print or commit the token, and normal CI stays offline.
