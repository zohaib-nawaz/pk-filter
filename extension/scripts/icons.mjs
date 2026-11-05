import { crc32, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function pixel(x, y, size) {
  const c = (size - 1) / 2;
  const d = Math.hypot(x - c, y - c) / (size / 2);
  if (d > 0.98) {
    return [0, 0, 0, 0];
  }
  if (d > 0.84) {
    return [24, 128, 56, 255];
  }
  const inCheck =
    (Math.abs(y - (x + size * 0.12)) < size * 0.07 && x > size * 0.28 && x < size * 0.46) ||
    (Math.abs(y - (-1.25 * x + size * 1.18)) < size * 0.08 && x >= size * 0.42 && x < size * 0.74);
  return inCheck ? [255, 255, 255, 255] : [24, 128, 56, 255];
}

export function iconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      Buffer.from(pixel(x, y, size)).copy(raw, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
