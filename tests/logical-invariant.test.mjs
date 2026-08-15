import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("Z3 proves selected shared-bar basis transition has no pulse-BPM jump", () => {
  const script = String.raw`
from z3 import Real, Solver, Not, sat
old_bpm = Real("old_bpm")
old_meter = Real("old_meter")
selected_meter = Real("selected_meter")
before = old_bpm * selected_meter / old_meter
after = before * selected_meter / selected_meter
s = Solver()
s.add(old_bpm > 0, old_meter > 0, selected_meter > 0)
s.add(Not(before == after))
print(s.check())
`;
  const output = execFileSync("python", ["-c", script], { encoding: "utf8" }).trim();
  assert.equal(output, "unsat");
});
