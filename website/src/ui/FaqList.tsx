import type { Question } from '../core/content';

export function FaqList({ questions }: { questions: Question[] }) {
  return (
    <div className="mt-10 divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      {questions.map((item) => (
        <details key={item.question} className="group p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
            {item.question}
            <span className="text-neutral-400 transition-transform group-open:rotate-45" aria-hidden>
              +
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
