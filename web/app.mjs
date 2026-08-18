import {
  advanceCycle,
  applyNextReplacement,
  createInitialState,
  generateEventsInWindow,
  renderArrangement,
  resolvingSeconds,
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

let state = makeStateFromControls();
let entitlement = readEntitlement();
let audioContext = null;
let masterInput = null;
let midiAccess = null;
let midiOutput = null;
let timer = null;
let live = null;

updatePaywallUi();
validateExistingEntitlement();
draw();

controls.addEventListener("input", () => {
  if (timer) return;
  state = makeStateFromControls();
  draw();
});

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
  if (!timer) {
    state = makeStateFromControls();
    draw();
  }
});

midiBtn.addEventListener("click", async () => {
  if (!requireUnlocked()) return;
  await connectMidi();
});

midiOutputSelect.addEventListener("change", () => {
  midiOutput = midiAccess?.outputs.get(midiOutputSelect.value) ?? null;
});

exportBtn.addEventListener("click", () => {
  if (!requireUnlocked()) return;
  const sections = readNumber("exportSections");
  const rendered = renderArrangement(makeStateFromControls(), { sectionCount: sections, ppq: 480 });
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
  state = makeStateFromControls();
  await ensureAudioContext();
  live = {
    state,
    sectionStart: audioContext.currentTime + 0.08,
    lastReplacementBar: -1,
    lastReplacementResolve: -1,
    scheduled: new Set()
  };
  draw();
  tick();
  statusEl.textContent = live.scheduled.size ? "playing" : "waiting for hit";
  timer = window.setInterval(tick, 25);
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
    updatePaywallUi();
    return;
  }
  try {
    const verdict = await validateLicense(entitlement);
    if (!verdict.unlocked) {
      clearEntitlement();
      entitlement = null;
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
  const unlocked = entitlementUnlocks(entitlement);
  startBtn.disabled = !unlocked;
  midiBtn.disabled = !unlocked;
  exportBtn.disabled = !unlocked;
  clearLicenseBtn.disabled = !unlocked;
  paywallStatus.textContent = unlocked ? "unlocked" : "locked";
}

function stopLive() {
  if (timer) window.clearInterval(timer);
  timer = null;
  live = null;
  statusEl.textContent = "stopped";
}

function tick() {
  const now = audioContext.currentTime;
  let currentSectionSeconds = sectionSeconds(live.state);
  while (now >= live.sectionStart + currentSectionSeconds) {
    live.sectionStart += currentSectionSeconds;
    live.state = advanceCycle(live.state);
    live.scheduled.clear();
    live.lastReplacementBar = -1;
    live.lastReplacementResolve = -1;
    state = live.state;
    currentSectionSeconds = sectionSeconds(live.state);
    draw();
  }

  applyCadence(now);

  const from = now + 0.02;
  const to = now + 0.35;
  const result = generateEventsInWindow(live.state, {
    fromSeconds: from,
    toSeconds: to,
    sectionStartSeconds: live.sectionStart,
    maxEvents: 600
  });

  for (const event of result.events) {
    const key = `${live.state.cycleIndex}:${event.voiceId}:${event.pulseIndex}`;
    if (live.scheduled.has(key)) continue;
    live.scheduled.add(key);
    playEvent(event, event.timeSeconds);
  }
}

function applyCadence(now) {
  if (!live.state.pendingReplacements.length) return;
  const local = now - live.sectionStart;
  const baseBar = (60 / live.state.baseBpm) * live.state.baseMeter;
  const barIndex = Math.floor(local / baseBar);
  if (live.state.config.replacementCadence === "one-per-bar" && barIndex > live.lastReplacementBar) {
    live.state = applyNextReplacement(live.state);
    live.lastReplacementBar = barIndex;
    state = live.state;
    draw();
  }
  if (live.state.config.replacementCadence === "one-per-resolving-sequence") {
    const resolveIndex = Math.floor(local / resolvingSeconds(live.state));
    if (resolveIndex > live.lastReplacementResolve) {
      live.state = applyNextReplacement(live.state);
      live.lastReplacementResolve = resolveIndex;
      state = live.state;
      draw();
    }
  }
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
    case "agogo-low":
      metallicHit(when, [620, 1240], 0.19, 0.28 * level, "sine");
      break;
    case "cabasa":
      shakerHit(when, 0.055, 0.16 * level, 7200);
      break;
    case "caixixi":
      shakerHit(when, 0.075, 0.18 * level, 6500);
      break;
    case "claves":
      woodHit(when, 2400, 0.045, 0.32 * level);
      break;
    case "gwo-ka":
      handDrum(when, 115, 0.2, 0.6 * level);
      break;
    case "tambourin":
      tambourinHit(when, level);
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
  const densityTrim = Math.max(0.28, Math.min(0.9, 3 / Math.sqrt(voices)));
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

function tambourinHit(when, level) {
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
    compressor.threshold.value = -18;
    compressor.knee.value = 22;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    masterGain.gain.value = 0.82;
    compressor.connect(masterGain).connect(audioContext.destination);
    masterInput = compressor;
  }
  await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("AudioContext not running");
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

function makeStateFromControls() {
  return createInitialState({
    seed: value("seed") || sessionSeed,
    baseBpm: readOptionalNumber("baseBpm"),
    baseMeter: readOptionalNumber("baseMeter"),
    patternCount: readOptionalNumber("patternCount"),
    startOnlyCount: readOptionalNumber("startOnlyCount"),
    pulseCount: readOptionalNumber("pulseCount"),
    kitPool: optionalValue("kitPool"),
    meterStart: readOptionalNumber("meterStart"),
    meterCount: readOptionalNumber("patternCount"),
    cycleLength: readOptionalNumber("cycleLength"),
    cycleLengthKind: optionalValue("cycleLengthKind"),
    basisPolicy: optionalValue("basisPolicy")
  });
}

function draw() {
  drawTimeline();
  drawVoices();
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
  document.querySelector("#patternCount").value = String(3 + Math.floor(Math.random() * 18));
  const patterns = readNumber("patternCount");
  document.querySelector("#startOnlyCount").value = String(Math.floor(Math.random() * Math.max(1, patterns / 3)));
  document.querySelector("#pulseCount").value = String(Math.floor(Math.random() * Math.max(1, patterns / 3)));
  document.querySelector("#kitPool").value = "";
  document.querySelector("#cycleLength").value = String(1 + Math.floor(Math.random() * 5));
  const policies = ["next", "random", "closest", "farthest"];
  document.querySelector("#basisPolicy").value = policies[Math.floor(Math.random() * policies.length)];
}

function value(id) {
  return document.querySelector(`#${id}`).value;
}

function optionalValue(id) {
  return value(id) || undefined;
}

function readOptionalNumber(id) {
  const current = value(id);
  return current === "" ? undefined : Number(current);
}

function readNumber(id) {
  return Number(value(id));
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
