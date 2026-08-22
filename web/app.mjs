import {
  advanceCycle,
  applyNextReplacement,
  baseBarSeconds,
  cloneState,
  createInitialState,
  generateEventsInWindow,
  renderArrangement,
  resolvingBaseBars,
  resolvingSeconds,
  sectionBaseBars,
  sectionSeconds,
  voiceBpm
} from "./lib/engine.mjs";
import { encodeMidiFile } from "./lib/midi-file.mjs";
import {
  activateLicense,
  clearEntitlement,
  entitlementUnlocks,
  fetchPublicConfig,
  getOrCreateInstanceName,
  licenseErrorMessage,
  makeEntitlement,
  readEntitlement,
  validateLicense,
  writeEntitlement
} from "./lib/paywall.mjs";

const controls = document.querySelector("#controls");
const statusEl = document.querySelector("#status");
const voicesEl = document.querySelector("#voices");
const canvas = document.querySelector("#timeline");
const ctx = canvas.getContext("2d");
const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const randomBtn = document.querySelector("#randomBtn");
const shareBtn = document.querySelector("#shareBtn");
const midiBtn = document.querySelector("#midiBtn");
const exportBtn = document.querySelector("#exportBtn");
const midiOutputSelect = document.querySelector("#midiOutput");
const donateLink = document.querySelector("#donateLink");
const checkoutLink = document.querySelector("#checkoutLink");
const licenseKeyInput = document.querySelector("#licenseKey");
const licenseEmailInput = document.querySelector("#licenseEmail");
const unlockBtn = document.querySelector("#unlockBtn");
const clearLicenseBtn = document.querySelector("#clearLicenseBtn");
const paywallStatus = document.querySelector("#paywallStatus");
const readoutFields = {
  tempoBasis: document.querySelector('[data-field="tempoBasis"]'),
  cycle: document.querySelector('[data-field="cycle"]'),
  change: document.querySelector('[data-field="change"]'),
  basisPolicy: document.querySelector('[data-field="basisPolicy"]'),
  voices: document.querySelector('[data-field="voices"]'),
  roles: document.querySelector('[data-field="roles"]'),
  meters: document.querySelector('[data-field="meters"]'),
  kits: document.querySelector('[data-field="kits"]'),
  timing: document.querySelector('[data-field="timing"]'),
  access: document.querySelector('[data-field="access"]'),
  accessBadge: document.querySelector("#accessBadge"),
  signal: document.querySelector('[data-field="signal"]'),
  signalFill: document.querySelector('[data-field="signalFill"]')
};

const donationUrl = donateLink.dataset.donationUrl;
if (!donationUrl) {
  donateLink.hidden = true;
} else {
  donateLink.href = donationUrl;
}

const checkoutUrl = checkoutLink.dataset.checkoutUrl;
if (!checkoutUrl) {
  checkoutLink.hidden = true;
} else {
  checkoutLink.href = checkoutUrl;
}
const sessionSeed = makeSessionSeed();
loadPublicConfig();

const tunedControlIds = [
  "seed",
  "baseBpm",
  "baseMeter",
  "patternCount",
  "startOnlyCount",
  "pulseCount",
  "kitPool",
  "meterStart",
  "meterTiming",
  "cycleLength",
  "cycleLengthKind",
  "basisPolicy"
];
const touchedControls = new Set();

applySharedConfigFromUrl();

let state = makeStateFromControls(null);
let entitlement = readEntitlement();
let audioContext = null;
let masterInput = null;
let signalAnalyser = null;
let signalSamples = null;
let signalFrame = null;
let signalPeak = 0;
let midiAccess = null;
let midiOutput = null;
let timer = null;
let live = null;
let entitlementValidationPending = entitlementUnlocks(entitlement);

const SCHEDULE_OFFSET_SECONDS = 0.02;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.35;
const SCHEDULE_PRUNE_SECONDS = 1;
const EPSILON_SECONDS = 1e-6;

updatePaywallUi();
validateExistingEntitlement();
draw();

controls.addEventListener("input", syncControls);
controls.addEventListener("change", syncControls);

function syncControls(event) {
  if (event?.target?.closest?.("#paywall")) return;
  markTouchedControl(event?.target);
  state = makeStateFromControls(state);
  releaseBlankTouchedControls();
  if (timer && live && audioContext) {
    live.state = state;
    live.sectionStart = audioContext.currentTime + 0.08;
    live.lastReplacementBar = -1;
    live.lastReplacementResolve = -1;
    live.scheduled.clear();
  }
  draw();
}

startBtn.addEventListener("click", async () => {
  if (!requireUnlocked()) return;
  try {
    await startLive();
  } catch {
    stopLive();
    statusEl.textContent = "audio unavailable";
  }
});

stopBtn.addEventListener("click", () => {
  stopLive();
});

randomBtn.addEventListener("click", () => {
  randomizeControls();
  markTunedControlsTouched();
  syncControls();
});

shareBtn.addEventListener("click", async () => {
  await shareStation();
});

midiBtn.addEventListener("click", async () => {
  if (!requireUnlocked()) return;
  try {
    await connectMidi();
  } catch {
    midiAccess = null;
    midiOutput = null;
    midiOutputSelect.innerHTML = '<option value="">none</option>';
    statusEl.textContent = "midi unavailable";
  }
});

midiOutputSelect.addEventListener("change", () => {
  midiOutput = midiAccess?.outputs.get(midiOutputSelect.value) ?? null;
});

exportBtn.addEventListener("click", () => {
  if (!requireUnlocked()) return;
  const sections = readNumber("exportSections");
  const rendered = renderArrangement(makeStateFromControls(state), { sectionCount: sections, ppq: 480 });
  const midi = encodeMidiFile(rendered);
  const blob = new Blob([midi], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "radio-polymetric-export.mid";
  link.click();
  URL.revokeObjectURL(url);
});

unlockBtn.addEventListener("click", async () => {
  await unlockWithLicense();
});

clearLicenseBtn.addEventListener("click", () => {
  clearEntitlement();
  entitlement = null;
  stopLive();
  updatePaywallUi();
});

async function startLive() {
  state = makeStateFromControls(state);
  releaseBlankTouchedControls();
  await ensureAudioContext();
  live = {
    state,
    sectionStart: audioContext.currentTime + 0.08,
    lastReplacementBar: -1,
    lastReplacementResolve: -1,
    scheduled: new Map()
  };
  draw();
  tick();
  statusEl.textContent = live.scheduled.size ? "playing" : "waiting for hit";
  timer = window.setInterval(tick, 25);
  startSignalMeter();
}

async function unlockWithLicense() {
  const licenseKey = licenseKeyInput.value;
  const email = licenseEmailInput.value;
  if (!licenseKey.trim()) {
    paywallStatus.textContent = licenseErrorMessage("license_key_required");
    return;
  }
  paywallStatus.textContent = "checking license";
  unlockBtn.disabled = true;
  try {
    const verdict = await activateLicense({
      licenseKey,
      email,
      instanceName: getOrCreateInstanceName()
    });
    if (!verdict.unlocked) {
      paywallStatus.textContent = licenseErrorMessage(verdict.error);
      return;
    }
    entitlement = makeEntitlement({ licenseKey, email, verdict });
    entitlementValidationPending = false;
    writeEntitlement(entitlement);
    licenseKeyInput.value = "";
    updatePaywallUi();
  } catch {
    paywallStatus.textContent = licenseErrorMessage("license_check_failed");
  } finally {
    unlockBtn.disabled = false;
  }
}

async function validateExistingEntitlement() {
  if (!entitlementUnlocks(entitlement)) {
    entitlementValidationPending = false;
    updatePaywallUi();
    return;
  }
  try {
    const verdict = await validateLicense(entitlement);
    if (!verdict.unlocked) {
      clearEntitlement();
      entitlement = null;
      stopLive();
    } else {
      entitlement = makeEntitlement({
        licenseKey: entitlement.licenseKey,
        email: entitlement.email,
        verdict
      });
      writeEntitlement(entitlement);
    }
  } catch {
    clearEntitlement();
    entitlement = null;
    stopLive();
  } finally {
    entitlementValidationPending = false;
  }
  updatePaywallUi();
}

async function loadPublicConfig() {
  const config = await fetchPublicConfig();
  if (config.checkoutUrl) {
    checkoutLink.href = config.checkoutUrl;
    checkoutLink.hidden = false;
  }
}

function requireUnlocked() {
  if (entitlementUnlocks(entitlement)) return true;
  paywallStatus.textContent = licenseErrorMessage("license_required");
  return false;
}

function updatePaywallUi() {
  const unlocked = !entitlementValidationPending && entitlementUnlocks(entitlement);
  const accessText = entitlementValidationPending ? "checking license" : (unlocked ? "unlocked" : "locked");
  startBtn.disabled = !unlocked;
  midiBtn.disabled = !unlocked;
  exportBtn.disabled = !unlocked;
  clearLicenseBtn.disabled = !unlocked;
  startBtn.title = unlocked ? "Play live audio" : "License required";
  midiBtn.title = unlocked ? "Connect MIDI output" : "License required";
  exportBtn.title = unlocked ? "Export MIDI file" : "License required";
  paywallStatus.textContent = accessText;
  readoutFields.access.textContent = accessText;
  readoutFields.accessBadge.textContent = accessText;
  document.documentElement.dataset.access = unlocked ? "unlocked" : "locked";
}

async function shareStation() {
  const url = new URL(window.location.href);
  url.hash = stationHashParams().toString();
  try {
    await navigator.clipboard.writeText(url.href);
    statusEl.textContent = "link copied";
  } catch {
    window.location.hash = url.hash;
    statusEl.textContent = "link ready";
  }
}

function stopLive() {
  if (timer) window.clearInterval(timer);
  timer = null;
  live = null;
  stopSignalMeter();
  signalPeak = 0;
  setSignalLevel(0);
  statusEl.textContent = "stopped";
}

function tick() {
  if (!live || !audioContext) return;
  const now = audioContext.currentTime;
  catchUpLiveState(now);
  pruneScheduled(now);
  scheduleWindow(now + SCHEDULE_OFFSET_SECONDS, now + SCHEDULE_LOOKAHEAD_SECONDS);
  updateCycleProgress(now);
}

function catchUpLiveState(now) {
  let changed = false;
  while (now >= live.sectionStart + sectionSeconds(live.state) - EPSILON_SECONDS) {
    live.sectionStart += sectionSeconds(live.state);
    live.state = advanceCycle(live.state);
    live.lastReplacementBar = -1;
    live.lastReplacementResolve = -1;
    changed = true;
  }
  changed = applyCadenceUntil(live, now) || changed;
  if (changed) {
    state = live.state;
    draw();
  }
}

function scheduleWindow(fromSeconds, toSeconds) {
  const cursorState = {
    state: cloneState(live.state),
    sectionStart: live.sectionStart,
    lastReplacementBar: live.lastReplacementBar,
    lastReplacementResolve: live.lastReplacementResolve
  };
  applyCadenceUntil(cursorState, fromSeconds);

  let cursor = fromSeconds;
  while (cursor < toSeconds - EPSILON_SECONDS) {
    const sectionEnd = cursorState.sectionStart + sectionSeconds(cursorState.state);
    const nextCadence = nextCadenceSeconds(cursorState);
    const segmentEnd = Math.min(toSeconds, sectionEnd, nextCadence ?? Number.POSITIVE_INFINITY);

    if (segmentEnd > cursor + EPSILON_SECONDS) {
      const result = generateEventsInWindow(cursorState.state, {
        fromSeconds: cursor,
        toSeconds: segmentEnd,
        sectionStartSeconds: cursorState.sectionStart,
        maxEvents: 600
      });
      for (const event of result.events) scheduleEvent(cursorState.state, event);
    }

    if (nextCadence !== null && nextCadence <= segmentEnd + EPSILON_SECONDS && nextCadence <= toSeconds + EPSILON_SECONDS) {
      applyOneReplacement(cursorState);
      cursor = Math.max(segmentEnd, nextCadence);
      continue;
    }

    if (sectionEnd <= segmentEnd + EPSILON_SECONDS && sectionEnd <= toSeconds + EPSILON_SECONDS) {
      cursorState.sectionStart = sectionEnd;
      cursorState.state = advanceCycle(cursorState.state);
      cursorState.lastReplacementBar = -1;
      cursorState.lastReplacementResolve = -1;
      cursor = Math.max(segmentEnd, sectionEnd);
      continue;
    }

    cursor = segmentEnd;
  }
}

function scheduleEvent(currentState, event) {
  const key = `${currentState.cycleIndex}:${event.voiceId}:${event.pulseIndex}`;
  if (live.scheduled.has(key)) return;
  live.scheduled.set(key, event.timeSeconds);
  playEvent(event, event.timeSeconds);
}

function pruneScheduled(now) {
  for (const [key, timeSeconds] of live.scheduled.entries()) {
    if (timeSeconds < now - SCHEDULE_PRUNE_SECONDS) live.scheduled.delete(key);
  }
}

function applyCadenceUntil(target, untilSeconds) {
  let changed = false;
  while (target.state.pendingReplacements.length) {
    const nextCadence = nextCadenceSeconds(target);
    if (nextCadence === null || nextCadence > untilSeconds + EPSILON_SECONDS) break;
    applyOneReplacement(target);
    changed = true;
  }
  return changed;
}

function nextCadenceSeconds(target) {
  if (!target.state.pendingReplacements.length) return null;
  if (target.state.config.replacementCadence === "immediate") return null;
  const unitSeconds = target.state.config.replacementCadence === "one-per-resolving-sequence"
    ? resolvingSeconds(target.state)
    : baseBarSeconds(target.state);
  if (!Number.isFinite(unitSeconds) || unitSeconds <= 0) return null;
  const lastIndex = target.state.config.replacementCadence === "one-per-resolving-sequence"
    ? target.lastReplacementResolve
    : target.lastReplacementBar;
  return target.sectionStart + ((lastIndex + 1) * unitSeconds);
}

function applyOneReplacement(target) {
  const cadence = target.state.config.replacementCadence;
  const atSeconds = nextCadenceSeconds(target);
  if (atSeconds === null) return false;
  const unitSeconds = cadence === "one-per-resolving-sequence"
    ? resolvingSeconds(target.state)
    : baseBarSeconds(target.state);
  const nextIndex = Math.round((atSeconds - target.sectionStart) / unitSeconds);
  target.state = applyNextReplacement(target.state);
  if (cadence === "one-per-resolving-sequence") {
    target.lastReplacementResolve = nextIndex;
  } else {
    target.lastReplacementBar = nextIndex;
  }
  return true;
}

function playEvent(event, when) {
  const output = midiOutput;
  if (output) {
    const timestamp = performance.now() + Math.max(0, (when - audioContext.currentTime) * 1000);
    output.send([0x99, event.note, event.velocity], timestamp);
    output.send([0x89, event.note, 0], timestamp + event.durationSeconds * 1000);
  }
  playAudio(event, when);
  statusEl.textContent = "playing";
}

function playAudio(event, when) {
  const level = eventLevel(event);
  switch (event.instrument.sound) {
    case "kick-tight":
      kickHit(when, level);
      break;
    case "tom-high":
      drumSine(when, 185 + event.meter * 2, 0.11, 0.42 * level, "triangle", 0.54);
      break;
    case "tom-high-mid":
      drumSine(when, 152 + event.meter * 2, 0.13, 0.45 * level, "triangle", 0.52);
      break;
    case "tom-low-mid":
      drumSine(when, 122 + event.meter * 2, 0.15, 0.48 * level, "triangle", 0.48);
      break;
    case "tom-low":
      drumSine(when, 95 + event.meter * 2, 0.17, 0.5 * level, "triangle", 0.45);
      break;
    case "snare":
      snareHit(when, level);
      break;
    case "rim":
      woodHit(when, 1750, 0.035, 0.34 * level);
      break;
    case "hihat-closed":
      noiseHit(when, 0.035, 0.18 * level, 7800, "highpass", 0.9);
      break;
    case "hihat-open":
      noiseHit(when, 0.16, 0.2 * level, 6200, "highpass", 0.7);
      break;
    case "ride-cup":
      metallicHit(when, [930, 1400, 2280], 0.16, 0.16 * level, "triangle");
      break;
    case "ride":
      cymbalHit(when, 0.2, 0.2 * level, 4700);
      break;
    case "crash":
      cymbalHit(when, 0.42, 0.26 * level, 3400);
      break;
    case "bongo-high":
      handDrum(when, 310, 0.08, 0.42 * level);
      break;
    case "bongo-low":
      handDrum(when, 225, 0.1, 0.46 * level);
      break;
    case "conga-slap":
      handDrum(when, 285, 0.065, 0.38 * level);
      woodHit(when, 2100, 0.025, 0.18 * level);
      break;
    case "conga-high":
      handDrum(when, 190, 0.14, 0.5 * level);
      break;
    case "conga-low":
      handDrum(when, 135, 0.18, 0.56 * level);
      break;
    case "timbales-high":
      metallicHit(when, [410, 790], 0.09, 0.3 * level, "square");
      break;
    case "timbales-low":
      metallicHit(when, [285, 570], 0.11, 0.33 * level, "square");
      break;
    case "agogo-high":
      metallicHit(when, [880, 1760], 0.18, 0.26 * level, "sine");
      break;
    case "djembe-high":
      handDrum(when, 165, 0.16, 0.58 * level);
      break;
    case "cabasa":
      shakerHit(when, 0.055, 0.16 * level, 7200);
      break;
    case "maracas":
      shakerHit(when, 0.075, 0.18 * level, 6500);
      break;
    case "claves":
      woodHit(when, 2400, 0.045, 0.32 * level);
      break;
    case "perc-african":
      handDrum(when, 115, 0.2, 0.6 * level);
      woodHit(when, 980, 0.03, 0.14 * level);
      break;
    case "tambourine":
      tambourineHit(when, level);
      break;
    case "shaker":
      shakerHit(when, 0.08, 0.15 * level, 5600);
      break;
    case "cowbell":
      metallicHit(when, [540, 810, 1620], 0.12, 0.25 * level, "square");
      break;
    default:
      drumSine(when, 220, 0.05, 0.18 * level, "sine", 0.5);
  }
}

function eventLevel(event) {
  const voices = Math.max(1, live.state?.voices.length ?? 1);
  const densityTrim = Math.max(0.38, Math.min(0.95, 3.4 / Math.sqrt(voices)));
  return (event.velocity / 127) * densityTrim;
}

function kickHit(when, level) {
  drumSine(when, 82, 0.14, 0.72 * level, "sine", 0.42);
  noiseHit(when, 0.018, 0.14 * level, 3600, "highpass", 0.8);
}

function snareHit(when, level) {
  noiseHit(when, 0.095, 0.34 * level, 1100, "bandpass", 1.6);
  drumSine(when, 185, 0.055, 0.12 * level, "triangle", 0.72);
}

function cymbalHit(when, duration, gainValue, frequency) {
  noiseHit(when, duration, gainValue, frequency, "highpass", 0.55);
  metallicHit(when, [frequency * 0.19, frequency * 0.27], Math.min(duration, 0.16), gainValue * 0.18, "triangle");
}

function handDrum(when, frequency, duration, gainValue) {
  drumSine(when, frequency, duration, gainValue, "triangle", 0.62);
  noiseHit(when, Math.min(0.035, duration), gainValue * 0.18, frequency * 9, "bandpass", 4);
}

function woodHit(when, frequency, duration, gainValue) {
  metallicHit(when, [frequency, frequency * 1.34], duration, gainValue, "square");
}

function shakerHit(when, duration, gainValue, frequency) {
  noiseHit(when, duration, gainValue, frequency, "highpass", 1.2);
}

function tambourineHit(when, level) {
  shakerHit(when, 0.11, 0.16 * level, 5400);
  metallicHit(when, [820, 1210, 1880], 0.09, 0.13 * level, "triangle");
}

function drumSine(when, frequency, duration, gainValue, type = "sine", endRatio = 0.45) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * endRatio), when + duration);
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  osc.connect(gain).connect(masterInput);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function metallicHit(when, frequencies, duration, gainValue, type) {
  frequencies.forEach((frequency, index) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const share = gainValue / Math.max(1, frequencies.length);
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(share * (index === 0 ? 1 : 0.72), when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain).connect(masterInput);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  });
}

function noiseHit(when, duration, gainValue, frequency, filterType = "highpass", q = 0.7) {
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(masterInput);
  source.start(when);
  source.stop(when + duration + 0.02);
}

async function ensureAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("AudioContext unavailable");
  audioContext = audioContext ?? new AudioContextCtor();
  if (!masterInput) {
    const compressor = audioContext.createDynamicsCompressor();
    const masterGain = audioContext.createGain();
    signalAnalyser = audioContext.createAnalyser();
    compressor.threshold.value = -18;
    compressor.knee.value = 22;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    signalAnalyser.fftSize = 256;
    signalAnalyser.smoothingTimeConstant = 0.45;
    masterGain.gain.value = 1;
    compressor.connect(signalAnalyser).connect(masterGain).connect(audioContext.destination);
    masterInput = compressor;
  }
  await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("AudioContext not running");
}

function startSignalMeter() {
  stopSignalMeter();
  const frame = () => {
    updateSignalMeter();
    if (timer) signalFrame = window.requestAnimationFrame(frame);
  };
  signalFrame = window.requestAnimationFrame(frame);
}

function stopSignalMeter() {
  if (!signalFrame) return;
  window.cancelAnimationFrame(signalFrame);
  signalFrame = null;
}

function updateSignalMeter() {
  if (!signalAnalyser) {
    setSignalLevel(0);
    return;
  }
  if (!signalSamples || signalSamples.length !== signalAnalyser.fftSize) {
    signalSamples = new Float32Array(signalAnalyser.fftSize);
  }
  signalAnalyser.getFloatTimeDomainData(signalSamples);
  let sum = 0;
  for (let index = 0; index < signalSamples.length; index += 1) {
    const sample = signalSamples[index];
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / signalSamples.length);
  signalPeak = Math.max(rms, signalPeak * 0.975);
  setSignalLevel(signalPeak);
}

function setSignalLevel(value) {
  const level = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  readoutFields.signal.textContent = level.toFixed(3);
  readoutFields.signalFill.style.transform = `scaleX(${Math.min(1, level * 5)})`;
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    statusEl.textContent = "midi unavailable";
    return;
  }
  midiAccess = await navigator.requestMIDIAccess();
  midiOutputSelect.innerHTML = '<option value="">none</option>';
  for (const output of midiAccess.outputs.values()) {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name;
    midiOutputSelect.append(option);
  }
  statusEl.textContent = "midi ready";
}

function makeStateFromControls(previousState = null) {
  const previousConfig = previousState?.config;
  return createInitialState({
    seed: readOptionalText("seed", previousState?.seed) || sessionSeed,
    baseBpm: readOptionalNumber("baseBpm", previousConfig?.baseBpm),
    baseMeter: readOptionalNumber("baseMeter", previousState?.baseMeter),
    patternCount: readOptionalNumber("patternCount", previousConfig?.patternCount),
    startOnlyCount: readOptionalNumber("startOnlyCount", previousConfig?.startOnlyCount),
    pulseCount: readOptionalNumber("pulseCount", previousConfig?.pulseCount),
    kitPool: readOptionalText("kitPool", previousConfig?.kitPool?.join(",")),
    meterStart: readOptionalNumber("meterStart", previousConfig?.meterStart),
    meterCount: readOptionalNumber("patternCount", previousConfig?.patternCount),
    meterTiming: readOptionalText("meterTiming", previousConfig?.meterTiming),
    cycleLength: readOptionalNumber("cycleLength", previousConfig?.cycleLength),
    cycleLengthKind: readOptionalText("cycleLengthKind", previousConfig?.cycleLengthKind),
    basisPolicy: readOptionalText("basisPolicy", previousConfig?.basisPolicy)
  });
}

function draw() {
  drawReadout();
  drawTimeline();
  drawVoices();
}

function drawReadout() {
  const baseVoice = state.voices.find((voice) => voice.id === state.baseVoiceId) ?? state.voices[0];
  const pending = state.pendingReplacements.length;
  const kits = [...new Set(state.voices.map((voice) => voice.kit))].join(", ");
  readoutFields.tempoBasis.textContent = `${baseVoice?.id ?? "-"}; meter ${state.baseMeter}; ${state.baseBpm.toFixed(3)} bpm`;
  readoutFields.cycle.textContent = cycleProgressText(state);
  readoutFields.change.textContent = `${state.config.cycleLength} ${cycleUnitText(state.config.cycleLengthKind)}; ${resolvingBaseBars(state)} resolving bars; ${pending} replacements`;
  readoutFields.basisPolicy.textContent = state.config.basisPolicy === "farthest" ? "farmost" : state.config.basisPolicy;
  readoutFields.voices.textContent = String(state.voices.length);
  readoutFields.roles.textContent = roleCountText(state);
  readoutFields.meters.textContent = meterSetText(state);
  readoutFields.kits.textContent = kits || "-";
  readoutFields.timing.textContent = state.config.meterTiming === "shared-bar-polyrhythm"
    ? "shared bar"
    : "same pulse";
  readoutFields.access.textContent = entitlementValidationPending
    ? "checking license"
    : (entitlementUnlocks(entitlement) ? "unlocked" : "locked");
}

function updateCycleProgress(now) {
  readoutFields.cycle.textContent = cycleProgressText(live.state, now, live.sectionStart);
}

function cycleProgressText(currentState, now = null, sectionStart = null) {
  const totalBars = sectionBaseBars(currentState);
  if (now === null || sectionStart === null) return `${currentState.cycleIndex}; ${totalBars} bars`;
  const elapsed = Math.max(0, now - sectionStart);
  const barIndex = Math.min(totalBars, Math.floor(elapsed / baseBarSeconds(currentState)));
  return `${currentState.cycleIndex}; bar ${barIndex} / ${totalBars}`;
}

function cycleUnitText(value) {
  return value === "resolving-sequences" ? "resolving sequences" : "bars";
}

function roleCountText(currentState) {
  const counts = currentState.voices.reduce((acc, voice) => {
    acc[voice.role] = (acc[voice.role] ?? 0) + 1;
    return acc;
  }, { "start-only": 0, pulse: 0, binary: 0 });
  return `start-only ${counts["start-only"]}; pulse ${counts.pulse}; binary ${counts.binary}`;
}

function meterSetText(currentState) {
  const meters = currentState.voices.map((voice) => voice.meter).sort((a, b) => a - b);
  if (!meters.length) return "-";
  const contiguous = meters.every((meter, index) => index === 0 || meter === meters[index - 1] + 1);
  if (contiguous && meters.length > 2) return `${meters[0]}-${meters[meters.length - 1]}`;
  return meters.join(", ");
}

function drawTimeline() {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#a5a5a1";
  ctx.fillRect(0, 0, width, height);

  const previewState = state;
  const previewSeconds = Math.min(sectionSeconds(previewState), 24);
  const result = generateEventsInWindow(previewState, {
    fromSeconds: 0,
    toSeconds: previewSeconds,
    sectionStartSeconds: 0,
    maxEvents: 3000
  });
  const rows = previewState.voices.length;
  const rowHeight = height / Math.max(1, rows);

  ctx.strokeStyle = "#8b8d88";
  ctx.lineWidth = 1;
  for (let row = 0; row <= rows; row += 1) {
    const y = Math.round(row * rowHeight) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const baseBar = (60 / previewState.baseBpm) * previewState.baseMeter;
  ctx.strokeStyle = "#747771";
  for (let time = 0; time <= previewSeconds; time += baseBar) {
    const x = (time / previewSeconds) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (const event of result.events) {
    const row = previewState.voices.findIndex((voice) => voice.id === event.voiceId);
    if (row < 0) continue;
    const x = (event.localSeconds / previewSeconds) * width;
    const y = row * rowHeight + rowHeight * 0.2;
    ctx.fillStyle = event.instrument.color;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.fillRect(x - 5, y, 10, Math.max(8, rowHeight * 0.6));
    ctx.strokeRect(x - 5, y, 10, Math.max(8, rowHeight * 0.6));
  }
}

function drawVoices() {
  voicesEl.innerHTML = "";
  for (const voice of state.voices) {
    const card = document.createElement("article");
    card.className = `voice${voice.id === state.baseVoiceId ? " base" : ""}`;
    const bpm = voiceBpm(state, voice);
    card.innerHTML = `
      <h2>${escapeHtml(voice.instrument.name)}</h2>
      <dl>
        <dt>voice</dt><dd>${escapeHtml(voice.id)}</dd>
        <dt>kit</dt><dd>${escapeHtml(voice.kit)}</dd>
        <dt>meter</dt><dd>${voice.meter}</dd>
        <dt>role</dt><dd>${escapeHtml(voice.role)}</dd>
        <dt>bpm</dt><dd>${bpm.toFixed(3)}</dd>
        <dt>pattern</dt><dd>${voice.pattern.join("")}</dd>
      </dl>
    `;
    voicesEl.append(card);
  }
}

function randomizeControls() {
  const now = Date.now().toString(36);
  document.querySelector("#seed").value = `radio-${now}`;
  document.querySelector("#baseBpm").value = String(80 + Math.floor(Math.random() * 80));
  document.querySelector("#baseMeter").value = "";
  document.querySelector("#patternCount").value = String(3 + Math.floor(Math.random() * 18));
  const patterns = readNumber("patternCount");
  document.querySelector("#startOnlyCount").value = String(Math.floor(Math.random() * Math.max(1, patterns / 3)));
  document.querySelector("#pulseCount").value = String(Math.floor(Math.random() * Math.max(1, patterns / 3)));
  document.querySelector("#kitPool").value = "";
  document.querySelector("#meterStart").value = "";
  const timingModes = ["same-pulse-polymeter", "shared-bar-polyrhythm"];
  document.querySelector("#meterTiming").value = timingModes[Math.floor(Math.random() * timingModes.length)];
  document.querySelector("#cycleLength").value = String(1 + Math.floor(Math.random() * 5));
  const units = ["resolving-sequences", "bars"];
  document.querySelector("#cycleLengthKind").value = units[Math.floor(Math.random() * units.length)];
  const policies = ["next", "random", "closest", "farmost"];
  document.querySelector("#basisPolicy").value = policies[Math.floor(Math.random() * policies.length)];
}

function applySharedConfigFromUrl() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const id of [...tunedControlIds, "exportSections"]) {
    if (!params.has(id)) continue;
    const control = document.querySelector(`#${id}`);
    if (!control) continue;
    control.value = params.get(id) ?? "";
    if (tunedControlIds.includes(id)) touchedControls.add(id);
  }
}

function stationHashParams() {
  const params = new URLSearchParams();
  const config = state.config;
  const values = {
    seed: state.seed,
    baseBpm: config.baseBpm,
    baseMeter: state.baseMeter,
    patternCount: config.patternCount,
    startOnlyCount: config.startOnlyCount,
    pulseCount: config.pulseCount,
    kitPool: config.kitPool.join(","),
    meterStart: config.meterStart,
    meterTiming: config.meterTiming,
    cycleLength: config.cycleLength,
    cycleLengthKind: config.cycleLengthKind,
    basisPolicy: config.basisPolicy === "farthest" ? "farmost" : config.basisPolicy,
    exportSections: value("exportSections") || "6"
  };
  for (const [key, value] of Object.entries(values)) {
    params.set(key, String(value));
  }
  return params;
}

function value(id) {
  return document.querySelector(`#${id}`).value;
}

function readOptionalText(id, fallback) {
  const current = value(id);
  if (current === "" && fallback !== undefined && !touchedControls.has(id)) return fallback;
  return current || undefined;
}

function readOptionalNumber(id, fallback) {
  const current = value(id);
  if (current === "" && fallback !== undefined && !touchedControls.has(id)) return fallback;
  return current === "" ? undefined : Number(current);
}

function readNumber(id) {
  return Number(value(id));
}

function markTouchedControl(target) {
  if (target?.id && tunedControlIds.includes(target.id)) {
    touchedControls.add(target.id);
  }
}

function markTunedControlsTouched() {
  for (const id of tunedControlIds) touchedControls.add(id);
}

function releaseBlankTouchedControls() {
  for (const id of tunedControlIds) {
    if (value(id) === "") touchedControls.delete(id);
  }
}

function makeSessionSeed() {
  return `radio-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
