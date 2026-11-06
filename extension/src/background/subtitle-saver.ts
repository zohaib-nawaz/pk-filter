import { mergeVtt, type SubtitleTrack } from '../core/subtitles';
import { saveFile } from './download-names';

const MAX_SEGMENTS = 2_000;
const MAX_BYTES = 1_400_000;
const TIMEOUT_MS = 15_000;

async function fetchParts(segments: string[]): Promise<string[]> {
  const parts: string[] = [];
  let total = 0;
  for (const url of segments.slice(0, MAX_SEGMENTS)) {
    const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Subtitles returned ${response.status}`);
    }
    const text = await response.text();
    total += new TextEncoder().encode(text).byteLength;
    if (total > MAX_BYTES) {
      throw new Error('Subtitles are too large');
    }
    parts.push(text);
  }
  return parts;
}

function downloadUrl(text: string): string {
  if (typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
  }
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:text/vtt;charset=utf-8;base64,${btoa(binary)}`;
}

export async function saveSubtitles(track: SubtitleTrack, title: string): Promise<void> {
  const text = mergeVtt(await fetchParts(track.segments));
  if (!text.trim().startsWith('WEBVTT') && !text.trim().startsWith('﻿WEBVTT')) {
    throw new Error('These subtitles are not in WebVTT format');
  }
  await saveFile(downloadUrl(text), `${title}.${track.language}`, 'vtt');
}
