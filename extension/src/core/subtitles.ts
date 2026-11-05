export interface SubtitleTrack {
  language: string;
  segments: string[];
}

const HEADER = /^﻿?WEBVTT[^\n]*\n(?:[^\n]+\n)*\n?/;

export function mergeVtt(parts: string[]): string {
  const normalized = parts.map((part) => part.replace(/\r\n?/g, '\n'));
  const [first, ...rest] = normalized;
  if (first === undefined) {
    return '';
  }
  const bodies = rest.map((part) => part.replace(HEADER, '').trim()).filter(Boolean);
  return [first.trim(), ...bodies].join('\n\n').concat('\n');
}

export function subtitleLanguage(value: string | undefined): string {
  if (!value) {
    return 'subtitles';
  }
  const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12);
  if (!clean) {
    return 'subtitles';
  }
  return clean;
}
