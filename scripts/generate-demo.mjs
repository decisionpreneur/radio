import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInitialState, renderArrangement } from "../web/lib/engine.mjs";
import { encodeMidiFile } from "../web/lib/midi-file.mjs";

const artifactDir = process.argv[2] ?? process.env.RADIO_ARTIFACT_DIR;
if (!artifactDir) {
  throw new Error("Artifact directory required");
}

const demos = [
  {
    basename: "radio-polymetric-demo",
    state: createInitialState({
      seed: "radio-demo",
      patternCount: 8,
      startOnlyCount: 8,
      pulseCount: 0,
      meterStart: 1,
      meterCount: 8,
      baseBpm: 127,
      baseMeter: 1,
      cycleLengthKind: "bars",
      cycleLength: 4,
      basisPolicy: "next",
      replacementCadence: "one-by-one",
      meterTiming: "same-pulse-polymeter"
    }),
    sections: 6,
    maxEventsPerSection: 50000
  },
  {
    basename: "radio-polymetric-20-meter-demo",
    state: createInitialState({
      seed: "radio-20-meter-demo",
      patternCount: 20,
      startOnlyCount: 20,
      pulseCount: 0,
      meterStart: 1,
      meterCount: 20,
      baseBpm: 120,
      baseMeter: 1,
      cycleLengthKind: "resolving-sequences",
      cycleLength: 3,
      basisPolicy: "next",
      replacementCadence: "one-by-one",
      meterTiming: "same-pulse-polymeter"
    }),
    sections: 1,
    maxEventsPerSection: 50000
  }
];

for (const demo of demos) {
  const rendered = renderArrangement(demo.state, {
    sectionCount: demo.sections,
    ppq: 480,
    maxEventsPerSection: demo.maxEventsPerSection
  });
  const midi = encodeMidiFile(rendered);
  await writeFile(join(artifactDir, `${demo.basename}.mid`), midi);
  console.log(join(artifactDir, `${demo.basename}.mid`));
}
