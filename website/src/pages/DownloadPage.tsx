import { useState, type FormEvent } from 'react';
import { TIKTOK_PERMISSION_URL } from '../core/config';
import { bestQuality, formatRows, lookupSummary, type VideoLookup } from '../core/media-api';
import { DOWNLOAD_LIMITS, DOWNLOAD_SUPPORT } from '../core/content';
import { useVideoLookup, type VideoLookupState } from '../hooks/useVideoLookup';
import { FormatList } from '../ui/FormatList';
import { TikTokNotice } from '../ui/TikTokNotice';
import { VideoPreview } from '../ui/VideoPreview';

const FIELD = 'min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-neutral-700 dark:bg-neutral-900';

function renderChoices(lookup: VideoLookup) {
  if (lookup.embed && lookup.formats.length === 0) {
    return <TikTokNotice embed={lookup.embed} permissionUrl={TIKTOK_PERMISSION_URL} />;
  }
  return (
    <>
      <FormatList heading="Choose a quality" rows={formatRows(lookup)} />
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Download links work for 6 hours. Direct files can be resumed from your browser’s downloads list if the connection drops.
      </p>
    </>
  );
}

function renderState(state: VideoLookupState) {
  if (state.phase === 'looking') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
        <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden />
        Looking for video qualities…
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {state.message}
      </p>
    );
  }
  if (state.phase === 'done') {
    return (
      <div className="flex flex-col gap-3">
        <VideoPreview
          key={state.lookup.title}
          title={state.lookup.title}
          summary={lookupSummary(state.lookup)}
          bestQuality={bestQuality(state.lookup)}
          preview={state.lookup.preview}
          embed={state.lookup.embed}
        />
        {renderChoices(state.lookup)}
      </div>
    );
  }
  return null;
}

export function DownloadPage() {
  const { state, lookup } = useVideoLookup();
  const [input, setInput] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void lookup(input);
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Video downloader</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance">Paste a link, pick a quality, download.</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-300">
        Every quality the video offers is listed, from 144p to 4K, with its size and whether it has sound.
      </p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="video-link">
          Video or page link
        </label>
        <input
          id="video-link"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://example.com/videos/launch"
          autoComplete="off"
          inputMode="url"
          className={FIELD}
        />
        <button
          type="submit"
          disabled={state.phase === 'looking'}
          className="rounded-xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          Find video
        </button>
      </form>
      <div className="mt-6" aria-live="polite">
        {renderState(state)}
      </div>
      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="font-semibold">What works</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
            {DOWNLOAD_SUPPORT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-semibold">What does not</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
            {DOWNLOAD_LIMITS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
