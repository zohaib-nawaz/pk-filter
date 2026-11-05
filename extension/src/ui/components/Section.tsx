import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

function renderDescription(description: string | undefined) {
  if (!description) {
    return null;
  }
  return <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{description}</p>;
}

export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <h2 className="text-sm font-semibold">{title}</h2>
      {renderDescription(description)}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}
