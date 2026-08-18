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
  const profileDir = await mkdtemp(join(await profileRoot(), "radio-browser-profile-"));
  const debuggingPort = await freePort();
  const chromium = spawn(chromiumExecutable(), [
    "--headless=new",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-features=MediaRouter",
    "about:blank"
  ], { stdio: "ignore" });

  let client;
  try {
    const targetInfo = await waitForInitialPage(debuggingPort);
    client = new CdpClient(targetInfo.webSocketDebuggerUrl);
    await client.open();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: probeScript() });
    await client.send("Page.navigate", { url: target.url });
    await waitForValue(client, `document.readyState === "complete" && Boolean(document.querySelector("#startBtn"))`);

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
  } finally {
    if (client) {
      await client.send("Browser.close").catch(() => {});
      client.close();
    }
    await closeChromium(chromium);
    await removeWithRetry(profileDir);
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
  await evaluate(client, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("selector not found: ${selector}");
      element.click();
      return true;
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

function probeScript() {
  return String.raw`
(() => {
  const probe = {
    audioContextConstructed: 0,
    audioState: "uncreated",
    starts: 0,
    stops: 0,
    connections: 0,
    midiRequests: 0,
    midiSends: 0,
    nodeTypes: {},
    destinationTypes: {},
    analyser: null,
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
