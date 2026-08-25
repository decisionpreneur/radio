export const FOSS_DRUMSET_ID = "avl-drumkits-generic";
export const FOSS_ETHNIC_PERCUSSION_KIT_ID = "avl-buskmans-holiday-percussion";

const FOSS_DRUMSET_NAME = "Generic drum set";
const FOSS_ETHNIC_PERCUSSION_KIT_NAME = "Ethnic percussion kit";

const lane = (kitId, kitName, name, note, color, sound) =>
  Object.freeze({ kitId, kitName, name, note, color, sound });

export const GENERIC_DRUMSET_LANES = Object.freeze([
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Kick Tight Gen Purpose", 36, "#315f72", "kick-tight"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Rim Sidestick Gen Purpose", 37, "#8c4f45", "rim"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Snare Gen Purpose", 38, "#ba4a3d", "snare"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Snare Gen Purpose 2", 39, "#d06148", "snare-edge"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Snare Gen Purpose 3", 40, "#df7a57", "snare-edge"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Tom Low Gen Purpose", 41, "#6f5b46", "tom-low"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Hihat Closed Gen Purpose", 42, "#7d8d39", "hihat-closed"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Tom Low-Mid Gen Purpose", 43, "#8a6748", "tom-low-mid"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Hihat Open Gen Purpose", 44, "#a1a943", "semi-open-hihat"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Tom High-Mid Gen Purpose", 45, "#9b6d45", "tom-high-mid"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Hihat Open Gen Purpose 2", 46, "#bec55a", "swish-hihat"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Tom High Gen Purpose", 47, "#af7850", "tom-high"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Crash Gen Purpose", 48, "#d09b34", "crash"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Crash Gen Purpose 2", 49, "#e0b14b", "crash"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Ride Gen Purpose", 50, "#46909b", "ride"),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, "Ride Cup Gen Purpose", 51, "#62aeb8", "ride-cup")
]);

export const ETHNIC_PERCUSSION_LANES = Object.freeze([
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Stick Click", 35, "#a56a48", "stick-click"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Cajon Thump", 36, "#be734b", "cajon-low"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Finger Snaps", 37, "#e7b48a", "finger-snap"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Cajon Slap Left", 38, "#d19867", "cajon-slap"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Hand Clap", 39, "#c85e3f", "hand-clap"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Cajon Slap Right", 40, "#d77a56", "cajon-slap"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Large Conga Left", 41, "#b65c45", "conga-low"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Shakers", 42, "#7cab52", "shaker-soft"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Large Conga Right", 43, "#9abf59", "conga-high"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Shake Tambourine", 44, "#c9ba44", "tambourine"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Small Conga Left", 45, "#8c6f48", "hand-drum-small"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Bump Tambourine", 46, "#a88452", "tambourine"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Small Conga Right", 47, "#4d7d8a", "hand-drum-small-high"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Claves", 48, "#b9885a", "claves"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Cymbal", 49, "#e0c45c", "cymbal-hand"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Cymbal Bell", 50, "#6d8ba7", "cymbal-bell"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Cowbell", 51, "#9ca7ad", "cowbell"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Foot Stomp", 52, "#6f6251", "foot-stomp"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Bucket", 53, "#4d7d8a", "bucket"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Bell Tree Down", 54, "#9278bd", "bell-tree-down"),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, "Bell Tree Up", 55, "#b692d6", "bell-tree-up")
]);

export const KITS = Object.freeze([
  Object.freeze({
    id: FOSS_DRUMSET_ID,
    name: FOSS_DRUMSET_NAME,
    aliases: Object.freeze(["generic drum set", "normal drumset"]),
    lanes: GENERIC_DRUMSET_LANES
  }),
  Object.freeze({
    id: FOSS_ETHNIC_PERCUSSION_KIT_ID,
    name: FOSS_ETHNIC_PERCUSSION_KIT_NAME,
    aliases: Object.freeze(["ethnic percussion kit"]),
    lanes: ETHNIC_PERCUSSION_LANES
  })
]);

export const KIT_BY_ID = Object.freeze(
  Object.fromEntries(KITS.map((kit) => [kit.id, kit]))
);

export const ALL_LANES = Object.freeze(KITS.flatMap((kit) => kit.lanes));

const KIT_ID_ALIASES = new Map([
  [FOSS_DRUMSET_ID, FOSS_DRUMSET_ID],
  ["drums", FOSS_DRUMSET_ID],
  ["generic", FOSS_DRUMSET_ID],
  ["generic drum set", FOSS_DRUMSET_ID],
  ["normal drumset", FOSS_DRUMSET_ID],
  [FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_ID],
  ["ethnic", FOSS_ETHNIC_PERCUSSION_KIT_ID],
  ["percussion", FOSS_ETHNIC_PERCUSSION_KIT_ID],
  ["ethnic percussion kit", FOSS_ETHNIC_PERCUSSION_KIT_ID],
  ["buskmans", FOSS_ETHNIC_PERCUSSION_KIT_ID]
]);

export function kitById(id) {
  const normalizedId = KIT_ID_ALIASES.get(id) ?? id;
  return KITS.find((kit) => kit.id === normalizedId);
}

export function normalizeKitPool(value) {
  const requested = Array.isArray(value)
    ? value
    : String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const normalized = requested
    .map((id) => KIT_ID_ALIASES.get(id) ?? id)
    .filter((id, index, ids) => kitById(id) && ids.indexOf(id) === index);
  return Object.freeze(normalized.length ? normalized : KITS.map((kit) => kit.id));
}

export function laneByName(name) {
  return ALL_LANES.find((candidate) => candidate.name === name);
}

export function pickKit(rng, kitPool) {
  const pool = normalizeKitPool(kitPool);
  return kitById(pool[Math.floor(rng() * pool.length)]);
}

export function pickLane(rng, kitPool) {
  const kit = pickKit(rng, kitPool);
  return kit.lanes[Math.floor(rng() * kit.lanes.length)];
}
