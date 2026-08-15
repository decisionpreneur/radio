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
});
