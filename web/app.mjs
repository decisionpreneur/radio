import {
  baseBarSeconds,
  candidateBpm,
  cloneStation,
  eventsBetween,
  makeStation,
  nextCycle,
  nextReplacementAt,
  replaceNext,
  renderArrangement,
  resolvingBars,
  sectionBars,
  sectionSeconds,
  stationKitText
} from "./lib/engine.mjs";
import { encodeMidiFile } from "./lib/midi-file.mjs";

const accessStore = "radio-access-20260827";
const instanceStore = "radio-instance-20260827";
const sessionSeed = `r-${Date.now().toString(36)}`;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const ui = {
  form: $("#controls"),
  play: $("#playButton"),
  stop: $("#stopButton"),
  fresh: $("#newButton"),
  copy: $("#copyButton"),
  midi: $("#midiButton"),
  save: $("#saveButton"),
  run: $("#stateText"),
  accessState: $("#accessState"),
  subscribe: $("#subscribeLink"),
  donate: $("#donateLink"),
  license: $("#licenseKey"),
  email: $("#email"),
  unlock: $("#unlockButton"),
  clear: $("#clearButton"),
  accessLine: $("#accessLine"),
  midiOutput: $("#midiOutput"),
  canvas: $("#scope"),
  scope: $(".scope"),
  needle: $("#needle"),
  reads: Object.fromEntries($$("[data-read]").map((node) => [node.dataset.read, node])),
  hitPanel: $("#hitPanel"),
  hitReads: Object.fromEntries($$("[data-hit]").map((node) => [node.dataset.hit, node])),
  lanes: $("#laneList")
};
const ctx = ui.canvas.getContext("2d");

let station = makeStation(formValues());
let live = null;
let audio = null;
let midiAccess = null;
let midiOutput = null;
let storedAccess = readAccess();
let checkingAccess = Boolean(storedAccess?.unlocked);
let lastHitUid = "";
let lastHitSlot = -1;
let flashTimer = 0;
let signalTimer = 0;
let signalPeak = 0;

readHash();
station = makeStation(formValues());
loadConfig();
refreshAccess();
paint();

ui.form.addEventListener("input", formChanged);
ui.form.addEventListener("change", formChanged);
ui.play.addEventListener("click", play);
ui.stop.addEventListener("click", stop);
ui.fresh.addEventListener("click", randomStation);
ui.copy.addEventListener("click", copyStationLink);
ui.unlock.addEventListener("click", unlock);
ui.clear.addEventListener("click", clearAccess);
ui.midi.addEventListener("click", connectMidi);
ui.midiOutput.addEventListener("change", chooseMidiOutput);
ui.save.addEventListener("click", saveMidi);
window.addEventListener("resize", () => paint());

function formChanged(event) {
  const id = event?.target?.id ?? "";
  if (event?.target?.closest(".access") || id === "sections" || id === "midiOutput") return;
  station = makeStation(formValues());
  if (live && audio) {
    live.station = cloneStation(station);
    live.origin = audio.context.currentTime + 0.08;
    live.sent.clear();
  }
  paint();
}

async function play() {
  if (!hasAccess()) {
    say("license required");
    return;
  }
  if (!audio) audio = makeAudioGraph();
  await audio.context.resume();
  live = {
    station: cloneStation(station),
    origin: audio.context.currentTime + 0.08,
    sent: new Map(),
    timer: window.setInterval(tick, 24)
  };
  ui.scope.classList.add("live");
  say("playing");
  tick();
  signalLoop();
}

function stop() {
  if (live?.timer) window.clearInterval(live.timer);
  live = null;
  ui.scope.classList.remove("live");
  ui.needle.style.setProperty("--x", "50%");
  say("stopped");
  paint();
}

function tick() {
  if (!live || !audio) return;
  const now = audio.context.currentTime;
  advanceLive(now);
  scheduleHits(now + 0.015, now + 0.34);
  paintTime(now);
}

function advanceLive(now) {
  let changed = false;
  while (now >= live.origin + sectionSeconds(live.station) - 1e-9) {
    live.origin += sectionSeconds(live.station);
    live.station = nextCycle(live.station);
    live.sent.clear();
    changed = true;
  }
  while (true) {
    const cut = nextReplacementAt(live.station, live.origin);
    if (cut === null || cut > now + 1e-9) break;
    live.station = replaceNext(live.station);
    changed = true;
  }
  if (changed) {
    station = cloneStation(live.station);
    paint();
  }
}

function scheduleHits(fromSecond, toSecond) {
  for (const [key, sentAt] of live.sent) {
    if (sentAt < fromSecond - 1) live.sent.delete(key);
  }
  let cursor = fromSecond;
  let segment = cloneStation(live.station);
  let origin = live.origin;
  while (cursor < toSecond - 1e-9) {
    const cycleEnd = origin + sectionSeconds(segment);
    const replaceAt = nextReplacementAt(segment, origin);
    const edge = Math.min(toSecond, cycleEnd, replaceAt ?? Number.POSITIVE_INFINITY);
    for (const hit of eventsBetween(segment, {
      fromSecond: cursor,
      toSecond: edge,
      originSecond: origin,
      maxEvents: 2400
    })) {
      const key = `${segment.cycle}:${segment.replacementsDone}:${hit.uid}:${hit.pulse}`;
      if (live.sent.has(key)) continue;
      live.sent.set(key, hit.timeSecond);
      sound(hit);
    }
    cursor = edge;
    if (replaceAt !== null && replaceAt <= edge + 1e-9) {
      segment = replaceNext(segment);
      continue;
    }
    if (cycleEnd <= edge + 1e-9) {
      origin = cycleEnd;
      segment = nextCycle(segment);
    }
  }
}

function sound(hit) {
  if (midiOutput) {
    const at = performance.now() + Math.max(0, (hit.timeSecond - audio.context.currentTime) * 1000);
    midiOutput.send([0x99, hit.note, hit.velocity], at);
    midiOutput.send([0x89, hit.note, 0], at + hit.seconds * 1000);
  }
  synth(hit);
  signalPeak = Math.max(signalPeak, hit.velocity / 127);
  const delay = Math.max(0, (hit.timeSecond - audio.context.currentTime) * 1000);
  window.setTimeout(() => showHit(hit), delay);
}

function synth(hit) {
  const loud = (hit.velocity / 127) * Math.max(0.28, Math.min(0.82, 3.2 / Math.sqrt(Math.max(1, station.voices.length))));
  const when = hit.timeSecond;
  const family = hit.lane.family;
  if (family === "kick") {
    tone(76, 0.15, loud * 0.9, "sine", when, 0.32);
    filteredNoise(0.028, loud * 0.12, 2600, "highpass", when);
  } else if (family === "snare") {
    filteredNoise(0.105, loud * 0.35, 1150, "bandpass", when);
    tone(190, 0.055, loud * 0.14, "triangle", when, 0.5);
  } else if (family === "tom") {
    tone(92 + (hit.note - 41) * 20, 0.18, loud * 0.48, "sine", when, 0.48);
  } else if (family === "hat") {
    filteredNoise(hit.lane.name.includes("Open") ? 0.18 : 0.052, loud * 0.18, 6500, "highpass", when);
    partials([4100, 5800], 0.055, loud * 0.045, when, "triangle");
  } else if (family === "cymbal") {
    filteredNoise(0.28, loud * 0.25, 3900, "highpass", when);
    partials([730, 1130, 2030], 0.22, loud * 0.09, when, "triangle");
  } else if (family === "hand") {
    const base = 88 + (hit.note - 35) * 15;
    tone(base, 0.14, loud * 0.48, "triangle", when, 0.56);
    filteredNoise(0.032, loud * 0.09, base * 9, "bandpass", when);
  } else if (family === "wood") {
    partials([510 + hit.note * 4, 790 + hit.note * 5], 0.07, loud * 0.18, when, "square");
  } else if (family === "metal") {
    partials([830 + hit.note * 7, 1320 + hit.note * 5, 2200 + hit.note * 3], 0.14, loud * 0.16, when, "triangle");
  } else {
    filteredNoise(0.11, loud * 0.14, 5200, "highpass", when);
  }
}

function makeAudioGraph() {
  const context = new AudioContext();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  master.gain.value = 0.52;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  analyser.fftSize = 512;
  master.connect(compressor).connect(analyser).connect(context.destination);
  return {
    context,
    master,
    analyser,
    samples: new Uint8Array(analyser.frequencyBinCount),
    noise: makeNoise(context)
  };
}

function tone(freq, seconds, gainValue, type, when, fall) {
  const osc = audio.context.createOscillator();
  const gain = audio.context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(18, freq * fall), when + seconds);
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + seconds);
  osc.connect(gain).connect(audio.master);
  osc.start(when);
  osc.stop(when + seconds + 0.025);
}

function filteredNoise(seconds, gainValue, freq, type, when) {
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const gain = audio.context.createGain();
  source.buffer = audio.noise;
  filter.type = type;
  filter.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + seconds);
  source.connect(filter).connect(gain).connect(audio.master);
  source.start(when);
  source.stop(when + seconds + 0.025);
}

function partials(freqs, seconds, gainValue, when, type) {
  for (const freq of freqs) tone(freq, seconds, gainValue / freqs.length, type, when, 0.91);
}

function makeNoise(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function signalLoop() {
  if (!audio || signalTimer) return;
  const step = () => {
    signalTimer = 0;
    if (!audio) return;
    audio.analyser.getByteFrequencyData(audio.samples);
    let peak = 0;
    for (const value of audio.samples) peak = Math.max(peak, value);
    const level = Math.max(peak / 255, signalPeak);
    ui.reads.signal.textContent = level.toFixed(3);
    ui.reads.signalFill.style.transform = `scaleX(${level})`;
    signalPeak = signalPeak < 0.001 ? 0 : signalPeak * 0.985;
    if (live) signalTimer = requestAnimationFrame(step);
  };
  signalTimer = requestAnimationFrame(step);
}

function showHit(hit) {
  lastHitUid = hit.uid;
  lastHitSlot = hit.slot;
  ui.hitReads.instrument.textContent = hit.lane.name;
  ui.hitReads.lane.textContent = `L${hit.slot + 1}`;
  ui.hitReads.meter.textContent = String(hit.meter);
  ui.hitReads.kit.textContent = hit.kit;
  ui.hitReads.role.textContent = hit.role;
  ui.hitReads.pulse.textContent = formatPulse(hit.pulse);
  ui.hitPanel.classList.add("hot");
  $$(".lane.flash").forEach((node) => node.classList.remove("flash"));
  $(`[data-uid="${hit.uid}"]`)?.classList.add("flash");
  if (flashTimer) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    ui.hitPanel.classList.remove("hot");
    $$(".lane.flash").forEach((node) => node.classList.remove("flash"));
  }, 330);
}

function paintTime(now) {
  if (!live) return;
  const total = sectionSeconds(live.station);
  const spent = Math.max(0, now - live.origin);
  const ratio = total > 0 ? Math.min(1, spent / total) : 0;
  const bar = Math.min(sectionBars(live.station), Math.floor(spent / baseBarSeconds(live.station)));
  ui.reads.cycle.textContent = `${live.station.cycle}; bar ${bar} / ${sectionBars(live.station)}`;
  ui.reads.change.textContent = changeText(live.station);
  ui.needle.style.setProperty("--x", `${Math.round(ratio * 100)}%`);
  draw(live.station, ratio);
}

function paint() {
  const view = live?.station ?? station;
  ui.reads.basis.textContent = basisText(view);
  ui.reads.cycle.textContent = `${view.cycle}; ${sectionBars(view)} bars`;
  ui.reads.change.textContent = changeText(view);
  ui.reads.basisMode.textContent = view.config.basisMode === "farthest" ? "farmost" : view.config.basisMode;
  ui.reads.patterns.textContent = String(view.voices.length);
  ui.reads.roles.textContent = rolesText(view);
  ui.reads.meters.textContent = view.voices.map((voice) => voice.meter).sort((a, b) => a - b).join(", ");
  ui.reads.kits.textContent = stationKitText(view);
  paintAccess();
  draw(view, 0);
  drawLanes(view);
}

function draw(view, progress) {
  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const rect = ui.canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width * scale));
  const height = Math.max(300, Math.floor(rect.height * scale));
  if (ui.canvas.width !== width || ui.canvas.height !== height) {
    ui.canvas.width = width;
    ui.canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = css("--paper");
  ctx.fillRect(0, 0, width, height);
  const left = Math.min(width * 0.28, 126 * scale);
  const right = width - 28 * scale;
  const top = 30 * scale;
  const bottom = height - 28 * scale;
  const rowHeight = (bottom - top) / Math.max(1, view.voices.length);
  ctx.strokeStyle = css("--rule");
  ctx.lineWidth = scale;
  for (let guide = 0; guide <= 8; guide += 1) {
    const x = left + (right - left) * guide / 8;
    ctx.beginPath();
    ctx.moveTo(x, top - 10 * scale);
    ctx.lineTo(x, bottom + 4 * scale);
    ctx.stroke();
  }
  const preview = Math.max(1, Math.min(sectionSeconds(view), 18));
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(11 * scale)}px Segoe UI, Arial, sans-serif`;
  for (const [slot, voice] of view.voices.entries()) {
    const y = top + rowHeight * (slot + 0.5);
    ctx.strokeStyle = voice.uid === view.baseUid ? css("--ink") : css("--rule");
    ctx.lineWidth = (voice.uid === view.baseUid ? 2 : 1) * scale;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = voice.uid === view.baseUid ? css("--red") : css("--quiet");
    ctx.fillText(`L${slot + 1}  ${voice.lane.name}`, 16 * scale, y);
  }
  for (const hit of eventsBetween(view, {
    fromSecond: 0,
    toSecond: preview,
    originSecond: 0,
    maxEvents: 6000
  })) {
    const x = left + (right - left) * hit.localSecond / preview;
    const y = top + rowHeight * (hit.slot + 0.5);
    ctx.fillStyle = hit.lane.color;
    ctx.beginPath();
    ctx.arc(x, y, (hit.uid === view.baseUid ? 5 : 3.5) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  if (live) {
    const x = left + (right - left) * progress;
    ctx.strokeStyle = css("--red");
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(x, top - 10 * scale);
    ctx.lineTo(x, bottom + 4 * scale);
    ctx.stroke();
  }
  ctx.fillStyle = css("--ink");
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${Math.round(11 * scale)}px ui-monospace, Cascadia Mono, monospace`;
  ctx.fillText(`${preview.toFixed(1)} s`, right, height - 8 * scale);
}

function drawLanes(view) {
  ui.lanes.textContent = "";
  for (const [slot, voice] of view.voices.entries()) {
    const row = document.createElement("li");
    row.className = `lane${voice.uid === view.baseUid ? " base" : ""}${voice.uid === lastHitUid || slot === lastHitSlot ? " flash" : ""}`;
    row.dataset.uid = voice.uid;
    row.style.setProperty("--tone", voice.lane.color);
    row.innerHTML = `
      <b>${html(`L${slot + 1} ${voice.lane.name}`)}</b>
      <small>${html(`m ${voice.meter} / ${candidateBpm(view, voice).toFixed(3)} bpm`)}</small>
      <em>${html(`${voice.lane.kitName} / ${voice.role} / n ${voice.lane.note}`)}</em>
      ${ticks(voice)}
      <code>${html(voice.hitPositions.map(formatPulse).join(" "))}</code>
    `;
    ui.lanes.append(row);
  }
}

function ticks(voice) {
  const positions = voice.hitPositions.map(formatPulse).join(" ");
  const marks = voice.hitPositions.map((position) => `<i style="--position:${Math.min(100, Math.max(0, position / voice.meter * 100))}%"></i>`).join("");
  return `<span class="ticks" aria-label="hit positions ${html(positions)}">${marks}</span>`;
}

function formatPulse(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, "");
}

function basisText(view) {
  const voice = view.voices.find((item) => item.uid === view.baseUid) ?? view.voices[0];
  const from = voice?.rethoughtFrom ? ` from meter ${voice.rethoughtFrom}` : "";
  return `${voice?.uid ?? "-"}; meter ${view.baseMeter}${from}; ${view.baseBpm.toFixed(3)} bpm`;
}

function changeText(view) {
  const total = view.replacementsDone + view.pending.length;
  const replacement = total ? `${view.replacementsDone}/${total} replacements` : "basis";
  return `${view.config.cycleLength} ${view.config.cycleUnit}; ${resolvingBars(view)} resolving bars; ${replacement}; one by one`;
}

function rolesText(view) {
  const count = { "start-only": 0, pulse: 0, binary: 0 };
  for (const voice of view.voices) count[voice.role] += 1;
  return `start-only ${count["start-only"]}; pulse ${count.pulse}; binary ${count.binary}`;
}

function formValues() {
  return {
    seed: value("seed") || sessionSeed,
    voiceCount: value("voiceCount"),
    startCount: value("startCount"),
    pulseCount: value("pulseCount"),
    baseBpm: value("baseBpm"),
    baseMeter: value("baseMeter"),
    firstMeter: value("firstMeter"),
    cycleLength: value("cycleLength"),
    cycleUnit: value("cycleUnit"),
    basisMode: value("basisMode"),
    kits: $$('input[name="kits"]:checked').map((node) => node.value)
  };
}

function value(id) {
  return $(`#${id}`)?.value?.trim() ?? "";
}

function randomStation() {
  const count = 2 + Math.floor(Math.random() * 19);
  $("#seed").value = `r-${Date.now().toString(36)}`;
  $("#voiceCount").value = String(count);
  $("#startCount").value = String(count);
  $("#pulseCount").value = "0";
  $("#baseBpm").value = String(72 + Math.floor(Math.random() * 84));
  $("#baseMeter").value = "";
  $("#firstMeter").value = "";
  $("#cycleLength").value = String(1 + Math.floor(Math.random() * 4));
  $("#cycleUnit").value = "bars";
  $("#basisMode").value = ["next", "random", "closest", "farmost"][Math.floor(Math.random() * 4)];
  for (const box of $$('input[name="kits"]')) box.checked = true;
  station = makeStation(formValues());
  if (live && audio) {
    live.station = cloneStation(station);
    live.origin = audio.context.currentTime + 0.08;
    live.sent.clear();
  }
  paint();
}

function copyStationLink() {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(formValues())) {
    if (Array.isArray(val)) params.set(key, val.join(","));
    else if (val) params.set(key, val);
  }
  const link = `${location.origin}${location.pathname}#${params.toString()}`;
  navigator.clipboard.writeText(link).then(() => say("link copied"), () => say("copy unavailable"));
}

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  for (const id of ["seed", "voiceCount", "startCount", "pulseCount", "baseBpm", "baseMeter", "firstMeter", "cycleLength", "cycleUnit", "basisMode", "sections"]) {
    if (params.has(id) && $(`#${id}`)) $(`#${id}`).value = params.get(id);
  }
  if (params.has("kits")) {
    const chosen = new Set(params.get("kits").split(",").map((item) => item.trim()));
    for (const box of $$('input[name="kits"]')) box.checked = chosen.has(box.value);
  }
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config", { headers: { Accept: "application/json" } });
    const data = await res.json();
    if (isHttps(data.checkoutUrl)) ui.subscribe.href = data.checkoutUrl;
    if (isHttps(data.donationUrl)) ui.donate.href = data.donationUrl;
  } catch {
    ui.accessLine.textContent = "payment links unavailable";
  }
}

async function unlock() {
  const licenseKey = ui.license.value.trim();
  const email = ui.email.value.trim();
  if (!licenseKey) {
    ui.accessLine.textContent = "enter license key";
    return;
  }
  ui.unlock.disabled = true;
  ui.accessLine.textContent = "checking";
  try {
    const verdict = await licensePost("activate", {
      licenseKey,
      email,
      instanceName: instanceName()
    });
    if (!verdict.unlocked) {
      ui.accessLine.textContent = readableError(verdict.error);
      return;
    }
    storedAccess = {
      unlocked: true,
      licenseKey,
      email,
      provider: verdict.provider,
      status: verdict.licenseStatus || "active",
      instanceId: verdict.instanceId || instanceName()
    };
    localStorage.setItem(accessStore, JSON.stringify(storedAccess));
    ui.license.value = "";
    checkingAccess = false;
    paintAccess();
  } catch {
    ui.accessLine.textContent = "license check failed";
  } finally {
    ui.unlock.disabled = false;
  }
}

async function refreshAccess() {
  if (!storedAccess?.unlocked) {
    checkingAccess = false;
    paintAccess();
    return;
  }
  try {
    const verdict = await licensePost("validate", {
      licenseKey: storedAccess.licenseKey,
      email: storedAccess.email,
      instanceId: storedAccess.instanceId
    });
    if (!verdict.unlocked) {
      localStorage.removeItem(accessStore);
      storedAccess = null;
      stop();
    } else {
      storedAccess = {
        ...storedAccess,
        status: verdict.licenseStatus || storedAccess.status,
        instanceId: verdict.instanceId || storedAccess.instanceId
      };
      localStorage.setItem(accessStore, JSON.stringify(storedAccess));
    }
  } catch {
    localStorage.removeItem(accessStore);
    storedAccess = null;
    stop();
  } finally {
    checkingAccess = false;
    paintAccess();
  }
}

function clearAccess() {
  localStorage.removeItem(accessStore);
  storedAccess = null;
  stop();
  paintAccess();
}

function paintAccess() {
  const open = hasAccess();
  document.documentElement.dataset.access = open ? "subscribed" : "locked";
  ui.accessState.textContent = checkingAccess ? "checking license" : open ? "subscribed" : "license required";
  ui.accessLine.textContent = checkingAccess ? "checking license" : open ? "subscribed" : "license required";
  ui.clear.disabled = !open;
  ui.midi.disabled = !open;
  ui.save.disabled = !open;
}

function hasAccess() {
  return storedAccess?.unlocked === true;
}

function readAccess() {
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

function readableError(code) {
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
  if (!hasAccess()) {
    say("license required");
    return;
  }
  if (!navigator.requestMIDIAccess) {
    say("midi unavailable");
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    ui.midiOutput.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "none";
    ui.midiOutput.append(empty);
    for (const output of midiAccess.outputs.values()) {
      const option = document.createElement("option");
      option.value = output.id;
      option.textContent = output.name || output.id;
      ui.midiOutput.append(option);
    }
    say("midi ready");
  } catch {
    say("midi denied");
  }
}

function chooseMidiOutput() {
  midiOutput = midiAccess?.outputs.get(ui.midiOutput.value) ?? null;
}

function saveMidi() {
  if (!hasAccess()) {
    say("license required");
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
  say("midi saved");
}

function say(text) {
  ui.run.textContent = text;
}

function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function html(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
