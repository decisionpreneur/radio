import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";

const WEB_ROOT = new URL("../web/", import.meta.url);
const LOCAL_LICENSE_KEY = "browser-sound-smoke-key";

test("browser radio tab drives Web Audio output and MIDI sends after unlock", { timeout: 45_000 }, async () => {
  const target = await makeTarget();
  const session = await openTargetInChromium(target, { midiMode: "available" });
  const { client, issues } = session;
  try {
    await evaluate(client, `
      document.querySelector("#seed").value = "browser-sound-smoke";
      document.querySelector("#baseBpm").value = "120";
      document.querySelector("#baseMeter").value = "1";
      document.querySelector("#patternCount").value = "20";
      document.querySelector("#startOnlyCount").value = "4";
      document.querySelector("#pulseCount").value = "6";
      document.querySelector("#cycleLength").value = "3";
      document.querySelector("#cycleLengthKind").value = "resolving-sequences";
      document.querySelector("#basisPolicy").value = "next";
      document.querySelector("#kitPool").value = "";
      document.querySelector("#controls").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#licenseKey").value = ${JSON.stringify(target.licenseKey)};
      document.querySelector("#licenseEmail").value = "";
    `);

    await clickSelector(client, "#unlockBtn");
    await waitForValue(client, `document.querySelector("#paywallStatus").textContent === "unlocked"`);
    await clickSelector(client, "#midiBtn");
    await waitForValue(client, `document.querySelector("#midiOutput option[value='probe-output']") !== null`);
    await evaluate(client, `
      const midiOutput = document.querySelector("#midiOutput");
      midiOutput.value = "probe-output";
      midiOutput.dispatchEvent(new Event("change", { bubbles: true }));
    `);
    await clickSelector(client, "#startBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "playing"`);

    const result = await evaluate(client, `
      (async () => {
        const energy = await window.__radioProbe.captureEnergy(1800);
        const voices = [...document.querySelectorAll(".voice")].map((voice) => ({
          instrument: voice.querySelector("h2")?.textContent,
          facts: voice.textContent
        }));
        return {
          status: document.querySelector("#status").textContent,
          paywallStatus: document.querySelector("#paywallStatus").textContent,
          startDisabled: document.querySelector("#startBtn").disabled,
          midiRequests: window.__radioProbe.midiRequests,
          midiSends: window.__radioProbe.midiSends,
          starts: window.__radioProbe.starts,
          connections: window.__radioProbe.connections,
          audioContextConstructed: window.__radioProbe.audioContextConstructed,
          audioState: window.__radioProbe.audioState,
          nodeTypes: window.__radioProbe.nodeTypes,
          destinationTypes: window.__radioProbe.destinationTypes,
          energy,
          voiceCount: voices.length,
          normalKitVisible: voices.some((voice) => voice.facts.includes("normal drumset")),
          ethnicKitVisible: voices.some((voice) => voice.facts.includes("ethnic percussion kit"))
        };
      })()
    `);

    assert.equal(result.paywallStatus, "unlocked");
    assert.equal(result.status, "playing");
    assert.equal(result.startDisabled, false);
    assert.ok(result.audioContextConstructed >= 1);
    assert.equal(result.audioState, "running");
    assert.ok(result.starts > 0);
    assert.ok(result.connections > 0);
    assert.ok(result.nodeTypes.OscillatorNode > 0 || result.nodeTypes.AudioBufferSourceNode > 0);
    assert.ok(result.destinationTypes.AudioDestinationNode > 0);
    assert.ok(result.energy.frames > 5);
    assert.ok(result.energy.nonSilentFrames > 0);
    assert.ok(result.energy.maxPeak > 0.0001);
    assert.ok(result.energy.maxRms > 0.00001);
    assert.ok(result.midiRequests >= 1);
    assert.ok(result.midiSends > 0);
    assert.equal(result.voiceCount, 20);
    assert.equal(result.normalKitVisible, true);
    assert.equal(result.ethnicKitVisible, true);
    assert.deepEqual(issues.errors, []);
  } finally {
    await session.close();
    await target.close();
  }
});

test("ordinary Chromium user flow covers controls, paywall, MIDI, export, and responsive UI", { timeout: 90_000 }, async () => {
  const target = await makeTarget();
  const session = await openTargetInChromium(target, { midiMode: "denied" });
  const { client, issues } = session;
  try {
    await waitForValue(client, `document.querySelector("#checkoutLink").hidden === false`);

    const locked = await evaluate(client, `
      ({
        status: document.querySelector("#status").textContent,
        paywallStatus: document.querySelector("#paywallStatus").textContent,
        startDisabled: document.querySelector("#startBtn").disabled,
        midiDisabled: document.querySelector("#midiBtn").disabled,
        exportDisabled: document.querySelector("#exportBtn").disabled,
        checkoutHref: document.querySelector("#checkoutLink").href,
        donateHidden: document.querySelector("#donateLink").hidden,
        voiceCount: document.querySelectorAll(".voice").length,
        canvasWidth: document.querySelector("#timeline").getBoundingClientRect().width
      })
    `);
    assert.equal(locked.status, "stopped");
    assert.equal(locked.paywallStatus, "locked");
    assert.equal(locked.startDisabled, true);
    assert.equal(locked.midiDisabled, true);
    assert.equal(locked.exportDisabled, true);
    assert.match(locked.checkoutHref, /^https?:\/\//);
    assert.equal(locked.donateHidden, true);
    assert.ok(locked.voiceCount >= 2);
    assert.ok(locked.canvasWidth > 0);

    await clickSelector(client, "#unlockBtn");
    await waitForValue(client, `document.querySelector("#paywallStatus").textContent === "license key required"`);
    await replaceValue(client, "#licenseKey", target.licenseKey);
    await replaceValue(client, "#licenseEmail", "");
    await clickSelector(client, "#unlockBtn");
    await waitForValue(client, `document.querySelector("#paywallStatus").textContent === "unlocked"`);

    await setControlValues(client, {
      "#seed": "ordinary-flow",
      "#baseBpm": "118",
      "#baseMeter": "1",
      "#patternCount": "6",
      "#startOnlyCount": "2",
      "#pulseCount": "2",
      "#meterStart": "1",
      "#cycleLength": "2",
      "#exportSections": "2"
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

    await clickSelector(client, "#startBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "playing"`);
    const playing = await evaluate(client, `
      (async () => {
        const energy = await window.__radioProbe.captureEnergy(1800);
        return {
          status: document.querySelector("#status").textContent,
          midiSends: window.__radioProbe.midiSends,
          starts: window.__radioProbe.starts,
          audioState: window.__radioProbe.audioState,
          energy
        };
      })()
    `);
    assert.equal(playing.status, "playing");
    assert.equal(playing.audioState, "running");
    assert.ok(playing.starts > 0);
    assert.ok(playing.midiSends > 0);
    assert.ok(playing.energy.nonSilentFrames > 0);
    assert.ok(playing.energy.maxPeak > 0.005);
    assert.ok(playing.energy.maxRms > 0.0005);

    await clickSelector(client, "#randomBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "playing"`);
    await clickSelector(client, "#stopBtn");
    await waitForValue(client, `document.querySelector("#status").textContent === "stopped"`);
    await clickSelector(client, "#exportBtn");
    await waitForValue(client, `window.__radioProbe.downloadClicks.some((item) => item.download === "radio-polymetric-export.mid")`);
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
    await target.close();
  }
});

async function makeTarget() {
  const remoteUrl = process.env.RADIO_BROWSER_TEST_URL;
  if (remoteUrl) {
    return {
      url: remoteUrl,
      licenseKey: process.env.RADIO_BROWSER_TEST_LICENSE_KEY ?? LOCAL_LICENSE_KEY,
      close: async () => {}
    };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/config") {
      json(response, { checkoutUrl: "https://polyradio.lemonsqueezy.com/checkout" });
      return;
    }
    if (url.pathname === "/api/license/activate" || url.pathname === "/api/license/validate") {
      json(response, {
        ok: true,
        unlocked: true,
        provider: "cloudflare-backdoor",
        licenseStatus: "active",
        instanceId: "browser-sound-smoke",
        error: null
      });
      return;
    }
    await serveStatic(url.pathname, response);
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}/`,
    licenseKey: LOCAL_LICENSE_KEY,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function openTargetInChromium(target, options = {}) {
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
    await client.send("Page.navigate", { url: target.url });
    await waitForValue(client, `document.readyState === "complete" && Boolean(document.querySelector("#startBtn"))`);
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

async function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  if (relativePath.includes("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    response.writeHead(403).end();
    return;
  }
  const fileUrl = new URL(relativePath, WEB_ROOT);
  try {
    const info = await stat(fileUrl);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "Content-Type": contentType(extname(relativePath)),
      "Cache-Control": "no-store"
    });
    createReadStream(fileUrl).pipe(response);
  } catch {
    response.writeHead(404).end("not found");
  }
}

function json(response, body) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function contentType(extension) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8"
  }[extension] ?? "application/octet-stream";
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
    throw new Error(result.exceptionDetails.text);
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
