import { HOUR_OPTIONS } from '../core/night';
import { CHECK_FREQUENCIES, FILTER_MODES, MAX_STREAM_DOMAINS, parseStreamDomain, STREAM_QUALITIES } from '../core/settings';
import type { OverviewStats } from '../core/types';
import { dimmedWhen } from '../ui/classes';
import { Button } from '../ui/components/Button';
import { DomainListEditor } from '../ui/components/DomainListEditor';
import { ErrorText } from '../ui/components/ErrorText';
import { OptionList } from '../ui/components/OptionList';
import { Section } from '../ui/components/Section';
import { SelectField } from '../ui/components/SelectField';
import { ServiceSummary } from '../ui/components/ServiceSummary';
import { Switch } from '../ui/components/Switch';
import { useFailureHelper } from '../ui/hooks/useFailureHelper';
import { useOverview } from '../ui/hooks/useOverview';
import { useSettings } from '../ui/hooks/useSettings';
import { useVideoDownloader } from '../ui/hooks/useVideoDownloader';

const COUNTRIES = [{ value: 'PK', label: 'Pakistan' }];

function ispOptions(overview: OverviewStats | null, preferredIsp: string): Array<{ value: string; label: string }> {
  const isps = new Set<string>();
  if (overview) {
    for (const network of overview.service.networks) {
      if (network.isp && network.isp !== 'unknown') {
        isps.add(network.isp);
      }
    }
  }
  if (preferredIsp) {
    isps.add(preferredIsp);
  }
  return [{ value: '', label: 'All networks' }, ...[...isps].map((isp) => ({ value: isp, label: isp }))];
}

export function App() {
  const { settings, update } = useSettings();
  const { overview, busy, refresh, clearCache } = useOverview();
  const downloader = useVideoDownloader(settings, update);
  const failureHelper = useFailureHelper(settings, update);

  if (!settings) {
    return null;
  }

  const networkOptions = ispOptions(overview, settings.preferredIsp);

  const addStreamDomain = (input: string): string | null => {
    const domain = parseStreamDomain(input);
    if (!domain) {
      return 'Enter a website like example.com';
    }
    if (settings.streamDomains.includes(domain)) {
      return 'This website is already in the list';
    }
    if (settings.streamDomains.length >= MAX_STREAM_DOMAINS) {
      return `You can add up to ${MAX_STREAM_DOMAINS} websites`;
    }
    void update((current) => ({ streamDomains: [...current.streamDomains.filter((item) => item !== domain), domain] }));
    return null;
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-10">
      <header>
        <h1 className="text-xl font-semibold">PK Access Filter settings</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Shows whether Google, Bing and DuckDuckGo results open from Pakistani networks. Nothing is hidden unless you choose a filter.
        </p>
      </header>

      <Section title="General">
        <Switch checked={settings.enabled} label="Enable on search results" description="Google, Bing and DuckDuckGo" onChange={(enabled) => void update({ enabled })} />
        <SelectField label="Country" value="PK" options={COUNTRIES} disabled onChange={() => undefined} />
        <SelectField
          label="Measurement network"
          hint='Badges and filtering follow this network. "All networks" marks a site blocked only when every network blocks it.'
          value={settings.preferredIsp}
          options={networkOptions}
          onChange={(preferredIsp) => void update({ preferredIsp })}
        />
      </Section>

      <Section title="When a site does not open" description="Right-click any link or page and choose “Does this open in Pakistan?” to check it at any time.">
        <Switch
          checked={settings.explainFailures}
          label="Explain sites that fail to load"
          description="Shows whether the site is blocked in Pakistan, with an archived copy. Chrome will ask to see page load errors; only the failing site's domain is checked."
          onChange={(enabled) => void failureHelper.setEnabled(enabled)}
        />
        <ErrorText message={failureHelper.error} />
      </Section>

      <Section title="Filtering" description="Results are hidden only when the evidence is strong enough for the chosen mode.">
        <OptionList
          name="filter-mode"
          value={settings.filterMode}
          options={FILTER_MODES}
          onChange={(filterMode) => void update({ filterMode })}
        />
        <Switch
          checked={settings.showUnknown}
          label="Show unknown websites"
          description="Keep results with unknown status or server errors visible"
          onChange={(showUnknown) => void update({ showUnknown })}
        />
      </Section>

      <Section
        title="Video downloader"
        description="Shows a download icon for direct video and audio files (MP4, WebM, MOV, MKV, AVI, MP3, M4A, WAV and more). Streaming, DRM-protected and sign-in-only media are never downloaded."
      >
        <Switch
          checked={settings.videoDownloader}
          label="Enable video downloader"
          description="Chrome will ask for download and site access. Downloads only start when you click."
          onChange={(enabled) => void downloader.setEnabled(enabled)}
        />
        <ErrorText message={downloader.error} />
        <div className={`flex flex-col gap-3 ${dimmedWhen(!settings.videoDownloader)}`}>
          <Switch
            checked={settings.videoOnGoogle}
            label="Icons on search results"
            description="Marks direct video files and streaming-only videos in search results"
            onChange={(videoOnGoogle) => void update({ videoOnGoogle })}
          />
          <Switch
            checked={settings.videoOnPages}
            label="Icons on video pages"
            description="Detects video and audio players, media links and the page's own published video file"
            onChange={(videoOnPages) => void update({ videoOnPages })}
          />
          <Switch
            checked={settings.videoShowUnavailable}
            label="Show not-downloadable icons"
            description="Also mark streaming and DRM videos (Facebook, YouTube, reels) with a grey icon"
            onChange={(videoShowUnavailable) => void update({ videoShowUnavailable })}
          />
        </div>
      </Section>

      <Section
        title="Stream downloads (HLS / DASH)"
        description="On these websites, streamed videos (HLS .m3u8 and DASH .mpd) are downloaded piece by piece and saved as one file. Only add websites whose videos you own or have permission to download. Encrypted, DRM and live streams are never downloaded."
      >
        <DomainListEditor
          domains={settings.streamDomains}
          disabled={!settings.videoDownloader}
          placeholder="example.com"
          onAdd={addStreamDomain}
          onRemove={(domain) => void update((current) => ({ streamDomains: current.streamDomains.filter((item) => item !== domain) }))}
        />
        <div className={`flex flex-col gap-3 ${dimmedWhen(!settings.videoDownloader)}`}>
          <SelectField
            label="Stream quality"
            hint="Lower quality downloads faster and uses less internet data."
            value={settings.streamQuality}
            options={STREAM_QUALITIES}
            onChange={(streamQuality) => void update({ streamQuality })}
          />
          <Switch
            checked={settings.saveSubtitles}
            label="Save subtitles"
            description="When a stream has subtitles, also save them as a .vtt file next to the video"
            onChange={(saveSubtitles) => void update({ saveSubtitles })}
          />
        </div>
      </Section>

      <Section
        title="Night downloads"
        description="Videos you mark “Tonight” in the popup start downloading in this window, when night internet packages are cheaper. Keep the browser open."
      >
        <div className={`grid grid-cols-2 gap-3 ${dimmedWhen(!settings.videoDownloader)}`}>
          <SelectField
            label="Starts at"
            value={settings.nightStartHour}
            options={HOUR_OPTIONS}
            isOptionDisabled={(hour) => hour === settings.nightEndHour}
            onChange={(nightStartHour) => void update({ nightStartHour })}
          />
          <SelectField
            label="Ends at"
            value={settings.nightEndHour}
            options={HOUR_OPTIONS}
            isOptionDisabled={(hour) => hour === settings.nightStartHour}
            onChange={(nightEndHour) => void update({ nightEndHour })}
          />
        </div>
      </Section>

      <Section title="Checking frequency" description="How long a measurement is reused before the site is checked again.">
        <SelectField value={settings.minCacheMinutes} options={CHECK_FREQUENCIES} onChange={(minCacheMinutes) => void update({ minCacheMinutes })} />
      </Section>

      <Section title="Measurements and cache" description="Measured by a server inside Pakistan and cross-checked with OONI.">
        <ServiceSummary overview={overview} />
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void refresh()}>
            Refresh measurements
          </Button>
          <Button disabled={busy} onClick={() => void clearCache()}>
            Clear cache
          </Button>
        </div>
      </Section>

      <Section title="Privacy">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Only domain names are sent to the checking service: search results, sites you check from the right-click menu,
          and, if you turn it on, sites that fail to load. Search queries, full URLs and browsing history are never
          collected, and no account is needed. Videos download straight from the website to
          your computer through Chrome; nothing passes through our server.
        </p>
      </Section>
    </main>
  );
}
