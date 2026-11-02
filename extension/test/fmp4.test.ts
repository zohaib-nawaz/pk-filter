import { describe, expect, it } from 'vitest';
import { interleave, mergeInitSegments, parseSidx, retagFragment } from '../src/core/fmp4';
import { canCombine, type StreamTrack } from '../src/core/hls';
import { newStreamJob } from '../src/core/stream-jobs';

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const body = children.reduce((all, child) => new Uint8Array([...all, ...child]), new Uint8Array());
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((char) => char.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

const fullBox = (type: string, payload: Uint8Array) => box(type, new Uint8Array([0, 0, 0, 0]), payload);
const tkhd = (id: number) => fullBox('tkhd', new Uint8Array([...uint32(0), ...uint32(0), ...uint32(id), ...new Uint8Array(68)]));
const mvhd = (nextId: number) => fullBox('mvhd', new Uint8Array([...new Uint8Array(92), ...uint32(nextId)]));
const trex = (id: number) => fullBox('trex', new Uint8Array([...uint32(id), ...new Uint8Array(16)]));
const trak = (id: number, handler: string) => box('trak', tkhd(id), box('mdia', box('hdlr', new TextEncoder().encode(`....${handler}`))));
const init = (id: number, handler: string) => new Uint8Array([...box('ftyp', new TextEncoder().encode('iso6')), ...box('moov', mvhd(id + 1), trak(id, handler), box('mvex', trex(id)))]);
const fragment = (id: number) => new Uint8Array([...box('moof', box('mfhd', uint32(1)), box('traf', fullBox('tfhd', uint32(id)))), ...box('mdat', new Uint8Array([1, 2, 3]))]);

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint32(offset);
}

function boxesIn(data: Uint8Array, start = 0, end = data.length): Array<{ type: string; start: number; size: number }> {
  const out = [];
  for (let offset = start; offset + 8 <= end; ) {
    const size = readU32(data, offset);
    out.push({ type: String.fromCharCode(...data.subarray(offset + 4, offset + 8)), start: offset, size });
    offset += size;
  }
  return out;
}

describe('mergeInitSegments', () => {
  it('puts the audio track into the video init with a new track id', () => {
    const { init: merged, audioTrackId } = mergeInitSegments(init(1, 'vide'), init(1, 'soun'));
    expect(audioTrackId).toBe(2);
    const top = boxesIn(merged);
    expect(top.map((item) => item.type)).toEqual(['ftyp', 'moov']);
    const moov = top[1] as { start: number; size: number };
    const children = boxesIn(merged, moov.start + 8, moov.start + moov.size);
    expect(children.map((item) => item.type)).toEqual(['mvhd', 'trak', 'trak', 'mvex']);
    const mvhdBox = children[0] as { start: number; size: number };
    expect(readU32(merged, mvhdBox.start + mvhdBox.size - 4)).toBe(3);
    const ids = children.filter((item) => item.type === 'trak').map((item) => readU32(merged, item.start + 8 + 8 + 12));
    expect(ids).toEqual([1, 2]);
    const handlers = new TextDecoder().decode(merged);
    expect(handlers).toContain('vide');
    expect(handlers).toContain('soun');
    const mvex = children[3] as { start: number; size: number };
    const trexIds = boxesIn(merged, mvex.start + 8, mvex.start + mvex.size).map((item) => readU32(merged, item.start + 12));
    expect(trexIds).toEqual([1, 2]);
  });

  it('refuses inputs that are not fragmented MP4', () => {
    expect(() => mergeInitSegments(new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101]), init(1, 'soun'))).toThrow('Missing video moov');
  });
});

describe('retagFragment', () => {
  it('moves audio fragments to the new track id without touching the original', () => {
    const original = fragment(1);
    const retagged = retagFragment(original, 2);
    const moof = boxesIn(retagged)[0] as { start: number; size: number };
    const traf = boxesIn(retagged, moof.start + 8, moof.start + moof.size)[1] as { start: number; size: number };
    const tfhd = boxesIn(retagged, traf.start + 8, traf.start + traf.size)[0] as { start: number };
    expect(readU32(retagged, tfhd.start + 12)).toBe(2);
    expect(readU32(original, tfhd.start + 12)).toBe(1);
    expect(retagged.length).toBe(original.length);
  });
});

describe('combining tracks', () => {
  const track = (kind: StreamTrack['kind'], withInit: boolean): StreamTrack => ({
    kind,
    extension: kind === 'video' ? 'mp4' : 'm4a',
    init: withInit ? { url: `https://cdn.example.com/${kind}/init.mp4`, range: null } : null,
    segments: [{ url: `https://cdn.example.com/${kind}/1.m4s`, range: null }],
  });

  it('combines only fragmented video plus audio into a single file job', () => {
    expect(canCombine([track('video', true), track('audio', true)])).toBe(true);
    expect(canCombine([track('video', false), track('audio', false)])).toBe(false);
    expect(canCombine([track('video', true)])).toBe(false);
    const plan = { manifestUrl: 'https://cdn.example.com/m.m3u8', tracks: [track('video', true), track('audio', true)], combine: true, durationSeconds: 6, estimatedBytes: null, resolution: null };
    expect(newStreamJob('j', plan, 'Talk', 'https://site.org', new Date()).trackCount).toBe(1);
    expect(newStreamJob('j', { ...plan, combine: false }, 'Talk', 'https://site.org', new Date()).trackCount).toBe(2);
  });

  it('interleaves video and audio segments so playback stays in sync', () => {
    expect(interleave(['v1', 'v2', 'v3'], ['a1', 'a2', 'a3', 'a4'])).toEqual(['v1', 'a1', 'v2', 'a2', 'v3', 'a3', 'a4']);
  });
});

describe('parseSidx', () => {
  const sidx = (references: number[], firstOffset = 0, hierarchical = false) => {
    const refs = references.flatMap((size) => [...uint32((hierarchical ? 0x80000000 : 0) | size), ...uint32(1000), ...uint32(0x90000000)]);
    return fullBox('sidx', new Uint8Array([...uint32(1), ...uint32(1000), ...uint32(0), ...uint32(firstOffset), 0, 0, 0, references.length, ...refs]));
  };

  it('turns the index into exact fragment byte ranges in the file', () => {
    const box = sidx([500, 700, 300]);
    expect(parseSidx(box, 1000)).toEqual([
      { start: 1000 + box.length, end: 1000 + box.length + 499 },
      { start: 1000 + box.length + 500, end: 1000 + box.length + 1199 },
      { start: 1000 + box.length + 1200, end: 1000 + box.length + 1499 },
    ]);
    expect(parseSidx(sidx([100], 16), 0)?.[0]?.start).toBe(sidx([100], 16).length + 16);
  });

  it('gives up on nested indexes and missing boxes so the caller can fall back', () => {
    expect(parseSidx(sidx([100], 0, true), 0)).toBeNull();
    expect(parseSidx(new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101]), 0)).toBeNull();
  });
});
