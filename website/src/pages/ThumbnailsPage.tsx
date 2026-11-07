import { THUMBNAIL_LIMITS, THUMBNAIL_SUPPORT } from '../core/content';
import { findThumbnails, type ThumbnailLookup } from '../core/thumbnail-api';
import { useLinkLookup, type LinkLookupState } from '../hooks/useLinkLookup';
import { LinkForm } from '../ui/LinkForm';
import { ErrorNote, LoadingNote } from '../ui/Notice';
import { PageIntro } from '../ui/PageIntro';
import { PAGE } from '../ui/styles';
import { SupportLists } from '../ui/SupportLists';
import { ThumbnailGrid } from '../ui/ThumbnailGrid';

function renderState(state: LinkLookupState<ThumbnailLookup>) {
  if (state.phase === 'looking') {
    return <LoadingNote text="Looking for thumbnails…" />;
  }
  if (state.phase === 'error') {
    return <ErrorNote message={state.message} />;
  }
  if (state.phase === 'done') {
    return <ThumbnailGrid key={state.result.title} title={state.result.title} summary={state.result.summary} items={state.result.items} />;
  }
  return null;
}

export function ThumbnailsPage() {
  const { state, lookup } = useLinkLookup(findThumbnails);

  return (
    <main className={PAGE}>
      <PageIntro
        eyebrow="Thumbnail finder"
        title="Get the thumbnail of any video."
        text="Paste a YouTube, Vimeo, Dailymotion or TikTok link, or any page with a video. Every size the site offers is listed for download."
      />
      <div className="mt-8">
        <LinkForm
          id="thumbnail-link"
          label="Video or page link"
          placeholder="https://www.youtube.com/watch?v=…"
          action="Find thumbnail"
          busy={state.phase === 'looking'}
          onSubmit={(value) => void lookup(value)}
        />
      </div>
      <div className="mt-6" aria-live="polite">
        {renderState(state)}
      </div>
      <SupportLists works={THUMBNAIL_SUPPORT} limits={THUMBNAIL_LIMITS} />
    </main>
  );
}
