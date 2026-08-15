import { DRUM_LANES, pickLane } from "./instruments.mjs";
import { makeRng, pick, randomInt, shuffled } from "./prng.mjs";

export const BASIS_POLICIES = Object.freeze(["next", "random", "closest", "farthest"]);
export const METER_TIMING_MODES = Object.freeze(["shared-bar-polyrhythm", "same-pulse-polymeter"]);
export const CYCLE_LENGTH_KINDS = Object.freeze(["bars", "resolving-sequences"]);
export const REPLACEMENT_CADENCES = Object.freeze(["immediate", "one-per-bar", "one-per-resolving-sequence"]);
export const STRONG_BEAT_MODES = Object.freeze(["every-beat", "downbeat-only"]);
const BASIS_POLICY_TYPOS = Object.freeze({ farmost: "farthest" });

const EPSILON = 1e-9;

export function createInitialState(input = {}) {
  const seed = input.seed ?? `seed-${Date.now()}`;
  const rng = makeRng(seed);
  const config = normalizeConfig(input, rng, seed);
  const meters = buildMeterValues(config);
  const roles = buildRoles(config, rng);
  const voices = meters.slice(0, config.patternCount).map((meter, index) => {
    return createVoice({
      id: `v${index + 1}`,
      meter,
      role: roles[index],
      rng,
      cycleIndex: 0
    });
  });
  const baseVoice = voices[0];

  return {
    config,
    seed,
    cycleIndex: 0,
    nextVoiceNumber: voices.length + 1,
    baseVoiceId: baseVoice.id,
    previousBaseVoiceId: null,
    baseMeter: baseVoice.meter,
    baseBpm: config.baseBpm,
    voices,
    pendingReplacements: []
  };
}

export function normalizeConfig(input, rng = makeRng(input.seed), seed = input.seed) {
  const patternCountInput = hasValue(input.patternCount)
    ? input.patternCount
    : randomInt(rng, 3, 20);
  const patternCount = clampNumber(
    patternCountInput,
    2,
    64
  );
  const baseMeter = hasValue(input.baseMeter) ? clampNumber(input.baseMeter, 1, 64) : undefined;
  const baseBpm = clampNumber(hasValue(input.baseBpm) ? input.baseBpm : randomInt(rng, 72, 156), 20, 300);
  const meterStart = clampNumber(
    hasValue(input.meterStart) ? input.meterStart : (baseMeter ?? randomInt(rng, 1, 20)),
    1,
    64
  );
  const meterCount = clampNumber(hasValue(input.meterCount) ? input.meterCount : patternCount, 1, 64);
  const maxSpecial = patternCount;
  const startOnlyCount = clampNumber(
    hasValue(input.startOnlyCount) ? input.startOnlyCount : randomInt(rng, 0, Math.floor(maxSpecial / 3)),
    0,
    maxSpecial
  );
  const remainingAfterStartOnly = maxSpecial - startOnlyCount;
  const pulseCount = clampNumber(
    hasValue(input.pulseCount) ? input.pulseCount : randomInt(rng, 0, Math.floor(remainingAfterStartOnly / 2)),
    0,
    remainingAfterStartOnly
  );

  return {
    seed,
    patternCount,
    startOnlyCount,
    pulseCount,
    baseBpm,
    baseMeter,
    meterStart,
    meterCount,
    customMeters: Array.isArray(input.customMeters) ? input.customMeters.map(Number).filter(Number.isFinite) : null,
    meterTiming: ensureMemberOrRandom(input.meterTiming, METER_TIMING_MODES, rng),
    cycleLengthKind: ensureMemberOrRandom(input.cycleLengthKind, CYCLE_LENGTH_KINDS, rng),
    cycleLength: clampNumber(hasValue(input.cycleLength) ? input.cycleLength : randomInt(rng, 1, 4), 1, 4096),
    basisPolicy: normalizeBasisPolicy(input.basisPolicy, rng),
    replacementCadence: ensureMemberOrRandom(input.replacementCadence, REPLACEMENT_CADENCES, rng),
    strongBeatMode: ensureMemberOrRandom(input.strongBeatMode, STRONG_BEAT_MODES, rng),
    noteDurationSeconds: clampNumber(hasValue(input.noteDurationSeconds) ? input.noteDurationSeconds : 0.08, 0.01, 2)
  };
}

export function buildMeterValues(config) {
  const raw = config.customMeters?.length
    ? config.customMeters
    : Array.from({ length: config.meterCount }, (_, index) => config.meterStart + index);
  const unique = [];
  for (const meter of raw) {
    const value = Math.max(1, Math.floor(Number(meter)));
    if (!unique.includes(value)) unique.push(value);
  }
  while (unique.length < config.patternCount) {
    unique.push(unique[unique.length - 1] + 1);
  }
  if (config.baseMeter) {
    const baseMeter = Math.max(1, Math.floor(Number(config.baseMeter)));
    const baseIndex = unique.indexOf(baseMeter);
    if (baseIndex >= 0) unique.splice(baseIndex, 1);
    unique.unshift(baseMeter);
  }
  return unique;
}

export function buildRoles(config, rng) {
  const roles = [
    ...Array.from({ length: config.startOnlyCount }, () => "start-only"),
    ...Array.from({ length: config.pulseCount }, () => "pulse")
  ];
  while (roles.length < config.patternCount) roles.push("binary");
  return shuffled(rng, roles);
}

export function createVoice({ id, meter, role, rng, cycleIndex, lane }) {
  const instrument = lane ?? pickLane(rng);
  return {
    id,
    meter,
    role,
    pattern: createPattern(meter, role, rng),
    instrument,
    velocity: randomInt(rng, 78, 120),
    createdAtCycle: cycleIndex,
    protectedThroughCycle: null
  };
}

export function createPattern(meter, role, rng) {
  const length = Math.max(1, Math.floor(meter));
  if (role === "start-only") {
    return Array.from({ length }, (_, index) => (index === 0 ? 1 : 0));
  }
  if (role === "pulse") {
    return Array.from({ length }, () => 1);
  }
  const pattern = Array.from({ length }, () => (rng() >= 0.5 ? 1 : 0));
  if (!pattern.some(Boolean)) {
    pattern[randomInt(rng, 0, length - 1)] = 1;
  }
  return pattern;
}

export function baseBarSeconds(state) {
  return (60 / state.baseBpm) * state.baseMeter;
}

export function voiceBpm(state, voice) {
  if (state.config.meterTiming === "same-pulse-polymeter") {
    return state.baseBpm;
  }
  return state.baseBpm * (voice.meter / state.baseMeter);
}

export function voicePulseSeconds(state, voice) {
  return 60 / voiceBpm(state, voice);
}

export function resolvingBaseBars(state) {
  if (state.config.meterTiming === "shared-bar-polyrhythm") return 1;
  const meterLcm = lcmAll(state.voices.map((voice) => voice.meter));
  return meterLcm / state.baseMeter;
}

export function sectionBaseBars(state) {
  const unit = state.config.cycleLengthKind === "resolving-sequences"
    ? resolvingBaseBars(state)
    : 1;
  return unit * state.config.cycleLength;
}

export function resolvingSeconds(state) {
  return resolvingBaseBars(state) * baseBarSeconds(state);
}

export function sectionSeconds(state) {
  return sectionBaseBars(state) * baseBarSeconds(state);
}

export function generateSectionEvents(state, options = {}) {
  const startSeconds = options.startSeconds ?? 0;
  const endSeconds = startSeconds + Math.min(sectionSeconds(state), options.maxSeconds ?? Infinity);
  return generateEventsInWindow(state, {
    fromSeconds: startSeconds,
    toSeconds: endSeconds,
    sectionStartSeconds: startSeconds,
    maxEvents: options.maxEvents ?? 20000
  });
}

export function generateEventsInWindow(state, options) {
  const sectionStart = options.sectionStartSeconds ?? 0;
  const fromLocal = Math.max(0, (options.fromSeconds ?? sectionStart) - sectionStart);
  const toLocal = Math.min(sectionSeconds(state), (options.toSeconds ?? sectionStart) - sectionStart);
  const maxEvents = options.maxEvents ?? 2000;
  const events = [];

  for (const voice of state.voices) {
    const pulseSeconds = voicePulseSeconds(state, voice);
    const firstPulse = Math.max(0, Math.floor((fromLocal - EPSILON) / pulseSeconds));
    const lastPulse = Math.ceil((toLocal + EPSILON) / pulseSeconds);

    for (let pulseIndex = firstPulse; pulseIndex <= lastPulse; pulseIndex += 1) {
      const localTime = pulseIndex * pulseSeconds;
      if (localTime + EPSILON < fromLocal || localTime - EPSILON >= toLocal) continue;
      if (!patternHitAt(state, voice, pulseIndex)) continue;
      events.push({
        timeSeconds: sectionStart + localTime,
        localSeconds: localTime,
        pulseIndex,
        voiceId: voice.id,
        meter: voice.meter,
        role: voice.role,
        instrument: voice.instrument,
        note: voice.instrument.note,
        velocity: voice.velocity,
        durationSeconds: state.config.noteDurationSeconds
      });
      if (events.length >= maxEvents) {
        return { events: events.sort(sortEvents), truncated: true };
      }
    }
  }

  return { events: events.sort(sortEvents), truncated: false };
}

export function chooseBasisVoice(state) {
  const currentIndex = state.voices.findIndex((voice) => voice.id === state.baseVoiceId);
  const candidates = state.voices.filter((voice) => {
    return voice.id !== state.baseVoiceId && voice.meter !== state.baseMeter;
  });
  if (!candidates.length) {
    throw new Error("No eligible next basis voice");
  }

  if (state.config.basisPolicy === "next") {
    const meterOrder = buildMeterValues(state.config);
    const orderIndex = Math.max(0, meterOrder.indexOf(state.baseMeter));
    for (let offset = 1; offset <= meterOrder.length; offset += 1) {
      const targetMeter = meterOrder[(orderIndex + offset) % meterOrder.length];
      const candidate = candidates.find((voice) => voice.meter === targetMeter);
      if (candidate) return candidate;
    }
    for (let offset = 1; offset <= state.voices.length; offset += 1) {
      const candidate = state.voices[(currentIndex + offset) % state.voices.length];
      if (candidates.includes(candidate)) return candidate;
    }
  }

  if (state.config.basisPolicy === "random") {
    const rng = makeRng(`${state.seed}:basis:${state.cycleIndex}`);
    return pick(rng, candidates);
  }

  const withDistance = candidates.map((voice) => {
    return {
      voice,
      distance: Math.abs(voiceBpm(state, voice) - state.baseBpm)
    };
  });
  withDistance.sort((a, b) => {
    if (a.distance !== b.distance) {
      return state.config.basisPolicy === "closest"
        ? a.distance - b.distance
        : b.distance - a.distance;
    }
    return state.voices.indexOf(a.voice) - state.voices.indexOf(b.voice);
  });
  return withDistance[0].voice;
}

export function advanceCycle(state) {
  const selected = chooseBasisVoice(state);
  const oldBase = state.voices.find((voice) => voice.id === state.baseVoiceId);
  const selectedBpm = voiceBpm(state, selected);
  const nextCycleIndex = state.cycleIndex + 1;
  const rng = makeRng(`${state.seed}:cycle:${nextCycleIndex}`);
  const selectedClone = cloneVoice(selected);
  const oldBaseClone = cloneVoice(oldBase);
  oldBaseClone.protectedThroughCycle = nextCycleIndex;

  const preserved = [selectedClone];
  if (oldBaseClone.id !== selectedClone.id) preserved.push(oldBaseClone);

  const replacementPlan = buildReplacementVoices({
    previousState: state,
    preserved,
    cycleIndex: nextCycleIndex,
    rng
  });

  const nextState = {
    ...state,
    cycleIndex: nextCycleIndex,
    baseVoiceId: selectedClone.id,
    previousBaseVoiceId: oldBase.id,
    baseMeter: selectedClone.meter,
    baseBpm: selectedBpm,
    nextVoiceNumber: replacementPlan.nextVoiceNumber,
    pendingReplacements: []
  };

  if (state.config.replacementCadence === "immediate") {
    nextState.voices = replacementPlan.finalVoices;
    return nextState;
  }

  nextState.voices = [selectedClone, ...state.voices.filter((voice) => voice.id !== selectedClone.id).map(cloneVoice)];
  nextState.pendingReplacements = replacementPlan.replacements;
  return nextState;
}

export function applyNextReplacement(state) {
  if (!state.pendingReplacements.length) return state;
  const [replacement, ...rest] = state.pendingReplacements;
  const voices = state.voices.slice();
  voices[replacement.slot] = replacement.voice;
  return {
    ...state,
    voices,
    pendingReplacements: rest
  };
}

export function renderArrangement(initialState, options = {}) {
  let state = cloneState(initialState);
  const sectionCount = options.sectionCount ?? 4;
  const ppq = options.ppq ?? 480;
  const maxEventsPerSection = options.maxEventsPerSection ?? 50000;
  let startSeconds = 0;
  let startTick = 0;
  const events = [];
  const tempos = [];
  const sections = [];

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const beatSeconds = 60 / state.baseBpm;
    const currentSectionSeconds = sectionSeconds(state);
    tempos.push({ tick: startTick, bpm: state.baseBpm });
    const result = generateSectionEvents(state, {
      startSeconds,
      maxEvents: maxEventsPerSection
    });

    for (const event of result.events) {
      const relativeSeconds = event.timeSeconds - startSeconds;
      const tick = startTick + Math.round((relativeSeconds / beatSeconds) * ppq);
      const durationTicks = Math.max(1, Math.round((event.durationSeconds / beatSeconds) * ppq));
      events.push({ ...event, tick, durationTicks, sectionIndex });
    }

    sections.push({
      sectionIndex,
      startSeconds,
      startTick,
      baseBpm: state.baseBpm,
      baseMeter: state.baseMeter,
      baseVoiceId: state.baseVoiceId,
      sectionSeconds: currentSectionSeconds,
      truncated: result.truncated
    });

    startSeconds += currentSectionSeconds;
    startTick += Math.round((currentSectionSeconds / beatSeconds) * ppq);
    state = advanceCycle(state);
  }

  return { events, tempos, sections, ppq, finalState: state };
}

export function cloneState(state) {
  return {
    ...state,
    config: { ...state.config, customMeters: state.config.customMeters ? state.config.customMeters.slice() : null },
    voices: state.voices.map(cloneVoice),
    pendingReplacements: state.pendingReplacements.map((replacement) => ({
      ...replacement,
      voice: cloneVoice(replacement.voice)
    }))
  };
}

function buildReplacementVoices({ previousState, preserved, cycleIndex, rng }) {
  const config = previousState.config;
  const targetCount = config.patternCount;
  const usedMeters = new Set(preserved.map((voice) => voice.meter));
  const meters = buildMeterValues(config).filter((meter) => !usedMeters.has(meter));
  const preservedRoleCounts = countRoles(preserved);
  const roleList = [];
  for (let i = 0; i < Math.max(0, config.startOnlyCount - preservedRoleCounts["start-only"]); i += 1) {
    roleList.push("start-only");
  }
  for (let i = 0; i < Math.max(0, config.pulseCount - preservedRoleCounts.pulse); i += 1) {
    roleList.push("pulse");
  }
  while (roleList.length < targetCount - preserved.length) roleList.push("binary");
  const roles = shuffled(rng, roleList);
  const finalVoices = preserved.slice();
  const replacements = [];
  let nextVoiceNumber = previousState.nextVoiceNumber;

  while (finalVoices.length < targetCount) {
    const meter = meters.shift() ?? (Math.max(...finalVoices.map((voice) => voice.meter)) + 1);
    const role = roles.shift() ?? "binary";
    const voice = createVoice({
      id: `v${nextVoiceNumber}`,
      meter,
      role,
      rng,
      cycleIndex
    });
    finalVoices.push(voice);
    replacements.push({ slot: finalVoices.length - 1, voice });
    nextVoiceNumber += 1;
  }

  return { finalVoices, replacements, nextVoiceNumber };
}

function patternHitAt(state, voice, pulseIndex) {
  if (state.config.strongBeatMode === "downbeat-only" && pulseIndex % voice.meter !== 0) {
    return false;
  }
  return voice.pattern[pulseIndex % voice.pattern.length] === 1;
}

function cloneVoice(voice) {
  return {
    ...voice,
    pattern: voice.pattern.slice(),
    instrument: { ...voice.instrument }
  };
}

function countRoles(voices) {
  return voices.reduce((acc, voice) => {
    acc[voice.role] = (acc[voice.role] ?? 0) + 1;
    return acc;
  }, { "start-only": 0, pulse: 0, binary: 0 });
}

function sortEvents(a, b) {
  if (a.timeSeconds !== b.timeSeconds) return a.timeSeconds - b.timeSeconds;
  return a.voiceId.localeCompare(b.voiceId);
}

function ensureMember(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function ensureMemberOrRandom(value, allowed, rng) {
  return allowed.includes(value) ? value : pick(rng, allowed);
}

function normalizeBasisPolicy(value, rng) {
  const corrected = BASIS_POLICY_TYPOS[value] ?? value;
  return ensureMember(corrected, BASIS_POLICIES, pick(rng, BASIS_POLICIES));
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function clampNumber(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function gcd(a, b) {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

function lcmAll(values) {
  return values.reduce((acc, value) => lcm(acc, value), 1);
}

export function assertInstrumentsWithinLeanSet(state) {
  const names = new Set(DRUM_LANES.map((lane) => lane.name));
  return state.voices.every((voice) => names.has(voice.instrument.name));
}
