const familyColor = Object.freeze({
  kick: "#0072b2",
  snare: "#d55e00",
  tom: "#009e73",
  hat: "#56b4e9",
  cymbal: "#e69f00",
  hand: "#cc79a7",
  wood: "#7f6d5f",
  metal: "#4d7c43",
  shake: "#8b6f00"
});

const kitRows = Object.freeze([
  kit("generic-drums", "Generic drum set", "AVL Drumkits", [
    [36, "Kick Tight", "kick"],
    [37, "Rim Sidestick", "wood"],
    [38, "Snare", "snare"],
    [39, "Snare 2", "snare"],
    [40, "Snare 3", "snare"],
    [41, "Tom Low", "tom"],
    [42, "Hihat Closed", "hat"],
    [43, "Tom Low-Mid", "tom"],
    [44, "Hihat Open", "hat"],
    [45, "Tom High-Mid", "tom"],
    [46, "Hihat Open 2", "hat"],
    [47, "Tom High", "tom"],
    [48, "Crash", "cymbal"],
    [49, "Crash 2", "cymbal"],
    [50, "Ride", "cymbal"],
    [51, "Ride Cup", "cymbal"]
  ]),
  kit("ethnic-percussion", "Ethnic percussion kit", "Buskman's Holiday percussion", [
    [35, "Frame Drum", "hand"],
    [36, "Djembe Bass", "hand"],
    [37, "Djembe Tone", "hand"],
    [38, "Djembe Slap", "hand"],
    [39, "Conga Open", "hand"],
    [40, "Conga Slap", "hand"],
    [41, "Bongo Low", "hand"],
    [42, "Bongo High", "hand"],
    [43, "Udu Low", "hand"],
    [44, "Udu High", "hand"],
    [45, "Darbuka", "hand"],
    [46, "Talking Drum", "hand"],
    [47, "Clave", "wood"],
    [48, "Wood Block", "wood"],
    [49, "Cowbell", "metal"],
    [50, "Agogo Low", "metal"],
    [51, "Agogo High", "metal"],
    [52, "Shaker", "shake"],
    [53, "Shekere", "shake"],
    [54, "Tambourine", "shake"],
    [55, "Bell Tree", "metal"]
  ])
]);

export const KITS = kitRows;
export const KIT_IDS = Object.freeze(KITS.map((item) => item.id));
export const LANES = Object.freeze(KITS.flatMap((item) => item.lanes));

export function cleanKitPool(input) {
  const incoming = Array.isArray(input) ? input : String(input ?? "").split(",");
  const legal = new Set(KIT_IDS);
  const out = [];
  for (const raw of incoming) {
    const id = String(raw).trim();
    if (legal.has(id) && !out.includes(id)) out.push(id);
  }
  return Object.freeze(out.length ? out : [...KIT_IDS]);
}

export function chooseLane(rng, kitPool) {
  const pool = cleanKitPool(kitPool);
  const lanes = LANES.filter((lane) => pool.includes(lane.kitId));
  return lanes[Math.floor(rng() * lanes.length) % lanes.length];
}

export function kitNames(kitPool) {
  const pool = cleanKitPool(kitPool);
  return pool.map((id) => KITS.find((kitItem) => kitItem.id === id)?.name).filter(Boolean).join(", ");
}

export function lanesForKit(kitId) {
  return LANES.filter((lane) => lane.kitId === kitId);
}

function kit(id, name, source, rows) {
  return Object.freeze({
    id,
    name,
    source,
    lanes: Object.freeze(rows.map(([note, laneName, family]) => Object.freeze({
      kitId: id,
      kitName: name,
      source,
      note,
      name: laneName,
      family,
      color: familyColor[family]
    })))
  });
}
