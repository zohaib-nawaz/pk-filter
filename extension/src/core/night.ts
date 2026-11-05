const HOUR_MS = 3_600_000;

export function inNightWindow(date: Date, startHour: number, endHour: number): boolean {
  const hour = date.getHours();
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function nextNightStart(now: Date, startHour: number): Date {
  const next = new Date(now);
  next.setHours(startHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

export function hoursUntil(target: Date, now: Date): number {
  return Math.max(0, Math.round((target.getTime() - now.getTime()) / HOUR_MS));
}

export const HOUR_OPTIONS: Array<{ value: number; label: string }> = Array.from({ length: 24 }, (_, value) => ({ value, label: formatHour(value) }));
