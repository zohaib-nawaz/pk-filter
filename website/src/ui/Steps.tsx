import type { Step } from '../core/content';
import { StatusBadge } from './StatusBadge';

interface StatusHelp {
  label: string;
  color: string;
  text: string;
}

export function Steps({ steps, statuses }: { steps: Step[]; statuses: StatusHelp[] }) {
  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
      <ol className="flex flex-col gap-6">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">{index + 1}</span>
            <div>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <ul className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        {statuses.map((status) => (
          <li key={status.label} className="flex flex-col gap-1.5">
            <StatusBadge label={status.label} color={status.color} />
            <span className="text-sm text-neutral-600 dark:text-neutral-300">{status.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
