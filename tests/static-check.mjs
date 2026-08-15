import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Cloudflare Pages config points at static web output", async () => {
  const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /^pages_build_output_dir = "\.\/web"$/m);
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
