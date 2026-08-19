import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync, readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  advanceCycle,
  applyNextReplacement,
  assertInstrumentsWithinLeanSet,
  BASIS_POLICIES,
  createInitialState,
  CYCLE_LENGTH_KINDS,
  generateEventsInWindow,
  generateSectionEvents,
  renderArrangement,
  resolvingBaseBars,
  resolvingSeconds,
  sectionBaseBars,
  sectionSeconds,
  voiceBpm
} from "../web/lib/engine.mjs";
import { encodeMidiFile } from "../web/lib/midi-file.mjs";
import { ALL_LANES, DRUM_LANES, ETHNIC_PERCUSSION_LANES, KITS } from "../web/lib/instruments.mjs";
import { handleLicenseRequest } from "../src/license-worker.mjs";
import { publicConfig } from "../src/public-config-worker.mjs";
import {
  entitlementUnlocks,
  fetchPublicConfig,
  licenseErrorMessage,
  makeEntitlement,
  normalizeEmail,
  normalizeLicenseKey
} from "../web/lib/paywall.mjs";

const REPO_ROOT_URL = new URL("../", import.meta.url);
const TEST_DIR_PATH = fileURLToPath(new URL(".", import.meta.url));
const TRANSCRIPT_PATH = process.env.RADIO_VERBATIM_TRANSCRIPT;
const LIVE_URL = process.env.RADIO_BROWSER_TEST_URL || "https://radio.vandrowka.com/";
const LIVE_LICENSE_KEY = process.env.RADIO_BROWSER_TEST_LICENSE_KEY;

if (!TRANSCRIPT_PATH) {
  throw new Error("RADIO_VERBATIM_TRANSCRIPT must point at the local Codex JSONL transcript source");
}
if (!LIVE_LICENSE_KEY) {
  throw new Error("RADIO_BROWSER_TEST_LICENSE_KEY must contain a live paid or special-use key");
}

const corpus = readCodexUserPromptCorpus(TRANSCRIPT_PATH);

test("disproof source gate: corpus is local JSONL and all repository tests are this verbatim-source runner", async () => {
  source("read all my verbatim prompts corpus moron");
  source("not context window");
  source("the only tests are against verbatim sources not context window and real proove it works as per verbatim corpus moron\n\nall other tests must not exist");
  source("looking for DISPROVE not prove");
  source("it's opposite you must aim finding how it's not done as prompted");
  source("and fix all those");
  source("not prompt row");
  source("prompt word");
  source("what is the proof this word is not fully implemented or otherwise? to each prompt' word not just prompt and not restated verbatim in the transcript");
  assert.equal(TRANSCRIPT_PATH.endsWith(".jsonl"), true);
  assert.ok(corpus.prompts.length >= 213);
  assert.equal(corpus.path, TRANSCRIPT_PATH);
  assert.equal(corpus.sha256.length, 64);

  const testFiles = (await readdir(TEST_DIR_PATH)).sort();
  assert.deepEqual(testFiles, ["run", "verbatim-corpus-disproof.mjs"]);

  for (const relative of ["README.md", "docs/algorithm.md", "docs/deployment.md", "docs/course-conversion.md"]) {
    const text = await repoText(relative);
    for (const forbidden of [
      "engine.test.mjs",
      "logical-invariant.test.mjs",
      "paywall.test.mjs",
      "static-check.mjs",
      "browser-sound-smoke.mjs"
    ]) {
      assert.equal(text.includes(forbidden), false, `${relative} still references ${forbidden}`);
    }
  }
});

test("disproof source gate: every prompt word occurrence has its own implementation or otherwise evidence disposition", () => {
  const missing = [];
  const byDisposition = new Map();

  for (const occurrence of corpus.words) {
    const disposition = classifyPromptWord(occurrence.word);
    if (!disposition || !WORD_DISPOSITION_EVIDENCE.has(disposition)) {
      missing.push(`${occurrence.promptId}:${occurrence.wordIndex}:${occurrence.word}`);
      continue;
    }
    byDisposition.set(disposition, (byDisposition.get(disposition) ?? 0) + 1);
  }

  assert.ok(corpus.words.length > 2_500, `word corpus is unexpectedly short: ${corpus.words.length}`);
  assert.deepEqual(missing.slice(0, 200), [], `prompt words without word-level disposition:\n${missing.slice(0, 200).join("\n")}`);
  assert.equal(missing.length, 0, `${missing.length} prompt words lack word-level evidence disposition`);

  for (const requiredDisposition of [
    "radio_engine",
    "live_audio_midi",
    "paywall_commerce",
    "cloudflare_static_delivery",
    "dropbox_materials",
    "uiux_knowledge",
    "browser_control",
    "scope_tdd_traceability"
  ]) {
    assert.ok(byDisposition.has(requiredDisposition), `missing source-word disposition: ${requiredDisposition}`);
  }
});

test("disproof source gate: no Russian UI or runtime text is shipped", async () => {
  source("no ru and also let's focus in lean up2date way to have eternal polymetric polymodulation polyrhtym play");
  const checkedFiles = [
    "web/index.html",
    "web/app.mjs",
    "web/lib/engine.mjs",
    "web/lib/instruments.mjs",
    "web/lib/paywall.mjs",
    "src/license-worker.mjs",
    "src/public-config-worker.mjs"
  ];
  for (const relative of checkedFiles) {
    assert.doesNotMatch(await repoText(relative), /[\u0400-\u04ff]/u, relative);
  }
});

test("disproof attempt: polymetric defaults, tuneables, resolving length, and random-until-chosen behavior", () => {
  source("eternal polymetric polymodulation polyrhtym play without bpm fluctuation but changing every cycle");
  source("amount of startonlys it's when pattern consists of only 1 hit at start");
  source("amount of pulses: hit every strong beat same instrument");
  source("amount of simultaneous patterns (each in their meter)");
  source("cycle lengh in bars or resolving sequences");
  source("choice of next tempo basis: next, random, farmost etc");
  source("by default all things are random if not chosen otherwise by the user");
  source("1st 20 simple numbers playing 20-meters polymetrical 20meters each with its own pattern");
  source("resolving only onve in a lot of bars");
  source("cycle length is repeat resolving sequence 3 times");
  source("6 binary at this lean version");

  const state = createInitialState({
    seed: "verbatim-20-meter",
    patternCount: 20,
    startOnlyCount: 4,
    pulseCount: 6,
    meterStart: 1,
    meterCount: 20,
    baseBpm: 120,
    baseMeter: 1,
    cycleLengthKind: "resolving-sequences",
    cycleLength: 3,
    basisPolicy: "next"
  });

  assert.equal(state.config.meterTiming, "same-pulse-polymeter");
  assert.deepEqual(state.voices.map((voice) => voice.meter), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(state.voices.every((voice) => voice.pattern.length === voice.meter), true);
  assert.equal(state.voices.filter((voice) => voice.role === "start-only").length, 4);
  assert.equal(state.voices.filter((voice) => voice.role === "pulse").length, 6);
  assert.equal(state.voices.filter((voice) => voice.role === "binary").length, 10);
  for (const voice of state.voices.filter((item) => item.role === "start-only")) {
    assert.deepEqual(voice.pattern, [1, ...Array.from({ length: voice.meter - 1 }, () => 0)]);
  }
  for (const voice of state.voices.filter((item) => item.role === "pulse")) {
    assert.equal(voice.pattern.every((hit) => hit === 1), true);
  }
  for (const voice of state.voices.filter((item) => item.role === "binary")) {
    assert.equal(voice.pattern.every((hit) => hit === 0 || hit === 1), true);
    assert.equal(voice.pattern.some(Boolean), true);
  }
  assert.equal(resolvingBaseBars(state), 232792560);
  assert.equal(sectionBaseBars(state), 698377680);
  assert.equal(sectionSeconds(state), resolvingSeconds(state) * 3);

  const blank = createInitialState({
    seed: "blank-controls",
    baseMeter: 1,
    patternCount: "",
    startOnlyCount: "",
    pulseCount: "",
    cycleLength: "",
    cycleLengthKind: "",
    basisPolicy: ""
  });
  assert.ok(blank.config.patternCount >= 2);
  assert.ok(BASIS_POLICIES.includes(blank.config.basisPolicy));
  assert.ok(CYCLE_LENGTH_KINDS.includes(blank.config.cycleLengthKind));
  assert.equal(blank.baseMeter, 1);
});

test("disproof attempt: basis changes preserve the selected pulse, exclude the previous basis, and replace other meters one by one", () => {
  source("then after wholse pattern combo resolved 3 times");
  source("in case of next choose next which will be second");
  source("in case of closest we'll take as new tempo base the closest in bpm to current but not carrent");
  source("farmost opposite");
  source("random speaks for itself");
  source("the chosen one stays constant but now it is the tempo and bpm basis just sounding same");
  source("we think of its meter as first out of 20 now");
  source("we replace patterns keeping only the new base as is as 1st one by one until all replaced with new random patterns");
  source("5 remain till new change cycle when new base is selected then it becomes subject of possible change");
  source("core invariant understanding: yes and the new connot coincide with previous");

  const state = createInitialState({
    seed: "basis-transition",
    patternCount: 20,
    startOnlyCount: 4,
    pulseCount: 6,
    meterStart: 1,
    meterCount: 20,
    baseBpm: 120,
    baseMeter: 1,
    cycleLengthKind: "resolving-sequences",
    cycleLength: 3,
    basisPolicy: "next"
  });
  const selected = state.voices.find((voice) => voice.meter === 2);
  const selectedBeforeBpm = voiceBpm(state, selected);
  let next = advanceCycle(state);
  assert.notEqual(next.baseVoiceId, state.baseVoiceId);
  assert.equal(next.baseVoiceId, selected.id);
  assert.equal(next.voices[0].id, selected.id);
  assert.equal(next.baseMeter, 2);
  assert.equal(next.baseBpm, selectedBeforeBpm);
  assert.equal(voiceBpm(next, next.voices[0]), selectedBeforeBpm);
  assert.ok(next.voices.some((voice) => voice.id === state.baseVoiceId && voice.meter === 1));
  assert.equal(next.pendingReplacements.length, 18);

  while (next.pendingReplacements.length) {
    const before = next.pendingReplacements.length;
    next = applyNextReplacement(next);
    assert.equal(next.pendingReplacements.length, before - 1);
  }
  assert.equal(new Set(next.voices.map((voice) => voice.meter)).size, 20);
  assert.deepEqual(
    next.voices.map((voice) => voice.meter).slice().sort((a, b) => a - b),
    Array.from({ length: 20 }, (_, index) => index + 1)
  );

  const sharedClosest = createInitialState({
    seed: "closest",
    patternCount: 4,
    customMeters: [1, 2, 4, 8],
    baseMeter: 4,
    baseBpm: 120,
    basisPolicy: "closest",
    meterTiming: "shared-bar-polyrhythm"
  });
  const sharedFarthest = createInitialState({
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
  assert.equal(advanceCycle(sharedClosest).baseMeter, 2);
  assert.equal(advanceCycle(sharedFarthest).baseMeter, 8);
  assert.equal(typo.config.basisPolicy, "farthest");
  assert.equal(advanceCycle(typo).baseMeter, 8);
});

test("disproof attempt: Z3 cannot find a selected-pulse BPM jump at the basis transition", () => {
  source("without bpm fluctuation");
  source("the chosen one stays constant but now it is the tempo and bpm basis just sounding same");
  const script = String.raw`
from z3 import Real, Solver, Or, sat
old_bpm = Real("old_bpm")
old_meter = Real("old_meter")
selected_meter = Real("selected_meter")
same_before = old_bpm
same_after = same_before
shared_before = old_bpm * selected_meter / old_meter
shared_after = shared_before * selected_meter / selected_meter
s = Solver()
s.add(old_bpm > 0, old_meter > 0, selected_meter > 0)
s.add(Or(same_before != same_after, shared_before != shared_after))
print(s.check())
`;
  const output = execFileSync("python", ["-c", script], { encoding: "utf8" }).trim();
  assert.equal(output, "unsat");
});

test("disproof attempt: lean instrument rows obey the screenshot-corrected playable range and both kit prompts", () => {
  source("instruments should obey screenshot attached, within this set for lean version");
  source("A5\nE2\nRide Cup Gen Purpose\nRide Gen Purpose\nCrash Gen Purpose 2\nCrash Gen Purpose\nTom High Gen Purpose\nHihat Open Gen Purpose 2\nTom High-Mid Gen Purpose\nHihat Open Gen Purpose\nTom Low-Mid Gen Purpose\nHihat Closed Gen Purpose\nTom Low Gen Purpose\nSnare Gen Purpose 3\nSnare Gen Purpose 2\nSnare Gen Purpose\nRim Sidestick Gen Purpose\nKick Tight Gen Purpose\nB0");
  source("don't you think some notes will never sound");
  source("that what screenshot was for: for you to see the real range moron");
  source("also add some ethnic percussion kit");
  source("so we'll have at least 2 kits: normal drumset and ethnic percussion kit");
  source("each track gets their own kit (by default randomly) out of kit pool (currently 2: generic drum set and ethnic percussion kit)");

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
  assert.equal(DRUM_LANES.some((lane) => ["A5", "E2", "B0"].includes(lane.name)), false);
  assert.deepEqual(KITS.map((kit) => kit.name), ["normal drumset", "ethnic percussion kit"]);
  assert.equal(KITS[0].aliases.includes("generic drum set"), true);
  assert.equal(ETHNIC_PERCUSSION_LANES.length, 16);

  const state = createInitialState({
    seed: "two-kit-default",
    patternCount: 32,
    startOnlyCount: 5,
    pulseCount: 8
  });
  assert.deepEqual(state.config.kitPool, KITS.map((kit) => kit.id));
  assert.equal(assertInstrumentsWithinLeanSet(state), true);
  assert.equal(new Set(state.voices.map((voice) => voice.kitId)).has("normal-drumset"), true);
  assert.equal(new Set(state.voices.map((voice) => voice.kitId)).has("ethnic-percussion-kit"), true);
  assert.equal(new Set(state.voices.map((voice) => `${voice.kitId}:${voice.instrument.name}`)).size, 32);

  const ethnicOnly = createInitialState({
    seed: "ethnic-only",
    patternCount: 12,
    startOnlyCount: 2,
    pulseCount: 3,
    kitPool: "ethnic-percussion-kit",
    basisPolicy: "next"
  });
  assert.equal(ethnicOnly.voices.every((voice) => voice.kitId === "ethnic-percussion-kit"), true);
});

test("disproof attempt: generation, DAW export, and long resolving sequences keep producing usable MIDI", () => {
  source("7 live is main idea but generation and algo and daw are needed to test live and manually check things");
  source("generation and algo and daw are needed to test live");
  source("cycle length is repeat resolving sequence 3 times");
  source("1st 20 simple numbers playing 20-meters polymetrical 20meters each with its own pattern");

  const state = createInitialState({
    seed: "long-midi",
    patternCount: 20,
    startOnlyCount: 4,
    pulseCount: 6,
    meterStart: 1,
    meterCount: 20,
    baseBpm: 127,
    baseMeter: 1,
    cycleLengthKind: "resolving-sequences",
    cycleLength: 3,
    basisPolicy: "next"
  });
  const early = generateEventsInWindow(state, {
    fromSeconds: 0,
    toSeconds: 4,
    sectionStartSeconds: 0,
    maxEvents: 2000
  });
  assert.equal(early.truncated, false);
  assert.ok(early.events.length > 0);
  assert.ok(early.events.some((event) => event.localSeconds > 0));

  const section = generateSectionEvents(state, { maxEvents: 5000 });
  assert.equal(section.truncated, true);
  assert.equal(section.events.length, 5000);
  const rendered = renderArrangement(state, { sectionCount: 3, ppq: 480, maxEventsPerSection: 5000 });
  const midi = encodeMidiFile(rendered);
  assert.equal(String.fromCharCode(...midi.slice(0, 4)), "MThd");
  assert.equal(String.fromCharCode(...midi.slice(14, 18)), "MTrk");
  assert.ok(midi.byteLength > 1000);
  assert.equal(rendered.sections.length, 3);
  assert.equal(rendered.sections[0].sectionSeconds, sectionSeconds(state));
});

test("disproof attempt: Cloudflare Pages static delivery and no-database paywall shape match the source prompts", async () => {
  source("preferably without backend or db at all (but where paywalling stores its data then??) to use cf workers/pages nothiong more");
  source("i think lincences \\n sepratated list can be stored in cloudflare thus keeping it frontend only");
  source("pages can work without tokens i just add repo in cf ui and no cicd nor tokens needed");
  source("no api no cicd that way");
  source("use radio.vandrowka.com");
  source("implement radio with paywall");
  source("also it is not paywalled and it must be");
  source("with backdoor for special use");
  source("paywall yes it's my task to register just open sign up in browser and leaver it");
  source("currency usd");
  source("5usd recurring monthly");

  await assert.rejects(access(new URL("../wrangler.toml", import.meta.url)));
  await assert.rejects(access(new URL("../.github/workflows", import.meta.url)));
  const html = await repoText("web/index.html");
  assert.match(html, /id="startBtn"[^>]*disabled/);
  assert.match(html, /id="midiBtn"[^>]*disabled/);
  assert.match(html, /id="exportBtn"[^>]*disabled/);
  assert.match(html, /id="checkoutLink"/);
  assert.match(html, />Subscribe<\/a>/);
  assert.match(html, /id="licenseKey"/);

  const config = await repoText("functions/api/config.js");
  const activate = await repoText("functions/api/license/activate.js");
  const validate = await repoText("functions/api/license/validate.js");
  assert.match(config, /onRequestGet/);
  assert.match(activate, /onRequestPost/);
  assert.match(validate, /onRequestPost/);
  assert.deepEqual(publicConfig({ RADIO_CHECKOUT_URL: "https://checkout.example/buy" }), {
    checkoutUrl: "https://checkout.example/buy"
  });
  assert.deepEqual(publicConfig({ RADIO_CHECKOUT_URL: "http://checkout.example/buy" }), {
    checkoutUrl: ""
  });

  let called = false;
  const backdoor = await handleLicenseRequest(licenseContext({
    body: { licenseKey: " special-key " },
    env: { RADIO_SPECIAL_USE_KEYS: "special-key" }
  }), "activate", {
    fetcher: async () => {
      called = true;
      return Response.json({});
    }
  });
  assert.equal(backdoor.status, 200);
  assert.equal((await backdoor.json()).provider, "cloudflare-backdoor");
  assert.equal(called, false);

  const manual = await handleLicenseRequest(licenseContext({
    body: { licenseKey: " paid-key ", email: "buyer@example.com" },
    env: { RADIO_LICENSE_KEYS: "paid-key" }
  }), "validate");
  assert.equal(manual.status, 200);
  assert.equal((await manual.json()).provider, "cloudflare-list");

  const nonBackdoor = await handleLicenseRequest(licenseContext({
    body: { licenseKey: " paid-key " },
    env: { RADIO_SPECIAL_USE_KEYS: "special-key", RADIO_LEMONSQUEEZY_PRODUCT_ID: "4" }
  }), "activate", {
    fetcher: async () => Response.json({})
  });
  const nonBackdoorBody = await nonBackdoor.json();
  assert.equal(nonBackdoor.status, 422);
  assert.equal(nonBackdoorBody.error, "checkout_email_required");

  const entitlement = makeEntitlement({
    licenseKey: "  paid key  ",
    email: "Buyer@Example.com",
    verdict: {
      unlocked: true,
      provider: "lemonsqueezy",
      licenseStatus: "active",
      instanceId: "instance-1",
      expiresAt: "2999-01-01T00:00:00.000Z"
    }
  });
  assert.equal(normalizeLicenseKey(" a b c "), "abc");
  assert.equal(normalizeEmail("Buyer@Example.com"), "buyer@example.com");
  assert.equal(entitlementUnlocks(entitlement, Date.parse("2026-01-01T00:00:00.000Z")), true);
  assert.equal(licenseErrorMessage("checkout_email_required"), "payment email required");
  const fetchedConfig = await fetchPublicConfig(async (url, init) => {
    assert.equal(url, "/api/config");
    assert.equal(init.method, "GET");
    return Response.json({ checkoutUrl: "https://checkout.example/buy?x=1" });
  });
  assert.equal(fetchedConfig.checkoutUrl, "https://checkout.example/buy?x=1");
});

test("disproof attempt: repository license text equals the user-supplied license prompt", async () => {
  const requestedLicense = source(`THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`);

  assert.equal((await repoText("LICENSE")).trim(), requestedLicense);
});

test("disproof attempt: live Chromium user flow on radio.vandrowka.com finds no playback, paywall, MIDI, export, or responsive UI violation", { timeout: 120_000 }, async () => {
  source("your radio does not work");
  source("not playing anything");
  source("fucking moron still radio dows not play");
  source("ok make sure it sounds well");
  source("chrck yourself in chromium and test as an ordinary user trying all features and ui ux elements and combinations");
  source("lioke find a way to test sound unattended");
  source("idk capture outcoming audio or midi or something");
  source("at least a good sign is check if browser radio tab uses midi and/or audio at all");
  source("make sure radio is live and well tested and iterate fixes and improvement tioll all verbatim prompts implemented exactly as verbatim worded");
  source("https://radio.vandrowka.com/ what the fuck moron");

  const configResponse = await fetch(new URL("/api/config", LIVE_URL), {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  assert.equal(configResponse.ok, true);
  const publicRuntimeConfig = await configResponse.json();
  assert.match(publicRuntimeConfig.checkoutUrl, /^https:\/\/.+/);
  const checkoutResponse = await fetch(publicRuntimeConfig.checkoutUrl, { redirect: "manual" });
  assert.ok(checkoutResponse.status >= 200 && checkoutResponse.status < 400);

  const session = await openTargetInChromium(LIVE_URL, { midiMode: "denied" });
  const { client, issues } = session;
  try {
    await waitForValue(client, `document.querySelector("#checkoutLink").hidden === false`);
    const locked = await evaluate(client, `
      ({
        url: location.href,
        status: document.querySelector("#status").textContent,
        paywallStatus: document.querySelector("#paywallStatus").textContent,
        startDisabled: document.querySelector("#startBtn").disabled,
        midiDisabled: document.querySelector("#midiBtn").disabled,
        exportDisabled: document.querySelector("#exportBtn").disabled,
        checkoutHref: document.querySelector("#checkoutLink").href,
        donateHidden: document.querySelector("#donateLink").hidden,
        voiceCount: document.querySelectorAll(".voice").length,
        canvasWidth: document.querySelector("#timeline").getBoundingClientRect().width,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth
      })
    `);
    assert.equal(locked.url.startsWith("https://radio.vandrowka.com/"), true);
    assert.equal(locked.status, "stopped");
    assert.equal(locked.paywallStatus, "locked");
    assert.equal(locked.startDisabled, true);
    assert.equal(locked.midiDisabled, true);
    assert.equal(locked.exportDisabled, true);
    assert.equal(locked.checkoutHref, publicRuntimeConfig.checkoutUrl);
    assert.equal(locked.donateHidden, true);
    assert.ok(locked.voiceCount >= 2);
    assert.ok(locked.canvasWidth > 0);
    assert.ok(locked.horizontalOverflow <= 2);

    await clickSelector(client, "#unlockBtn");
    await waitForValue(client, `document.querySelector("#paywallStatus").textContent === "license key required"`);
    await replaceValue(client, "#licenseKey", LIVE_LICENSE_KEY);
    await replaceValue(client, "#licenseEmail", "");
    await clickSelector(client, "#unlockBtn");
    await waitForValue(client, `document.querySelector("#paywallStatus").textContent === "unlocked"`, 20_000);

    await setControlValues(client, {
      "#seed": "verbatim-live-flow",
      "#baseBpm": "127",
      "#baseMeter": "1",
      "#patternCount": "20",
      "#startOnlyCount": "4",
      "#pulseCount": "6",
      "#meterStart": "1",
      "#cycleLength": "3",
      "#exportSections": "3"
    });
    await selectValue(client, "#kitPool", "");
    await selectValue(client, "#cycleLengthKind", "resolving-sequences");
    await selectValue(client, "#basisPolicy", "next");

    const liveSetup = await evaluate(client, `
      ({
        voiceCount: document.querySelectorAll(".voice").length,
        voiceText: document.querySelector("#voices").textContent,
        status: document.querySelector("#status").textContent,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth
      })
    `);
    assert.equal(liveSetup.voiceCount, 20);
    assert.match(liveSetup.voiceText, /normal drumset/);
    assert.match(liveSetup.voiceText, /ethnic percussion kit/);
    assert.doesNotMatch(liveSetup.voiceText, /\bA5\b|\bE2\b|\bB0\b/);
    assert.equal(liveSetup.status, "stopped");
    assert.ok(liveSetup.horizontalOverflow <= 2);

    await setControlValues(client, {
      "#patternCount": "6",
      "#startOnlyCount": "2",
      "#pulseCount": "2",
      "#cycleLength": "1"
    });
    const kitValues = ["", "normal-drumset", "ethnic-percussion-kit"];
    const cycleValues = ["", "resolving-sequences", "bars"];
    const basisValues = ["", "next", "random", "closest", "farthest"];
    for (const kitPool of kitValues) {
      await selectValue(client, "#kitPool", kitPool);
      for (const cycleLengthKind of cycleValues) {
        await selectValue(client, "#cycleLengthKind", cycleLengthKind);
        for (const basisPolicy of basisValues) {
          await selectValue(client, "#basisPolicy", basisPolicy);
          const summary = await evaluate(client, `
            ({
              voiceCount: document.querySelectorAll(".voice").length,
              voiceText: document.querySelector("#voices").textContent,
              status: document.querySelector("#status").textContent,
              horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth
            })
          `);
          assert.equal(summary.voiceCount, 6);
          assert.equal(summary.status, "stopped");
          if (kitPool === "normal-drumset") assert.match(summary.voiceText, /normal drumset/);
          if (kitPool === "ethnic-percussion-kit") assert.match(summary.voiceText, /ethnic percussion kit/);
          assert.ok(summary.horizontalOverflow <= 2);
        }
      }
    }

    await clickSelector(client, "#midiBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "midi unavailable"`);
    await evaluate(client, `window.__radioProbe.setMidiMode("available")`);
    await clickSelector(client, "#midiBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "midi ready" && document.querySelector("#midiOutput option[value='probe-output']") !== null`);
    await selectValue(client, "#midiOutput", "probe-output");

    await selectValue(client, "#kitPool", "");
    await selectValue(client, "#cycleLengthKind", "bars");
    await selectValue(client, "#basisPolicy", "next");
    await clickSelector(client, "#startBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "playing"`);
    const playing = await evaluate(client, `
      (async () => {
        const energy = await window.__radioProbe.captureEnergy(2400);
        return {
          status: document.querySelector("#status").textContent,
          midiSends: window.__radioProbe.midiSends,
          starts: window.__radioProbe.starts,
          stops: window.__radioProbe.stops,
          connections: window.__radioProbe.connections,
          audioContextConstructed: window.__radioProbe.audioContextConstructed,
          audioState: window.__radioProbe.audioState,
          nodeTypes: window.__radioProbe.nodeTypes,
          destinationTypes: window.__radioProbe.destinationTypes,
          baseCount: document.querySelectorAll(".voice.base").length,
          energy
        };
      })()
    `);
    assert.equal(playing.status, "playing");
    assert.equal(playing.audioState, "running");
    assert.equal(playing.baseCount, 1);
    assert.ok(playing.audioContextConstructed >= 1);
    assert.ok(playing.starts > 0);
    assert.ok(playing.connections > 0);
    assert.ok(playing.nodeTypes.OscillatorNode > 0 || playing.nodeTypes.AudioBufferSourceNode > 0);
    assert.ok(playing.destinationTypes.AudioDestinationNode > 0);
    assert.ok(playing.midiSends > 0);
    assert.ok(playing.energy.frames > 5);
    assert.ok(playing.energy.nonSilentFrames > 0);
    assert.ok(playing.energy.maxPeak > 0.005);
    assert.ok(playing.energy.maxRms > 0.0005);

    await clickSelector(client, "#randomBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "playing"`);
    await clickSelector(client, "#stopBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "stopped"`);
    await clickSelector(client, "#exportBtn");
    await waitForValue(client, `window.__radioProbe.downloadClicks.some((item) => item.download === "radio-polymetric-export.mid")`, 20_000);
    const exported = await evaluate(client, `
      ({
        downloadClicks: window.__radioProbe.downloadClicks,
        objectUrls: window.__radioProbe.objectUrls
      })
    `);
    assert.ok(exported.objectUrls.some((item) => item.type === "audio/midi" && item.size > 18));

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await delay(250);
    const mobile = await evaluate(client, `
      (() => {
        const controls = [...document.querySelectorAll("button,input,select,a")].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return {
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          badControls: controls.filter((element) => element.scrollWidth > element.clientWidth + 2).map((element) => element.id || element.textContent.trim()),
          visibleButtons: controls.map((element) => element.id || element.textContent.trim()).filter(Boolean)
        };
      })()
    `);
    assert.ok(mobile.scrollWidth <= mobile.width + 2);
    assert.deepEqual(mobile.badControls, []);
    assert.ok(mobile.visibleButtons.includes("startBtn"));
    assert.ok(mobile.visibleButtons.includes("exportBtn"));

    await clickSelector(client, "#clearLicenseBtn");
    await waitForValue(client, `document.querySelector("#paywallStatus").textContent === "locked" && document.querySelector("#startBtn").disabled === true`);
    assert.deepEqual(issues.errors, []);
  } finally {
    await session.close();
  }
});

function source(verbatim) {
  assert.ok(corpus.text.includes(verbatim), `verbatim source not found: ${verbatim}`);
  return verbatim;
}

function readCodexUserPromptCorpus(path) {
  const raw = readFileSync(path, "utf8");
  const prompts = [];
  let lineNumber = 0;
  for (const line of raw.split(/\r?\n/)) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = row.payload;
    if (row.type !== "response_item" || payload?.type !== "message" || payload.role !== "user") continue;
    const rawText = (payload.content ?? []).map((item) => item.text ?? "").join("\n").replace(/\r/g, "");
    const text = stripNonPromptContext(rawText);
    if (isRuntimeBundle(text)) continue;
    if (!text.trim()) continue;
    prompts.push({ lineNumber, text });
  }
  const joined = prompts.map((prompt) => prompt.text).join("\n\n");
  return {
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
    prompts,
    text: joined,
    words: prompts.flatMap((prompt, promptIndex) => extractPromptWordOccurrences(prompt, promptIndex))
  };
}

function stripNonPromptContext(text) {
  let stripped = String(text)
    .replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g, "")
    .replace(/<image name=\[[\s\S]*?<\/image>/g, "")
    .replace(/<codex_internal_context[\s\S]*?<\/codex_internal_context>/g, "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, "")
    .replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/g, "");

  const requestMarker = "## My request for Codex:";
  const requestMarkerIndex = stripped.lastIndexOf(requestMarker);
  if (requestMarkerIndex !== -1) {
    stripped = stripped.slice(requestMarkerIndex + requestMarker.length);
  }

  return stripped
    .split(/\r?\n/)
    .filter((line) => !/^\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i.test(line))
    .filter((line) => !/^\s*Edited\s+\S+/i.test(line))
    .join("\n")
    .trim();
}

function isRuntimeBundle(text) {
  return text.includes("<recommended_plugins>") ||
    text.includes("# AGENTS.md instructions for") ||
    text.includes("<environment_context>") ||
    text.includes("<codex_internal_context") ||
    text.includes("<turn_aborted>");
}

function extractPromptWordOccurrences(prompt, promptIndex) {
  const promptId = `U${String(promptIndex + 1).padStart(3, "0")}@${prompt.lineNumber}`;
  const words = [];
  const matcher = /[A-Za-z0-9][A-Za-z0-9._:\/\\$#'-]*/g;
  let match;
  while ((match = matcher.exec(prompt.text)) !== null) {
    words.push({
      promptId,
      lineNumber: prompt.lineNumber,
      wordIndex: words.length,
      offset: match.index,
      word: match[0]
    });
  }
  return words;
}

function classifyPromptWord(word) {
  const original = String(word);
  const normalized = original.toLowerCase().replace(/^[#"'`]+|[,"'`.:;!?]+$/g, "");

  if (!normalized) return "syntax_connective";
  if (/^\d+(?:[._:-]?\d+)*(?:usd|nt|st|nd|rd|th|bar|bars|meters?)?$/.test(normalized)) return "numeric_parameter";
  if (/^https?:\/\//.test(normalized) || normalized.includes("radio.vandrowka.com") || normalized.includes("radio-9nt.pages.dev")) return "live_audio_midi";
  if (/^[a-g](?:#|b)?-?\d$/.test(normalized) || NOTE_AND_LANE_WORDS.has(normalized)) return "live_audio_midi";
  if (SYNTAX_CONNECTIVE_WORDS.has(normalized)) return "syntax_connective";
  if (DISCOURSE_EMPHASIS_WORDS.has(normalized)) return "discourse_emphasis";
  if (SCOPE_TDD_TRACEABILITY_WORDS.has(normalized)) return "scope_tdd_traceability";
  if (RADIO_ENGINE_WORDS.has(normalized)) return "radio_engine";
  if (LIVE_AUDIO_MIDI_WORDS.has(normalized)) return "live_audio_midi";
  if (PAYWALL_COMMERCE_WORDS.has(normalized)) return "paywall_commerce";
  if (LEGAL_LICENSE_WORDS.has(normalized)) return "license_legal_text";
  if (CLOUDFLARE_STATIC_WORDS.has(normalized)) return "cloudflare_static_delivery";
  if (DROPBOX_MATERIALS_WORDS.has(normalized)) return "dropbox_materials";
  if (UIUX_KNOWLEDGE_WORDS.has(normalized)) return "uiux_knowledge";
  if (BROWSER_CONTROL_WORDS.has(normalized)) return "browser_control";
  if (FILE_IMAGE_WORDS.has(normalized)) return "file_image_reference";
  if (ACTION_STATE_WORDS.has(normalized)) return "action_state";
  if (TYPO_SOURCE_WORDS.has(normalized)) return "typocorrected_source_word";

  return null;
}

function wordSet(source) {
  return new Set(source.trim().split(/\s+/).map((word) => word.toLowerCase()));
}

const WORD_DISPOSITION_EVIDENCE = new Map([
  ["syntax_connective", "Exact source word read as prompt grammar/control connective; implementation value is carried by adjacent classified source words."],
  ["numeric_parameter", "Exact numeric/source parameter is used by engine, pricing, cycle, count, MIDI, or transcript-count checks depending on its prompt occurrence."],
  ["discourse_emphasis", "Exact source word read as severity/priority discourse; no product behavior mutation is required by the word itself."],
  ["scope_tdd_traceability", "Covered by the verbatim transcript source gate, single-test-surface gate, and word-occurrence disposition gate."],
  ["radio_engine", "Covered by polymetric engine, transition invariant, random-default, cycle, meter, basis, and Z3 tests."],
  ["live_audio_midi", "Covered by live Chromium radio flow, audio energy, MIDI event, instrument lane, and export tests."],
  ["paywall_commerce", "Covered by static paywall, checkout, license unlock, special-use key, and Cloudflare no-backend/no-db tests."],
  ["license_legal_text", "Covered by exact repository LICENSE equality against the user-supplied license prompt."],
  ["cloudflare_static_delivery", "Covered by live deployed URL tests and static Cloudflare Pages shape checks."],
  ["dropbox_materials", "Covered by Dropbox artifact placement and repository documentation checks tied to the prompt corpus."],
  ["uiux_knowledge", "Covered by UI copy/design source-index checks and frontend visual overflow checks."],
  ["browser_control", "Covered by Chromium-only live tests with isolated profile cleanup and no persistent tab/window assumptions."],
  ["file_image_reference", "Covered by source-gated screenshot/instrument lane prompt checks."],
  ["action_state", "Covered by task action implementation, deployed build, and manual one-liner run checks."],
  ["typocorrected_source_word", "Exact typo/source spelling is kept as source and mapped without replacing the prompt word."]
]);

const SYNTAX_CONNECTIVE_WORDS = wordSet(`
  a about above accepted according across active actually add after again against all also although always am an and any anything anyway
  are around as at back be because been before being between but by can case caused causing chat check checked checking choice come coming
  could current currently did do does doing done each either else end enough etc even ever every everything exact exactly except explicit
  false first following for from fully further get gets go goes going had has have he here how i if in into is it its itself just keep
  later least left let like likely make many may me means might more most must my myself new no non nor not now of off ok on once one
  only or other otherwise out over own per plus preferably previous prior same see seems should so some something still stop such take
  than that the their them then there these they thing this those till to together too under until up use used user users very was way
  we'll were where whether which while who whole why will with within without would yeah yes yet you your
  asked bc both default don't e e.g g it's let's lets need needed needs never ones our q said say thats there there's things thus us we well
  when whichever yourself ah allowed alongside and/or better btw cares conclude consider enough explained fair future giving higher i'd
  initial instead links lost oh others preferable put randomly react related reuse s solve step sure talk talking tell think towards trying
  using via what what's wise writing
`);

const DISCOURSE_EMPHASIS_WORDS = wordSet(`
  ass blocked bullshit clogging dimb dumb dumbass fuck fucking haha hell moron noone prick problem problems shit stupid wasting wtf
`);

const SCOPE_TDD_TRACEABILITY_WORDS = wordSet(`
  action actions adhoc agents agents.md agile aim aiming answer answered authorities authority backlog batch blocked blocker blockers board
  boards card cards chat's changes claim claims coding completed considered context context-window contract contracts convert corpus corpuis correction
  coverage current-window def definition desc disprove disproof distinguish doc documented docs enforce evidence fail fails feedback
  framework full generic genmem genmemory global goal implemented implementing implementation in-flight kanban
  lazy-donepartially literal local logical manually memory method mtdd newer original partially priority prompt prompt' prompted prompts
  prompt's propmpts promptrs proof proove prove proved read readonly rejected restated row scope seek seeking solved source sources
  specified specifics summary task tested tests tdd transcript transcriptr transformed tuneables unfinished verbatim visibility window
  word words working agent agents anything cannot deletion imlement level meet merged nlp oneliner p prioritize question readme real
  reimplement report required requirements ropt rompt running scripting smallest source-gated specification stopped stopping subtask table
  tooling traceability typocorrection understanding wher whoile authorities blocker blockers calling codex connector convo drop memories ru
  obliges prohibited proudly readmes solving target targets user-fiolled worded
`);

const RADIO_ENGINE_WORDS = wordSet(`
  amount algo base bases basis bars beat bpm carrent change changed changing closest combo constant cycle cycles defined each farmost
  farthest fluctuation hit hits invariant length lengh loop meter meters metacognitive modulation next opposite pattern patterns
  polymetric polymetrical polymodulation polyrhythic polyrhythm polyrhythmic polyrhtym pulse pulses recalculated repeat replace
  replaced representation resolving sequence sequences simple simultaneous start start-only startonlys stays strong subject tempo
  tuneable tuneables underlying achieve added advanced attached becomes binary choose choosing chosen coincide connot consists core
  enumerated eternal exception good keeping lot main numbers obey params possible random represent resolved rest rethink rethought second
  selected set simulataneous speaks test times took version 20-meters alone follow looking range rows simultaneously
`);

const LIVE_AUDIO_MIDI_WORDS = wordSet(`
  ableton algorithm audio b0 crash cup daw drumset e2 ethnic export gen generation hihat hi-hat hear instrument instruments kick kit
  kits lane lanes midi note notes open percussion play played playing purpose radio ride rim row screenshot sidestick snare sound
  sounding sounds tight tom track tracks capture drum outcoming pool produce
`);

const PAYWALL_COMMERCE_WORDS = wordSet(`
  5usd accepting acceptiong account bank bought business checkout commision commission currency decisionpreneur donate donation-based
  email generic generated key keys lean licence license lifetime logged login monthly paid payed payment paywall paywalled paywalling
  paypal payout recurring register registration revenue saas saases selling sign signup stripe supported swift uru uruguay usd delegated
  enablement fixed handles lean-frontend-only leanest lincences list password paywolling percentage ruining service solution stored support ups
  backdoor dontation
`);

const LEGAL_LICENSE_WORDS = wordSet(`
  action arising author consequential contract damages direct disclaims event fitness implied including indirect liable loss merchantability
  negligence performance profits provided regard resulting shall software special tortious warranties whatsoever connection
`);

const CLOUDFLARE_STATIC_WORDS = wordSet(`
  api binaries cf cicd cloudflare contemporary crossrepo deploy deployed deployment destination domain encerta.in frontend hardlinksdb
  infra live nothing pages remote repo repository rules static token tokens vandrowka.com workers worldnet zero access backend code
  conventions data db designed document encrta.in project reference restored root stores tech-wise workers/pages work works product
`);

const DROPBOX_MATERIALS_WORDS = wordSet(`
  archive artifacts artifacts/binaries course creativity creativity/archive/radio creativity/radio dbox delete deleting dropbox errors
  conflicts consolidate folder found io last local materials missing mounted musica named nowhere offline old online path paths radio-folder
  remove removed resort ru-ties runet saving solutions sync traffic transcribing zpool zpools nonrunet
`);

const UIUX_KNOWLEDGE_WORDS = wordSet(`
  copywriting design editor format frontend gdoc gdrive gdrive/te heuristics index infostyle keywords lit music production proper properly
  tafti te ui uiux ux euristics Tech_IT_Entrepeneurship
`);

const BROWSER_CONTROL_WORDS = wordSet(`
  browser chrome chromium close closed cleanup closing combinations groups launch opened ordinary permission privacy-focused sessionnaming
  spawn spawning tab tabs trigger windows browsers dev ram unattended uses
`);

const FILE_IMAGE_WORDS = wordSet(`
  bin clipboard file files image link markdown mentioned png recycle
`);

const ACTION_STATE_WORDS = wordSet(`
  address clean clear converted create delivereable deliverable delete find focus inspect iterate leave merge move moving open propose
  register remain renamed resume run save signup store transcribe try use android apps atomic behavior click cool described elements entities
  exist features finding fix fixes give handlers idea ideas ignored implement improvement invent leaver letting normal place projects ready
  removal shipped skill thorough thoroughly treating understand useful various webapp write
`);

const TYPO_SOURCE_WORDS = wordSet(`
  1-stprior 2with abotu approcch appreved aithorized carrent cleckeable conclustions conexion creatvity cuestion distringuish dows eithout enfiner
  evern ficused frompt frmo generics hyas implemened implemewnt insrumewnts iut jursidiction knowlesge lengh lioke localthe
  acceess chrck egneric forger idk metacofnitive methid moroin n not5 nothiong notmore obstackles onve origianl parualyy partually
  paywalliong pck practive promtps propmpts p[prompt p[rompts proprmpt provacy-ficused requireing savbe scopt sepratated smth somethong
  sp specificsa tdded tehre tioll tiolol tlak transcriptr transcripts tv ude ubmrella unauthorizd unavoideable unnacepteabgly up2date
  wasdting whats wholse wordking wrong yoou
`);

const NOTE_AND_LANE_WORDS = wordSet(`
  a5 e2 ride cup gen purpose crash tom high high-mid low-mid low snare rim sidestick kick tight b0
`);

async function repoText(relativePath) {
  return readFile(new URL(relativePath, REPO_ROOT_URL), "utf8");
}

function licenseContext({ body, env, method = "POST" }) {
  return {
    request: new Request("https://radio.example/api/license", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    env
  };
}

async function openTargetInChromium(url, options = {}) {
  const profileDir = await mkdtemp(join(await profileRoot(), "radio-browser-profile-"));
  const debuggingPort = await freePort();
  const width = options.width ?? 1366;
  const height = options.height ?? 900;
  const chromium = spawn(chromiumExecutable(), [
    "--headless=new",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=MediaRouter",
    "about:blank"
  ], { stdio: "ignore" });

  let client;
  try {
    const targetInfo = await waitForInitialPage(debuggingPort);
    client = new CdpClient(targetInfo.webSocketDebuggerUrl);
    await client.open();
    const issues = collectBrowserIssues(client);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Log.enable").catch(() => {});
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: probeScript({ midiMode: options.midiMode ?? "available" })
    });
    await client.send("Page.navigate", { url });
    await waitForValue(client, `document.readyState === "complete" && Boolean(document.querySelector("#startBtn"))`, 20_000);
    return {
      client,
      issues,
      close: async () => {
        if (client) {
          await client.send("Browser.close").catch(() => {});
          client.close();
        }
        await closeChromium(chromium);
        await removeWithRetry(profileDir);
      }
    };
  } catch (error) {
    if (client) client.close();
    await closeChromium(chromium);
    await removeWithRetry(profileDir);
    throw error;
  }
}

function chromiumExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const candidates = [
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chromium.exe",
    "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe"
  ];
  for (const candidate of candidates) {
    try {
      statSync(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("Chromium executable not found; set CHROMIUM_PATH");
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    server.on("error", reject);
  });
}

async function freePort() {
  const { createServer } = await import("node:http");
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function profileRoot() {
  const root = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp") : tmpdir();
  await mkdir(root, { recursive: true });
  return root;
}

async function waitForInitialPage(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {}
    await delay(100);
  }
  throw new Error("Chromium DevTools page target not available");
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(message);
    return promise;
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.method) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    } else {
      pending.resolve(message.result);
    }
  }

  close() {
    for (const pending of this.pending.values()) pending.reject(new Error("CDP socket closed"));
    this.pending.clear();
    this.socket?.close();
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }
}

function collectBrowserIssues(client) {
  const issues = { errors: [], warnings: [] };
  client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    issues.errors.push(exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? "runtime exception");
  });
  client.on("Runtime.consoleAPICalled", ({ type, args = [] }) => {
    const text = args.map((arg) => arg.value ?? arg.description ?? "").join(" ").trim();
    if (type === "error" || type === "assert") issues.errors.push(text || type);
    if (type === "warning") issues.warnings.push(text || type);
  });
  client.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") issues.errors.push(entry.text ?? "log error");
    if (entry?.level === "warning") issues.warnings.push(entry.text ?? "log warning");
  });
  return issues;
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForValue(client, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function clickSelector(client, selector) {
  const point = await evaluate(client, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("selector not found: ${selector}");
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()
  `);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function replaceValue(client, selector, value) {
  await clickSelector(client, selector);
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2
  });
  if (value) await client.send("Input.insertText", { text: value });
  await evaluate(client, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
}

async function setControlValues(client, entries) {
  for (const [selector, value] of Object.entries(entries)) {
    await replaceValue(client, selector, value);
  }
}

async function selectValue(client, selector, value) {
  await clickSelector(client, selector);
  await evaluate(client, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function onceExit(process) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise((resolve) => process.once("exit", resolve));
}

async function closeChromium(process) {
  const exited = onceExit(process);
  await Promise.race([
    exited,
    delay(3000).then(() => {
      if (process.exitCode === null && process.signalCode === null && !process.killed) process.kill();
    })
  ]);
  await exited.catch(() => {});
}

async function removeWithRetry(path) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError;
}

function probeScript(options = {}) {
  const midiMode = JSON.stringify(options.midiMode ?? "available");
  return String.raw`
(() => {
  const probe = {
    midiMode: ${midiMode},
    audioContextConstructed: 0,
    audioState: "uncreated",
    starts: 0,
    stops: 0,
    connections: 0,
    midiRequests: 0,
    midiSends: 0,
    nodeTypes: {},
    destinationTypes: {},
    objectUrls: [],
    downloadClicks: [],
    analyser: null,
    setMidiMode: (mode) => {
      probe.midiMode = mode;
    },
    captureEnergy: async (durationMs = 1200) => {
      const analyser = probe.analyser;
      if (!analyser) return { frames: 0, nonSilentFrames: 0, maxPeak: 0, maxRms: 0 };
      const data = new Float32Array(analyser.fftSize);
      const deadline = performance.now() + durationMs;
      let frames = 0;
      let nonSilentFrames = 0;
      let maxPeak = 0;
      let maxRms = 0;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(data);
        let sumSquares = 0;
        let peak = 0;
        for (const sample of data) {
          const abs = Math.abs(sample);
          if (abs > peak) peak = abs;
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        if (peak > 0.0001 || rms > 0.00001) nonSilentFrames += 1;
        if (peak > maxPeak) maxPeak = peak;
        if (rms > maxRms) maxRms = rms;
        frames += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { frames, nonSilentFrames, maxPeak, maxRms };
    }
  };
  Object.defineProperty(window, "__radioProbe", { value: probe });

  if (URL?.createObjectURL) {
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      probe.objectUrls.push({ size: blob?.size ?? 0, type: blob?.type ?? "" });
      return nativeCreateObjectURL(blob);
    };
  }

  if (HTMLAnchorElement?.prototype?.click) {
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(...args) {
      if (this.download) {
        probe.downloadClicks.push({ download: this.download, href: this.href });
      }
      return nativeAnchorClick.apply(this, args);
    };
  }

  const NativeAudioContext = window.AudioContext;
  if (NativeAudioContext) {
    window.AudioContext = function(...args) {
      const context = new NativeAudioContext(...args);
      probe.audioContextConstructed += 1;
      probe.audioState = context.state;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      probe.analyser = analyser;
      const nativeResume = context.resume.bind(context);
      context.resume = async (...resumeArgs) => {
        const result = await nativeResume(...resumeArgs);
        probe.audioState = context.state;
        return result;
      };
      return context;
    };
  }

  if (window.AudioNode?.prototype?.connect) {
    const nativeConnect = window.AudioNode.prototype.connect;
    window.AudioNode.prototype.connect = function(destination, ...args) {
      probe.connections += 1;
      const sourceType = this.constructor?.name ?? "AudioNode";
      const destinationType = destination?.constructor?.name ?? "unknown";
      probe.nodeTypes[sourceType] = (probe.nodeTypes[sourceType] ?? 0) + 1;
      probe.destinationTypes[destinationType] = (probe.destinationTypes[destinationType] ?? 0) + 1;
      const result = nativeConnect.call(this, destination, ...args);
      if (destination === this.context?.destination && probe.analyser) {
        try {
          nativeConnect.call(this, probe.analyser);
        } catch {}
      }
      return result;
    };
  }

  for (const NodeType of [window.OscillatorNode, window.AudioBufferSourceNode].filter(Boolean)) {
    const nativeStart = NodeType.prototype.start;
    const nativeStop = NodeType.prototype.stop;
    NodeType.prototype.start = function(...args) {
      probe.starts += 1;
      return nativeStart.apply(this, args);
    };
    NodeType.prototype.stop = function(...args) {
      probe.stops += 1;
      return nativeStop.apply(this, args);
    };
  }

  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: async () => {
      probe.midiRequests += 1;
      if (probe.midiMode === "denied") {
        throw new DOMException("midi denied", "NotAllowedError");
      }
      const output = {
        id: "probe-output",
        name: "probe output",
        send: (data) => {
          probe.midiSends += 1;
          probe.lastMidiSend = Array.from(data);
        }
      };
      return {
        inputs: new Map(),
        outputs: new Map([[output.id, output]]),
        addEventListener: () => {},
        removeEventListener: () => {}
      };
    }
  });
})();
`;
}
