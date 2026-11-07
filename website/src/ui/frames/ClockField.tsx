import { useEffect, useState } from 'react';
import { FIELD } from '../styles';

interface ClockFieldProps {
  id: string;
  label: string;
  value: number;
  format: (seconds: number) => string;
  parse: (text: string) => number | null;
  onCommit: (seconds: number) => void;
}

export function ClockField({ id, label, value, format, parse, onCommit }: ClockFieldProps) {
  const [draft, setDraft] = useState(format(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(format(value));
    setInvalid(false);
  }, [value, format]);

  const commit = () => {
    const parsed = parse(draft);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    onCommit(parsed);
  };

  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input
        id={id}
        value={draft}
        aria-invalid={invalid}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          }
        }}
        inputMode="decimal"
        className={`${FIELD} w-full font-mono tabular-nums aria-[invalid=true]:border-red-500`}
      />
    </label>
  );
}
