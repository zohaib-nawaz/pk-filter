import { BRAND } from '../core/brand';
import { countryName } from '../core/countries';
import { describeFailure } from '../core/net-errors';
import { parseSiteReport, type SiteReportParams } from '../core/site-report';
import { verdictFor } from '../core/site-view';
import { Button } from '../ui/components/Button';
import { SiteStatusCard } from '../ui/components/SiteStatusCard';
import { useSettings } from '../ui/hooks/useSettings';
import { useSiteStatus, type SiteCardState } from '../ui/hooks/useSiteStatus';

const params = parseSiteReport(location.search);

function heading(report: SiteReportParams, state: SiteCardState): string {
  if (report.mode === 'failed') {
    return `${report.domain} did not open`;
  }
  if (state.phase === 'ready') {
    return `Does ${report.domain} open in ${countryName(state.view.country)}?`;
  }
  return `Is ${report.domain} blocked?`;
}

function openTarget(report: SiteReportParams): string {
  if (report.url) {
    return report.url;
  }
  return `https://${report.domain}/`;
}

function renderVerdict(state: SiteCardState) {
  if (state.phase !== 'ready') {
    return null;
  }
  return <p className="text-sm text-neutral-700 dark:text-neutral-200">{verdictFor(state.view.statusKey, state.view.country)}</p>;
}

function renderFailure(report: SiteReportParams) {
  if (report.mode !== 'failed') {
    return null;
  }
  return <p className="text-sm text-neutral-500 dark:text-neutral-400">{describeFailure(report.error)}</p>;
}

function renderActions(report: SiteReportParams) {
  if (report.mode === 'failed' && report.url) {
    const retry = report.url;
    return (
      <Button variant="primary" onClick={() => location.assign(retry)}>
        Try again
      </Button>
    );
  }
  return (
    <div className="flex gap-2">
      <Button variant="primary" onClick={() => window.open(openTarget(report), '_blank', 'noopener')}>
        Open site
      </Button>
      <Button onClick={() => window.close()}>Close</Button>
    </div>
  );
}

function Report({ report }: { report: SiteReportParams }) {
  const { settings } = useSettings();
  const site = useSiteStatus(settings?.preferredIsp, report.domain);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <header className="flex items-center gap-2.5">
        <img src="/icons/icon-32.png" alt="" className="h-6 w-6" />
        <span className="text-sm font-semibold">{BRAND.name}</span>
      </header>
      <section className="flex flex-col gap-1.5">
        <h1 className="break-words text-lg font-semibold">{heading(report, site.state)}</h1>
        {renderFailure(report)}
        {renderVerdict(site.state)}
      </section>
      <SiteStatusCard state={site.state} />
      {renderActions(report)}
    </main>
  );
}

export function App() {
  if (!params) {
    return <p className="p-6 text-sm">Nothing to check.</p>;
  }
  return <Report report={params} />;
}
