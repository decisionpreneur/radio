const familyColor = Object.freeze({
  kick: "#224b7a",
  snare: "#d94841",
  tom: "#28785b",
  hat: "#9b6b00",
  cymbal: "#b07a0b",
  wood: "#7a5230"
});

const kitRows = Object.freeze([
  kit("gen-purpose", "Gen Purpose", "Ableton screenshot", [
    [36, "Kick Tight Gen Purpose", "kick"],
    [37, "Rim Sidestick Gen Purpose", "wood"],
    [38, "Snare Gen Purpose", "snare"],
    [39, "Snare Gen Purpose 2", "snare"],
    [40, "Snare Gen Purpose 3", "snare"],
    [41, "Tom Low Gen Purpose", "tom"],
    [42, "Hihat Closed Gen Purpose", "hat"],
    [43, "Tom Low-Mid Gen Purpose", "tom"],
    [44, "Hihat Open Gen Purpose", "hat"],
    [45, "Tom High-Mid Gen Purpose", "tom"],
    [46, "Hihat Open Gen Purpose 2", "hat"],
    [47, "Tom High Gen Purpose", "tom"],
    [48, "Crash Gen Purpose", "cymbal"],
    [49, "Crash Gen Purpose 2", "cymbal"],
    [50, "Ride Gen Purpose", "cymbal"],
    [51, "Ride Cup Gen Purpose", "cymbal"]
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
