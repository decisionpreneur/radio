import { cleanKitIds, kitNameList, pickLane } from "./instruments.mjs";

export const BASIS_MODES = Object.freeze(["next", "random", "closest", "farthest"]);
export const CYCLE_UNITS = Object.freeze(["bars", "resolving-sequences"]);

export function makeStation(input = {}) {
  const seed = text(input.seed) || `s-${Date.now().toString(36)}`;
  const rng = randomSource(seed);
  const count = whole(input.voiceCount, 2, 64, integer(rng, 2, 20));
  const startDefault = has(input.startCount) ? input.startCount : count;
  const startCount = whole(startDefault, 0, count, count);
  const pulseLimit = count - startCount;
  const pulseCount = whole(has(input.pulseCount) ? input.pulseCount : 0, 0, pulseLimit, 0);
  const meterStart = whole(input.meterStart, 1, 64, integer(rng, 1, 20));
  const baseMeter = whole(has(input.baseMeter) ? input.baseMeter : meterStart, 1, 64, meterStart);
  const baseBpm = decimal(input.baseBpm, 20, 300, integer(rng, 72, 156));
  const unit = member(input.cycleUnit, CYCLE_UNITS, CYCLE_UNITS[integer(rng, 0, CYCLE_UNITS.length - 1)]);
  const basisMode = normalizeBasis(input.basisMode, rng);
  const kitIds = cleanKitIds(input.kits);
  const meterLine = metersFor({ count, meterStart, baseMeter });
  const kitPlan = kitPlanFor(count, kitIds, rng);
  const roles = shuffled(rng, [
    ...Array.from({ length: startCount }, () => "start-only"),
    ...Array.from({ length: pulseCount }, () => "pulse"),
    ...Array.from({ length: count - startCount - pulseCount }, () => "binary")
  ]);
  const voices = meterLine.map((meter, index) => voice({
    uid: `r${index + 1}`,
    meter,
    role: roles[index],
    rng,
    kitIds: [kitPlan[index]],
    serial: index + 1,
    cycle: 0
  }));

  return {
    seed,
    cycle: 0,
    serial: voices.length + 1,
    baseUid: voices[0].uid,
    priorBaseUid: null,
    baseMeter: voices[0].meter,
    baseBpm,
    config: {
      voiceCount: count,
      startCount,
      pulseCount,
      meterStart,
      baseMeter,
      cycleLength: whole(input.cycleLength, 1, 4096, integer(rng, 1, 4)),
      cycleUnit: unit,
      basisMode,
      kitIds
    },
    voices,
    pending: [],
    replacementsDone: 0
  };
}

export function cloneStation(station) {
  return {
    ...station,
    config: { ...station.config, kitIds: [...station.config.kitIds] },
    voices: station.voices.map((item) => ({
      ...item,
      pattern: [...item.pattern],
      instrument: { ...item.instrument }
    })),
    pending: station.pending.map((job) => ({ ...job }))
  };
}

export function pulseSeconds(station) {
  return 60 / station.baseBpm;
}

export function baseBarSeconds(station) {
  return pulseSeconds(station) * station.baseMeter;
}

export function resolveBars(station) {
  return lcmAll(station.voices.map((item) => item.pattern.length)) / station.baseMeter;
}

export function sectionBars(station) {
  const factor = station.config.cycleUnit === "resolving-sequences" ? resolveBars(station) : 1;
  return factor * station.config.cycleLength;
}

export function sectionSeconds(station) {
  return sectionBars(station) * baseBarSeconds(station);
}

export function voiceBpm(station, item) {
  return 60 / pulseSeconds(station, item);
}

export function beginNextCycle(station) {
  const rng = randomSource(`${station.seed}:cycle:${station.cycle + 1}`);
  const selected = chooseBasis(station, rng);
  const targetMeters = metersFor({
    count: station.config.voiceCount,
    meterStart: station.config.meterStart,
    baseMeter: station.config.meterStart
  });
  const currentPulse = pulseSeconds(station);
  const nextBaseBpm = bpmForRethoughtBasis(selected, targetMeters[0], currentPulse);
  const nextBase = {
    ...selected,
    meter: targetMeters[0],
    pattern: rethinkPattern(selected, targetMeters[0]),
    rethoughtFrom: selected.meter,
    protectedThrough: station.cycle + 1
  };
  const remaining = station.voices.filter((item) => item.uid !== selected.uid);
  const voices = [nextBase, ...remaining].slice(0, station.config.voiceCount);
  const rolePlan = rolesFor(station.config, rng);
  const kitPlan = kitPlanFor(Math.max(0, voices.length - 1), station.config.kitIds, rng, selected.instrument.kitId);
  const pending = voices.slice(1).map((item, index) => ({
    slot: index + 1,
    meter: targetMeters[index + 1],
    role: rolePlan[index + 1],
    kitId: kitPlan[index],
    replacedUid: item.uid
  }));

  return {
    ...station,
    cycle: station.cycle + 1,
    serial: station.serial,
    baseUid: nextBase.uid,
    priorBaseUid: station.baseUid,
    baseMeter: nextBase.meter,
    baseBpm: nextBaseBpm,
    voices,
    pending,
    replacementsDone: 0
  };
}

export function replaceOne(station) {
  if (!station.pending.length) return station;
  const rng = randomSource(`${station.seed}:replace:${station.cycle}:${station.replacementsDone}`);
  const [job, ...pending] = station.pending;
  const next = voice({
    uid: `r${station.serial}`,
    meter: job.meter,
    role: job.role,
    rng,
    kitIds: [job.kitId],
    serial: station.serial,
    cycle: station.cycle
  });
  const voices = station.voices.map((item, index) => (index === job.slot ? next : item));
  return {
    ...station,
    serial: station.serial + 1,
    voices,
    pending,
    replacementsDone: station.replacementsDone + 1
  };
}

export function nextReplacementSecond(station, sectionStartSecond) {
  if (!station.pending.length) return null;
  const total = station.replacementsDone + station.pending.length;
  return sectionStartSecond + (sectionSeconds(station) * (station.replacementsDone + 1) / (total + 1));
}

export function eventsBetween(station, window) {
  const from = Math.max(0, Number(window.fromSecond ?? 0));
  const to = Math.max(from, Number(window.toSecond ?? from));
  const origin = Number(window.originSecond ?? 0);
  const maxEvents = Math.max(1, Math.floor(Number(window.maxEvents ?? 10000)));
  const step = pulseSeconds(station);
  const events = [];
  for (const [slot, item] of station.voices.entries()) {
    if (events.length >= maxEvents) break;
    const firstPulse = Math.max(0, Math.floor((from - origin) / step) - 1);
    const lastPulse = Math.ceil((to - origin) / step) + 1;
    for (let pulse = firstPulse; pulse <= lastPulse; pulse += 1) {
      if (events.length >= maxEvents) break;
      if (item.pattern[pulse % item.pattern.length] !== 1) continue;
      const at = origin + pulse * step;
      if (at < from - 1e-9 || at >= to - 1e-9) continue;
      events.push({
        timeSecond: at,
        localSecond: at - origin,
        pulse,
        slot,
        uid: item.uid,
        meter: item.meter,
        role: item.role,
        pattern: [...item.pattern],
        instrument: item.instrument,
        kit: item.instrument.kitName,
        note: item.instrument.note,
        velocity: item.velocity,
        seconds: 0.075,
        bpm: voiceBpm(station, item)
      });
    }
  }
  events.sort((a, b) => a.timeSecond - b.timeSecond || a.slot - b.slot);
  return events.slice(0, maxEvents);
}

export function renderArrangement(start, options = {}) {
  const ppq = whole(options.ppq, 24, 3840, 480);
  const sectionCount = whole(options.sectionCount, 1, 64, 4);
  const maxEventsPerSection = whole(options.maxEventsPerSection, 1, 100000, 30000);
  const tempos = [];
  const events = [];
  let station = cloneStation(start);
  let elapsed = 0;
  let tickCursor = 0;

  for (let section = 0; section < sectionCount; section += 1) {
    const bpm = station.baseBpm;
    tempos.push({ tick: Math.round(tickCursor), bpm });
    const secondsTotal = sectionSeconds(station);
    let cursor = elapsed;
    let segmentStation = station;
    while (cursor < elapsed + secondsTotal - 1e-9) {
      const cut = nextReplacementSecond(segmentStation, elapsed);
      const end = cut === null ? elapsed + secondsTotal : Math.min(elapsed + secondsTotal, cut);
      for (const event of eventsBetween(segmentStation, {
        fromSecond: cursor,
        toSecond: end,
        originSecond: elapsed,
        maxEvents: maxEventsPerSection
      })) {
        events.push({
          tick: Math.round(tickCursor + (event.timeSecond - elapsed) * bpm * ppq / 60),
          note: event.note,
          velocity: event.velocity,
          durationTicks: Math.max(1, Math.round(event.seconds * bpm * ppq / 60))
        });
      }
      cursor = end;
      if (cut !== null && cut <= end + 1e-9) segmentStation = replaceOne(segmentStation);
    }
    station = beginNextCycle(segmentStation);
    tickCursor += secondsTotal * bpm * ppq / 60;
    elapsed += secondsTotal;
  }

  return { ppq, tempos, events };
}

export function kitSummary(station) {
  return kitNameList(station.config.kitIds);
}

function voice({ uid, meter, role, rng, kitIds, serial, cycle }) {
  const instrument = pickLane(rng, kitIds);
  return {
    uid,
    meter,
    role,
    pattern: patternFor(meter, role, rng),
    instrument,
    velocity: integer(rng, 78, 118),
    madeInCycle: cycle,
    serial,
    protectedThrough: null
  };
}

function patternFor(meter, role, rng) {
  const size = Math.max(1, Math.floor(meter));
  if (role === "start-only") return Array.from({ length: size }, (_, index) => (index === 0 ? 1 : 0));
  if (role === "pulse") return Array.from({ length: size }, () => 1);
  const row = Array.from({ length: size }, () => (rng() < 0.5 ? 0 : 1));
  if (row.includes(1)) return row;
  row[integer(rng, 0, size - 1)] = 1;
  return row;
}

function rethinkPattern(item, meter) {
  const size = Math.max(1, Math.floor(meter));
  if (item.role === "pulse") return Array.from({ length: size }, () => 1);
  const hits = item.pattern.map((value, index) => value ? index / item.pattern.length : null).filter((value) => value !== null);
  const out = Array.from({ length: size }, () => 0);
  for (const hit of hits) out[Math.min(size - 1, Math.round(hit * size))] = 1;
  if (!out.includes(1)) out[0] = 1;
  return out;
}

function bpmForRethoughtBasis(item, targetMeter, oldPulse) {
  if (item.role === "pulse") return 60 / oldPulse;
  const oldPeriod = item.pattern.length * oldPulse;
  return 60 * targetMeter / oldPeriod;
}

function chooseBasis(station, rng) {
  const candidates = station.voices.filter((item) => item.uid !== station.baseUid);
  if (station.config.basisMode === "next") {
    const current = station.voices.findIndex((item) => item.uid === station.baseUid);
    for (let step = 1; step <= station.voices.length; step += 1) {
      const item = station.voices[(current + step) % station.voices.length];
      if (item.uid !== station.baseUid) return item;
    }
  }
  if (station.config.basisMode === "closest" || station.config.basisMode === "farthest") {
    const target = station.baseBpm;
    const ordered = candidates
      .map((item) => ({ item, distance: Math.abs(bpmForRethoughtBasis(item, station.config.meterStart, pulseSeconds(station)) - target) }))
      .sort((a, b) => a.distance - b.distance);
    return station.config.basisMode === "closest" ? ordered[0].item : ordered[ordered.length - 1].item;
  }
  return candidates[integer(rng, 0, candidates.length - 1)];
}

function rolesFor(config, rng) {
  return shuffled(rng, [
    ...Array.from({ length: config.startCount }, () => "start-only"),
    ...Array.from({ length: config.pulseCount }, () => "pulse"),
    ...Array.from({ length: config.voiceCount - config.startCount - config.pulseCount }, () => "binary")
  ]);
}

function kitPlanFor(count, kitIds, rng, differentFrom = "") {
  const clean = cleanKitIds(kitIds);
  const out = [];
  if (differentFrom && clean.length > 1 && count > 0) {
    const other = shuffled(rng, clean.filter((id) => id !== differentFrom));
    out.push(other[0]);
  }
  for (let index = out.length; index < count; index += 1) {
    out.push(clean[index % clean.length]);
  }
  return shuffled(rng, out);
}

function metersFor({ count, meterStart, baseMeter }) {
  const line = Array.from({ length: count }, (_, index) => meterStart + index);
  const found = line.indexOf(baseMeter);
  if (found > 0) {
    line.splice(found, 1);
    line.unshift(baseMeter);
  }
  return line;
}

function normalizeBasis(value, rng) {
  const raw = text(value);
  if (raw === "farmost") return "farthest";
  if (BASIS_MODES.includes(raw)) return raw;
  return BASIS_MODES[integer(rng, 0, BASIS_MODES.length - 1)];
}

function member(value, options, fallback) {
  const raw = text(value);
  return options.includes(raw) ? raw : fallback;
}

function shuffled(rng, values) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = integer(rng, 0, index);
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

function whole(value, min, max, fallback) {
  const number = has(value) ? Math.floor(Number(value)) : fallback;
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function decimal(value, min, max, fallback) {
  const number = has(value) ? Number(value) : fallback;
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function integer(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function has(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function text(value) {
  return String(value ?? "").trim();
}

function randomSource(seed) {
  let state = 0x811c9dc5;
  for (const char of String(seed)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state += 0x6d2b79f5;
    let word = state;
    word = Math.imul(word ^ (word >>> 15), word | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  };
}

function lcmAll(values) {
  return values.reduce((acc, value) => lcm(acc, value), 1);
}

function lcm(a, b) {
  const next = Math.abs(a * b) / gcd(a, b);
  return next > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : next;
}

function gcd(a, b) {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}
