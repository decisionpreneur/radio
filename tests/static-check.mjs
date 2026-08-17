import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("Cloudflare Pages Git integration points at static web output", async () => {
  const deployment = await readFile(new URL("../docs/deployment.md", import.meta.url), "utf8");
  assert.match(deployment, /Connect to Git/);
  assert.match(deployment, /Build output directory: web/);
  await assert.rejects(access(new URL("../wrangler.toml", import.meta.url)));
  await assert.rejects(access(new URL("../.github/workflows/tests.yml", import.meta.url)));
});

test("static app imports only deployable web-local modules", async () => {
  const app = await readFile(new URL("../web/app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app, /\.\.\/src\//);
  assert.match(app, /from "\.\/lib\/engine\.mjs"/);
  assert.match(app, /from "\.\/lib\/midi-file\.mjs"/);
});

test("HTML loads the static app module", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="\.\/app\.mjs"><\/script>/);
  assert.match(html, /id="patternCount"[^>]+min="2"/);
  assert.match(html, /id="licenseKey"/);
  assert.match(html, /id="checkoutLink"/);
  assert.match(html, />Subscribe<\/a>/);
  assert.match(html, /Payment email/);
});

test("paid controls fail closed before license JavaScript runs", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /id="startBtn"[^>]*disabled/);
  assert.match(html, /id="midiBtn"[^>]*disabled/);
  assert.match(html, /id="exportBtn"[^>]*disabled/);
});

test("static app initializes session seed before constructing state", async () => {
  const app = await readFile(new URL("../web/app.mjs", import.meta.url), "utf8");
  const seedIndex = app.indexOf("const sessionSeed = makeSessionSeed();");
  const stateIndex = app.indexOf("let state = makeStateFromControls();");
  assert.notEqual(seedIndex, -1);
  assert.notEqual(stateIndex, -1);
  assert.ok(seedIndex < stateIndex);
});

test("live playback reports playing only after scheduling an audio event", async () => {
  const app = await readFile(new URL("../web/app.mjs", import.meta.url), "utf8");
  const startLiveIndex = app.indexOf("async function startLive()");
  const tickIndex = app.indexOf("  tick();", startLiveIndex);
  const playingIndex = app.indexOf('statusEl.textContent = live.scheduled.size ? "playing" : "waiting for hit";', startLiveIndex);
  assert.notEqual(startLiveIndex, -1);
  assert.notEqual(tickIndex, -1);
  assert.notEqual(playingIndex, -1);
  assert.ok(tickIndex < playingIndex);
  assert.match(app, /if \(audioContext\.state !== "running"\) throw new Error\("AudioContext not running"\);/);
  assert.doesNotMatch(app.slice(startLiveIndex, playingIndex), /statusEl\.textContent = "playing"/);
});

test("web audio nodes route through a master output graph", async () => {
  const app = await readFile(new URL("../web/app.mjs", import.meta.url), "utf8");
  assert.match(app, /let masterInput = null;/);
  assert.match(app, /compressor\.connect\(masterGain\)\.connect\(audioContext\.destination\);/);
  assert.match(app, /osc\.connect\(gain\)\.connect\(masterInput\);/);
  assert.match(app, /source\.connect\(filter\)\.connect\(gain\)\.connect\(masterInput\);/);
});

test("Pages Function license endpoints are present without wrangler deployment config", async () => {
  const config = await readFile(new URL("../functions/api/config.js", import.meta.url), "utf8");
  const activate = await readFile(new URL("../functions/api/license/activate.js", import.meta.url), "utf8");
  const validate = await readFile(new URL("../functions/api/license/validate.js", import.meta.url), "utf8");
  assert.match(config, /onRequestGet/);
  assert.match(activate, /onRequestPost/);
  assert.match(validate, /onRequestPost/);
  await assert.rejects(access(new URL("../wrangler.toml", import.meta.url)));
});

test("repository docs and app do not present local HTTP serving as delivery", async () => {
  const files = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/deployment.md", import.meta.url), "utf8"),
    readFile(new URL("../web/app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../web/index.html", import.meta.url), "utf8")
  ]);
  for (const file of files) {
    assert.doesNotMatch(file, /127\.0\.0\.1|localhost|http\.server|local server/i);
  }
});
