import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeStation, renderArrangement } from "../web/lib/engine.mjs";
import { encodeMidiFile } from "../web/lib/midi-file.mjs";

const outDir = process.argv[2] ?? process.env.RADIO_ARTIFACT_DIR;
if (!outDir) throw new Error("Artifact directory required");

const rows = [
  [
    "radio-polymetric-demo.mid",
    makeStation({
      seed: "radio-demo",
      voiceCount: 8,
      startCount: 8,
      pulseCount: 0,
      meterStart: 1,
      baseMeter: 1,
      baseBpm: 127,
      cycleUnit: "bars",
      cycleLength: 4,
      basisMode: "next"
    }),
    6
  ],
  [
    "radio-polymetric-20-meter-demo.mid",
    makeStation({
      seed: "radio-20-meter-demo",
      voiceCount: 20,
      startCount: 20,
      pulseCount: 0,
      meterStart: 1,
      baseMeter: 1,
      baseBpm: 120,
      cycleUnit: "resolving-sequences",
      cycleLength: 3,
      basisMode: "next"
    }),
    1
  ]
];

for (const [name, station, sectionCount] of rows) {
  const midi = encodeMidiFile(renderArrangement(station, {
    sectionCount,
    ppq: 480,
    maxEventsPerSection: 50000
  }));
  const path = join(outDir, name);
  await writeFile(path, midi);
  console.log(path);
}
