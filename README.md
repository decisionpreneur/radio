# Radio

Lean browser-live polymetric polymodulation instrument for an eternal drum pattern stream whose audible timing stays continuous while the selected tempo basis changes at cycle boundaries.

## Current Deliverable

- Static browser app: `web/index.html`
- Shared algorithm engine: `web/lib/engine.mjs`
- MIDI file encoder/export path: `web/lib/midi-file.mjs`
- Static paywall client: `web/lib/paywall.mjs`
- Cloudflare Pages Function license endpoints: `functions/api/license`
- Cloudflare Pages Function public checkout config: `functions/api/config`
- Node test path: `tests/engine.test.mjs`
- Demo artifact generator: `scripts/generate-demo.mjs`

The lean version has no database, no Cloudflare API deploy path, and no repo CI/CD workflow. Donation and checkout are configurable outbound links in the static page. Paywall validation runs through Cloudflare Pages Functions with either Lemon Squeezy license keys or a newline-separated Cloudflare environment license list.

## Verify

```powershell
node --test C:\git\radio\tests\engine.test.mjs C:\git\radio\tests\logical-invariant.test.mjs C:\git\radio\tests\paywall.test.mjs C:\git\radio\tests\static-check.mjs
```

```powershell
bash C:\git\radio\tests\run
```

```powershell
node C:\git\radio\scripts\generate-demo.mjs
```

The full test runner includes the Z3 invariant check.

## Lean Controls

- simultaneous patterns
- start-only patterns
- pulse patterns
- meter source as first natural numbers
- meter timing mode
- cycle length in bars or resolving sequences
- next tempo-basis policy: next, random, closest, farthest
- replacement cadence: immediate, one per bar, one per resolving sequence
- seed
- base BPM
- base meter
- MIDI export section count

Unchosen tuneables randomize by default. A blank control means the shared engine receives no value for that tuneable and derives it from the current seed.

## Instrument Set

The lean version is constrained to every visible lane label in the attached drum-lane screenshot:

- A5
- E2
- Ride Cup Gen Purpose
- Ride Gen Purpose
- Crash Gen Purpose 2
- Crash Gen Purpose
- Tom High Gen Purpose
- Hihat Open Gen Purpose 2
- Tom High-Mid Gen Purpose
- Hihat Open Gen Purpose
- Tom Low-Mid Gen Purpose
- Hihat Closed Gen Purpose
- Tom Low Gen Purpose
- Snare Gen Purpose 3
- Snare Gen Purpose 2
- Snare Gen Purpose
- Rim Sidestick Gen Purpose
- Kick Tight Gen Purpose
- B0

## Artifact Target

Generated binaries and manual-check artifacts go under:

```text
C:\Users\j\Dropbox\Musica\radio\polymetric-polymodulation
```

## Cloudflare Target

The delivery target is Cloudflare Pages Git integration configured in the Cloudflare dashboard.

Use repository `decisionpreneur/radio`, production branch `master`, build command blank, build output directory `web`, and the repository `functions` directory for Pages Functions.

Set these Cloudflare Pages environment variables or secrets when paywalling is enabled:

- `RADIO_LICENSE_KEYS`: newline-separated license-key allowlist.
- `RADIO_CHECKOUT_URL`: hosted checkout URL shown by the app.
- `RADIO_LICENSE_REQUIRE_EMAIL`: `0` only when checkout email should not be required.
- `RADIO_LEMONSQUEEZY_PRODUCT_ID`: optional Lemon Squeezy product id constraint.
- `RADIO_LEMONSQUEEZY_VARIANT_ID`: optional Lemon Squeezy variant id constraint.

Local HTTP serving is not a delivery target.

Deployment boundary details are in `docs/deployment.md`.

The old radio course conversion is in `docs/course-conversion.md`.
