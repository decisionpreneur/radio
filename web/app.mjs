import {
  baseBarSeconds,
  beginNextCycle,
  cloneStation,
  eventsBetween,
  kitSummary,
  makeStation,
  nextReplacementSecond,
  replaceOne,
  renderArrangement,
  resolveBars,
  sectionBars,
  sectionSeconds,
  voiceBpm
} from "./lib/engine.mjs";
import { encodeMidiFile } from "./lib/midi-file.mjs";

const accessStore = "radio-access-v4";
const instanceStore = "radio-instance-v4";
const sessionSeed = `r-${Date.now().toString(36)}`;
const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];
const ui = {
  tune: q("#tune"),
  run: q("#runState"),
  lock: q("#lockState"),
  play: q("#play"),
  stop: q("#stop"),
  fresh: q("#fresh"),
  copy: q("#copyLink"),
  midi: q("#midiConnect"),
  save: q("#midiSave"),
  buy: q("#buy"),
  give: q("#give"),
  license: q("#license"),
  email: q("#email"),
  unlock: q("#unlock"),
  forget: q("#forget"),
  accessText: q("#accessText"),
  midiOut: q("#midiOut"),
  canvas: q("#map"),
  mapWrap: q("#mapWrap"),
  needle: q("#mapWrap > span"),
  parts: q("#partList"),
  cycleMeter: q("#cycleMeter"),
  reads: Object.fromEntries(qa("[data-read]").map((node) => [node.dataset.read, node])),
  hit: q("#hit"),
  hitLamp: q('[data-hit="lamp"]'),
  hitReads: Object.fromEntries(qa("[data-hit]").map((node) => [node.dataset.hit, node]))
};
const paper = ui.canvas.getContext("2d");

let station = makeStation(valuesFromForm());
let listening = null;
let audio = null;
let midiAccess = null;
let midiOut = null;
let savedAccess = readStoredAccess();
let accessCheckPending = savedAccess?.unlocked === true;
let lastHitUid = "";
let lastHitSlot = -1;
let signalFrame = 0;
let signalPeak = 0;
let hitBlink = 0;

applyHash();
station = makeStation(valuesFromForm());
loadPaymentLinks();
refreshAccessFromStorage();
paint();

ui.tune.addEventListener("input", rebuild);
ui.tune.addEventListener("change", rebuild);
ui.play.addEventListener("click", start);
ui.stop.addEventListener("click", stop);
ui.fresh.addEventListener("click", randomize);
ui.copy.addEventListener("click", copyLink);
ui.unlock.addEventListener("click", unlock);
ui.forget.addEventListener("click", clearAccess);
ui.midi.addEventListener("click", connectMidi);
ui.midiOut.addEventListener("change", chooseMidiOut);
ui.save.addEventListener("click", saveMidi);

function rebuild(event) {
  if (event?.target?.closest?.(".access") || event?.target?.id === "sections" || event?.target?.id === "midiOut") return;
  station = makeStation(valuesFromForm());
  if (listening) {
    listening.station = cloneStation(station);
    listening.started = audio.context.currentTime + 0.08;
    listening.sent.clear();
  }
  paint();
}

async function start() {
  if (!unlocked()) {
    phrase("license required");
    return;
  }
  if (!audio) audio = audioGraph();
  await audio.context.resume();
  const now = audio.context.currentTime;
  listening = {
    station: cloneStation(station),
    started: now + 0.08,
    sent: new Map(),
    timer: window.setInterval(tick, 25)
  };
  ui.mapWrap.dataset.live = "yes";
  phrase("playing");
  tick();
  signalLoop();
}

function stop() {
  if (listening?.timer) window.clearInterval(listening.timer);
  listening = null;
  ui.mapWrap.dataset.live = "no";
  ui.cycleMeter.value = 0;
  ui.needle.style.setProperty("--needle-x", "50%");
  phrase("stopped");
}

function tick() {
  if (!listening || !audio) return;
  const now = audio.context.currentTime;
  carryTo(now);
  schedule(now + 0.015, now + 0.35);
  showTime(now);
}

function carryTo(now) {
  let changed = false;
  while (now >= listening.started + sectionSeconds(listening.station) - 1e-9) {
    listening.started += sectionSeconds(listening.station);
    listening.station = beginNextCycle(listening.station);
    listening.sent.clear();
    changed = true;
  }
  while (true) {
    const cut = nextReplacementSecond(listening.station, listening.started);
    if (cut === null || cut > now + 1e-9) break;
    listening.station = replaceOne(listening.station);
    changed = true;
  }
  if (changed) {
    station = cloneStation(listening.station);
    paint();
  }
}

function schedule(fromSecond, toSecond) {
  for (const [key, at] of listening.sent) {
    if (at < fromSecond - 1) listening.sent.delete(key);
  }
  let cursor = fromSecond;
  let local = cloneStation(listening.station);
  let origin = listening.started;
  while (cursor < toSecond - 1e-9) {
    const cycleEnd = origin + sectionSeconds(local);
    const replacementAt = nextReplacementSecond(local, origin);
    const edge = Math.min(toSecond, cycleEnd, replacementAt ?? Number.POSITIVE_INFINITY);
    for (const hit of eventsBetween(local, {
      fromSecond: cursor,
      toSecond: edge,
      originSecond: origin,
      maxEvents: 2200
    })) {
      const key = `${local.cycle}:${local.replacementsDone}:${hit.uid}:${hit.pulse}`;
      if (listening.sent.has(key)) continue;
      listening.sent.set(key, hit.timeSecond);
      sound(hit, hit.timeSecond);
    }
    cursor = edge;
    if (replacementAt !== null && replacementAt <= edge + 1e-9) {
      local = replaceOne(local);
      continue;
    }
    if (cycleEnd <= edge + 1e-9) {
      origin = cycleEnd;
      local = beginNextCycle(local);
    }
  }
}

function sound(hit, when) {
  if (midiOut) {
    const at = performance.now() + Math.max(0, (when - audio.context.currentTime) * 1000);
    midiOut.send([0x99, hit.note, hit.velocity], at);
    midiOut.send([0x89, hit.note, 0], at + hit.seconds * 1000);
  }
  renderHit(hit, when);
  signalPeak = Math.max(signalPeak, hit.velocity / 127);
  const delay = Math.max(0, (when - audio.context.currentTime) * 1000);
  window.setTimeout(() => showHit(hit), delay);
}

function renderHit(hit, when) {
  const loud = (hit.velocity / 127) * Math.max(0.38, Math.min(0.9, 2.8 / Math.sqrt(Math.max(1, station.voices.length))));
  const family = hit.instrument.family;
  if (family === "kick") {
    tone(82, 0.16, loud * 0.76, "sine", when, 0.38);
    noise(0.026, loud * 0.16, 2600, "highpass", when);
  } else if (family === "snare") {
    noise(0.11, loud * 0.34, 980, "bandpass", when);
    tone(185, 0.06, loud * 0.13, "triangle", when, 0.55);
  } else if (family === "tom") {
    const freq = 112 + (hit.note - 41) * 22;
    tone(freq, 0.18, loud * 0.42, "sine", when, 0.52);
  } else if (family === "hat") {
    noise(hit.instrument.name.includes("Open") ? 0.18 : 0.055, loud * 0.18, 6200, "highpass", when);
    metal([3800, 5700], 0.06, loud * 0.05, when);
  } else if (family === "crash") {
    noise(0.32, loud * 0.24, 3600, "highpass", when);
    metal([730, 1190, 2110], 0.22, loud * 0.09, when);
  } else if (family === "ride") {
    noise(0.18, loud * 0.16, 4700, "highpass", when);
    metal([610, 920], 0.12, loud * 0.08, when);
  } else if (family === "hand") {
    const freq = 96 + (hit.note - 35) * 15;
    tone(freq, 0.15, loud * 0.45, "triangle", when, 0.58);
    noise(0.03, loud * 0.08, freq * 9, "bandpass", when);
  } else if (family === "wood") {
    metal([520 + hit.note * 5, 780 + hit.note * 6], 0.08, loud * 0.16, when, "square");
  } else if (family === "metal") {
    metal([820 + hit.note * 8, 1310 + hit.note * 6, 2190 + hit.note * 4], 0.13, loud * 0.15, when);
  } else {
    noise(0.095, loud * 0.15, 5200, "highpass", when);
  }
}

function audioGraph() {
  const context = new AudioContext();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  master.gain.value = 0.52;
  compressor.threshold.value = -18;
  compressor.knee.value = 22;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  analyser.fftSize = 512;
  master.connect(compressor).connect(analyser).connect(context.destination);
  return {
    context,
    master,
    analyser,
    samples: new Uint8Array(analyser.frequencyBinCount),
    noiseBuffer: makeNoise(context)
  };
}

function tone(freq, seconds, gainValue, type, when, fall = 0.5) {
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(18, freq * fall), when + seconds);
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + seconds);
  osc.connect(gain).connect(audio.master);
  osc.start(when);
  osc.stop(when + seconds + 0.02);
}

function noise(seconds, gainValue, freq, type, when) {
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const gain = audio.context.createGain();
  source.buffer = audio.noiseBuffer;
  filter.type = type;
  filter.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + seconds);
  source.connect(filter).connect(gain).connect(audio.master);
  source.start(when);
  source.stop(when + seconds + 0.02);
}

function metal(freqs, seconds, gainValue, when, type = "triangle") {
  for (const freq of freqs) tone(freq, seconds, gainValue / freqs.length, type, when, 0.92);
}

function makeNoise(context) {
  const length = context.sampleRate * 2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function signalLoop() {
  if (!audio || signalFrame) return;
  const draw = () => {
    signalFrame = 0;
    if (!audio) return;
    audio.analyser.getByteFrequencyData(audio.samples);
    let peak = 0;
    for (const value of audio.samples) peak = Math.max(peak, value);
    const level = Math.max(peak / 255, signalPeak);
    ui.reads.signal.textContent = level.toFixed(3);
    ui.reads.signalFill.style.transform = `scaleX(${level})`;
    signalPeak = signalPeak < 0.001 ? 0 : signalPeak * 0.985;
    if (listening) signalFrame = requestAnimationFrame(draw);
  };
  signalFrame = requestAnimationFrame(draw);
}

function showHit(hit) {
  lastHitUid = hit.uid;
  lastHitSlot = hit.slot;
  ui.hitReads.instrument.textContent = hit.instrument.name;
  ui.hitReads.lane.textContent = `L${hit.slot + 1}`;
  ui.hitReads.meter.textContent = String(hit.meter);
  ui.hitReads.kit.textContent = hit.kit;
  ui.hitReads.role.textContent = hit.role;
  ui.hitReads.pulse.textContent = String(hit.pulse);
  ui.hit.classList.add("hot");
  ui.hitLamp.classList.add("hot");
  qa(".part.last").forEach((item) => item.classList.remove("last"));
  const row = q(`[data-uid="${hit.uid}"], [data-slot="${hit.slot}"]`);
  row?.classList.add("hit", "last");
  if (hitBlink) window.clearTimeout(hitBlink);
  hitBlink = window.setTimeout(() => {
    ui.hit.classList.remove("hot");
    ui.hitLamp.classList.remove("hot");
    qa(".part.hit").forEach((item) => item.classList.remove("hit"));
  }, 360);
}

function showTime(now) {
  if (!listening) return;
  const total = sectionSeconds(listening.station);
  const spent = Math.max(0, now - listening.started);
  const ratio = total > 0 ? Math.min(1, spent / total) : 0;
  ui.cycleMeter.value = ratio;
  ui.reads.cycle.textContent = `${listening.station.cycle}; bar ${Math.min(sectionBars(listening.station), Math.floor(spent / baseBarSeconds(listening.station)))} / ${sectionBars(listening.station)}`;
  ui.reads.change.textContent = changePhrase(listening.station);
  ui.needle.style.setProperty("--needle-x", `${Math.round(ratio * 100)}%`);
  drawMap(listening.station, ratio);
}

function paint() {
  const view = listening?.station ?? station;
  ui.reads.basis.textContent = basisPhrase(view);
  ui.reads.cycle.textContent = `${view.cycle}; ${sectionBars(view)} bars`;
  ui.reads.change.textContent = changePhrase(view);
  ui.reads.basisChoice.textContent = view.config.basisMode === "farthest" ? "farmost" : view.config.basisMode;
  ui.reads.patterns.textContent = String(view.voices.length);
  ui.reads.roles.textContent = rolesPhrase(view);
  ui.reads.meters.textContent = metersPhrase(view);
  ui.reads.kits.textContent = kitSummary(view);
  ui.reads.timing.textContent = "same pulse";
  ui.reads.access.textContent = unlocked() ? "subscribed" : "locked";
  drawMap(view, 0);
  drawParts(view);
  paintAccess();
}

function drawMap(view, progress) {
  const width = ui.canvas.width;
  const height = ui.canvas.height;
  const centerX = width * 0.5;
  const centerY = height * 0.52;
  const outer = Math.min(width, height) * 0.44;
  const inner = Math.max(42, outer * 0.16);
  paper.clearRect(0, 0, width, height);
  paper.fillStyle = css("--map-paper");
  paper.fillRect(0, 0, width, height);
  paper.strokeStyle = css("--map-line");
  paper.lineWidth = 1;
  for (let ring = 0; ring < view.voices.length; ring += 1) {
    const radius = ringRadius(inner, outer, view.voices.length, ring);
    paper.beginPath();
    paper.arc(centerX, centerY, radius, 0, Math.PI * 2);
    paper.stroke();
  }

  const preview = Math.min(sectionSeconds(view), 24);
  for (const hit of eventsBetween(view, {
    fromSecond: 0,
    toSecond: preview,
    originSecond: 0,
    maxEvents: 5000
  })) {
    const angle = -Math.PI / 2 + (hit.localSecond / preview) * Math.PI * 2;
    const radius = ringRadius(inner, outer, view.voices.length, hit.slot);
    const size = hit.uid === view.baseUid ? 12 : 8;
    radialStroke(centerX, centerY, angle, radius - size, radius + size, hit.instrument.color, hit.uid === view.baseUid ? 4 : 2);
  }

  const baseIndex = view.voices.findIndex((part) => part.uid === view.baseUid);
  if (baseIndex >= 0) {
    const radius = ringRadius(inner, outer, view.voices.length, baseIndex);
    paper.strokeStyle = css("--map-base");
    paper.lineWidth = 3;
    paper.beginPath();
    paper.arc(centerX, centerY, radius, 0, Math.PI * 2);
    paper.stroke();
  }

  if (listening) {
    const angle = -Math.PI / 2 + progress * Math.PI * 2;
    radialStroke(centerX, centerY, angle, inner * 0.45, outer + 18, css("--hit"), 2);
  }

  paper.fillStyle = css("--ink");
  paper.font = "28px Georgia, serif";
  paper.textAlign = "center";
  paper.fillText(`cycle ${view.cycle}`, centerX, centerY - 6);
  paper.font = "16px Aptos, Helvetica Neue, Helvetica, sans-serif";
  paper.fillText(`m ${view.baseMeter} / ${view.baseBpm.toFixed(3)} bpm`, centerX, centerY + 23);
}

function radialStroke(cx, cy, angle, start, end, color, width) {
  paper.strokeStyle = color;
  paper.lineWidth = width;
  paper.beginPath();
  paper.moveTo(cx + Math.cos(angle) * start, cy + Math.sin(angle) * start);
  paper.lineTo(cx + Math.cos(angle) * end, cy + Math.sin(angle) * end);
  paper.stroke();
}

function ringRadius(inner, outer, count, index) {
  if (count <= 1) return (inner + outer) / 2;
  return inner + (outer - inner) * index / (count - 1);
}

function drawParts(view) {
  ui.parts.innerHTML = "";
  for (const [slot, part] of view.voices.entries()) {
    const row = document.createElement("li");
    row.className = `part${part.uid === view.baseUid ? " base" : ""}${part.uid === lastHitUid || slot === lastHitSlot ? " last" : ""}`;
    row.dataset.uid = part.uid;
    row.dataset.slot = String(slot);
    row.style.setProperty("--tone", part.instrument.color);
    row.innerHTML = `
      <b>${escapeHtml(`L${slot + 1} ${part.instrument.name}`)}</b>
      <small>${escapeHtml(`m ${part.meter} / ${voiceBpm(view, part).toFixed(3)} bpm`)}</small>
      <em>${escapeHtml(`${part.instrument.kitName} / ${part.role} / n ${part.instrument.note}`)}</em>
      ${spark(part.pattern)}
      <code>${escapeHtml(part.pattern.join(""))}</code>
    `;
    ui.parts.append(row);
  }
}

function spark(pattern) {
  return `<span class="spark" aria-label="pattern ${pattern.join("")}">${pattern.map((value) => `<i class="${value ? "on" : ""}"></i>`).join("")}</span>`;
}

function basisPhrase(view) {
  const part = view.voices.find((item) => item.uid === view.baseUid) ?? view.voices[0];
  const from = part?.rethoughtFrom ? ` from meter ${part.rethoughtFrom}` : "";
  return `${part?.uid ?? "-"}; meter ${view.baseMeter}${from}; ${view.baseBpm.toFixed(3)} bpm`;
}

function changePhrase(view) {
  const total = view.replacementsDone + view.pending.length;
  const progress = total ? `${view.replacementsDone}/${total} replacements` : "basis";
  return `${view.config.cycleLength} ${view.config.cycleUnit}; ${resolveBars(view)} resolving bars; ${progress}; one by one`;
}

function rolesPhrase(view) {
  const map = { "start-only": 0, pulse: 0, binary: 0 };
  for (const part of view.voices) map[part.role] += 1;
  return `start-only ${map["start-only"]}; pulse ${map.pulse}; binary ${map.binary}`;
}

function metersPhrase(view) {
  const meters = view.voices.map((part) => part.meter).sort((a, b) => a - b);
  return meters.join(", ");
}

function valuesFromForm() {
  return {
    seed: value("seed") || sessionSeed,
    voiceCount: value("voiceCount"),
    startCount: value("startCount"),
    pulseCount: value("pulseCount"),
    baseBpm: value("baseBpm"),
    baseMeter: value("baseMeter"),
    meterStart: value("meterStart"),
    cycleLength: value("cycleLength"),
    cycleUnit: value("cycleUnit"),
    basisMode: value("basisMode"),
    kits: qa('input[name="kits"]:checked').map((node) => node.value)
  };
}

function value(id) {
  return q(`#${id}`)?.value?.trim() ?? "";
}

function randomize() {
  const count = 2 + Math.floor(Math.random() * 19);
  q("#seed").value = `r-${Date.now().toString(36)}`;
  q("#voiceCount").value = String(count);
  q("#startCount").value = String(count);
  q("#pulseCount").value = "0";
  q("#baseBpm").value = String(72 + Math.floor(Math.random() * 84));
  q("#baseMeter").value = "";
  q("#meterStart").value = "";
  q("#cycleLength").value = String(1 + Math.floor(Math.random() * 4));
  q("#cycleUnit").value = Math.random() < 0.5 ? "bars" : "resolving-sequences";
  const modes = ["next", "random", "closest", "farmost"];
  q("#basisMode").value = modes[Math.floor(Math.random() * modes.length)];
  for (const box of qa('input[name="kits"]')) box.checked = true;
  rebuild();
}

function copyLink() {
  const hash = new URLSearchParams();
  const data = valuesFromForm();
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) hash.set(key, val.join(","));
    else if (val) hash.set(key, val);
  }
  const url = `${location.origin}${location.pathname}#${hash.toString()}`;
  navigator.clipboard.writeText(url).then(() => phrase("link copied"), () => phrase("copy unavailable"));
}

function applyHash() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  for (const id of ["seed", "voiceCount", "startCount", "pulseCount", "baseBpm", "baseMeter", "meterStart", "cycleLength", "cycleUnit", "basisMode", "sections"]) {
    if (hash.has(id) && q(`#${id}`)) q(`#${id}`).value = hash.get(id);
  }
  if (hash.has("kits")) {
    const chosen = new Set(hash.get("kits").split(",").map((part) => part.trim()));
    for (const box of qa('input[name="kits"]')) box.checked = chosen.has(box.value);
  }
}

async function loadPaymentLinks() {
  try {
    const res = await fetch("/api/config", { headers: { Accept: "application/json" } });
    const body = await res.json();
    if (httpsUrl(body.checkoutUrl)) ui.buy.href = body.checkoutUrl;
    if (httpsUrl(body.donationUrl)) ui.give.href = body.donationUrl;
  } catch {
    ui.accessText.textContent = "payment links unavailable";
  }
}

async function unlock() {
  const licenseKey = ui.license.value.trim();
  const email = ui.email.value.trim();
  if (!licenseKey) {
    ui.accessText.textContent = "enter license key";
    return;
  }
  ui.unlock.disabled = true;
  ui.accessText.textContent = "checking";
  try {
    const verdict = await licensePost("activate", {
      licenseKey,
      email,
      instanceName: instanceName()
    });
    if (!verdict.unlocked) {
      ui.accessText.textContent = errorText(verdict.error);
      return;
    }
    savedAccess = {
      unlocked: true,
      licenseKey,
      email,
      instanceId: verdict.instanceId || instanceName(),
      provider: verdict.provider,
      status: verdict.licenseStatus || "active"
    };
    localStorage.setItem(accessStore, JSON.stringify(savedAccess));
    ui.license.value = "";
    accessCheckPending = false;
    paintAccess();
  } catch {
    ui.accessText.textContent = "license check failed";
  } finally {
    ui.unlock.disabled = false;
  }
}

async function refreshAccessFromStorage() {
  if (!savedAccess?.unlocked) {
    accessCheckPending = false;
    paintAccess();
    return;
  }
  try {
    const verdict = await licensePost("validate", {
      licenseKey: savedAccess.licenseKey,
      email: savedAccess.email,
      instanceId: savedAccess.instanceId
    });
    if (!verdict.unlocked) {
      localStorage.removeItem(accessStore);
      savedAccess = null;
      stop();
    } else {
      savedAccess = { ...savedAccess, status: verdict.licenseStatus || savedAccess.status, instanceId: verdict.instanceId || savedAccess.instanceId };
      localStorage.setItem(accessStore, JSON.stringify(savedAccess));
    }
  } catch {
    localStorage.removeItem(accessStore);
    savedAccess = null;
    stop();
  } finally {
    accessCheckPending = false;
    paintAccess();
  }
}

function clearAccess() {
  localStorage.removeItem(accessStore);
  savedAccess = null;
  stop();
  paintAccess();
}

function paintAccess() {
  const ok = unlocked();
  document.documentElement.dataset.access = ok ? "ok" : "locked";
  ui.lock.textContent = accessCheckPending ? "checking license" : ok ? "subscribed" : "license required";
  ui.accessText.textContent = accessCheckPending ? "checking license" : ok ? "subscribed" : "license required";
  ui.forget.disabled = !ok;
  ui.midi.disabled = !ok;
  ui.save.disabled = !ok;
  ui.reads.access.textContent = ok ? "subscribed" : "locked";
}

function unlocked() {
  return savedAccess?.unlocked === true;
}

function readStoredAccess() {
  try {
    const raw = localStorage.getItem(accessStore);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function instanceName() {
  const existing = localStorage.getItem(instanceStore);
  if (existing) return existing;
  const made = `radio-${crypto.randomUUID()}`;
  localStorage.setItem(instanceStore, made);
  return made;
}

async function licensePost(action, body) {
  const res = await fetch(`/api/license/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok && !data.error) data.error = "license_check_failed";
  return data;
}

function errorText(code) {
  return ({
    license_key_required: "enter license key",
    checkout_email_required: "enter payment email",
    checkout_email_mismatch: "email mismatch",
    license_key_not_listed: "license not listed",
    license_not_active: "license inactive",
    license_not_valid: "license invalid",
    product_mismatch: "wrong product",
    variant_mismatch: "wrong variant"
  })[code] || "license check failed";
}

async function connectMidi() {
  if (!unlocked()) {
    phrase("license required");
    return;
  }
  if (!navigator.requestMIDIAccess) {
    phrase("midi unavailable");
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    fillMidiOutputs();
    phrase("midi ready");
  } catch {
    phrase("midi denied");
  }
}

function fillMidiOutputs() {
  ui.midiOut.innerHTML = '<option value="">none</option>';
  for (const output of midiAccess.outputs.values()) {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name || output.id;
    ui.midiOut.append(option);
  }
}

function chooseMidiOut() {
  midiOut = midiAccess?.outputs.get(ui.midiOut.value) ?? null;
}

function saveMidi() {
  if (!unlocked()) {
    phrase("license required");
    return;
  }
  const sectionCount = Math.min(64, Math.max(1, Math.floor(Number(value("sections")) || 6)));
  const bytes = encodeMidiFile(renderArrangement(station, { sectionCount, ppq: 480 }));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "radio.mid";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  phrase("midi saved");
}

function phrase(text) {
  ui.run.textContent = text;
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function httpsUrl(text) {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
