import { useEffect, useState } from 'react';
import { countActive } from '../core/downloads';
import { FILTER_MODES } from '../core/settings';
import type { PageVideo } from '../core/types';
import { Button } from '../ui/components/Button';
import { DownloadList } from '../ui/components/DownloadList';
import { OptionList } from '../ui/components/OptionList';
import { PageVideoList } from '../ui/components/PageVideoList';
import { ScheduledList } from '../ui/components/ScheduledList';
import { ServiceSummary } from '../ui/components/ServiceSummary';
import { Switch } from '../ui/components/Switch';
import { SiteStatusCard } from '../ui/components/SiteStatusCard';
import { Tabs } from '../ui/components/Tabs';
import { useDownloads } from '../ui/hooks/useDownloads';
import { useOverview } from '../ui/hooks/useOverview';
import { usePageVideos } from '../ui/hooks/usePageVideos';
import { useScheduled } from '../ui/hooks/useScheduled';
import { useSiteStatus } from '../ui/hooks/useSiteStatus';
import { useSettings } from '../ui/hooks/useSettings';
import { Header } from './components/Header';

type Tab = 'filter' | 'downloads';

const openSettings = () => void chrome.runtime.openOptionsPage();

function downloadsLabel(videoCount: number, active: number): string {
  if (videoCount > 0) {
    return `Videos (${videoCount})`;
  }
  if (active > 0) {
    return `Downloads (${active})`;
  }
  return 'Downloads';
}

function pageVideoList(videos: PageVideo[] | null): PageVideo[] {
  if (!videos) {
    return [];
  }
  return videos;
}

export function App() {
  const { settings, update } = useSettings();
  const { overview, busy, refresh } = useOverview();
  const downloads = useDownloads();
  const pageVideos = usePageVideos();
  const site = useSiteStatus(settings?.preferredIsp);
  const scheduled = useScheduled();
  const [tab, setTab] = useState<Tab>('filter');
  const [tabChosen, setTabChosen] = useState(false);
  const videos = pageVideoList(pageVideos.videos);

  useEffect(() => {
    if (!tabChosen && videos.length > 0) {
      setTab('downloads');
    }
  }, [tabChosen, videos.length]);

  if (!settings) {
    return <div className="h-40 w-80" />;
  }

  const chooseTab = (next: Tab) => {
    setTabChosen(true);
    setTab(next);
  };

  const tabs = [
    { value: 'filter' as const, label: 'Accessibility' },
    { value: 'downloads' as const, label: downloadsLabel(videos.length, countActive(downloads.items)) },
  ];

  const renderSyncError = () => {
    if (!overview?.sync.lastError) {
      return null;
    }
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        {overview.sync.lastError}
      </p>
    );
  };

  const refreshAll = async () => {
    await refresh();
    await site.reload();
  };

  const refreshLabel = () => {
    if (busy) {
      return 'Refreshing…';
    }
    return 'Refresh measurements';
  };

  const renderFilterTab = () => (
    <>
      <SiteStatusCard state={site.state} />
      <OptionList
        name="filter-mode"
        value={settings.filterMode}
        options={FILTER_MODES}
        disabled={!settings.enabled}
        onChange={(filterMode) => void update({ filterMode })}
      />
      <Switch
        checked={settings.showUnknown}
        label="Show unknown websites"
        description="Keep results without reliable data visible"
        onChange={(showUnknown) => void update({ showUnknown })}
      />
      <ServiceSummary overview={overview} />
      {renderSyncError()}
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={busy || !settings.enabled} onClick={() => void refreshAll()}>
          {refreshLabel()}
        </Button>
        <Button onClick={openSettings}>Settings</Button>
      </div>
    </>
  );

  const renderPageVideos = () => {
    if (!settings.videoDownloader || videos.length === 0) {
      return null;
    }
    return <PageVideoList videos={videos} states={pageVideos.states} onAction={(video, action) => void pageVideos.run(video, action)} />;
  };

  const renderDownloadsTab = () => (
    <>
      {renderPageVideos()}
      <ScheduledList
        items={scheduled.items}
        startHour={settings.nightStartHour}
        endHour={settings.nightEndHour}
        onCancel={(id) => void scheduled.cancel(id)}
      />
      <DownloadList
        items={downloads.items}
        enabled={settings.videoDownloader && downloads.available}
        message={downloads.message}
        onOpenSettings={openSettings}
        onPause={(view) => void downloads.run('pause', view)}
        onResume={(view) => void downloads.run('resume', view)}
        onCancel={(view) => void downloads.run('cancel', view)}
        onRetry={(view) => void downloads.run('retry', view)}
        onOpen={(view) => void downloads.run('open', view)}
        onShow={(view) => void downloads.run('show', view)}
        onRemove={(view) => void downloads.run('remove', view)}
      />
    </>
  );

  const renderTab = () => {
    if (tab === 'filter') {
      return renderFilterTab();
    }
    return renderDownloadsTab();
  };

  return (
    <main className="flex w-80 flex-col gap-4 p-4">
      <Header enabled={settings.enabled} onToggle={(enabled) => void update({ enabled })} />
      <Tabs value={tab} options={tabs} onChange={chooseTab} />
      {renderTab()}
    </main>
  );
}
