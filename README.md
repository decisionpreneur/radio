# Radio

Lean browser-live polymetric polymodulation instrument for an eternal drum pattern stream whose audible timing stays continuous while the selected tempo basis changes at cycle boundaries.

## Current Deliverable

- Static browser app: `web/index.html`
- Shared algorithm engine: `web/lib/engine.mjs`
- MIDI file encoder/export path: `web/lib/midi-file.mjs`
- Node test path: `tests/engine.test.mjs`
- Demo artifact generator: `scripts/generate-demo.mjs`
- Cloudflare Pages config: `wrangler.toml`

The lean version has no backend and no database. Donation is a configurable outbound link in the static page. Later paywalling is documented as a Cloudflare Worker signed-token path.

## Verify

```powershell
node --test C:\git\radio\tests\engine.test.mjs C:\git\radio\tests\static-check.mjs
```

```powershell
node C:\git\radio\scripts\generate-demo.mjs
```

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

Unchosen values can be randomized from the app.

## Instrument Set

The lean version is constrained to the attached drum-lane set:

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

The delivery target is Cloudflare Pages or Cloudflare Workers Pages. The config uses `pages_build_output_dir = "./web"`. A Worker can be added later only when paywall enforcement is implemented.

Local HTTP serving is not a delivery target.

Deployment boundary details are in `docs/deployment.md`.
