import {
  advanceCycle,
  applyNextReplacement,
  baseBarSeconds,
  cloneState,
  createInitialState,
  generateEventsInWindow,
  renderArrangement,
  resolvingBaseBars,
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
const timelineShell = document.querySelector("#timelineShell");
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
  signalFill: document.querySelector('[data-field="signalFill"]'),
  changeFill: document.querySelector('[data-field="changeFill"]'),
  changeCue: document.querySelector('[data-field="changeCue"]')
};
const hitFields = {
  strip: document.querySelector("#hitStrip"),
  lamp: document.querySelector('[data-field="hitLamp"]'),
  instrument: document.querySelector('[data-field="hitInstrument"]'),
  voice: document.querySelector('[data-field="hitVoice"]'),
  meter: document.querySelector('[data-field="hitMeter"]'),
  kit: document.querySelector('[data-field="hitKit"]'),
  role: document.querySelector('[data-field="hitRole"]'),
  pulse: document.querySelector('[data-field="hitPulse"]')
};

const commerceLinks = {
  donationUrl: donateLink.dataset.donationUrl,
  checkoutUrl: checkoutLink.dataset.checkoutUrl
};
applyCommerceLinks();
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
let currentHitPan = 0;
let midiAccess = null;
let midiOutput = null;
let timer = null;
let live = null;
let entitlementValidationPending = entitlementUnlocks(entitlement);
let statusHoldUntil = 0;
const hitTimeouts = new Set();
const voiceHitTimers = new Map();
let stripHitTimer = null;

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

for (const link of [checkoutLink]) {
  link.addEventListener("click", (event) => {
    if (link.dataset.state !== "unavailable") return;
    event.preventDefault();
    paywallStatus.textContent = "subscription link unavailable";
    setStatus("subscription link unavailable", 1600);
  });
}

donateLink.addEventListener("click", async (event) => {
  if (donateLink.dataset.state === "unavailable") {
    event.preventDefault();
    paywallStatus.textContent = "donation link unavailable";
    setStatus("donation link unavailable", 1600);
  }
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
  if (!requireUnlocked()) return;
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
  timelineShell.dataset.state = "playing";
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
    commerceLinks.checkoutUrl = config.checkoutUrl;
  }
  if (config.donationUrl) {
    commerceLinks.donationUrl = config.donationUrl;
  }
  applyCommerceLinks();
}

function applyCommerceLinks() {
  configureCommerceLink(checkoutLink, commerceLinks.checkoutUrl, "Subscribe $5/mo USD", "subscription link unavailable");
  configureDonationLink();
}

function configureCommerceLink(link, url, activeText, inactiveText) {
  if (url) {
    link.href = url;
    link.textContent = activeText;
    link.removeAttribute("title");
    link.dataset.state = "active";
    return;
  }
  link.href = "#paywall";
  link.textContent = activeText;
  link.title = inactiveText;
  link.dataset.state = "unavailable";
}

function configureDonationLink() {
  if (commerceLinks.donationUrl) {
    configureCommerceLink(donateLink, commerceLinks.donationUrl, "Donate", "donation link unavailable");
    return;
  }
  configureCommerceLink(donateLink, "", "Donate", "donation link unavailable");
}

function requireUnlocked() {
  if (!entitlementValidationPending && entitlementUnlocks(entitlement)) return true;
  const message = entitlementValidationPending ? "checking license" : licenseErrorMessage("license_required");
  paywallStatus.textContent = message;
  setStatus(message, 1600);
  return false;
}

function updatePaywallUi() {
  const unlocked = !entitlementValidationPending && entitlementUnlocks(entitlement);
  const accessText = entitlementValidationPending ? "checking license" : (unlocked ? "subscribed" : "license required");
  startBtn.disabled = false;
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
    setStatus("link copied", 1600);
  } catch {
    window.location.hash = url.hash;
    setStatus("link ready", 1600);
  }
}

function stopLive() {
  if (timer) window.clearInterval(timer);
  timer = null;
  live = null;
  clearHitIndicators();
  stopSignalMeter();
  signalPeak = 0;
  setSignalLevel(0);
  timelineShell.dataset.state = "stopped";
  timelineShell.style.setProperty("--playhead-x", "0%");
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
  const duration = sectionSeconds(target.state);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const completed = Math.max(0, target.lastReplacementBar + 1);
  const total = completed + target.state.pendingReplacements.length;
  return target.sectionStart + (duration * (completed + 1) / (total + 1));
}

function applyOneReplacement(target) {
  const atSeconds = nextCadenceSeconds(target);
  if (atSeconds === null) return false;
  const nextIndex = Math.max(0, target.lastReplacementBar + 1);
  target.state = applyNextReplacement(target.state);
  target.lastReplacementBar = nextIndex;
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
  scheduleHitIndicator(event, when);
  setPlaybackStatus("playing");
}

function scheduleHitIndicator(event, when) {
  if (!hitFields.strip || !audioContext) return;
  const delay = Math.max(0, (when - audioContext.currentTime) * 1000);
  const timeout = window.setTimeout(() => {
    hitTimeouts.delete(timeout);
    showHit(event);
  }, delay);
  hitTimeouts.add(timeout);
}

function showHit(event) {
  hitFields.instrument.textContent = event.instrument.name;
  hitFields.voice.textContent = event.voiceId;
  hitFields.meter.textContent = String(event.meter);
  hitFields.kit.textContent = event.kit;
  hitFields.role.textContent = event.role;
  hitFields.pulse.textContent = String(event.pulseIndex);
  hitFields.strip.classList.add("is-hit");
  hitFields.lamp.classList.add("is-hit");

  if (stripHitTimer) window.clearTimeout(stripHitTimer);
  stripHitTimer = window.setTimeout(() => {
    hitFields.strip.classList.remove("is-hit");
    hitFields.lamp.classList.remove("is-hit");
    stripHitTimer = null;
  }, 320);

  const voiceNode = voicesEl.querySelector(`[data-voice-id="${event.voiceId}"]`);
  if (!voiceNode) return;
  voicesEl.querySelectorAll(".voice.last-hit").forEach((node) => node.classList.remove("last-hit"));
  voiceNode.classList.add("last-hit");
  const previousTimer = voiceHitTimers.get(event.voiceId);
  if (previousTimer) window.clearTimeout(previousTimer);
  voiceNode.classList.add("hit");
  const timerId = window.setTimeout(() => {
    voiceNode.classList.remove("hit");
    voiceHitTimers.delete(event.voiceId);
  }, 420);
  voiceHitTimers.set(event.voiceId, timerId);
}

function clearHitIndicators() {
  for (const timeout of hitTimeouts) window.clearTimeout(timeout);
  hitTimeouts.clear();
  if (stripHitTimer) window.clearTimeout(stripHitTimer);
  stripHitTimer = null;
  for (const timeout of voiceHitTimers.values()) window.clearTimeout(timeout);
  voiceHitTimers.clear();
  hitFields.strip?.classList.remove("is-hit");
  hitFields.lamp?.classList.remove("is-hit");
  voicesEl.querySelectorAll(".voice.hit, .voice.last-hit").forEach((node) => {
    node.classList.remove("hit");
    node.classList.remove("last-hit");
  });
  for (const field of ["instrument", "voice", "meter", "kit", "role", "pulse"]) {
    if (hitFields[field]) hitFields[field].textContent = "-";
  }
}

function setStatus(text, holdMs = 0) {
  statusEl.textContent = text;
  statusHoldUntil = holdMs ? performance.now() + holdMs : 0;
}

function setPlaybackStatus(text) {
  if (performance.now() >= statusHoldUntil) {
    statusEl.textContent = text;
  }
}

function playAudio(event, when) {
  const level = eventLevel(event);
  currentHitPan = eventPan(event);
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
    case "floor-tom-edge":
      drumSine(when, 105 + event.meter * 2, 0.16, 0.43 * level, "triangle", 0.5);
      woodHit(when, 760, 0.028, 0.07 * level);
      break;
    case "snare":
      snareHit(when, level);
      break;
    case "snare-edge":
      snareHit(when, level * 0.88);
      woodHit(when, 1850, 0.025, 0.08 * level);
      break;
    case "rim":
      woodHit(when, 1750, 0.035, 0.34 * level);
      break;
    case "hihat-closed":
      noiseHit(when, 0.035, 0.18 * level, 7800, "highpass", 0.9);
      break;
    case "pedal-hihat":
      noiseHit(when, 0.055, 0.13 * level, 5200, "highpass", 1.1);
      break;
    case "semi-open-hihat":
      noiseHit(when, 0.115, 0.18 * level, 6800, "highpass", 0.8);
      break;
    case "swish-hihat":
      noiseHit(when, 0.23, 0.16 * level, 4500, "highpass", 0.55);
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
    case "ride-bell":
      metallicHit(when, [820, 1520, 2540], 0.18, 0.18 * level, "triangle");
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
    case "cajon-thump":
      handDrum(when, 92, 0.13, 0.62 * level);
      break;
    case "finger-snap":
      woodHit(when, 2600, 0.024, 0.22 * level);
      break;
    case "cajon-slap":
      noiseHit(when, 0.055, 0.24 * level, 1800, "bandpass", 2.2);
      woodHit(when, 980, 0.032, 0.12 * level);
      break;
    case "conga-left":
      handDrum(when, 168, 0.14, 0.5 * level);
      break;
    case "conga-right":
      handDrum(when, 205, 0.12, 0.48 * level);
      break;
    case "small-conga-left":
      handDrum(when, 238, 0.1, 0.42 * level);
      break;
    case "small-conga-right":
      handDrum(when, 282, 0.085, 0.4 * level);
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
    case "foot-stomp":
      drumSine(when, 66, 0.12, 0.42 * level, "sine", 0.5);
      noiseHit(when, 0.035, 0.1 * level, 420, "lowpass", 0.8);
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
    case "bucket":
      drumSine(when, 118, 0.12, 0.32 * level, "triangle", 0.58);
      metallicHit(when, [310, 470], 0.07, 0.12 * level, "square");
      break;
    case "bell-tree-down":
      bellTreeHit(when, level, false);
      break;
    case "bell-tree-up":
      bellTreeHit(when, level, true);
      break;
    case "djembe-bass":
      handDrum(when, 96, 0.19, 0.64 * level);
      break;
    case "djembe-tone":
      handDrum(when, 178, 0.14, 0.54 * level);
      break;
    case "djembe-slap":
      handDrum(when, 250, 0.08, 0.42 * level);
      woodHit(when, 1980, 0.022, 0.14 * level);
      break;
    case "dunun-low":
      handDrum(when, 72, 0.24, 0.7 * level);
      break;
    case "dunun-high":
      handDrum(when, 128, 0.18, 0.58 * level);
      break;
    case "udu-low":
      drumSine(when, 82, 0.2, 0.52 * level, "sine", 0.38);
      break;
    case "udu-high":
      drumSine(when, 156, 0.13, 0.4 * level, "sine", 0.45);
      break;
    case "talking-drum":
      talkingDrumHit(when, level);
      break;
    case "shekere":
      shakerHit(when, 0.12, 0.2 * level, 4100);
      break;
    case "metal-shaker":
      shakerHit(when, 0.09, 0.18 * level, 7600);
      metallicHit(when, [3100], 0.05, 0.06 * level, "triangle");
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

function eventPan(event) {
  const meter = Number.isFinite(event.meter) ? event.meter : 1;
  const voiceNumber = Number.parseInt(String(event.voiceId ?? "").replace(/\D+/g, ""), 10);
  const laneOffset = Number.isFinite(voiceNumber) ? ((voiceNumber % 7) - 3) / 6 : 0;
  const meterOffset = ((meter % 5) - 2) / 10;
  return Math.max(-0.62, Math.min(0.62, laneOffset + meterOffset));
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

function bellTreeHit(when, level, ascending) {
  const base = ascending ? 900 : 2300;
  const step = ascending ? 240 : -240;
  for (let index = 0; index < 5; index += 1) {
    metallicHit(when + index * 0.012, [base + step * index], 0.12, 0.065 * level, "triangle");
  }
}

function talkingDrumHit(when, level) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(145, when);
  osc.frequency.exponentialRampToValueAtTime(245, when + 0.055);
  osc.frequency.exponentialRampToValueAtTime(118, when + 0.16);
  gain.gain.setValueAtTime(0.42 * level, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
  osc.connect(gain);
  connectHitOutput(gain);
  osc.start(when);
  osc.stop(when + 0.2);
}

function drumSine(when, frequency, duration, gainValue, type = "sine", endRatio = 0.45) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * endRatio), when + duration);
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  osc.connect(gain);
  connectHitOutput(gain);
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
    osc.connect(gain);
    connectHitOutput(gain);
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
  source.connect(filter).connect(gain);
  connectHitOutput(gain);
  source.start(when);
  source.stop(when + duration + 0.02);
}

function connectHitOutput(node) {
  if (!audioContext?.createStereoPanner) {
    node.connect(masterInput);
    return;
  }
  const pan = audioContext.createStereoPanner();
  pan.pan.value = currentHitPan;
  node.connect(pan).connect(masterInput);
}

async function ensureAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("AudioContext unavailable");
  audioContext = audioContext ?? new AudioContextCtor();
  if (!masterInput) {
    const inputBus = audioContext.createGain();
    const lowShelf = audioContext.createBiquadFilter();
    const presence = audioContext.createBiquadFilter();
    const air = audioContext.createBiquadFilter();
    const compressor = audioContext.createDynamicsCompressor();
    const limiter = audioContext.createDynamicsCompressor();
    const masterGain = audioContext.createGain();
    const roomSend = audioContext.createGain();
    const roomDelay = audioContext.createDelay(0.08);
    const roomFeedback = audioContext.createGain();
    const roomFilter = audioContext.createBiquadFilter();
    const roomReturn = audioContext.createGain();
    signalAnalyser = audioContext.createAnalyser();
    inputBus.gain.value = 0.92;
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = 90;
    lowShelf.gain.value = 1.2;
    presence.type = "peaking";
    presence.frequency.value = 2350;
    presence.Q.value = 0.75;
    presence.gain.value = 1.4;
    air.type = "highshelf";
    air.frequency.value = 8200;
    air.gain.value = -0.8;
    compressor.threshold.value = -20;
    compressor.knee.value = 24;
    compressor.ratio.value = 4.8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    limiter.threshold.value = -2;
    limiter.knee.value = 3;
    limiter.ratio.value = 18;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.055;
    roomSend.gain.value = 0.08;
    roomDelay.delayTime.value = 0.028;
    roomFeedback.gain.value = 0.16;
    roomFilter.type = "lowpass";
    roomFilter.frequency.value = 2800;
    roomReturn.gain.value = 0.14;
    signalAnalyser.fftSize = 256;
    signalAnalyser.smoothingTimeConstant = 0.45;
    masterGain.gain.value = 0.9;
    inputBus.connect(lowShelf).connect(presence).connect(air).connect(compressor).connect(limiter).connect(signalAnalyser).connect(masterGain).connect(audioContext.destination);
    inputBus.connect(roomSend).connect(roomDelay);
    roomDelay.connect(roomFeedback).connect(roomDelay);
    roomDelay.connect(roomFilter).connect(roomReturn).connect(compressor);
    masterInput = inputBus;
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
    startOnlyCount: readOptionalNumber("startOnlyCount"),
    pulseCount: readOptionalNumber("pulseCount"),
    kitPool: readOptionalText("kitPool", previousConfig?.kitPool?.join(",")),
    meterStart: readOptionalNumber("meterStart", previousConfig?.meterStart),
    meterCount: readOptionalNumber("patternCount", previousConfig?.patternCount),
    meterTiming: "same-pulse-polymeter",
    cycleLength: readOptionalNumber("cycleLength", previousConfig?.cycleLength),
    cycleLengthKind: readOptionalText("cycleLengthKind", previousConfig?.cycleLengthKind),
    basisPolicy: readOptionalText("basisPolicy", previousConfig?.basisPolicy),
    replacementCadence: "one-by-one"
  });
}

function draw() {
  drawReadout();
  drawTimeline();
  drawVoices();
}

function drawReadout() {
  const baseVoice = state.voices.find((voice) => voice.id === state.baseVoiceId) ?? state.voices[0];
  const kits = [...new Set(state.voices.map((voice) => voice.kit))].join(", ");
  const rethought = baseVoice?.rethoughtFromMeter ? `; from meter ${baseVoice.rethoughtFromMeter}` : "";
  readoutFields.tempoBasis.textContent = `${baseVoice?.id ?? "-"}; meter ${state.baseMeter}${rethought}; ${state.baseBpm.toFixed(3)} bpm`;
  readoutFields.cycle.textContent = cycleProgressText(state);
  readoutFields.change.textContent = changeText(state);
  readoutFields.basisPolicy.textContent = state.config.basisPolicy === "farthest" ? "farmost" : state.config.basisPolicy;
  readoutFields.voices.textContent = String(state.voices.length);
  readoutFields.roles.textContent = roleCountText(state);
  readoutFields.meters.textContent = meterSetText(state);
  readoutFields.kits.textContent = kits || "-";
  readoutFields.timing.textContent = "same pulse";
  readoutFields.access.textContent = entitlementValidationPending
    ? "checking license"
    : (entitlementUnlocks(entitlement) ? "subscribed" : "license required");
  updateChangeRail(state);
}

function updateCycleProgress(now) {
  readoutFields.cycle.textContent = cycleProgressText(live.state, now, live.sectionStart);
  readoutFields.change.textContent = changeText(live.state, live);
  updateChangeRail(live.state, now, live.sectionStart, live);
  updateTimelinePlayhead(live.state, now, live.sectionStart);
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

function changeText(currentState, liveState = null) {
  const applied = Math.max(0, (liveState?.lastReplacementBar ?? -1) + 1);
  const total = applied + currentState.pendingReplacements.length;
  const replacements = total ? `${applied}/${total} replacements` : "basis";
  return `${currentState.config.cycleLength} ${cycleUnitText(currentState.config.cycleLengthKind)}; ${resolvingBaseBars(currentState)} resolving bars; ${replacements}; ${replacementCadenceText()}`;
}

function updateChangeRail(currentState, now = null, sectionStart = null, liveState = null) {
  const duration = sectionSeconds(currentState);
  const elapsed = now === null || sectionStart === null
    ? 0
    : Math.max(0, Math.min(duration, now - sectionStart));
  const cycleProgress = duration > 0 ? elapsed / duration : 0;
  const applied = Math.max(0, (liveState?.lastReplacementBar ?? -1) + 1);
  const total = applied + currentState.pendingReplacements.length;
  const replacementProgress = total ? applied / total : 1;
  readoutFields.changeFill.style.transform = `scaleX(${Math.min(1, cycleProgress)})`;
  readoutFields.changeCue.style.left = `${Math.round(Math.min(1, replacementProgress) * 100)}%`;
  readoutFields.changeCue.textContent = total ? `${applied}/${total}` : "basis";
}

function updateTimelinePlayhead(currentState, now, sectionStart) {
  const duration = Math.min(sectionSeconds(currentState), 24);
  const elapsed = Math.max(0, now - sectionStart);
  const progress = duration > 0 ? (elapsed % duration) / duration : 0;
  timelineShell.style.setProperty("--playhead-x", `${Math.min(100, Math.max(0, progress * 100))}%`);
}

function replacementCadenceText() {
  return "one by one";
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
  const counts = new Map();
  for (const meter of meters) counts.set(meter, (counts.get(meter) ?? 0) + 1);
  const uniqueMeters = [...counts.keys()].sort((a, b) => a - b);
  const ranges = [];
  let rangeStart = uniqueMeters[0];
  let rangeEnd = uniqueMeters[0];
  for (let index = 1; index < uniqueMeters.length; index += 1) {
    const meter = uniqueMeters[index];
    if (meter === rangeEnd + 1) {
      rangeEnd = meter;
      continue;
    }
    ranges.push(formatMeterRange(rangeStart, rangeEnd));
    rangeStart = meter;
    rangeEnd = meter;
  }
  ranges.push(formatMeterRange(rangeStart, rangeEnd));
  const repeated = uniqueMeters
    .filter((meter) => counts.get(meter) > 1)
    .map((meter) => `${meter} x${counts.get(meter)}`);
  return repeated.length ? `${ranges.join(", ")}; ${repeated.join(", ")}` : ranges.join(", ");
}

function formatMeterRange(start, end) {
  return start === end ? String(start) : `${start}-${end}`;
}

function drawTimeline() {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101316";
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

  ctx.strokeStyle = "#30363d";
  ctx.lineWidth = 1;
  for (let row = 0; row <= rows; row += 1) {
    const y = Math.round(row * rowHeight) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const baseBar = (60 / previewState.baseBpm) * previewState.baseMeter;
  ctx.strokeStyle = "#c7a22c";
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
    ctx.strokeStyle = "#f7f8f4";
    ctx.lineWidth = 2;
    ctx.fillRect(x - 5, y, 10, Math.max(8, rowHeight * 0.6));
    ctx.strokeRect(x - 5, y, 10, Math.max(8, rowHeight * 0.6));
  }
}

function drawVoices() {
  voicesEl.innerHTML = "";
  for (const voice of state.voices) {
    const card = document.createElement("article");
    const held = voice.protectedThroughCycle !== null && voice.protectedThroughCycle >= state.cycleIndex;
    card.className = `voice${voice.id === state.baseVoiceId ? " base" : ""}${held ? " held" : ""}`;
    card.dataset.voiceId = voice.id;
    card.style.setProperty("--voice-color", voice.instrument.color);
    const bpm = voiceBpm(state, voice);
    card.innerHTML = `
      <span class="lane-lamp" aria-hidden="true"></span>
      <span class="voice-id">${escapeHtml(voice.id)}</span>
      <strong class="instrument-name">${escapeHtml(voice.instrument.name)}</strong>
      <span class="kit-name">${escapeHtml(voice.kit)}</span>
      <span class="meter-chip">m ${voice.meter}</span>
      <span class="role-chip">${escapeHtml(voice.role)}</span>
      <span class="hold-chip">${held ? "held" : "-"}</span>
      <span class="bpm-chip">${bpm.toFixed(3)} bpm</span>
      <span class="note-chip">n ${voice.instrument.note}</span>
      ${patternMapHtml(voice.pattern)}
    `;
    voicesEl.append(card);
  }
}

function patternMapHtml(pattern) {
  const binary = pattern.join("");
  const cells = pattern
    .map((hit, index) => `<span class="pattern-cell${hit ? " on" : ""}" data-step="${index + 1}"></span>`)
    .join("");
  return `<span class="pattern-chip" aria-label="pattern ${binary}" title="${binary}" data-pattern="${binary}">${cells}</span>`;
}

function randomizeControls() {
  const now = Date.now().toString(36);
  document.querySelector("#seed").value = `radio-${now}`;
  document.querySelector("#baseBpm").value = String(80 + Math.floor(Math.random() * 80));
  document.querySelector("#baseMeter").value = "";
  document.querySelector("#patternCount").value = String(2 + Math.floor(Math.random() * 19));
  const patterns = readNumber("patternCount");
  document.querySelector("#startOnlyCount").value = String(patterns);
  document.querySelector("#pulseCount").value = "0";
  document.querySelector("#kitPool").value = "";
  document.querySelector("#meterStart").value = "";
  document.querySelector("#cycleLength").value = String(1 + Math.floor(Math.random() * 5));
  const units = ["bars", "resolving-sequences"];
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
