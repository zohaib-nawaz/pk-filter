export function dimmedWhen(disabled: boolean | undefined): string {
  if (disabled) {
    return 'pointer-events-none opacity-50';
  }
  return '';
}
