interface Box {
  type: string;
  start: number;
  size: number;
  header: number;
}

function readBoxes(data: Uint8Array, start = 0, end = data.length): Box[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) break;
    boxes.push({ type: String.fromCharCode(...data.subarray(offset + 4, offset + 8)), start: offset, size, header });
    offset += size;
  }
  return boxes;
}

function childrenOf(data: Uint8Array, parent: Box): Box[] {
  return readBoxes(data, parent.start + parent.header, parent.start + parent.size);
}

function find(boxes: Box[], type: string): Box | undefined {
  return boxes.find((box) => box.type === type);
}

function bytesOf(data: Uint8Array, box: Box): Uint8Array {
  return data.slice(box.start, box.start + box.size);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function makeBox(type: string, children: Uint8Array[]): Uint8Array {
  const body = concat(children);
  const out = new Uint8Array(8 + body.byteLength);
  new DataView(out.buffer).setUint32(0, out.byteLength);
  out.set([...type].map((char) => char.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
}

function trackIdOffset(data: Uint8Array, tkhd: Box): number {
  const content = tkhd.start + tkhd.header;
  return content + (data[content] === 1 ? 20 : 12);
}

function expectBox<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Missing ${what} box`);
  return value;
}

function trackId(data: Uint8Array, trak: Box): number {
  const tkhd = expectBox(find(childrenOf(data, trak), 'tkhd'), 'tkhd');
  return new DataView(data.buffer, data.byteOffset).getUint32(trackIdOffset(data, tkhd));
}

function withUint32(source: Uint8Array, box: Box, absoluteOffset: number, value: number): Uint8Array {
  const copy = bytesOf(source, box);
  new DataView(copy.buffer).setUint32(absoluteOffset - box.start, value);
  return copy;
}

export interface MergedInit {
  init: Uint8Array<ArrayBuffer>;
  audioTrackId: number;
}

export function mergeInitSegments(video: Uint8Array, audio: Uint8Array): MergedInit {
  const videoTop = readBoxes(video);
  const videoMoov = expectBox(find(videoTop, 'moov'), 'video moov');
  const audioMoov = expectBox(find(readBoxes(audio), 'moov'), 'audio moov');
  const videoChildren = childrenOf(video, videoMoov);
  const audioChildren = childrenOf(audio, audioMoov);

  const videoTraks = videoChildren.filter((box) => box.type === 'trak');
  if (videoTraks.length === 0) throw new Error('Missing video trak box');
  const audioTrackId = Math.max(...videoTraks.map((trak) => trackId(video, trak))) + 1;

  const audioTrak = expectBox(find(audioChildren, 'trak'), 'audio trak');
  const audioTkhd = expectBox(find(childrenOf(audio, audioTrak), 'tkhd'), 'audio tkhd');
  const patchedTrak = withUint32(audio, audioTrak, trackIdOffset(audio, audioTkhd), audioTrackId);

  const audioTrex = expectBox(find(childrenOf(audio, expectBox(find(audioChildren, 'mvex'), 'audio mvex')), 'trex'), 'audio trex');
  const patchedTrex = withUint32(audio, audioTrex, audioTrex.start + audioTrex.header + 4, audioTrackId);
  const videoMvex = expectBox(find(videoChildren, 'mvex'), 'video mvex');
  const mvex = makeBox('mvex', [...childrenOf(video, videoMvex).map((box) => bytesOf(video, box)), patchedTrex]);

  const mvhd = expectBox(find(videoChildren, 'mvhd'), 'video mvhd');
  const patchedMvhd = withUint32(video, mvhd, mvhd.start + mvhd.size - 4, audioTrackId + 1);
  const kept = videoChildren.filter((box) => box.type !== 'mvhd' && box.type !== 'mvex').map((box) => bytesOf(video, box));
  const moov = makeBox('moov', [patchedMvhd, ...kept, patchedTrak, mvex]);

  const ftyp = find(videoTop, 'ftyp');
  return { init: concat(ftyp ? [bytesOf(video, ftyp), moov] : [moov]), audioTrackId };
}

export function retagFragment(fragment: Uint8Array, trackIdValue: number): Uint8Array<ArrayBuffer> {
  const copy = concat([fragment]);
  const view = new DataView(copy.buffer);
  for (const top of readBoxes(copy)) {
    if (top.type === 'sidx') view.setUint32(top.start + top.header + 4, trackIdValue);
    if (top.type !== 'moof') continue;
    for (const traf of childrenOf(copy, top).filter((box) => box.type === 'traf')) {
      const tfhd = find(childrenOf(copy, traf), 'tfhd');
      if (tfhd) view.setUint32(tfhd.start + tfhd.header + 4, trackIdValue);
    }
  }
  return copy;
}

export function interleave<T>(first: T[], second: T[]): T[] {
  const out: T[] = [];
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    if (index < first.length) out.push(first[index] as T);
    if (index < second.length) out.push(second[index] as T);
  }
  return out;
}
