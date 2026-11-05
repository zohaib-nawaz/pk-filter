import type { Feature } from '../core/content';
import { Icon } from './Icon';

export function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {features.map((feature) => (
        <li key={feature.title} className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Icon name={feature.icon} />
          </span>
          <h3 className="mt-4 font-semibold">{feature.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{feature.text}</p>
        </li>
      ))}
    </ul>
  );
}
