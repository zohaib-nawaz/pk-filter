import { useState } from 'react';
import type { ThumbnailItem } from '../core/thumbnail-api';
import { BUTTON } from './styles';

interface ThumbnailGridProps {
  title: string;
  summary: string;
  items: ThumbnailItem[];
}

function sizeText(size: { width: number; height: number } | null): string {
  if (!size) {
    return 'Loading…';
  }
  return `${size.width} × ${size.height}`;
}

function ThumbnailCard({ item, title }: { item: ThumbnailItem; title: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return null;
  }
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <a href={item.src} target="_blank" rel="noopener noreferrer" className="block bg-[repeating-conic-gradient(#f4f4f5_0_25%,#fff_0_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)]">
        <img
          src={item.src}
          alt={`${item.label} thumbnail of ${title}`}
          className="aspect-video w-full object-contain"
          loading="lazy"
          onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
        />
      </a>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block font-semibold">{item.label}</span>
          <span className="block text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{sizeText(size)}</span>
        </span>
        <a
          href={item.href}
          rel="nofollow"
          className={`${BUTTON} flex-none`}
          aria-label={`Download ${item.label} thumbnail`}
        >
          Download
        </a>
      </div>
    </li>
  );
}

export function ThumbnailGrid({ title, summary, items }: ThumbnailGridProps) {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-xl font-semibold text-balance">{title}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{summary}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <ThumbnailCard key={item.key} item={item} title={title} />
        ))}
      </ul>
    </section>
  );
}
