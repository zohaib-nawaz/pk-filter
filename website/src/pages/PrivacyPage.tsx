import { POLICY, POLICY_UPDATED, type PolicySection } from '../core/privacy';

function renderItems(items: string[] | undefined) {
  if (!items) {
    return null;
  }
  return (
    <ul className="mt-3 list-disc space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Section({ section }: { section: PolicySection }) {
  return (
    <section className="border-t border-neutral-200 pt-8 dark:border-neutral-800">
      <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
      {section.paragraphs.map((paragraph) => (
        <p key={paragraph} className="mt-3">
          {paragraph}
        </p>
      ))}
      {renderItems(section.items)}
    </section>
  );
}

export function PrivacyPage({ issuesUrl }: { issuesUrl: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Privacy</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mt-3 text-neutral-500 dark:text-neutral-400">Last updated {POLICY_UPDATED}</p>
      <div className="mt-10 flex flex-col gap-8 leading-relaxed text-neutral-700 dark:text-neutral-200">
        {POLICY.map((section) => (
          <Section key={section.title} section={section} />
        ))}
        <section className="border-t border-neutral-200 pt-8 dark:border-neutral-800">
          <h2 className="text-xl font-semibold tracking-tight">Questions</h2>
          <p className="mt-3">
            Open an issue on{' '}
            <a href={issuesUrl} className="font-medium text-emerald-700 underline dark:text-emerald-400">
              GitHub
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
