import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceCycle,
  applyNextReplacement,
  assertInstrumentsWithinLeanSet,
  BASIS_POLICIES,
  createInitialState,
  CYCLE_LENGTH_KINDS,
  generateEventsInWindow,
  generateSectionEvents,
  METER_TIMING_MODES,
  REPLACEMENT_CADENCES,
  renderArrangement,
  resolvingSeconds,
  sectionSeconds,
  voiceBpm
} from "../web/lib/engine.mjs";
import { encodeMidiFile } from "../web/lib/midi-file.mjs";
import { DRUM_LANES, ETHNIC_PERCUSSION_LANES, KITS } from "../web/lib/instruments.mjs";

test("start-only and pulse role counts are represented", () => {
  const state = createInitialState({
    seed: "roles",
    patternCount: 10,
    startOnlyCount: 3,
    pulseCount: 2,
    basisPolicy: "next"
  });
  assert.equal(state.voices.filter((voice) => voice.role === "start-only").length, 3);
  assert.equal(state.voices.filter((voice) => voice.role === "pulse").length, 2);
  for (const voice of state.voices.filter((item) => item.role === "start-only")) {
    assert.equal(voice.pattern[0], 1);
    assert.equal(voice.pattern.slice(1).every((hit) => hit === 0), true);
  }
  for (const voice of state.voices.filter((item) => item.role === "pulse")) {
    assert.equal(voice.pattern.every((hit) => hit === 1), true);
  }
});

test("instrument selection stays inside the lean kit set", () => {
  const state = createInitialState({
    seed: "lanes",
    patternCount: 19,
    startOnlyCount: 4,
    pulseCount: 6
  });
  assert.equal(assertInstrumentsWithinLeanSet(state), true);
});

test("normal drumset uses only named playable screenshot lanes", () => {
  assert.deepEqual(DRUM_LANES.map((lane) => lane.name), [
    "Ride Cup Gen Purpose",
    "Ride Gen Purpose",
    "Crash Gen Purpose 2",
    "Crash Gen Purpose",
    "Tom High Gen Purpose",
    "Hihat Open Gen Purpose 2",
    "Tom High-Mid Gen Purpose",
    "Hihat Open Gen Purpose",
    "Tom Low-Mid Gen Purpose",
    "Hihat Closed Gen Purpose",
    "Tom Low Gen Purpose",
    "Snare Gen Purpose 3",
    "Snare Gen Purpose 2",
    "Snare Gen Purpose",
    "Rim Sidestick Gen Purpose",
    "Kick Tight Gen Purpose"
  ]);
  assert.deepEqual(DRUM_LANES.map((lane) => lane.note), Array.from({ length: 16 }, (_, index) => 51 - index));
});

test("lean version has normal drumset and ethnic percussion kit", () => {
  assert.deepEqual(KITS.map((kit) => kit.name), ["normal drumset", "ethnic percussion kit"]);
  assert.equal(KITS[0].aliases.includes("generic drum set"), true);
  assert.deepEqual(ETHNIC_PERCUSSION_LANES.map((lane) => lane.name), [
    "Bongo High",
    "Bongo Low",
    "Conga Slap",
    "Conga High",
    "Conga Low",
    "Timbales High",
    "Timbales Low",
    "Afoxe Agogo",
    "Agogo Low",
    "Cabasa",
    "Caixixi",
    "Claves",
    "Gwo Ka",
    "Tambourin",
    "Shaker",
    "Cowbell"
  ]);
});

test("default generation gives each track a kit from the full kit pool", () => {
  const state = createInitialState({
    seed: "two-kit-default",
    patternCount: 64,
    startOnlyCount: 5,
    pulseCount: 8
  });
  const kitIds = new Set(state.voices.map((voice) => voice.kitId));
  assert.deepEqual(state.config.kitPool, KITS.map((kit) => kit.id));
  assert.equal(kitIds.has("normal-drumset"), true);
  assert.equal(kitIds.has("ethnic-percussion-kit"), true);
  assert.equal(state.voices.every((voice) => voice.kit === voice.instrument.kitName), true);
});

test("selected kit pool constrains generated and replacement tracks", () => {
  let state = createInitialState({
    seed: "ethnic-only",
    patternCount: 12,
    startOnlyCount: 2,
    pulseCount: 3,
    kitPool: "ethnic-percussion-kit",
    basisPolicy: "next"
  });
  assert.equal(state.voices.every((voice) => voice.kitId === "ethnic-percussion-kit"), true);
  state = advanceCycle(state);
  while (state.pendingReplacements.length) state = applyNextReplacement(state);
  assert.equal(state.voices.every((voice) => voice.kitId === "ethnic-percussion-kit"), true);
  assert.equal(assertInstrumentsWithinLeanSet(state), true);
});

test("next basis cannot equal previous basis", () => {
  const state = createInitialState({
    seed: "next",
    patternCount: 5,
    baseBpm: 100,
    baseMeter: 1,
    basisPolicy: "next",
    meterTiming: "shared-bar-polyrhythm"
  });
  const next = advanceCycle(state);
  assert.notEqual(next.baseVoiceId, state.baseVoiceId);
  assert.notEqual(next.baseMeter, state.baseMeter);
});

test("next basis follows configured meter order instead of protected old-base slot", () => {
  const state = createInitialState({
    seed: "next-order",
    patternCount: 6,
    baseBpm: 100,
    baseMeter: 1,
    basisPolicy: "next",
    meterTiming: "shared-bar-polyrhythm"
  });
  const second = advanceCycle(state);
  const third = advanceCycle(second);
  assert.equal(second.baseMeter, 2);
  assert.equal(third.baseMeter, 3);
});

test("blank UI-style controls use seeded random defaults and preserve chosen base meter", () => {
  const state = createInitialState({
    seed: "blank-controls",
    baseMeter: 1,
    patternCount: "",
    startOnlyCount: "",
    pulseCount: "",
    meterStart: "",
    cycleLength: "",
    cycleLengthKind: "",
    basisPolicy: ""
  });
  assert.equal(state.baseMeter, 1);
  assert.equal(state.voices[0].meter, 1);
  assert.ok(state.config.patternCount >= 2);
  assert.ok(BASIS_POLICIES.includes(state.config.basisPolicy));
  assert.ok(CYCLE_LENGTH_KINDS.includes(state.config.cycleLengthKind));
  assert.equal(state.config.meterTiming, "shared-bar-polyrhythm");
  assert.equal(state.config.replacementCadence, "one-per-bar");
  assert.equal(state.config.strongBeatMode, "every-beat");
  assert.equal(state.config.noteDurationSeconds, 0.08);
});


test("single-pattern input is clamped because new basis cannot equal previous basis", () => {
  const state = createInitialState({
    seed: "minimum",
    patternCount: 1,
    basisPolicy: "next"
  });
  assert.equal(state.config.patternCount, 2);
  assert.equal(state.voices.length, 2);
  const next = advanceCycle(state);
  assert.notEqual(next.baseVoiceId, state.baseVoiceId);
});

test("basis policies closest, farthest, and farmost typo resolve to eligible non-current bases", () => {
  const closest = createInitialState({
    seed: "closest",
    patternCount: 4,
    customMeters: [1, 2, 4, 8],
    baseMeter: 4,
    baseBpm: 120,
    basisPolicy: "closest",
    meterTiming: "shared-bar-polyrhythm"
  });
  const farthest = createInitialState({
    seed: "farthest",
    patternCount: 4,
    customMeters: [1, 2, 4, 8],
    baseMeter: 4,
    baseBpm: 120,
    basisPolicy: "farthest",
    meterTiming: "shared-bar-polyrhythm"
  });
  const typo = createInitialState({
    seed: "farmost",
    patternCount: 4,
    customMeters: [1, 2, 4, 8],
    baseMeter: 4,
    baseBpm: 120,
    basisPolicy: "farmost",
    meterTiming: "shared-bar-polyrhythm"
  });

  assert.equal(advanceCycle(closest).baseMeter, 2);
  assert.equal(advanceCycle(farthest).baseMeter, 8);
  assert.equal(typo.config.basisPolicy, "farthest");
  assert.equal(advanceCycle(typo).baseMeter, 8);
});

test("selected basis keeps its absolute pulse BPM through transition", () => {
  const state = createInitialState({
    seed: "invariant",
    patternCount: 6,
    baseBpm: 120,
    baseMeter: 1,
    basisPolicy: "next",
    meterTiming: "shared-bar-polyrhythm"
  });
  const selected = state.voices[1];
  const selectedBeforeBpm = voiceBpm(state, selected);
  const next = advanceCycle(state);
  const selectedAfter = next.voices.find((voice) => voice.id === selected.id);
  assert.equal(next.baseVoiceId, selected.id);
  assert.equal(next.baseBpm, selectedBeforeBpm);
  assert.equal(voiceBpm(next, selectedAfter), selectedBeforeBpm);
});

test("old base survives one new cycle", () => {
  const state = createInitialState({
    seed: "old-base",
    patternCount: 8,
    baseMeter: 1,
    basisPolicy: "next"
  });
  const next = advanceCycle(state);
  assert.ok(next.voices.some((voice) => voice.id === state.baseVoiceId));
});

test("delayed replacement cadence converges to regenerated meter representation", () => {
  let state = createInitialState({
    seed: "cadence",
    patternCount: 6,
    baseMeter: 1,
    basisPolicy: "next",
    replacementCadence: "one-per-bar"
  });
  state = advanceCycle(state);
  assert.ok(state.pendingReplacements.length > 0);
  const pendingCount = state.pendingReplacements.length;
  for (let index = 0; index < pendingCount; index += 1) {
    state = applyNextReplacement(state);
  }
  assert.equal(state.pendingReplacements.length, 0);
  assert.equal(new Set(state.voices.map((voice) => voice.meter)).size, state.config.patternCount);
  assert.ok(state.voices.some((voice) => voice.id === state.previousBaseVoiceId));
});

test("twenty-meter resolving-sequence scenario rethinks selected basis and regenerates representation", () => {
  const state = createInitialState({
    seed: "twenty-meter-verbatim-scenario",
    patternCount: 20,
    meterCount: 20,
    meterStart: 1,
    baseMeter: 1,
    baseBpm: 120,
    cycleLengthKind: "resolving-sequences",
    cycleLength: 3,
    basisPolicy: "next",
    meterTiming: "shared-bar-polyrhythm",
    replacementCadence: "one-per-bar"
  });
  assert.deepEqual(state.voices.map((voice) => voice.meter), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(sectionSeconds(state), resolvingSeconds(state) * 3);

  const selected = state.voices.find((voice) => voice.meter === 2);
  const selectedBeforeBpm = voiceBpm(state, selected);
  let next = advanceCycle(state);

  assert.notEqual(next.baseVoiceId, state.baseVoiceId);
  assert.equal(next.baseVoiceId, selected.id);
  assert.equal(next.baseMeter, 2);
  assert.equal(next.baseBpm, selectedBeforeBpm);
  assert.equal(voiceBpm(next, next.voices.find((voice) => voice.id === selected.id)), selectedBeforeBpm);
  assert.ok(next.voices.some((voice) => voice.id === state.baseVoiceId && voice.meter === 1));
  assert.equal(next.pendingReplacements.length, 18);

  while (next.pendingReplacements.length) {
    next = applyNextReplacement(next);
  }

  assert.equal(next.pendingReplacements.length, 0);
  assert.deepEqual(
    next.voices.map((voice) => voice.meter).slice().sort((a, b) => a - b),
    Array.from({ length: 20 }, (_, index) => index + 1)
  );
});

test("lean live defaults keep producing events after the initial hit window", () => {
  const state = createInitialState({
    seed: "probe",
    baseBpm: 100,
    patternCount: 20,
    startOnlyCount: 4,
    pulseCount: 4,
    cycleLength: 3,
    cycleLengthKind: "resolving-sequences"
  });
  const first = generateEventsInWindow(state, {
    fromSeconds: 0,
    toSeconds: 1,
    sectionStartSeconds: 0,
    maxEvents: 1000
  });
  const second = generateEventsInWindow(state, {
    fromSeconds: 1,
    toSeconds: 2,
    sectionStartSeconds: 0,
    maxEvents: 1000
  });
  assert.ok(first.events.length > 0);
  assert.ok(second.events.length > 0);
});

test("default random states schedule an opening audible event", () => {
  for (let index = 0; index < 500; index += 1) {
    const state = createInitialState({ seed: `opening-${index}` });
    const firstWindow = generateEventsInWindow(state, {
      fromSeconds: 0,
      toSeconds: 0.35,
      sectionStartSeconds: 0,
      maxEvents: 1000
    });
    assert.ok(firstWindow.events.length > 0, `opening-${index}`);
    assert.equal(firstWindow.events[0].localSeconds, 0, `opening-${index}`);
  }
});

test("resolvingSeconds stays independent of cycle length unit", () => {
  const bars = createInitialState({
    seed: "resolve-bars",
    patternCount: 4,
    customMeters: [1, 2, 3, 4],
    baseMeter: 1,
    baseBpm: 120,
    cycleLengthKind: "bars",
    cycleLength: 3,
    meterTiming: "same-pulse-polymeter"
  });
  const resolving = createInitialState({
    seed: "resolve-sequences",
    patternCount: 4,
    customMeters: [1, 2, 3, 4],
    baseMeter: 1,
    baseBpm: 120,
    cycleLengthKind: "resolving-sequences",
    cycleLength: 3,
    meterTiming: "same-pulse-polymeter"
  });
  assert.equal(resolvingSeconds(bars), resolvingSeconds(resolving));
  assert.notEqual(sectionSeconds(bars), sectionSeconds(resolving));
});

test("section events and midi encoder produce a standard midi header", () => {
  const state = createInitialState({
    seed: "midi",
    patternCount: 4,
    startOnlyCount: 1,
    pulseCount: 1,
    cycleLengthKind: "bars",
    cycleLength: 2,
    basisPolicy: "next"
  });
  const section = generateSectionEvents(state, { maxEvents: 2000 });
  assert.ok(section.events.length > 0);
  const rendered = renderArrangement(state, { sectionCount: 3 });
  const midi = encodeMidiFile(rendered);
  assert.equal(String.fromCharCode(...midi.slice(0, 4)), "MThd");
  assert.equal(String.fromCharCode(...midi.slice(14, 18)), "MTrk");
});
