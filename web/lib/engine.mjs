import { chooseLane, cleanKitPool, kitNames } from "./instruments.mjs";

export const BASIS_MODES = Object.freeze(["next", "random", "closest", "farthest"]);
export const CYCLE_UNITS = Object.freeze(["bars", "resolving-sequences"]);

export function makeStation(input = {}) {
  const seed = stringValue(input.seed) || `radio-${Date.now().toString(36)}`;
  const rng = seeded(seed);
  const voiceCount = integerValue(input.voiceCount, 2, 64, randomInt(rng, 2, 20));
  const startCount = integerValue(input.startCount, 0, voiceCount, randomInt(rng, 0, voiceCount));
  const pulseCount = integerValue(input.pulseCount, 0, voiceCount - startCount, randomInt(rng, 0, voiceCount - startCount));
  const firstMeter = integerValue(input.firstMeter, 1, 64, randomInt(rng, 1, 20));
  const requestedBase = integerValue(input.baseMeter, 1, firstMeter + voiceCount - 1, randomInt(rng, firstMeter, firstMeter + voiceCount - 1));
  const baseBpm = numberValue(input.baseBpm, 20, 300, randomInt(rng, 72, 156));
  const cycleLength = integerValue(input.cycleLength, 1, 4096, randomInt(rng, 1, 4));
  const cycleUnit = cycleUnitFor(input.cycleUnit, rng);
  const basisMode = basisModeFor(input.basisMode, rng);
  const kitPool = cleanKitPool(input.kits);
  const meterLine = meters(voiceCount, firstMeter, requestedBase);
  const roles = roleLine(voiceCount, startCount, pulseCount, rng);
  const plannedKits = kitLine(voiceCount, kitPool, rng);
  const voices = meterLine.map((meter, index) => buildVoice({
    uid: `v${index + 1}`,
    meter,
    role: roles[index],
    rng,
    kitPool: [plannedKits[index]],
    cycle: 0,
    serial: index + 1
  }));

  return freezeStation({
    seed,
    cycle: 0,
    serial: voices.length + 1,
    baseUid: voices[0].uid,
    previousBaseUid: null,
    baseMeter: voices[0].meter,
    baseBpm,
    voices,
    pending: [],
    replacementsDone: 0,
    config: {
      voiceCount,
      startCount,
      pulseCount,
      firstMeter,
      cycleLength,
      cycleUnit,
      basisMode,
      kitPool
    }
  });
}

export function cloneStation(station) {
  return freezeStation({
    ...station,
    config: { ...station.config, kitPool: [...station.config.kitPool] },
    voices: station.voices.map((voice) => ({
      ...voice,
      pattern: [...voice.pattern],
      hitPositions: [...voice.hitPositions],
      lane: { ...voice.lane }
    })),
    pending: station.pending.map((job) => ({ ...job }))
  });
}

export function pulseSeconds(station) {
  return 60 / station.baseBpm;
}

export function baseBarSeconds(station) {
  return station.baseMeter * pulseSeconds(station);
}

export function resolvingBars(station) {
  return lcmAll(station.voices.map((voice) => voice.meter)) / station.baseMeter;
}

export function sectionBars(station) {
  const multiplier = station.config.cycleUnit === "resolving-sequences" ? resolvingBars(station) : 1;
  return station.config.cycleLength * multiplier;
}

export function sectionSeconds(station) {
  return sectionBars(station) * baseBarSeconds(station);
}

export function candidateBpm(station, voice) {
  return station.baseBpm * station.config.firstMeter / voice.meter;
}

export function nextCycle(station) {
  const rng = seeded(`${station.seed}:cycle:${station.cycle + 1}`);
  const selected = selectBasis(station, rng);
  const targetMeters = meters(station.config.voiceCount, station.config.firstMeter, station.config.firstMeter);
  const nextBpm = candidateBpm(station, selected);
  const base = {
    ...selected,
    meter: targetMeters[0],
    pattern: displayPattern(targetMeters[0], selected.hitPositions.map((position) => position * targetMeters[0] / selected.meter)),
    hitPositions: selected.hitPositions.map((position) => position * targetMeters[0] / selected.meter),
    rethoughtFrom: selected.meter,
    protectedCycle: station.cycle + 1
  };
  const survivors = station.voices.filter((voice) => voice.uid !== selected.uid);
  const voices = [base, ...survivors].slice(0, station.config.voiceCount);
  const roles = roleLine(station.config.voiceCount, station.config.startCount, station.config.pulseCount, rng);
  const kits = kitLine(Math.max(0, voices.length - 1), station.config.kitPool, rng, selected.lane.kitId);
  const pending = voices.slice(1).map((voice, index) => ({
    slot: index + 1,
    meter: targetMeters[index + 1],
    role: roles[index + 1],
    kitId: kits[index],
    replacedUid: voice.uid
  }));
  return freezeStation({
    ...station,
    cycle: station.cycle + 1,
    baseUid: base.uid,
    previousBaseUid: station.baseUid,
    baseMeter: base.meter,
    baseBpm: nextBpm,
    voices,
    pending,
    replacementsDone: 0
  });
}

export function replaceNext(station) {
  if (!station.pending.length) return station;
  const rng = seeded(`${station.seed}:replace:${station.cycle}:${station.replacementsDone}`);
  const [job, ...pending] = station.pending;
  const next = buildVoice({
    uid: `v${station.serial}`,
    meter: job.meter,
    role: job.role,
    rng,
    kitPool: [job.kitId],
    cycle: station.cycle,
    serial: station.serial
  });
  const voices = station.voices.map((voice, index) => (index === job.slot ? next : voice));
  return freezeStation({
    ...station,
    serial: station.serial + 1,
    voices,
    pending,
    replacementsDone: station.replacementsDone + 1
  });
}

export function nextReplacementAt(station, sectionStart) {
  if (!station.pending.length) return null;
  const total = station.replacementsDone + station.pending.length;
  const portion = (station.replacementsDone + 1) / (total + 1);
  return sectionStart + sectionSeconds(station) * portion;
}

export function eventsBetween(station, window) {
  const origin = finiteNumber(window.originSecond, 0);
  const from = Math.max(origin, finiteNumber(window.fromSecond, origin));
  const to = Math.max(from, finiteNumber(window.toSecond, from));
  const maxEvents = Math.max(1, Math.floor(finiteNumber(window.maxEvents, 8000)));
  const step = pulseSeconds(station);
  const rows = [];
  for (const [slot, voice] of station.voices.entries()) {
    for (const hitPosition of voice.hitPositions) {
      const firstCycle = Math.max(0, Math.ceil(((from - origin) / step - hitPosition) / voice.meter - 1e-9));
      const lastCycle = Math.floor(((to - origin) / step - hitPosition) / voice.meter + 1e-9);
      for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
        if (rows.length >= maxEvents) break;
        const pulse = cycle * voice.meter + hitPosition;
        const timeSecond = origin + pulse * step;
        if (timeSecond < from - 1e-9 || timeSecond >= to - 1e-9) continue;
        rows.push({
          timeSecond,
          localSecond: timeSecond - origin,
          pulse,
          slot,
          uid: voice.uid,
          meter: voice.meter,
          role: voice.role,
          pattern: [...voice.pattern],
          hitPositions: [...voice.hitPositions],
          lane: voice.lane,
          kit: voice.lane.kitName,
          note: voice.lane.note,
          velocity: voice.velocity,
          seconds: durationFor(voice.lane.family),
          bpm: candidateBpm(station, voice)
        });
      }
    }
  }
  rows.sort((a, b) => a.timeSecond - b.timeSecond || a.slot - b.slot);
  return rows.slice(0, maxEvents);
}

export function renderArrangement(firstStation, options = {}) {
  const ppq = integerValue(options.ppq, 24, 3840, 480);
  const sectionCount = integerValue(options.sectionCount, 1, 64, 6);
  const maxEventsPerSection = integerValue(options.maxEventsPerSection, 1, 100000, 25000);
  const tempos = [];
  const events = [];
  let station = cloneStation(firstStation);
  let elapsed = 0;
  let tickBase = 0;

  for (let section = 0; section < sectionCount; section += 1) {
    const bpm = station.baseBpm;
    const sectionEnd = elapsed + sectionSeconds(station);
    let cursor = elapsed;
    let segment = station;
    let used = 0;
    tempos.push({ tick: Math.round(tickBase), bpm });
    while (cursor < sectionEnd - 1e-9 && used < maxEventsPerSection) {
      const cut = nextReplacementAt(segment, elapsed);
      const end = Math.min(sectionEnd, cut ?? sectionEnd);
      for (const event of eventsBetween(segment, {
        fromSecond: cursor,
        toSecond: end,
        originSecond: elapsed,
        maxEvents: maxEventsPerSection - used
      })) {
        events.push({
          tick: Math.round(tickBase + (event.timeSecond - elapsed) * bpm * ppq / 60),
          note: event.note,
          velocity: event.velocity,
          durationTicks: Math.max(1, Math.round(event.seconds * bpm * ppq / 60))
        });
        used += 1;
      }
      cursor = end;
      if (cut !== null && cut <= end + 1e-9) segment = replaceNext(segment);
    }
    station = nextCycle(segment);
    tickBase += (sectionEnd - elapsed) * bpm * ppq / 60;
    elapsed = sectionEnd;
  }
  return { ppq, tempos, events };
}

export function stationKitText(station) {
  return kitNames(station.config.kitPool);
}

function selectBasis(station, rng) {
  const candidates = station.voices.filter((voice) => voice.uid !== station.baseUid);
  if (station.config.basisMode === "next") {
    const current = station.voices.findIndex((voice) => voice.uid === station.baseUid);
    for (let offset = 1; offset <= station.voices.length; offset += 1) {
      const candidate = station.voices[(current + offset) % station.voices.length];
      if (candidate.uid !== station.baseUid) return candidate;
    }
  }
  if (station.config.basisMode === "closest" || station.config.basisMode === "farthest") {
    const ordered = candidates
      .map((voice) => ({ voice, distance: Math.abs(candidateBpm(station, voice) - station.baseBpm) }))
      .sort((a, b) => a.distance - b.distance || a.voice.serial - b.voice.serial);
    return station.config.basisMode === "closest" ? ordered[0].voice : ordered[ordered.length - 1].voice;
  }
  return candidates[randomInt(rng, 0, candidates.length - 1)];
}

function buildVoice({ uid, meter, role, rng, kitPool, cycle, serial }) {
  const lane = chooseLane(rng, kitPool);
  const pattern = patternFor(meter, role, rng);
  return {
    uid,
    meter,
    role,
    pattern,
    hitPositions: pattern.flatMap((hit, index) => (hit === 1 ? [index] : [])),
    lane,
    velocity: randomInt(rng, 78, 118),
    cycle,
    serial,
    rethoughtFrom: null,
    protectedCycle: null
  };
}

function patternFor(meter, role, rng) {
  const size = Math.max(1, Math.floor(meter));
  if (role === "pulse") return Array.from({ length: size }, () => 1);
  if (role === "binary") {
    const row = Array.from({ length: size }, (_, index) => (index === 0 || rng() > 0.58 ? 1 : 0));
    return row.includes(1) ? row : [1, ...Array.from({ length: size - 1 }, () => 0)];
  }
  return Array.from({ length: size }, (_, index) => (index === 0 ? 1 : 0));
}

function displayPattern(meter, hitPositions) {
  const size = Math.max(1, Math.floor(meter));
  const out = Array.from({ length: size }, () => 0);
  for (const position of hitPositions) {
    const mapped = Math.min(size - 1, Math.floor(position + 1e-9));
    out[mapped] = 1;
  }
  if (!out.includes(1)) out[0] = 1;
  return out;
}

function roleLine(count, startCount, pulseCount, rng) {
  return shuffle([
    ...Array.from({ length: startCount }, () => "start-only"),
    ...Array.from({ length: pulseCount }, () => "pulse"),
    ...Array.from({ length: count - startCount - pulseCount }, () => "binary")
  ], rng);
}

function kitLine(count, kitPool, rng, differentFrom = "") {
  const pool = cleanKitPool(kitPool);
  const out = [];
  if (differentFrom && pool.length > 1 && count > 0) {
    out.push(shuffle(pool.filter((kitId) => kitId !== differentFrom), rng)[0]);
  }
  for (let index = out.length; index < count; index += 1) out.push(pool[randomInt(rng, 0, pool.length - 1)]);
  return out;
}

function meters(count, firstMeter, baseMeter) {
  const line = Array.from({ length: count }, (_, index) => firstMeter + index);
  const found = line.indexOf(baseMeter);
  if (found > 0) {
    line.splice(found, 1);
    line.unshift(baseMeter);
  }
  return line;
}

function cycleUnitFor(value, rng) {
  const raw = stringValue(value);
  if (CYCLE_UNITS.includes(raw)) return raw;
  if (raw === "random") return CYCLE_UNITS[randomInt(rng, 0, CYCLE_UNITS.length - 1)];
  return CYCLE_UNITS[randomInt(rng, 0, CYCLE_UNITS.length - 1)];
}

function basisModeFor(value, rng) {
  const raw = stringValue(value);
  if (raw === "farmost") return "farthest";
  if (BASIS_MODES.includes(raw)) return raw;
  return BASIS_MODES[randomInt(rng, 0, BASIS_MODES.length - 1)];
}

function durationFor(family) {
  return ({
    kick: 0.13,
    snare: 0.095,
    tom: 0.16,
    hat: 0.07,
    cymbal: 0.24,
    wood: 0.07
  })[family] ?? 0.08;
}

function freezeStation(station) {
  return {
    ...station,
    voices: station.voices.map((voice) => ({
      ...voice,
      pattern: Object.freeze([...voice.pattern]),
      hitPositions: Object.freeze([...voice.hitPositions]),
      lane: Object.freeze({ ...voice.lane })
    })),
    pending: station.pending.map((job) => ({ ...job })),
    config: { ...station.config, kitPool: Object.freeze([...station.config.kitPool]) }
  };
}

function shuffle(values, rng) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = randomInt(rng, 0, index);
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

function integerValue(value, min, max, fallback) {
  const parsed = hasValue(value) ? Math.floor(Number(value)) : fallback;
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, number));
}

function numberValue(value, min, max, fallback) {
  const parsed = hasValue(value) ? Number(value) : fallback;
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, number));
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function seeded(seed) {
  let state = 0x9e3779b9;
  for (const char of String(seed)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 0x85ebca6b);
  }
  return () => {
    state |= 0;
    state = Math.imul(state + 0x6d2b79f5, 0x1b873593);
    let word = state ^ (state >>> 15);
    word = Math.imul(word, word | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  };
}

function lcmAll(values) {
  return values.reduce((acc, value) => lcm(acc, value), 1);
}

function lcm(a, b) {
  const next = Math.abs(a * b) / gcd(a, b);
  return Number.isFinite(next) && next <= Number.MAX_SAFE_INTEGER ? next : Number.MAX_SAFE_INTEGER;
}

function gcd(a, b) {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}
