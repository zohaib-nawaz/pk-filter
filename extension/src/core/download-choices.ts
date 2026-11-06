import { formatBytes } from './download-errors';
import type { MediaInfo } from './types';

export interface DownloadChoice {
  label: string;
  detail: string;
  maxHeight?: number;
  audioOnly?: boolean;
}

const AUDIO_CHOICE: DownloadChoice = { label: 'Audio only', detail: '', audioOnly: true };

function sizeDetail(bytes: number | null): string {
  if (bytes === null) {
    return '';
  }
  return `~${formatBytes(bytes)}`;
}

function qualityChoices(info: MediaInfo): DownloadChoice[] {
  if (!info.qualities) {
    return [];
  }
  return info.qualities.map((quality) => ({ label: `${quality.height}p`, detail: sizeDetail(quality.sizeBytes), maxHeight: quality.height }));
}

export function downloadChoices(info: MediaInfo): DownloadChoice[] {
  const choices = qualityChoices(info);
  if (info.audioOnly) {
    choices.push(AUDIO_CHOICE);
  }
  if (choices.length < 2) {
    return [];
  }
  return choices;
}
