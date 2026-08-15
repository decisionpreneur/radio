export const DRUM_LANES = Object.freeze([
  { name: "Ride Cup Gen Purpose", note: 51, color: "#9fb7cf" },
  { name: "Ride Gen Purpose", note: 50, color: "#8da7bf" },
  { name: "Crash Gen Purpose 2", note: 49, color: "#d2c071" },
  { name: "Crash Gen Purpose", note: 48, color: "#c8b35e" },
  { name: "Tom High Gen Purpose", note: 47, color: "#b07a55" },
  { name: "Hihat Open Gen Purpose 2", note: 46, color: "#c9c9a5" },
  { name: "Tom High-Mid Gen Purpose", note: 45, color: "#a96f50" },
  { name: "Hihat Open Gen Purpose", note: 44, color: "#bfc28f" },
  { name: "Tom Low-Mid Gen Purpose", note: 43, color: "#965f48" },
  { name: "Hihat Closed Gen Purpose", note: 42, color: "#aeb47d" },
  { name: "Tom Low Gen Purpose", note: 41, color: "#86523f" },
  { name: "Snare Gen Purpose 3", note: 40, color: "#d18b83" },
  { name: "Snare Gen Purpose 2", note: 39, color: "#c97e77" },
  { name: "Snare Gen Purpose", note: 38, color: "#bd736c" },
  { name: "Rim Sidestick Gen Purpose", note: 37, color: "#cab2a0" },
  { name: "Kick Tight Gen Purpose", note: 36, color: "#7f8c75" }
]);

export function laneByName(name) {
  return DRUM_LANES.find((lane) => lane.name === name);
}

export function pickLane(rng) {
  return DRUM_LANES[Math.floor(rng() * DRUM_LANES.length)];
}
