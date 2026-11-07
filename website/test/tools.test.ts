import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activePreset,
  applyPreset,
  archiveName,
  defaultSettings,
  describeOutput,
  describeSize,
  FRAME_PRESETS,
  MAX_FRAMES,
  outputSize,
  parseClock,
  planFrames,
  sampleKey,
  sampleTimes,
} from '../src/core/frames';
import { linkFrom } from '../src/core/link-input';
import { findThumbnails } from '../src/core/thumbnail-api';
import { crc32, makeZip } from '../src/core/zip';
import { appendToken, DEFAULT_NAMING, nameFrames, previewNames, timeToken } from '../src/core/frame-names';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frame planning', () => {
  it('spaces frames by the frame rate inside the chosen range', () => {
    const settings = { ...defaultSettings(10), start: 2, end: 4, fps: 2 };
    expect(planFrames(settings, 10)).toEqual({ times: [2, 2.5, 3, 3.5, 4], wanted: 5, capped: false });
    expect(planFrames({ ...settings, start: 0, end: 60, fps: 0.1 }, 60).times).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it('spreads an exact number of frames evenly over the range', () => {
    const settings = { ...defaultSettings(10), spacing: 'count' as const, count: 5, start: 2, end: 6 };
    expect(planFrames(settings, 10).times).toEqual([2, 3, 4, 5, 6]);
    expect(planFrames({ ...settings, count: 1 }, 10).times).toEqual([2]);
    expect(planFrames({ ...settings, count: 5000 }, 10).times).toHaveLength(MAX_FRAMES);
  });

  it('keeps frames inside the video and caps very long runs', () => {
    const plan = planFrames({ ...defaultSettings(120), fps: 30 }, 120);
    expect(plan.times).toHaveLength(MAX_FRAMES);
    expect(plan.capped).toBe(true);
    expect(plan.wanted).toBeGreaterThan(MAX_FRAMES);
    const tail = planFrames({ ...defaultSettings(5), start: 9, end: 20 }, 5);
    expect(tail.times).toEqual([4.999]);
    expect(planFrames({ ...defaultSettings(5), fps: 0 }, 5).times.length).toBeGreaterThan(0);
  });

  it('shrinks by the short side and never enlarges', () => {
    expect(outputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1080, 1920, 360)).toEqual({ width: 360, height: 640 });
    expect(outputSize(640, 360, 1080)).toEqual({ width: 640, height: 360 });
    expect(outputSize(640, 360, null)).toEqual({ width: 640, height: 360 });
  });

  it('applies and recognises quality presets', () => {
    const compressed = FRAME_PRESETS.find((preset) => preset.id === 'compressed');
    const settings = applyPreset(defaultSettings(10), compressed as (typeof FRAME_PRESETS)[number]);
    expect(activePreset(settings)).toBe('compressed');
    expect(describeOutput(1920, 1080, settings)).toBe('640 × 360 WebP, 50%');
    expect(activePreset({ ...settings, quality: 0.51 })).toBeNull();
    expect(describeOutput(1920, 1080, defaultSettings(10))).toBe('1920 × 1080 JPG, 92%');
  });

  it('estimates the total size from sampled frames', () => {
    expect(sampleTimes(10)).toEqual([2, 5, 7.999]);
    expect(describeSize(null, 10)).toBe('working out the size…');
    expect(describeSize(100 * 1024, 120)).toBe('about 12 MB (100 KB each)');
    const settings = defaultSettings(10);
    expect(sampleKey({ ...settings, count: 99, start: 3 })).toBe(sampleKey(settings));
    expect(sampleKey({ ...settings, quality: 0.5 })).not.toBe(sampleKey(settings));
  });

  it('reads and writes times and names files by position', () => {
    expect(parseClock('75')).toBe(75);
    expect(parseClock('1:15.5')).toBe(75.5);
    expect(parseClock('1:00:02')).toBe(3602);
    expect(parseClock('abc')).toBeNull();
    expect(archiveName('Holiday: day 1.mp4')).toBe('Holiday day 1 frames.zip');
  });
});

describe('zip archive', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  it('stores files with matching local and central records', async () => {
    const data = new TextEncoder().encode('frame bytes');
    const blob = await makeZip([{ name: 'frame-0001.jpg', data: new Blob([data]) }, { name: 'frame-0002.jpg', data: new Blob([data]) }], new Date(2026, 10, 7, 12, 30, 10));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(crc32(data));
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    const secondLocal = view.getUint32(centralOffset + 46 + 14 + 42, true);
    expect(view.getUint32(secondLocal, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(bytes.subarray(secondLocal + 30, secondLocal + 44))).toBe('frame-0002.jpg');
  });
});

describe('frame names', () => {
  const context = { title: 'Moon: night.mp4', width: 720, height: 1280, fps: 2, date: new Date(2026, 10, 7) };
  const frames = [0, 1, 2].map((index) => ({ index, time: index * 0.5 + 61, type: 'image/jpeg' }));

  it('fills every variable and pads the counter', () => {
    expect(nameFrames(frames, DEFAULT_NAMING, context)).toEqual(['frame-001.jpg', 'frame-002.jpg', 'frame-003.jpg']);
    const custom = { pattern: '{date}_{title}_{width}x{height}_{fps}fps_{n}_{time}_{ms}', digits: 2, start: 0 };
    expect(nameFrames(frames, custom, context)[1]).toBe('2026-11-07_Moon night_720x1280_2fps_01_1-01.500_61500.jpg');
    expect(nameFrames(frames, { ...DEFAULT_NAMING, digits: 1, start: 9 }, context)).toEqual(['frame-9.jpg', 'frame-10.jpg', 'frame-11.jpg']);
  });

  it('keeps names safe and unique', () => {
    expect(nameFrames(frames, { ...DEFAULT_NAMING, pattern: 'shot/{title}' }, context)).toEqual(['shot-Moon night.jpg', 'shot-Moon night-2.jpg', 'shot-Moon night-3.jpg']);
    expect(nameFrames(frames.slice(0, 1), { ...DEFAULT_NAMING, pattern: '   ' }, context)).toEqual(['frame-001.jpg']);
    expect(nameFrames(frames.slice(0, 1), { ...DEFAULT_NAMING, pattern: '{unknown}' }, context)).toEqual(['{unknown}.jpg']);
  });

  it('builds patterns and previews', () => {
    expect(appendToken('', '{n}')).toBe('{n}');
    expect(appendToken('shot', '{n}')).toBe('shot-{n}');
    expect(appendToken('shot_', '{n}')).toBe('shot_{n}');
    expect(timeToken(3725.25)).toBe('1-02-05.250');
    expect(previewNames(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', '…', 'd']);
  });
});

describe('thumbnail lookup', () => {
  it('turns tokens into image and download links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ title: 'Launch talk', source: 'youtube', author: 'Example', thumbnails: [{ label: 'Full HD', token: 'abc' }, { label: 'bad' }] }),
      ),
    );
    const result = await findThumbnails('https://youtu.be/dQw4w9WgXcQ');
    expect(result.summary).toBe('YouTube · by Example · 1 size');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.src).toMatch(/\/api\/v1\/media\/thumbnail\?t=abc$/);
    expect(result.items[0]?.href).toMatch(/\/api\/v1\/media\/thumbnail\?t=abc&download=1$/);
  });

  it('accepts bare links and rejects junk', () => {
    expect(linkFrom('youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(linkFrom('not a link')).toBeNull();
  });
});
