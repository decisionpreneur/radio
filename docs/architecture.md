# Architecture

## Code

`web/lib/engine.mjs` contains the musical state machine and event renderer.

`web/lib/midi-file.mjs` contains a dependency-free Standard MIDI File encoder.

`web/lib/instruments.mjs` contains the lean instrument set from the attached drum-lane screenshot.

`web/app.mjs` is the live browser surface. It uses:

- Web Audio for local drum preview.
- Web MIDI when the browser exposes MIDI output access.
- The shared engine for every live cycle and export.

`scripts/generate-demo.mjs` renders a finite MIDI file for DAW/manual checks under the Dropbox radio artifact folder.

## No Backend Lean Version

The lean version is static. It can be served by Cloudflare Pages or any static server.

No user account, payment state, or entitlement state is stored by the app.

## Live Scheduling

The browser schedules a short lookahead window instead of pre-rendering huge resolving sequences. This keeps long resolving cycles playable without allocating a complete cycle event list.

When the section boundary is reached, the engine selects the next basis and recalculates the MIDI tempo basis while preserving the selected pattern's audible pulse continuity.

## DAW Check

The export path writes tempo meta events at section boundaries. MIDI notes are recalculated into the current base tempo grid per section, so manual DAW inspection can verify that the selected basis becomes the displayed tempo without an audible timing jump.

## Cloudflare

`wrangler.toml` is for Cloudflare Pages static deployment.

Cloudflare Workers Static Assets are a later option if entitlement checks must run before serving premium assets. The lean version does not use a Worker.
