export function encodeMidiFile(rendered) {
  const ppq = rendered.ppq ?? 480;
  const messages = [];

  for (const tempo of rendered.tempos) {
    messages.push({ tick: tempo.tick, order: 0, bytes: tempoBytes(tempo.bpm) });
  }

  for (const event of rendered.events) {
    const note = clampByte(event.note);
    const velocity = clampByte(event.velocity);
    messages.push({
      tick: event.tick,
      order: 2,
      bytes: [0x99, note, velocity]
    });
    messages.push({
      tick: event.tick + event.durationTicks,
      order: 1,
      bytes: [0x89, note, 0]
    });
  }

  messages.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.order - b.order;
  });

  const track = [];
  pushVar(track, 0);
  pushBytes(track, [0xff, 0x03, 0x05, ...ascii("Radio")]);

  let previousTick = 0;
  for (const message of messages) {
    pushDelta(track, message.tick - previousTick);
    pushBytes(track, message.bytes);
    previousTick = message.tick;
  }

  pushVar(track, 0);
  pushBytes(track, [0xff, 0x2f, 0x00]);

  const output = [];
  pushBytes(output, [...ascii("MThd"), 0x00, 0x00, 0x00, 0x06]);
  pushU16(output, 0);
  pushU16(output, 1);
  pushU16(output, ppq);
  pushBytes(output, ascii("MTrk"));
  pushU32(output, track.length);
  pushBytes(output, track);
  return new Uint8Array(output);
}

const MAX_MIDI_DELTA = 0x0fffffff;

function tempoBytes(bpm) {
  const microsPerQuarter = Math.max(1, Math.round(60000000 / bpm));
  return [
    0xff,
    0x51,
    0x03,
    (microsPerQuarter >> 16) & 0xff,
    (microsPerQuarter >> 8) & 0xff,
    microsPerQuarter & 0xff
  ];
}

function pushDelta(output, value) {
  let remaining = Math.max(0, Math.floor(Number(value)));
  while (remaining > MAX_MIDI_DELTA) {
    pushVar(output, MAX_MIDI_DELTA);
    pushBytes(output, [0xff, 0x01, 0x00]);
    remaining -= MAX_MIDI_DELTA;
  }
  pushVar(output, remaining);
}

function pushVar(output, value) {
  let remaining = Math.max(0, Math.floor(Number(value)));
  const bytes = [remaining % 128];
  remaining = Math.floor(remaining / 128);
  while (remaining > 0) {
    bytes.unshift((remaining % 128) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  for (const byte of bytes) {
    output.push(byte);
  }
}

function pushU16(output, value) {
  output.push((value >> 8) & 0xff, value & 0xff);
}

function pushU32(output, value) {
  output.push(
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff
  );
}

function pushBytes(output, bytes) {
  for (const byte of bytes) output.push(byte);
}

function ascii(text) {
  return Array.from(text).map((char) => char.charCodeAt(0) & 0x7f);
}

function clampByte(value) {
  return Math.max(0, Math.min(127, Math.floor(Number(value))));
}
