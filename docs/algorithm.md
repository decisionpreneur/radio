# Algorithm

## Core Invariant

At every tempo-basis change time `T`, the selected pattern keeps the same absolute event times after `T`. The selected pattern becomes the internal tempo basis. Other non-protected patterns are regenerated around that new basis. The new basis cannot be the previous basis.

## State

- `baseBpm`: current internal tempo number.
- `baseMeter`: meter value of the current basis voice.
- `baseVoiceId`: voice currently treated as the basis.
- `voices`: simultaneous binary patterns.
- `cycleIndex`: completed change cycles.
- `pendingReplacements`: delayed replacement queue for non-immediate cadence.

Each voice has:

- `meter`
- `pattern`
- `role`: `start-only`, `pulse`, or `binary`
- `instrument`
- `velocity`

Unchosen configuration fields are generated from the current seed. In the browser UI, a blank numeric control or a `random` select entry means the field is unchosen.

## Pattern Roles

`start-only`:

```text
1 0 0 ... 0
```

`pulse`:

```text
1 1 1 ... 1
```

The lean browser UI uses `every-beat` pulse interpretation so live playback keeps producing audible events after the initial window. `downbeat-only` remains an engine-level option only, not a lean UI tuneable.

`binary`:

```text
random 0/1 pattern with at least one hit
```

## Meter Timing Modes

`shared-bar-polyrhythm`:

All meters fit inside the same base bar duration. Voice pulse BPM is:

```text
voiceBpm = baseBpm * voiceMeter / baseMeter
```

This is the default because `closest` and `farthest` basis choices have concrete BPM distance.

`same-pulse-polymeter`:

All voices share the same pulse duration. Different meters create different bar lengths. Resolving length is based on the least common multiple of the active meters.

## Cycle Length

`bars`:

```text
change after cycleLength base bars
```

`resolving-sequences`:

```text
change after cycleLength * resolvingBaseBars
```

For `shared-bar-polyrhythm`, `resolvingBaseBars = 1`.

For `same-pulse-polymeter`:

```text
resolvingBaseBars = lcm(activeMeters) / baseMeter
```

## Basis Selection

Candidates exclude the current base voice and exclude the current base meter.

`next` selects the next remaining candidate in configured meter order.

`random` selects one remaining candidate from the seeded generator.

`closest` selects the remaining candidate with smallest absolute BPM distance from current `baseBpm`.

`farthest` selects the remaining candidate with largest absolute BPM distance from current `baseBpm`.

## Basis Change

Let selected voice `S` be chosen.

1. Compute `S` absolute pulse BPM under the current state.
2. Set `baseBpm` to that BPM.
3. Set `baseMeter` to `S.meter`.
4. Move `S` to voice slot 0 without changing its pattern or instrument.
5. Preserve the old base voice for the new cycle.
6. Regenerate replaceable voices from the configured meter source.
7. Replace meter and pattern together for regenerated voices.

The old base remains through the new cycle. At the next basis change, it becomes replaceable unless it is selected as the new base.

## Invariant Check

For `shared-bar-polyrhythm`, selected voice BPM before transition:

```text
before = oldBpm * selectedMeter / oldMeter
```

After selecting that voice as the new basis:

```text
newBaseBpm = before
after = newBaseBpm * selectedMeter / selectedMeter
```

Checked equality:

```text
oldBpm * selectedMeter / oldMeter == (oldBpm * selectedMeter / oldMeter) * selectedMeter / selectedMeter
```

Assumptions:

```text
oldBpm > 0
oldMeter > 0
selectedMeter > 0
```

Z3 result for the negated equality:

```text
unsat
```

Wolfram result for the equality:

```text
True
```

Runnable coverage:

```text
tests/logical-invariant.test.mjs
```
