# Polymetric Radio

Polymetric Radio is a live percussion system whose simultaneous meters share one tempo clock. A cycle may choose a different meter as the tempo basis. The chosen polystem keeps the same audible timing while the system recalculates its MIDI meaning around that basis.

The current target is `POC / MVP 0 / alpha prerelease`.

## MVP 0

- Every simultaneous polystem contains one hit at the beginning of its bar. That is the whole pattern.
- Playback is open.
- Donation is the only payment surface.
- The instrument set is the sixteen audible `Gen Purpose` lanes on MIDI notes `36` through `51`.
- Unset controls are random.
- The browser plays the live result; MIDI generation and DAW output remain engineering surfaces for the live system.
- Cloudflare Pages deploys the static `web/` directory from the connected repository.
- Binaries and generated artifacts belong in Dropbox `/Musica/radio`.

## Core Invariant

Within a cycle, BPM is constant. At a cycle boundary, the selected next basis differs from the current basis. Its sound stays in place while its meter becomes the first meter. The other polystems are replaced one by one until the full meter set is represented again.

## Release Stages

| Release | Deliverable | Payment | Main risk closed before release |
| --- | --- | --- | --- |
| R0 - POC / MVP 0 / alpha prerelease | Live static radio; one hit at every polystem bar start; random two-to-twenty meter set; `Gen Purpose` notes 36-51 | Donation through Ko-fi to PayPal | A listener can start, hear, stop, restart, change the station, and reach a working donation payment |
| R1 - Audible cycle laboratory | Short cycle presets beside long resolving sequences; exact cycle and bar readout | Donation | Cycle changes can be heard and adjusted without waiting through impractical resolving periods |
| R2 - Tempo-basis polymodulation | `next`, `random`, `closest`, and `farmost`; next basis cannot equal the current basis | Donation | The selected polystem keeps its audible pulse while BPM and meter meaning are recalculated |
| R3 - Resolving replacement | Selected basis remains; old basis may remain temporarily; every other meter and pattern is replaced one by one | Donation | Replacement order, duplicate meters, skipped meters, and cycle-boundary races are closed |
| R4 - Pattern roles | Tuneable start-only count, pulse count, simultaneous pattern count, strong-beat meaning, binary patterns, and random defaults | Donation | Density, clipping, silent lanes, and role-count drift are closed before richer patterns |
| R5 - MIDI and DAW | Browser MIDI output, downloadable arrangement, tempo map, and Ableton inspection path | Donation | Note range, tempo events, ordering, duration, and import behavior match live playback |
| R6 - Long-run tuning | Stable endless scheduling, exact large-cycle arithmetic, bounded CPU, bounded node count, mobile layout, and reconnect behavior | Donation | Drift, numeric overflow, scheduler gaps, bursts, memory growth, and tab suspension are closed |
| R7 - Public radio | Safe branded domain, concrete station name and description, share route, listener feedback route, and current world-network discovery | Donation | Domain reputation, first-play friction, dead links, unclear copy, and absent listener feedback are closed |
| R8 - Paid radio | `5 USD` monthly Lemon Squeezy product after KYC; licence key access; special-use access; Cloudflare Pages Functions; database still absent until a proved need appears | Monthly licence plus donation | Purchase, licence issue, activation, validation, revocation, recovery, and Uruguay payout complete end to end |
| R9 - Listener requests and station identity | Paid or donated pattern requests, station IDs, and optional jingles | Monthly licence plus donation | Request ownership, moderation, scheduling, attribution, and interruption of the endless composition are closed |
| R10 - Advanced composition | Velocity, duration, probability, accents, instrument choice, larger meter domains, and other backlog parameters | Product decision | Every added parameter has an audible adjustment path and cannot break the tempo-basis invariant |

## Iteration Stages

| Order | Increment | Why this is next | Problem exposed before more scope is added |
| --- | --- | --- | --- |
| I0.1 | Force every generated lane to `start-only` and every pattern to hit position `0` | Smallest complete sound generator | Silent notes, wrong instrument range, and event scheduling at time zero |
| I0.2 | Remove licence access and monthly checkout from the released surface; keep one Ko-fi donation route | Smallest public access path while Lemon KYC is pending | First-play blocking and donation-link failure |
| I0.3 | Fit Play, Stop, New, score, current hit, meters, and Donation into the first usable screen | The listener needs the actual radio first | Hidden transport, overlapping text, mobile overflow, and unclear live state |
| I0.4 | Connect Ko-fi directly to the existing Uruguay PayPal account | Completes the only MVP payment path | Account mismatch, country mismatch, supporter checkout, and withdrawal path |
| I0.5 | Deploy R0 from the repository-connected Cloudflare Pages project | Publishes the smallest complete release without deployment tokens | Build-root mistakes, stale assets, missing modules, and cached old access UI |
| I1.1 | Add an audible short-cycle preset without changing the long resolving-sequence mode | Makes cycle work manually adjustable | Cycle readout and transition timing can be judged in minutes |
| I1.2 | Keep random, consecutive, prime, and explicit meter sets within an exact supported numeric domain | Prevents arithmetic scope from outrunning playback | LCM growth, unsafe integers, and impractical cycle duration |
| I2.1 | Apply `next` basis selection to two meters | Least complex basis transition | Current-basis exclusion and audible continuity |
| I2.2 | Add `random`, `closest`, and `farmost` over the same candidate set | Reuses the proved transition | Ties, deterministic selection, and BPM-distance calculation |
| I2.3 | Expand the same transition to twenty simultaneous meters | Exercises the stated scale after the two-meter case | Candidate ordering and long resolving combinations |
| I3.1 | Preserve the selected polystem and queue every other replacement | Smallest complete replacement state | Selected-lane mutation and lost old-base representation |
| I3.2 | Execute one replacement per bar | Fastest visible cadence | Slot order, meter duplication, and role-count preservation |
| I3.3 | Add one-per-resolving-sequence, spread, and immediate cadences | Adds the remaining requested cadence meanings | Boundary collisions and unfinished replacement queues |
| I4.1 | Restore tuneable start-only and pulse counts while keeping total roles equal to simultaneous patterns | Adds one pattern family at a time | Invalid counts, excessive density, and clipped output |
| I4.2 | Add the binary pattern family | Completes the lean pattern set | Empty patterns, unstable accents, and excess event count |
| I4.3 | Restore random defaults for every unchosen pattern parameter | Applies the requested default after each role is independently adjustable | Random states outside valid count and timing constraints |
| I5.1 | Emit live MIDI notes 36-51 from the same scheduled events as browser audio | Reuses the live event stream | Browser/DAW divergence and stuck notes |
| I5.2 | Export a finite MIDI arrangement with tempo changes at cycle boundaries | Makes the endless system inspectable | Event ordering, delta times, and tempo-map mismatch |
| I5.3 | Inspect the arrangement in Ableton against the visible lane set | Uses the requested DAW surface | Unvoiced notes, wrong drum lanes, and misleading note labels |
| I6.1 | Replace unsafe large-number cycle arithmetic before widening meter limits | Failure prevention precedes larger domains | Overflow, fractional bar counts, and scheduler lockup |
| I6.2 | Bound scheduler lookahead, live node count, gain, and simultaneous transients | Required before denser patterns | CPU spikes, memory growth, clipping, and dropped hits |
| I6.3 | Exercise background-tab, reconnect, mobile, and long-run behavior | Closes live delivery failure modes | Suspended audio, stale state, layout overlap, and recovery gaps |
| I7.1 | Put the concrete name, short route, description, and one support action on the public radio | Applies the useful launch heuristics from the old material | A listener cannot identify, return to, or support the station |
| I7.2 | Add a lean external listener-feedback route | Avoids a database while exposing real listening problems | Missing reports about silence, timing, device behavior, and taste |
| I7.3 | Clear the branded domain's browser reputation and certificate route | A custom URL is useful only when browsers admit listeners | Safety interstitials and domain-level abandonment |
| I8.1 | Finish Lemon KYC and the `5 USD` monthly product | Manual provider prerequisite comes before paid code | Store activation and Uruguay payout |
| I8.2 | Add licence activation and validation in Pages Functions | Lean paid access without a separate backend service | Purchase-to-key delivery and provider outages |
| I8.3 | Add special-use access and licence recovery without committing raw keys | Completes requested exceptional access | Secret exposure, lockout, revocation, and recovery |
| I9.1 | Add optional station IDs or jingles between defined cycle boundaries | Lowest-risk identity insertion | Timing interruption and excessive repetition |
| I9.2 | Add listener pattern requests through an external payment or form route | Reuses provider surfaces before adding storage | Moderation, ownership, queueing, and fulfilment |
| I10.1 | Add one advanced musical parameter at a time, each with a direct audible control | Keeps tuning causal and inspectable | Interacting controls that obscure the source of a change |

## Milestone Stages

| Milestone | Evidence required before the next milestone |
| --- | --- |
| M0 - First sound | Every visible polystem has only hit position `0`; Chromium shows a running real-time audio context connected to the output; Stop suspends it; Ko-fi accepts a PayPal donation |
| M1 - First cycle | A short cycle changes basis on time while BPM stays constant inside the cycle |
| M2 - Preserved pulse | Every basis mode selects a different basis and the selected polystem sounds at the same instants before and after reinterpretation |
| M3 - Full resolution | One-by-one replacement finishes with the full target meter set and exactly one preserved selected polystem |
| M4 - Lean pattern set | Start-only, pulse, and binary counts remain valid and every unspecified choice is random within its domain |
| M5 - DAW parity | Browser audio, live MIDI, exported MIDI, and Ableton lanes use the same events, tempo changes, and notes 36-51 |
| M6 - Endless run | Long-run playback has constant in-cycle BPM, bounded resources, exact cycle math, and recovery after tab suspension |
| M7 - Public route | The branded route opens without a safety interstitial and listeners can play, share, donate, and report a problem |
| M8 - Paid route | A real `5 USD` monthly purchase issues a working licence; a non-buyer remains outside paid access; special-use access works; payout reaches the selected Uruguay route |
| M9 - Listener loop | A request or station-identity insertion enters at a defined boundary without breaking the endless composition |
| M10 - Advanced tuning | Each advanced parameter changes one named audible relation and preserves every core invariant |

## Deployment

Cloudflare Pages uses repository integration. The build command is empty and the output directory is `web`. The prerelease needs no API token, CI workflow, backend, or database.

## Licence

See [LICENSE](LICENSE).
