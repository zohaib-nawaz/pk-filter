interface ErrorTextProps {
  message: string | null | undefined;
}

export function ErrorText({ message }: ErrorTextProps) {
  if (!message) {
    return null;
  }
  return <p className="text-xs text-red-600 dark:text-red-400">{message}</p>;
}
