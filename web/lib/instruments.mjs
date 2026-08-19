export const NORMAL_DRUMSET_ID = "normal-drumset";
export const ETHNIC_PERCUSSION_KIT_ID = "ethnic-percussion-kit";

const NORMAL_DRUMSET_NAME = "normal drumset";
const ETHNIC_PERCUSSION_KIT_NAME = "ethnic percussion kit";

function lane(kitId, kitName, value) {
  return Object.freeze({
    kitId,
    kitName,
    ...value
  });
}

export const DRUM_LANES = Object.freeze([
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Ride Cup Gen Purpose", note: 51, color: "#9fb7cf", sound: "ride-cup" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Ride Gen Purpose", note: 50, color: "#8da7bf", sound: "ride" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Crash Gen Purpose 2", note: 49, color: "#d2c071", sound: "crash" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Crash Gen Purpose", note: 48, color: "#c8b35e", sound: "crash" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Tom High Gen Purpose", note: 47, color: "#b07a55", sound: "tom-high" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Hihat Open Gen Purpose 2", note: 46, color: "#c9c9a5", sound: "hihat-open" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Tom High-Mid Gen Purpose", note: 45, color: "#a96f50", sound: "tom-high-mid" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Hihat Open Gen Purpose", note: 44, color: "#bfc28f", sound: "hihat-open" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Tom Low-Mid Gen Purpose", note: 43, color: "#965f48", sound: "tom-low-mid" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Hihat Closed Gen Purpose", note: 42, color: "#aeb47d", sound: "hihat-closed" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Tom Low Gen Purpose", note: 41, color: "#86523f", sound: "tom-low" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Snare Gen Purpose 3", note: 40, color: "#d18b83", sound: "snare" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Snare Gen Purpose 2", note: 39, color: "#c97e77", sound: "snare" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Snare Gen Purpose", note: 38, color: "#bd736c", sound: "snare" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Rim Sidestick Gen Purpose", note: 37, color: "#cab2a0", sound: "rim" }),
  lane(NORMAL_DRUMSET_ID, NORMAL_DRUMSET_NAME, { name: "Kick Tight Gen Purpose", note: 36, color: "#7f8c75", sound: "kick-tight" })
]);

export const ETHNIC_PERCUSSION_LANES = Object.freeze([
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Bongo High Open Hard", note: 60, color: "#c66f46", sound: "bongo-high" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Bongo Low Open Hard", note: 61, color: "#b7623f", sound: "bongo-low" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Conga Hi Slap", note: 62, color: "#d08a55", sound: "conga-slap" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Conga Acoustified Hi", note: 63, color: "#c97d4f", sound: "conga-high" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Conga Acoustified Low", note: 64, color: "#b86a48", sound: "conga-low" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Timbales High Open Hard", note: 65, color: "#d4a15a", sound: "timbales-high" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Timbales Low Open Hard", note: 66, color: "#bd8a4c", sound: "timbales-low" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Bells Agogo Hi", note: 67, color: "#d2b65e", sound: "agogo-high" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Djembe High Hard", note: 68, color: "#c2a650", sound: "djembe-high" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Cabasa Short Mid", note: 69, color: "#a9a962", sound: "cabasa" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Maracas Hard", note: 70, color: "#8fae63", sound: "maracas" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Wood Claves", note: 75, color: "#c19070", sound: "claves" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Perc African MPC", note: 71, color: "#a15d45", sound: "perc-african" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Tambourine Hit Hard", note: 54, color: "#c2c36b", sound: "tambourine" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Shaker Acoustic", note: 82, color: "#9fb36f", sound: "shaker" }),
  lane(ETHNIC_PERCUSSION_KIT_ID, ETHNIC_PERCUSSION_KIT_NAME, { name: "Cowbell Latin Ting", note: 56, color: "#b9ad9b", sound: "cowbell" })
]);

export const KITS = Object.freeze([
  Object.freeze({ id: NORMAL_DRUMSET_ID, name: NORMAL_DRUMSET_NAME, aliases: Object.freeze(["generic drum set"]), lanes: DRUM_LANES }),
  Object.freeze({ id: ETHNIC_PERCUSSION_KIT_ID, name: ETHNIC_PERCUSSION_KIT_NAME, aliases: Object.freeze([]), lanes: ETHNIC_PERCUSSION_LANES })
]);

export const ALL_LANES = Object.freeze(KITS.flatMap((kit) => kit.lanes));

const KIT_ID_ALIASES = new Map([
  ["generic-drum-set", NORMAL_DRUMSET_ID],
  ["generic drum set", NORMAL_DRUMSET_ID],
  ["normal drumset", NORMAL_DRUMSET_ID],
  ["ethnic percussion kit", ETHNIC_PERCUSSION_KIT_ID]
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
