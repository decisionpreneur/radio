export const FOSS_DRUMSET_ID = "avl-drumkits-generic";
export const FOSS_ETHNIC_PERCUSSION_KIT_ID = "avl-buskmans-holiday-percussion";
export const PERC_AFRICAN_MPC_KIT_ID = "perc-african-mpc";

const FOSS_DRUMSET_NAME = "AVL Drumkits generic drums";
const FOSS_ETHNIC_PERCUSSION_KIT_NAME = "AVL Buskman's Holiday percussion";
const PERC_AFRICAN_MPC_KIT_NAME = "Perc African MPC";

function lane(kitId, kitName, value) {
  return Object.freeze({
    kitId,
    kitName,
    ...value
  });
}

export const DRUM_LANES = Object.freeze([
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Kick Drum", note: 36, color: "#566a79", sound: "kick-tight" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Snare Sidestick", note: 37, color: "#9f655f", sound: "rim" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Snare Center", note: 38, color: "#b66058", sound: "snare" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Snare Edge", note: 39, color: "#c27a6d", sound: "snare-edge" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Snare High", note: 40, color: "#cf8b78", sound: "snare-edge" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Low Tom", note: 41, color: "#7a6152", sound: "tom-low" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Closed HiHat", note: 42, color: "#9da75f", sound: "hihat-closed" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Low-Mid Tom", note: 43, color: "#8b6a55", sound: "tom-low-mid" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Open HiHat", note: 44, color: "#b5b970", sound: "semi-open-hihat" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "High-Mid Tom", note: 45, color: "#93634f", sound: "tom-high-mid" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Open HiHat 2", note: 46, color: "#c5c881", sound: "swish-hihat" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "High Tom", note: 47, color: "#a87559", sound: "tom-high" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Crash Cymbal 1", note: 48, color: "#c6a94f", sound: "crash" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Crash Cymbal 2", note: 49, color: "#d2b85e", sound: "crash" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Ride Cymbal", note: 50, color: "#8ca1ad", sound: "ride" }),
  lane(FOSS_DRUMSET_ID, FOSS_DRUMSET_NAME, { name: "Ride Cup", note: 51, color: "#9ab1bf", sound: "ride-bell" })
]);

export const ETHNIC_PERCUSSION_LANES = Object.freeze([
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Cajon Thump", note: 35, color: "#9c5f47", sound: "cajon-thump" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Finger Snap", note: 36, color: "#a87858", sound: "finger-snap" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Cajon Slap", note: 38, color: "#b56d4f", sound: "cajon-slap" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Cajon Rim Click", note: 39, color: "#8f6a55", sound: "claves" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Conga Left", note: 40, color: "#c6784d", sound: "conga-left" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Conga Right", note: 41, color: "#cf8558", sound: "conga-right" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Small Conga Left", note: 42, color: "#d0925f", sound: "small-conga-left" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Small Conga Right", note: 43, color: "#d8a16d", sound: "small-conga-right" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Shakers", note: 44, color: "#8ea867", sound: "shaker" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Foot Stomp", note: 45, color: "#796b5a", sound: "foot-stomp" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Tambourine", note: 46, color: "#bcb65c", sound: "tambourine" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Claves", note: 47, color: "#b7835b", sound: "claves" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Cowbell", note: 48, color: "#a2a09a", sound: "cowbell" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Bucket", note: 49, color: "#66808a", sound: "bucket" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Bell Tree Down", note: 50, color: "#ad9cce", sound: "bell-tree-down" }),
  lane(FOSS_ETHNIC_PERCUSSION_KIT_ID, FOSS_ETHNIC_PERCUSSION_KIT_NAME, { name: "Bell Tree Up", note: 51, color: "#8979b5", sound: "bell-tree-up" })
]);

export const PERC_AFRICAN_MPC_LANES = Object.freeze([
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Djembe Bass", note: 60, color: "#8b4f3d", sound: "djembe-bass" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Djembe Tone", note: 61, color: "#a76345", sound: "djembe-tone" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Djembe Slap", note: 62, color: "#bd764e", sound: "djembe-slap" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Dunun Low", note: 63, color: "#73533f", sound: "dunun-low" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Dunun High", note: 64, color: "#956546", sound: "dunun-high" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Udu Low", note: 65, color: "#6a6b56", sound: "udu-low" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Udu High", note: 66, color: "#858161", sound: "udu-high" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Talking Drum", note: 67, color: "#a58b4f", sound: "talking-drum" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Shekere", note: 68, color: "#7f9a5f", sound: "shekere" }),
  lane(PERC_AFRICAN_MPC_KIT_ID, PERC_AFRICAN_MPC_KIT_NAME, { name: "MPC Metal Shaker", note: 69, color: "#86a69a", sound: "metal-shaker" })
]);

export const KITS = Object.freeze([
  Object.freeze({
    id: FOSS_DRUMSET_ID,
    name: FOSS_DRUMSET_NAME,
    aliases: Object.freeze(["generic drum set", "normal drumset"]),
    source: Object.freeze({
      name: "AVL Drumkits",
      license: "GPL plus CC-BY-SA sample exception"
    }),
    lanes: DRUM_LANES
  }),
  Object.freeze({
    id: FOSS_ETHNIC_PERCUSSION_KIT_ID,
    name: FOSS_ETHNIC_PERCUSSION_KIT_NAME,
    aliases: Object.freeze(["ethnic percussion kit"]),
    source: Object.freeze({
      name: "AVL Drumkits Buskman's Holiday",
      license: "GPL plus CC-BY-SA sample exception"
    }),
    lanes: ETHNIC_PERCUSSION_LANES
  }),
  Object.freeze({
    id: PERC_AFRICAN_MPC_KIT_ID,
    name: PERC_AFRICAN_MPC_KIT_NAME,
    aliases: Object.freeze(["Perc African MPC", "perc african mpc"]),
    lanes: PERC_AFRICAN_MPC_LANES
  })
]);

export const ALL_LANES = Object.freeze(KITS.flatMap((kit) => kit.lanes));

const KIT_ID_ALIASES = new Map([
  ["normal-drumset", FOSS_DRUMSET_ID],
  ["generic-drum-set", FOSS_DRUMSET_ID],
  ["generic drum set", FOSS_DRUMSET_ID],
  ["normal drumset", FOSS_DRUMSET_ID],
  ["ethnic-percussion-kit", FOSS_ETHNIC_PERCUSSION_KIT_ID],
  ["ethnic percussion kit", FOSS_ETHNIC_PERCUSSION_KIT_ID],
  ["perc african mpc", PERC_AFRICAN_MPC_KIT_ID],
  ["Perc African MPC", PERC_AFRICAN_MPC_KIT_ID]
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
