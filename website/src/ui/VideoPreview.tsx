import { useState } from 'react';
import type { VideoEmbed, VideoPreview as Preview } from '../core/media-api';

interface VideoPreviewProps {
  title: string;
  summary: string;
  bestQuality: string | null;
  preview: Preview;
  embed: VideoEmbed | null;
}

const FRAME = 'relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800';

function Placeholder() {
  return (
    <div className={`${FRAME} flex items-center justify-center text-neutral-400 dark:text-neutral-500`}>
      <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
      </svg>
      <span className="sr-only">No preview available</span>
    </div>
  );
}

function Thumbnail({ url, title, onFail }: { url: string; title: string; onFail: () => void }) {
  return (
    <div className={FRAME}>
      <img src={url} alt={`Thumbnail of ${title}`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={onFail} />
    </div>
  );
}

function renderCover(thumbnail: string | null, title: string) {
  if (!thumbnail) {
    return <Placeholder />;
  }
  return <img src={thumbnail} alt={`Cover of ${title}`} className="aspect-video w-full rounded-xl object-cover" />;
}

function Player({ preview, thumbnail, title }: { preview: Preview; thumbnail: string | null; title: string }) {
  if (preview.audioOnly) {
    return (
      <div className="flex flex-col gap-3">
        {renderCover(thumbnail, title)}
        <audio controls preload="none" src={preview.mediaUrl as string} className="w-full" aria-label={`Preview of ${title}`} />
      </div>
    );
  }
  return (
    <video
      controls
      preload="metadata"
      playsInline
      src={preview.mediaUrl as string}
      poster={thumbnail || undefined}
      className={`${FRAME} bg-black object-contain`}
      aria-label={`Preview of ${title}`}
    />
  );
}

function EmbeddedPlayer({ embed, title }: { embed: VideoEmbed; title: string }) {
  return (
    <div className="mx-auto aspect-[9/16] w-full max-w-[20rem] overflow-hidden rounded-xl bg-black">
      <iframe
        src={embed.playerUrl}
        title={`TikTok player: ${title}`}
        className="h-full w-full"
        allow="encrypted-media; fullscreen; picture-in-picture"
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    </div>
  );
}

function renderMedia(preview: Preview, embed: VideoEmbed | null, thumbnail: string | null, title: string, onFail: () => void) {
  if (embed) {
    return <EmbeddedPlayer embed={embed} title={title} />;
  }
  if (preview.mediaUrl) {
    return <Player preview={preview} thumbnail={thumbnail} title={title} />;
  }
  if (thumbnail) {
    return <Thumbnail url={thumbnail} title={title} onFail={onFail} />;
  }
  return <Placeholder />;
}

function renderQuality(bestQuality: string | null) {
  if (!bestQuality) {
    return null;
  }
  return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Up to {bestQuality}</span>;
}

export function VideoPreview({ title, summary, bestQuality, preview, embed }: VideoPreviewProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnail = thumbnailFailed ? null : preview.thumbnailUrl;
  return (
    <section className="grid gap-5 rounded-2xl border border-neutral-200 bg-white p-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] dark:border-neutral-800 dark:bg-neutral-900" aria-label="Video preview">
      {renderMedia(preview, embed, thumbnail, title, () => setThumbnailFailed(true))}
      <div className="flex min-w-0 flex-col justify-center gap-2">
        <h2 className="text-lg font-semibold break-words">{title}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{summary}</p>
        <div>{renderQuality(bestQuality)}</div>
      </div>
    </section>
  );
}
