import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tdd = fileURLToPath(new URL("./tdd", import.meta.url));

test("tdd red accepts a failing command and rejects a passing command", () => {
  const failing = spawnSync("bash", [tdd, "red", "node", "--eval", "process.exit(1)"], {
    encoding: "utf8"
  });
  assert.equal(failing.status, 0, failing.stderr || failing.stdout);

  const passing = spawnSync("bash", [tdd, "red", "node", "--eval", "process.exit(0)"], {
    encoding: "utf8"
  });
  assert.equal(passing.status, 1);
});

test("tdd green accepts a passing command and rejects a failing command", () => {
  const passing = spawnSync("bash", [tdd, "green", "node", "--eval", "process.exit(0)"], {
    encoding: "utf8"
  });
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);

  const failing = spawnSync("bash", [tdd, "green", "node", "--eval", "process.exit(1)"], {
    encoding: "utf8"
  });
  assert.equal(failing.status, 1);
});
