import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("lean TDD is documented as the repo verification gate", async () => {
  const runner = await read("./run");
  const doc = await read("../docs/lean-tdd.md");

  assert.match(runner, /lean-tdd\.test\.mjs/);
  assert.match(doc, /smallest failing test/);
  assert.match(doc, /bash C:\\git\\radio\\tests\\run/);
  assert.match(doc, /Z3 invariant/);
});

test("converted course maps old services to lean worldnet replacements", async () => {
  const conversion = await read("../docs/course-conversion.md");

  assert.match(conversion, /Old lesson 1: create a station on `101\.ru`/);
  assert.match(conversion, /Converted lesson 1: ship the owned radio application/);
  assert.match(conversion, /Old lesson 2: buy traffic through WMMail task creation/);
  assert.match(conversion, /Converted lesson 2: publish the product link without paid task exchanges/);
  assert.match(conversion, /Old lesson 5: accept payment through manual electronic wallets/);
  assert.match(conversion, /Converted lesson 5: use hosted checkout and license keys/);
  assert.match(conversion, /Old lesson 6: add SMSCoin\/SMS payment script to a site/);
  assert.match(conversion, /Converted lesson 6: remove SMS payment scripts/);
  assert.match(conversion, /RADIO_LICENSE_KEYS/);
});

test("old course dependencies are absent from deployable code", async () => {
  const deployablePaths = [
    "../functions/api/config.js",
    "../functions/api/license/activate.js",
    "../functions/api/license/validate.js",
    "../src/license-worker.mjs",
    "../src/public-config-worker.mjs",
    "../web/app.mjs",
    "../web/index.html",
    "../web/lib/engine.mjs",
    "../web/lib/instruments.mjs",
    "../web/lib/midi-file.mjs",
    "../web/lib/paywall.mjs",
    "../web/lib/prng.mjs",
    "../web/styles.css"
  ];

  const oldCourseDependency = /101\.ru|wmmail|vma mail|vkontakte|\bvk\b|smscoin|qiwi|yoomoney|yandex/i;

  for (const path of deployablePaths) {
    const contents = await read(path);
    assert.doesNotMatch(contents, oldCourseDependency, path);
  }
});
