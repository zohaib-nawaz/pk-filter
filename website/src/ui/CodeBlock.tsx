export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-100">
      <figcaption className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">{label}</figcaption>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
