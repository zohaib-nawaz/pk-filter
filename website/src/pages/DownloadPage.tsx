import { TIKTOK_PERMISSION_URL } from '../core/config';
import { bestQuality, formatRows, lookupSummary, lookupVideo, type VideoLookup } from '../core/media-api';
import { DOWNLOAD_LIMITS, DOWNLOAD_SUPPORT } from '../core/content';
import { useLinkLookup, type LinkLookupState } from '../hooks/useLinkLookup';
import { FormatList } from '../ui/FormatList';
import { LinkForm } from '../ui/LinkForm';
import { ErrorNote, LoadingNote } from '../ui/Notice';
import { PageIntro } from '../ui/PageIntro';
import { PAGE } from '../ui/styles';
import { SupportLists } from '../ui/SupportLists';
import { TikTokNotice } from '../ui/TikTokNotice';
import { VideoPreview } from '../ui/VideoPreview';

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

function renderState(state: LinkLookupState<VideoLookup>) {
  if (state.phase === 'looking') {
    return <LoadingNote text="Looking for video qualities…" />;
  }
  if (state.phase === 'error') {
    return <ErrorNote message={state.message} />;
  }
  if (state.phase === 'done') {
    return (
      <div className="flex flex-col gap-3">
        <VideoPreview
          key={state.result.title}
          title={state.result.title}
          summary={lookupSummary(state.result)}
          bestQuality={bestQuality(state.result)}
          preview={state.result.preview}
          embed={state.result.embed}
        />
        {renderChoices(state.result)}
      </div>
    );
  }
  return null;
}

export function DownloadPage() {
  const { state, lookup } = useLinkLookup(lookupVideo);

  return (
    <main className={PAGE}>
      <PageIntro
        eyebrow="Video downloader"
        title="Paste a link, pick a quality, download."
        text="Every quality the video offers is listed, from 144p to 4K, with its size and whether it has sound."
      />
      <div className="mt-8">
        <LinkForm
          id="video-link"
          label="Video or page link"
          placeholder="https://example.com/videos/launch"
          action="Find video"
          busy={state.phase === 'looking'}
          onSubmit={(value) => void lookup(value)}
        />
      </div>
      <div className="mt-6" aria-live="polite">
        {renderState(state)}
      </div>
      <SupportLists works={DOWNLOAD_SUPPORT} limits={DOWNLOAD_LIMITS} />
    </main>
  );
}
