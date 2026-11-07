interface PageIntroProps {
  eyebrow: string;
  title: string;
  text: string;
}

export function PageIntro({ eyebrow, title, text }: PageIntroProps) {
  return (
    <header>
      <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">{eyebrow}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-300">{text}</p>
    </header>
  );
}
