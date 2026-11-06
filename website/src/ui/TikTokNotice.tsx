import type { VideoEmbed } from '../core/media-api';

interface TikTokNoticeProps {
  embed: VideoEmbed;
  permissionUrl: string;
}

function renderAuthor(embed: VideoEmbed) {
  if (!embed.author || !embed.authorUrl) {
    return null;
  }
  return (
    <a href={embed.authorUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
      {embed.author}
    </a>
  );
}

export function TikTokNotice({ embed, permissionUrl }: TikTokNoticeProps) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" aria-label="TikTok">
      <div>
        <h3 className="font-semibold">Save it in TikTok</h3>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          TikTok videos are saved through TikTok. If the creator allows it, open the video and tap Share, then Save video. Direct TikTok downloads will be added
          here through TikTok’s official access.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href={embed.openUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-emerald-700">
          Open in TikTok
        </a>
        {renderAuthor(embed)}
        <a href={permissionUrl} className="text-neutral-500 underline hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100">
          TikTok permission
        </a>
      </div>
    </section>
  );
}
