import type { InstallGuide } from '../core/content';

interface InstallTabsProps {
  guides: InstallGuide[];
  selected: string;
  releasesUrl: string;
  onSelect: (id: string) => void;
}

function tabClass(active: boolean): string {
  if (active) {
    return 'bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-white';
  }
  return 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white';
}

function renderGuide(guide: InstallGuide | undefined) {
  if (!guide) {
    return null;
  }
  return (
    <ol className="flex flex-col gap-3" id={`install-${guide.id}`} role="tabpanel">
      {guide.steps.map((step, index) => (
        <li key={step} className="flex gap-3 text-sm leading-relaxed">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold dark:bg-neutral-800">{index + 1}</span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallTabs({ guides, selected, releasesUrl, onSelect }: InstallTabsProps) {
  const guide = guides.find((item) => item.id === selected);
  return (
    <div className="mt-10 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div role="tablist" className="inline-flex rounded-xl bg-neutral-100 p-1 dark:bg-neutral-950">
        {guides.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === selected}
            aria-controls={`install-${item.id}`}
            onClick={() => onSelect(item.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tabClass(item.id === selected)}`}
          >
            {item.browser}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
        {renderGuide(guide)}
        <a href={releasesUrl} className="inline-flex justify-center rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
          Open the releases page
        </a>
      </div>
    </div>
  );
}
