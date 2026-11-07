export function LoadingNote({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
      <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden />
      {text}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      {message}
    </p>
  );
}

export function WarningNote({ message }: { message: string }) {
  return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{message}</p>;
}
