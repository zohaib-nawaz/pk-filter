interface SupportListsProps {
  works: string[];
  limits: string[];
}

function SupportList({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div>
      <h2 className="font-semibold">{heading}</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function SupportLists({ works, limits }: SupportListsProps) {
  return (
    <section className="mt-12 grid gap-6 sm:grid-cols-2">
      <SupportList heading="What works" items={works} />
      <SupportList heading="What does not" items={limits} />
    </section>
  );
}
