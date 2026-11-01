import { useState } from 'react';
import { countActive } from '../core/downloads';
import { FILTER_MODES } from '../core/settings';
import { Button } from '../ui/components/Button';
import { DownloadList } from '../ui/components/DownloadList';
import { OptionList } from '../ui/components/OptionList';
import { ServiceSummary } from '../ui/components/ServiceSummary';
import { Switch } from '../ui/components/Switch';
import { Tabs } from '../ui/components/Tabs';
import { useDownloads } from '../ui/hooks/useDownloads';
import { useOverview } from '../ui/hooks/useOverview';
import { useSettings } from '../ui/hooks/useSettings';
import { Header } from './components/Header';

type Tab = 'filter' | 'downloads';

const openSettings = () => void chrome.runtime.openOptionsPage();

export function App() {
  const { settings, update } = useSettings();
  const { overview, busy, refresh } = useOverview();
  const downloads = useDownloads();
  const [tab, setTab] = useState<Tab>('filter');

  if (!settings) return <div className="h-40 w-80" />;

  const active = countActive(downloads.items);
  const tabs = [
    { value: 'filter' as const, label: 'Accessibility' },
    { value: 'downloads' as const, label: active > 0 ? `Downloads (${active})` : 'Downloads' },
  ];

  return (
    <main className="flex w-80 flex-col gap-4 p-4">
      <Header enabled={settings.enabled} onToggle={(enabled) => void update({ enabled })} />
      <Tabs value={tab} options={tabs} onChange={setTab} />

      {tab === 'filter' ? (
        <>
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
          {overview?.sync.lastError && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {overview.sync.lastError}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" disabled={busy || !settings.enabled} onClick={() => void refresh()}>
              {busy ? 'Refreshing…' : 'Refresh measurements'}
            </Button>
            <Button onClick={openSettings}>Settings</Button>
          </div>
        </>
      ) : (
        <DownloadList
          items={downloads.items}
          enabled={settings.videoDownloader && downloads.available}
          message={downloads.message}
          onOpenSettings={openSettings}
          onPause={(id) => void downloads.pause(id)}
          onResume={(id) => void downloads.resume(id)}
          onCancel={(id) => void downloads.cancel(id)}
          onRetry={(view) => void downloads.retry(view.record)}
          onOpen={(id) => void downloads.open(id)}
          onShow={(id) => void downloads.show(id)}
          onRemove={(id) => void downloads.remove(id)}
        />
      )}
    </main>
  );
}
