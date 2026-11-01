import { Switch } from '../../ui/components/Switch';

interface HeaderProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function Header({ enabled, onToggle }: HeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <img src="/icons/icon-32.png" alt="" className="h-6 w-6" />
        <div>
          <h1 className="text-sm font-semibold leading-tight">PK Access Filter</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Country: Pakistan</p>
        </div>
      </div>
      <div className="rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800">
        <Switch checked={enabled} label="Enable on Google Search" onChange={onToggle} />
      </div>
    </header>
  );
}
