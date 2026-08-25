export function encodeMidiFile(arrangement) {
  const division = Math.max(24, Math.floor(Number(arrangement.ppq ?? 480)));
  const rows = [];
  for (const tempo of arrangement.tempos) {
    rows.push([Math.max(0, Math.floor(tempo.tick)), 0, tempoEvent(tempo.bpm)]);
  }
  for (const hit of arrangement.events) {
    const at = Math.max(0, Math.floor(hit.tick));
    const off = Math.max(at + 1, Math.floor(hit.tick + hit.durationTicks));
    rows.push([at, 2, [0x99, byte(hit.note), byte(hit.velocity)]]);
    rows.push([off, 1, [0x89, byte(hit.note), 0]]);
  }
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const track = [];
  variable(track, 0);
  bytes(track, [0xff, 0x03, 0x05, 82, 97, 100, 105, 111]);
  let last = 0;
  for (const [tick, , data] of rows) {
    variable(track, tick - last);
    bytes(track, data);
    last = tick;
  }
  variable(track, 0);
  bytes(track, [0xff, 0x2f, 0]);

  const file = [];
  bytes(file, [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]);
  word(file, 0);
  word(file, 1);
  word(file, division);
  bytes(file, [0x4d, 0x54, 0x72, 0x6b]);
  quad(file, track.length);
  bytes(file, track);
  return new Uint8Array(file);
}

function tempoEvent(bpm) {
  const micros = Math.max(1, Math.round(60000000 / Math.max(1, Number(bpm))));
  return [0xff, 0x51, 3, (micros >>> 16) & 255, (micros >>> 8) & 255, micros & 255];
}

function variable(out, value) {
  let number = Math.max(0, Math.floor(value));
  const stack = [number & 127];
  number >>>= 7;
  while (number) {
    stack.unshift((number & 127) | 128);
    number >>>= 7;
  }
  bytes(out, stack);
}

function bytes(out, values) {
  for (const value of values) out.push(value & 255);
}

function word(out, value) {
  out.push((value >>> 8) & 255, value & 255);
}

function quad(out, value) {
  out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function byte(value) {
  return Math.max(0, Math.min(127, Math.floor(Number(value))));
}
