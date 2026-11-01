import { CHECK_FREQUENCIES, FILTER_MODES } from '../core/settings';
import { Button } from '../ui/components/Button';
import { OptionList } from '../ui/components/OptionList';
import { Section } from '../ui/components/Section';
import { ServiceSummary } from '../ui/components/ServiceSummary';
import { Switch } from '../ui/components/Switch';
import { useOverview } from '../ui/hooks/useOverview';
import { useSettings } from '../ui/hooks/useSettings';

const selectClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

export function App() {
  const { settings, update } = useSettings();
  const { overview, busy, refresh, clearCache } = useOverview();

  if (!settings) return null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-10">
      <header>
        <h1 className="text-xl font-semibold">PK Access Filter settings</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Shows whether Google results open from Pakistani networks. Nothing is hidden unless you choose a filter.
        </p>
      </header>

      <Section title="General">
        <Switch checked={settings.enabled} label="Enable on Google Search" onChange={(enabled) => void update({ enabled })} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Country</span>
          <select className={selectClass} value="PK" disabled>
            <option value="PK">Pakistan</option>
          </select>
        </label>
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

      <Section title="Checking frequency" description="How long a measurement is reused before the site is checked again.">
        <select
          className={selectClass}
          value={settings.minCacheMinutes}
          onChange={(event) => void update({ minCacheMinutes: Number(event.target.value) })}
        >
          {CHECK_FREQUENCIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
          Only the domain names of search results are sent to the checking service. Search queries, full URLs and
          browsing history are never collected, and no account is needed.
        </p>
      </Section>
    </main>
  );
}
