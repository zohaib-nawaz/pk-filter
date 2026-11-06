export type FormatRef = (
  | { kind: 'file'; url: string; extension: string }
  | { kind: 'hls'; manifest: string; variant: number | null; audioOnly: boolean }
  | { kind: 'dash'; manifest: string; rendition: number }
) & { referer?: string };

export interface ThumbnailRef {
  kind: 'thumbnail';
  url: string;
  referer?: string;
}

export type TicketRef = FormatRef | ThumbnailRef;

export interface MediaFormat {
  label: string;
  detail: string;
  height: number | null;
  sizeBytes: number | null;
  exactSize: boolean;
  container: string;
  audio: 'included' | 'only' | 'none';
  ref: FormatRef;
}

export interface MediaEmbed {
  provider: 'tiktok';
  playerUrl: string;
  openUrl: string;
  author: string | null;
  authorUrl: string | null;
}

export interface MediaInspection {
  title: string;
  source: 'file' | 'hls' | 'dash' | 'page' | 'tiktok';
  durationSeconds: number | null;
  thumbnail: string | null;
  embed?: MediaEmbed;
  formats: MediaFormat[];
}

export class MediaUnavailable extends Error {
  constructor(
    readonly reason: 'restricted' | 'not_found' | 'unsupported',
    message: string,
  ) {
    super(message);
  }
}
