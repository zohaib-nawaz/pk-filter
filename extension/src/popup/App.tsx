import { FILTER_MODES } from '../core/settings';
import { Button } from '../ui/components/Button';
import { OptionList } from '../ui/components/OptionList';
import { ServiceSummary } from '../ui/components/ServiceSummary';
import { Switch } from '../ui/components/Switch';
import { useOverview } from '../ui/hooks/useOverview';
import { useSettings } from '../ui/hooks/useSettings';
import { Header } from './components/Header';

export function App() {
  const { settings, update } = useSettings();
  const { overview, busy, refresh } = useOverview();

  if (!settings) return <div className="h-40 w-80" />;

  return (
    <main className="flex w-80 flex-col gap-4 p-4">
      <Header enabled={settings.enabled} onToggle={(enabled) => void update({ enabled })} />

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
        <Button onClick={() => void chrome.runtime.openOptionsPage()}>Settings</Button>
      </div>
    </main>
  );
}
