export const KITS = Object.freeze([
  {
    id: "generic-drums",
    name: "Generic drum set",
    source: "AVL Drumkits",
    lanes: freezeLanes("generic-drums", "Generic drum set", [
      [36, "Kick Tight", "kick", "#7a4a35"],
      [37, "Rim Sidestick", "wood", "#8a5d2b"],
      [38, "Snare", "snare", "#a43f45"],
      [39, "Snare 2", "snare", "#b6535c"],
      [40, "Snare 3", "snare", "#c66b63"],
      [41, "Low Tom", "tom", "#55713f"],
      [42, "Closed Hihat", "hat", "#587c88"],
      [43, "Low-Mid Tom", "tom", "#638449"],
      [44, "Open Hihat", "hat", "#638f9f"],
      [45, "High-Mid Tom", "tom", "#758f4f"],
      [46, "Open Hihat 2", "hat", "#79a9b6"],
      [47, "High Tom", "tom", "#8a9c55"],
      [48, "Crash", "crash", "#bd8d28"],
      [49, "Crash 2", "crash", "#c99b39"],
      [50, "Ride", "ride", "#a77e2d"],
      [51, "Ride Cup", "ride", "#8f7330"]
    ])
  },
  {
    id: "ethnic-percussion",
    name: "Ethnic percussion kit",
    source: "Buskman's Holiday percussion",
    lanes: freezeLanes("ethnic-percussion", "Ethnic percussion kit", [
      [35, "Frame Drum", "hand", "#5f6140"],
      [36, "Djembe Bass", "hand", "#6c5533"],
      [37, "Djembe Tone", "hand", "#765f36"],
      [38, "Djembe Slap", "hand", "#86533d"],
      [39, "Conga Open", "hand", "#916b40"],
      [40, "Conga Slap", "hand", "#9d7647"],
      [41, "Bongo Low", "hand", "#a27e49"],
      [42, "Bongo High", "hand", "#b0844b"],
      [43, "Udu Low", "hand", "#6b6f7a"],
      [44, "Udu High", "hand", "#777f91"],
      [45, "Darbuka", "hand", "#8b5667"],
      [46, "Talking Drum", "hand", "#9a6174"],
      [47, "Clave", "wood", "#8c6c31"],
      [48, "Wood Block", "wood", "#a07634"],
      [49, "Cowbell", "metal", "#778377"],
      [50, "Agogo Low", "metal", "#829184"],
      [51, "Agogo High", "metal", "#8b9e91"],
      [52, "Shaker", "shake", "#6f8d7a"],
      [53, "Shekere", "shake", "#789a83"],
      [54, "Tambourine", "shake", "#b28b36"],
      [55, "Bell Tree", "metal", "#9280a7"]
    ])
  }
]);

export const DEFAULT_KIT_IDS = Object.freeze(KITS.map((kit) => kit.id));
export const ALL_LANES = Object.freeze(KITS.flatMap((kit) => kit.lanes));

export function cleanKitIds(input) {
  const accepted = new Set(DEFAULT_KIT_IDS);
  const ids = Array.isArray(input) ? input : String(input ?? "").split(",");
  const clean = ids.map((id) => String(id).trim()).filter((id) => accepted.has(id));
  return Object.freeze(clean.length ? [...new Set(clean)] : [...DEFAULT_KIT_IDS]);
}

export function kitNameList(ids) {
  const names = cleanKitIds(ids).map((id) => KITS.find((kit) => kit.id === id)?.name).filter(Boolean);
  return names.join(", ");
}

export function pickLane(rng, kitIds) {
  const active = ALL_LANES.filter((lane) => cleanKitIds(kitIds).includes(lane.kitId));
  return active[Math.floor(rng() * active.length) % active.length];
}

function freezeLanes(kitId, kitName, rows) {
  return Object.freeze(rows.map(([note, name, family, color]) => Object.freeze({
    kitId,
    kitName,
    note,
    name,
    family,
    color
  })));
}
