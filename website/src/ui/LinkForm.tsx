import { useState, type FormEvent } from 'react';
import { BUTTON_LARGE, FIELD } from './styles';

interface LinkFormProps {
  id: string;
  label: string;
  placeholder: string;
  action: string;
  busy: boolean;
  onSubmit: (value: string) => void;
}

export function LinkForm({ id, label, placeholder, action, busy, onSubmit }: LinkFormProps) {
  const [value, setValue] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        inputMode="url"
        className={`${FIELD} min-w-0 flex-1`}
      />
      <button
        type="submit"
        disabled={busy}
        className={BUTTON_LARGE}
      >
        {action}
      </button>
    </form>
  );
}
