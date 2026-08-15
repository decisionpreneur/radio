import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceCycle,
  assertInstrumentsWithinLeanSet,
  createInitialState,
  generateSectionEvents,
  renderArrangement,
  voiceBpm
} from "../web/lib/engine.mjs";
import { encodeMidiFile } from "../web/lib/midi-file.mjs";

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

test("instrument selection stays inside screenshot lane set", () => {
  const state = createInitialState({
    seed: "lanes",
    patternCount: 19,
    startOnlyCount: 4,
    pulseCount: 6
  });
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
