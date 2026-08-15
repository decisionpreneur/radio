# Architecture

## Code

`web/lib/engine.mjs` contains the musical state machine and event renderer.

`web/lib/midi-file.mjs` contains a dependency-free Standard MIDI File encoder.

`web/lib/instruments.mjs` contains the lean instrument set from the attached drum-lane screenshot.

`web/lib/paywall.mjs` contains browser-side license-key activation, validation, and local entitlement persistence.

`web/app.mjs` is the live browser surface. It uses:

- Web Audio for local drum preview.
- Web MIDI when the browser exposes MIDI output access.
- The shared engine for every live cycle and export.
- The paywall module to gate live playback, MIDI output, and MIDI export.

`scripts/generate-demo.mjs` renders a finite MIDI file for DAW/manual checks under the Dropbox radio artifact folder.

`functions/api/license` contains Cloudflare Pages Functions for paywall validation.

## Lean Paywall Version

The browser app is static. The delivery target is Cloudflare Pages with Pages Functions.

Paywall state is not stored in an app database.

Unchosen tuneables randomize by default. Blank controls pass no value for that tuneable into the shared engine.

Supported entitlement sources:

- Lemon Squeezy license key API.
- Cloudflare Pages environment variable `RADIO_LICENSE_KEYS` as a newline-separated license-key list.

The browser stores the activated license key, payment email, license instance id, and expiry in local storage so the same browser can revalidate against the Pages Function.

## Live Scheduling

The browser schedules a short lookahead window instead of pre-rendering huge resolving sequences. This keeps long resolving cycles playable without allocating a complete cycle event list.

When the section boundary is reached, the engine selects the next basis and recalculates the MIDI tempo basis while preserving the selected pattern's audible pulse continuity.

## DAW Check

The export path writes tempo meta events at section boundaries. MIDI notes are recalculated into the current base tempo grid per section, so manual DAW inspection can verify that the selected basis becomes the displayed tempo without an audible timing jump.

## Cloudflare

Cloudflare Pages deployment is configured through dashboard Git integration, not through Wrangler direct upload and not through a repo CI/CD workflow.

The static app directory is `web`.

The Pages Function directory is `functions`.
