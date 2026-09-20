# Dual QR Scanner

An installable, fully offline QR scanner that reads **two codes from a single
frame** and copes with codes **wrapped around curved surfaces** — bottles, cans,
pipes, cable labels.

No build step, no npm install, no network at runtime. Push it to GitHub Pages
and install it from the browser.

## Deploying to GitHub Pages

```bash
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Source: Deploy from a branch →
`main` / `/ (root)` → Save**. The app appears at
`https://<you>.github.io/<repo>/` within a minute or so.

Every path in the app is relative, so serving from a `/<repo>/` subpath works
without configuration.

## Installing on your phone

Open the Pages URL on the phone, then:

- **Android / Chrome** — "Add to Home screen" from the ⋮ menu, or the install
  prompt.
- **iOS / Safari** — Share → "Add to Home Screen". Must be Safari; other iOS
  browsers cannot install PWAs.

Load it once with a connection. After that everything — including the 950 KB
decoder — is in the service worker cache and it runs in airplane mode.

The camera needs HTTPS, which GitHub Pages provides. Opening `index.html` as a
`file://` path will not work.

## How it works

**Decoder.** ZXing-C++ compiled to WebAssembly (`vendor/zxing/`, reader build
only). Its `maxNumberOfSymbols` option is what caps results at two, and it
reports corner coordinates so detections can be outlined on the preview.

**Curved codes.** A label wrapped on a cylinder of radius `R` projects a point
at angle `t` from the near line to screen offset `R·sin(t)`, while its real
position on the flattened label is the arc length `R·t`. The picture is
therefore squeezed towards the silhouette edges, and undoing it means
resampling the source at `sin()` of evenly spaced output angles — that is
`dewarp.js`.

Three unknowns: how far the label wraps (`theta`), where the cylinder's near
line sits (`center`, since you never aim perfectly), and whether the cylinder
stands up or lies down (`axis`). So the scanner sweeps 19 combinations. It
sweeps them inside the worker, where blocking costs nothing visible because the
preview runs on the main thread. A frame carrying both codes finishes in
30–70 ms; a frame with nothing in it costs a full sweep, about 130 ms.

**One warp does not straighten a whole bottle.** This was the assumption the
real photographs killed. Each label sits at its own angle around the
circumference, so no single global correction fits both at once: on every
reference bottle the left label is recovered by a `center = -0.3` candidate and
the right one by `center = +0.3`, of the *same* frame. The scanner therefore
merges what the candidates find within one frame instead of hunting for one
perfect warp. `center` turned out to be the decisive parameter — it effectively
chooses which part of the curved surface gets corrected.

**Why a sweep and not curvature estimation:** the self-test bends a card by
1.15 rad and the winning candidate is the 0.7 rad one. Partial correction is
enough to bring the code back inside the decoder's own tolerance, so a coarse
sweep beats an expensive exact fit.

**Device orientation prunes the search.** While the phone is held upright,
world-up is image-up and a standing bottle has a vertical axis, so the
horizontal-axis half of the sweep is skipped — an empty frame costs 74 ms
instead of 131 ms. Tilt the phone flat, or run where motion events are
unavailable (a desktop, or iOS where the app never asks for permission), and
the full set is tried again. It only ever prunes; it never changes what a
successful frame reports.

**Two codes, one frame.** A reported pair always comes from one captured frame,
so two codes shown together were genuinely in view together. That is a claim
about the frame, not about one decode pass — which is exactly why merging
across candidates within a frame is still strict. Nothing is ever stitched
together across frames. A lone code is accepted only after a 1.4 s settle
window in which a frame carrying both would win.

**Offline.** `sw.js` precaches the whole app (~1 MB) on install and serves
cache-first. Each asset is fetched individually so a failure can name the file
that broke, and a partial precache fails the install rather than leaving the
app looking fine until the network disappears.

**Failing loudly.** An installed PWA has no console, so anything the user needs
to know goes to the status line. A watchdog notices when a scan stops making
progress — a wedged frame, a dead capture loop, a decoder that never loaded all
look identical from the outside — and says so instead of showing a live preview
that quietly decodes nothing.

## Checks

```bash
node scripts/check-assets.mjs   # every precached asset exists; nothing shipped is unlisted
```

Then open `selftest.html` (on the phone too, if you like). It builds a card
carrying two QR codes, bends it around a synthetic cylinder past the point
where the decoder copes alone, and asserts the dewarp sweep gets both payloads
back. It also prints the curvature range it survives.

Measured on the reference fixtures:

| half-wrap | decoder alone | with dewarp sweep |
| --------- | ------------- | ----------------- |
| 0.5 rad (29°) | 2/2 | 2/2 |
| 0.9 rad (52°) | 2/2 | 2/2 |
| 1.1 rad (63°) | 0/2 | 2/2 |
| 1.3 rad (74°) | 0/2 | 2/2 |
| 1.5 rad (86°) | 0/2 | 2/2 |

Synthetic images are a best case, and that test is partly circular: it bends
the card with the exact inverse of the transform used to straighten it, so it
proves the implementation, not the model. The real check is below.

### Real photographs

`test/bench.html` runs actual photographs of a labelled glass reagent bottle —
two paper labels wrapped around the curve — through the same pipeline, and
fails if any of them does not give up both codes. The photographs live in
`test/` and are never precached, so they add nothing to the offline payload.

| | no dewarp | swept |
| --- | --- | --- |
| 5 bottle photos @ 1080 | **0/2 on every one** | **2/2 on every one** |

Without the dewarp the decoder reads nothing at all on these — the failure that
motivated the app. Winning candidates are always vertical-axis and always
off-centre, in pairs like `v-t0.7-c-0.3` + `v-t0.7-c0.3`.

Resolution is not a free parameter here: at a 720 px long edge one of the five
bottles goes from 2/2 to 0/2, which is why `PROCESS_MAX` is 1080. 1440 costs
more and reads no more.

## Tuning

| What | Where |
| ---- | ----- |
| Curvatures and centres tried | `CANDIDATES` in `dewarp.js` |
| What counts as a finished scan | `policy.js` (`MAX_CODES`, `SETTLE_MS`) |
| Axis pruning from device tilt | `orientation.js` |
| Frame resolution handed to the decoder | `PROCESS_MAX` in `app.js` |
| Stall detection | `STALL_MS` in `app.js` |
| Barcode formats, symbol cap | `READER_OPTIONS` in `pipeline.js` |

After changing any shipped file, bump `CACHE` in `sw.js` so installed copies
pick the change up.

## Regenerating assets

```bash
node scripts/make-icons.mjs                      # PWA icons, no image libraries
npm install zxing-wasm@3.1.4 --no-save && \
  node scripts/make-fixtures.mjs                 # self-test QR fixtures
```

## If it struggles on a real object

Fill the frame with the object and keep the curved side facing you — the
correction assumes the cylinder's near line is roughly centred. Glare across a
finder pattern is the usual culprit; ZXing tolerates curvature better than it
tolerates a blown-out corner.

If real-world results disappoint, the upgrade path is OpenCV's WeChat detector
(CNN-based, markedly better on distorted codes, also multi-code). It has a
browser build but costs ~8–10 MB of precache. `pipeline.js` is the only file
that talks to the decoder, so swapping it is contained.

## Licence

App code: do as you like. Bundled decoder: ZXing-C++ under Apache-2.0, see
`vendor/zxing/LICENSE`.
