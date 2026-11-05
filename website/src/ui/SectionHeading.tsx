interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  text?: string;
}

function renderText(text: string | undefined) {
  if (!text) {
    return null;
  }
  return <p className="mt-3 text-base text-neutral-600 dark:text-neutral-300">{text}</p>;
}

export function SectionHeading({ eyebrow, title, text }: SectionHeadingProps) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {renderText(text)}
    </div>
  );
}
